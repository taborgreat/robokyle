/* ============================================================
   XP engine.

   XP is never stored as its own record of truth: it is a pure
   function of the domain data (works, votes, references) plus the
   voter weights recorded on each vote. Recomputing a user's XP from
   scratch always gives the same answer, and removing a source — an
   un-vote, a deleted work, a dropped reference — removes its XP by
   construction. The computed totals are cached on the user document
   purely so profiles and rankings read fast.

   The one thing recorded at action time is the voter's weight:
   weights derive from levels, levels from XP, and XP from votes, so
   freezing the weight at vote time is what keeps this a function
   instead of a fixed-point problem.

   XP sources live in the SOURCES registry below: works (E1–E4, E7,
   E13/E14), Talk accepted answers (E10), and verified standard
   compliance (E9). Talk votes are, by deliberate omission, not a
   source and never will be.
   ============================================================ */
const XP = require('../config/xp');

const CATS = new Map(XP.categories.map(c => [c.id, c]));
const zeroTotals = () => Object.fromEntries(XP.categoryIds.map(id => [id, 0]));

/* ---------- curve, levels, titles ---------- */

function levelFor(xp) {
  return Math.min(Math.floor(Math.sqrt(Math.max(0, xp) / XP.levelCurve.base)), XP.levelCurve.cap);
}

// XP needed to reach level L in total.
const xpForLevel = (L) => XP.levelCurve.base * L * L;

function titleFor(categoryId, level) {
  const cat = CATS.get(categoryId);
  if (!cat || !cat.titles.length) return null;
  let title = null;
  for (const [min, name] of cat.titles) if (level >= min) title = name;
  return title;
}

function innovationTier(innovXp) {
  let tier = null;
  for (const [min, name] of XP.innovationTiers) if (innovXp >= min) tier = name;
  return tier;
}

/* ---------- weight vectors ---------- */

/* The declared 1–3 category split, as fractions, with the composite
   bonus: works that reference other works gain sys weight because
   composition is the Systems skill. */
function effectiveWeights(design) {
  // Declarations are required at creation, so this cannot be empty in practice.
  const declared = design.categories || [];
  const vec = {};
  for (const c of declared) vec[c.id] = (vec[c.id] || 0) + c.weight / 100;

  const refs = new Set((design.uses || []).map(u => String(u.work))).size;
  const sysBonus = Math.min(refs * XP.composite.perReference, XP.composite.cap);
  if (sysBonus > 0) {
    vec.sys = (vec.sys || 0) + sysBonus;
    const sum = Object.values(vec).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(vec)) vec[k] /= sum;
  }
  return vec;
}

function dominantCategory(design) {
  const vec = effectiveWeights(design);
  const top = Object.entries(vec).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : XP.visibleCategoryIds[0];
}

/* ---------- voter weight (§4) ---------- */

function levelsOf(user) {
  const cats = (user.xp && user.xp.cats) || {};
  const levels = {};
  let totalLevel = 0;
  for (const id of XP.visibleCategoryIds) {
    levels[id] = levelFor(cats[id] || 0);
    totalLevel += levels[id];
  }
  return { levels, totalLevel };
}

/* clamp(base + perCatLevel×level(v,c) + perTotalLevel×TotalLevel(v)).
   New accounts land on the floor: visible socially, nearly worthless for XP. */
function voterWeight(voterUser, categoryId) {
  const { levels, totalLevel } = levelsOf(voterUser);
  const w = XP.voteWeight.base
    + XP.voteWeight.perCatLevel * (levels[categoryId] || 0)
    + XP.voteWeight.perTotalLevel * totalLevel;
  return Math.min(Math.max(w, XP.voteWeight.min), XP.voteWeight.max);
}

/* ---------- downvote accountability ---------- */

/* A reason card's state, derived from its votes. After the freeze window only
   votes cast inside it count, so the state cannot flip forever. */
function reasonState(reason, now = Date.now()) {
  const A = XP.accountability;
  const freezeAt = new Date(reason.createdAt).getTime() + A.stateFreezeDays * 86400e3;
  const counted = (reason.rvotes || []).filter(v => now <= freezeAt || new Date(v.at).getTime() <= freezeAt);
  const net = counted.reduce((a, v) => a + v.dir * (v.weight || XP.voteWeight.min), 0);
  const voters = new Set(counted.map(v => String(v.user))).size;
  if (net >= A.endorseNet && voters >= A.endorseQuorum) return 'endorsed';
  if (net <= A.strikeNet && voters >= A.strikeQuorum) return 'struck';
  return 'standing';
}

const reasonFrozen = (reason, now = Date.now()) =>
  now > new Date(reason.createdAt).getTime() + XP.accountability.stateFreezeDays * 86400e3;

/* ---------- the recompute ---------- */

const utcDay = (d) => new Date(d).toISOString().slice(0, 10);

/* The models are required lazily so this module never participates in a
   require cycle (models embed lib/social, which requires this file). */
const models = () => ({
  Design: require('../models/Design'),
  TalkPost: require('../models/TalkPost'),
  Comment: require('../models/Comment'),
  User: require('../models/User'),
  ProducedEntry: require('../models/ProducedEntry'),
  DocRevision: require('../models/DocRevision'),
  ModAction: require('../models/ModAction'),
});

const totalXpOf = (user) =>
  Object.values((user && user.xp && user.xp.cats) || {}).reduce((a, b) => a + b, 0);
const round1 = (n) => Math.round(n * 10) / 10;

/* ---- source: works (E1–E4, E7, E13/E14) ---- */
async function workEntries(userId, entries) {
  const { Design } = models();

  const authored = await Design.find({ author: userId })
    .select('title categories uses depth createdAt history upvotes downvotes downvoteReasons author')
    .sort({ createdAt: 1 });

  /* Publishes: first N per UTC day earn XP, the rest earn 0 (anti-spam).
     A fork or near-duplicate publishes at the derived rate. */
  const perDay = {};
  for (const w of authored) {
    const day = utcDay(w.createdAt);
    perDay[day] = (perDay[day] || 0) + 1;
    if (perDay[day] > XP.caps.publishesPerDay) continue;
    const amount = (w.depth || 0) > 0 ? XP.amounts.publishDerived : XP.amounts.publishOriginal;
    entries.push({ at: w.createdAt, kind: (w.depth || 0) > 0 ? 'publish-derived' : 'publish',
                   amount, vec: effectiveWeights(w), workId: w._id, workTitle: w.title });
  }

  /* Versions: capped per work per day AND per account per day (F7), so a big
     catalog is not a quiet treadmill. Late versions publish fine, earn 0. */
  const accountVersionsPerDay = {};
  for (const w of authored) {
    const vec = effectiveWeights(w);
    const versionsPerDay = {};
    for (const h of w.history || []) {
      const day = utcDay(h.createdAt || w.createdAt);
      versionsPerDay[day] = (versionsPerDay[day] || 0) + 1;
      if (versionsPerDay[day] > XP.caps.versionsPerWorkPerDay) continue;
      // Only versions that actually earn consume the account-wide budget.
      if ((accountVersionsPerDay[day] || 0) >= XP.caps.versionsPerDay) continue;
      accountVersionsPerDay[day] = (accountVersionsPerDay[day] || 0) + 1;
      entries.push({ at: h.createdAt || w.createdAt, kind: 'version',
                     amount: XP.amounts.version, vec, workId: w._id, workTitle: w.title });
    }
  }

  /* Votes: weight was frozen at vote time. One voter's positive XP to this
     author is capped for life; a work's net vote XP never drops below the
     negative of what publishing it earned. */
  const perVoter = {};
  for (const w of authored) {
    const vec = effectiveWeights(w);
    const publishAmount = (w.depth || 0) > 0 ? XP.amounts.publishDerived : XP.amounts.publishOriginal;
    let net = 0;
    /* F3: the Nth upvote on a work damps, so audience size stops inflating XP
       and a level means the same thing in any era. Ordered by vote time: the
       early, informed votes carry the value. */
    const dampFor = (index) => {
      let seen = 0;
      for (const [upTo, mult] of XP.voteDamping) {
        if (index < upTo) return mult;
        seen = upTo;
      }
      return XP.voteDamping[XP.voteDamping.length - 1][1];
    };
    const orderedUp = [...(w.upvotes || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    const votes = [
      ...orderedUp.map((v, i) => ({ v, sign: 1, damp: dampFor(i) })),
      ...(w.downvotes || []).map(v => ({ v, sign: -1, damp: 1 })),
    ];
    for (const { v, sign, damp } of votes) {
      if (!v || !v.user || String(v.user) === String(userId)) continue;  // self-votes earn 0
      if (sign < 0) {
        // A downvote's XP stands or falls with its reason: struck = voided,
        // and a downvote that somehow has no reason card carries no XP at all.
        const reason = (w.downvoteReasons || []).find(r => String(r.user) === String(v.user));
        if (!reason || reasonState(reason) === 'struck') continue;
      }
      let amount = sign * XP.amounts.vote * (v.weight || XP.voteWeight.min) * damp;
      if (amount > 0) {
        const key = String(v.user);
        const room = XP.caps.voterToAuthorLifetime - (perVoter[key] || 0);
        amount = Math.max(0, Math.min(amount, room));
        perVoter[key] = (perVoter[key] || 0) + amount;
      }
      if (amount < 0) amount = Math.max(amount, -publishAmount - net);   // the floor
      if (amount === 0) continue;
      entries.push({ at: v.at || w.createdAt, kind: sign > 0 ? 'upvote' : 'downvote',
                     amount, vec, workId: w._id, workTitle: w.title, who: v.user });
      net += amount;
    }
  }

  /* References: another author's work using yours — one of the only places
     Innovation can come from. */
  const authoredIds = authored.map(w => w._id);
  if (authoredIds.length) {
    const referencing = await Design.find({ 'uses.work': { $in: authoredIds } })
      .select('title author uses createdAt upvotes downvotes');
    const mine = new Map(authored.map(w => [String(w._id), w]));
    for (const ref of referencing) {
      if (String(ref.author) === String(userId)) continue;   // self-references earn 0
      /* F4: junk works referencing real ones emit nothing. The reference pays
         once the referencing work itself clears the liveness bar — and since
         XP is a recompute, "fires late but fires once" needs no machinery. */
      const netVotes = (ref.upvotes || []).reduce((a, v) => a + (v.weight || XP.voteWeight.min), 0)
                     - (ref.downvotes || []).reduce((a, v) => a + (v.weight || XP.voteWeight.min), 0);
      if (netVotes < XP.referenceLiveness.minNetVotes) continue;
      const distinct = new Set((ref.uses || []).map(u => String(u.work)).filter(id => mine.has(id)));
      for (const workId of distinct) {
        const target = mine.get(workId);
        entries.push({ at: ref.createdAt, kind: 'referenced',
                       amount: XP.amounts.referenceSplit, innov: XP.amounts.referenceInnov,
                       vec: effectiveWeights(target), workId: target._id, workTitle: target.title,
                       who: ref.author, refTitle: ref.title, refId: ref._id });
      }
    }
  }

  /* The user as critic: reasons they wrote on other people's works.
     Struck costs them a multiple of the voided downvote (public ledger entries
     stay unnamed — naming the work would unmask an anonymous downvote).
     Endorsed pays into Community, capped per day. */
  const criticized = await Design.find({ 'downvoteReasons.user': userId })
    .select('title categories uses author downvoteReasons');
  const endorsedPerDay = {};
  let recentStrikes = 0;
  for (const w of criticized) {
    if (String(w.author) === String(userId)) continue;
    const vec = effectiveWeights(w);
    for (const r of w.downvoteReasons.filter(r => String(r.user) === String(userId))) {
      const state = reasonState(r);
      if (state === 'struck') {
        const amount = -XP.accountability.e13Multiplier * XP.amounts.vote * (r.weight || XP.voteWeight.min);
        entries.push({ at: r.createdAt, kind: 'downvote-struck', amount, vec });
        if (Date.now() - new Date(r.createdAt).getTime() < 7 * 86400e3) recentStrikes++;
      } else if (state === 'endorsed') {
        const day = utcDay(r.createdAt);
        endorsedPerDay[day] = (endorsedPerDay[day] || 0) + 1;
        if (endorsedPerDay[day] > XP.accountability.e14PerDay) continue;
        entries.push({ at: r.createdAt, kind: 'reason-endorsed',
                       amount: XP.accountability.e14Amount, vec: { comm: 1 } });
      }
    }
  }
  if (recentStrikes > XP.accountability.strikesPerWeekBeforeFlag) {
    console.warn(`[xp] account ${userId} has ${recentStrikes} struck downvotes this week — moderation case`);
  }
}

/* ---- source: Talk (E10 → comm, and nothing else) ----
   Accepted answers are the only XP that exists in Talk. Post votes and
   comment votes there are display-only BY CONSTRUCTION: this walk never
   reads them, which is the Talk Spec's "fuel removal" — do not add them.
   test/talk-no-xp.test.js asserts this stays true. */
async function talkEntries(userId, entries) {
  const { TalkPost, Comment } = models();
  const mine = await Comment.find({ author: userId, targetType: 'talk' }).select('_id');
  if (!mine.length) return;
  const accepted = await TalkPost.find({
    acceptedAnswer: { $in: mine.map(c => c._id) },
    author: { $ne: userId },                       // accepting your own answer earns 0
  }).select('title acceptedAt createdAt');
  // First N acceptances per UTC day earn; the rest earn 0 (F2 anti-farm cap).
  const perDay = {};
  for (const p of accepted.sort((a, b) => new Date(a.acceptedAt || a.createdAt) - new Date(b.acceptedAt || b.createdAt))) {
    const at = p.acceptedAt || p.createdAt;
    const day = utcDay(at);
    perDay[day] = (perDay[day] || 0) + 1;
    if (perDay[day] > XP.caps.acceptedAnswersPerDay) continue;
    entries.push({ at, kind: 'accepted-answer', amount: XP.amounts.acceptedAnswer,
                   vec: { comm: 1 }, social: true, talkId: p._id, talkTitle: p.title });
  }
}

/* ---- source: standards (E9 → innov + docs) ----
   Ports Spec §2: a work's `provides` declaration against your standard gets
   verified — interoperability itself is a rewarded contribution. Per unique
   complying work per standard, once; your own works complying earn 0; and
   un-verifying (fraud, edit) removes the XP on recompute because the state
   lives on the declaration itself. */
async function standardEntries(userId, entries) {
  const { Design } = models();
  const standards = await Design.find({ author: userId, type: 'standard' }).select('title');
  if (!standards.length) return;
  const byId = new Map(standards.map(s => [String(s._id), s]));
  const complying = await Design.find({
    author: { $ne: userId },
    'ports.provides': { $elemMatch: { standard: { $in: standards.map(s => s._id) }, status: 'verified' } },
  }).select('title author ports.provides');
  for (const w of complying) {
    const seen = new Set();
    for (const p of w.ports.provides) {
      const sid = String(p.standard);
      if (p.status !== 'verified' || !byId.has(sid) || seen.has(sid)) continue;
      seen.add(sid);
      const std = byId.get(sid);
      entries.push({ at: p.verifiedAt || w.createdAt, kind: 'standard-compliance',
                     amount: XP.amounts.standardComplianceDocs, innov: XP.amounts.standardComplianceInnov,
                     vec: { docs: 1 }, workId: std._id, workTitle: std.title,
                     who: w.author, refTitle: w.title, refId: w._id });
    }
  }
}

/* ---- source: Produced (E5/E6/E11 + entry votes) ----
   The proof layer pays only on VERIFIED entries (models/ProducedEntry:
   challenge window closed, no endorsed or open challenge), so endorsing a
   challenge after the fact reverses everything the entry emitted — the
   poster's E5, the author's E6, and every vote on it — on recompute. */
async function producedEntries(userId, entries) {
  const { Design, User, ProducedEntry } = models();

  /* As the poster: E5 (builds/deployments, capped per day), E11 (usage,
     capped per day), and votes on the entry — usefulness votes that hit the
     poster, never the work's author, so a documented failure still earns. */
  const mine = await ProducedEntry.find({ poster: userId }).sort({ createdAt: 1 });
  if (mine.length) {
    const works = new Map((await Design.find({ _id: { $in: mine.map(e => e.work) } })
      .select('title author uses')).map(w => [String(w._id), w]));
    const perDay = {}, usagePerDay = {};
    for (const e of mine) {
      if (e.entryState() !== 'verified') continue;
      const w = works.get(String(e.work)) || null;   // a deleted work never orphans builders
      const title = w ? w.title : 'a removed work';
      const cat = e.category(w);
      const selfPost = w && String(w.author) === String(userId);
      const day = utcDay(e.createdAt);

      if (!selfPost) {                               // own gallery photos display, earn 0
        if (e.type === 'usage') {
          usagePerDay[day] = (usagePerDay[day] || 0) + 1;
          if (usagePerDay[day] <= XP.produced.usagePerDay) {
            entries.push({ at: e.createdAt, kind: 'fit-report', amount: XP.amounts.fitReport,
                           vec: { abil: 1 }, social: true, workId: e.work, workTitle: title });
          }
        } else {
          perDay[day] = (perDay[day] || 0) + 1;
          if (perDay[day] <= XP.produced.perDay) {
            entries.push({ at: e.createdAt, kind: 'build', amount: XP.amounts.buildBuilder,
                           vec: { [cat]: 1 }, workId: e.work, workTitle: title });
            if (e.type === 'physical' && e.fitFindings) {
              entries.push({ at: e.createdAt, kind: 'build-fit', amount: XP.amounts.buildAbilBonus,
                             vec: { abil: 1 }, workId: e.work, workTitle: title });
            }
          }
        }
      }
      // "Was this result useful?" — E3/E4 on the entry, routed to its poster.
      const votes = [
        ...(e.upvotes || []).map(v => ({ v, sign: 1 })),
        ...(e.downvotes || []).map(v => ({ v, sign: -1 })),
      ];
      for (const { v, sign } of votes) {
        if (!v || !v.user || String(v.user) === String(userId)) continue;
        if (sign < 0) {
          const reason = (e.downvoteReasons || []).find(r => String(r.user) === String(v.user));
          if (!reason || reasonState(reason) === 'struck') continue;
        }
        entries.push({ at: v.at || e.createdAt, kind: sign > 0 ? 'entry-upvote' : 'entry-downvote',
                       amount: sign * XP.amounts.vote * (v.weight || XP.voteWeight.min),
                       vec: { [cat]: 1 }, workId: e.work, workTitle: title, who: v.user });
      }
    }
  }

  /* As the work's author: E6 per unique poster per work (never for failed
     builds — Innovation only accrues from results that worked, at half for
     modified), and E11's innov side when real use is confirmed. Both scale
     with the poster's own standing (F6). */
  const authored = await Design.find({ author: userId }).select('title categories uses');
  if (authored.length) {
    const byId = new Map(authored.map(w => [String(w._id), w]));
    const onMine = await ProducedEntry.find({
      work: { $in: authored.map(w => w._id) }, poster: { $ne: userId },
    }).sort({ createdAt: 1 });
    const posters = new Map((await User.find({ _id: { $in: onMine.map(e => e.poster) } })
      .select('xp')).map(u => [String(u._id), u]));
    const seenE6 = new Set();
    for (const e of onMine) {
      if (e.entryState() !== 'verified' || e.outcome === 'failed') continue;
      const w = byId.get(String(e.work));
      const cred = Math.min(1, totalXpOf(posters.get(String(e.poster))) / XP.builderCredibilityXp);
      if (cred <= 0) continue;
      if (e.type === 'usage') {
        entries.push({ at: e.createdAt, kind: 'fit-confirmed', amount: 0,
                       innov: round1(XP.amounts.fitAuthorInnov * cred),
                       vec: {}, workId: w._id, workTitle: w.title, who: e.poster });
      } else {
        const key = `${e.poster}:${e.work}`;
        if (seenE6.has(key)) continue;
        seenE6.add(key);
        const factor = (e.outcome === 'modified' ? XP.produced.modifiedAuthorFactor : 1) * cred;
        entries.push({ at: e.createdAt, kind: 'build-author',
                       amount: round1(XP.amounts.buildAuthorSplit * factor),
                       innov: round1(XP.amounts.buildAuthorInnov * factor),
                       vec: effectiveWeights(w), workId: w._id, workTitle: w.title, who: e.poster });
      }
    }
  }
}

/* ---- source: doc revisions (E8 → docs + comm) ----
   Accepted words on someone else's work. Your own docs earn through the
   work's weight vector, never here (F5); small touch-ups pay half. */
async function docRevisionEntries(userId, entries) {
  const { Design, DocRevision } = models();
  const applied = await DocRevision.find({ author: userId, appliedAt: { $ne: null } })
    .sort({ appliedAt: 1 });
  if (!applied.length) return;
  const works = new Map((await Design.find({ _id: { $in: applied.map(r => r.work) } })
    .select('title author')).map(w => [String(w._id), w]));
  const total = XP.amounts.docRevision + XP.amounts.docRevisionComm;
  const vec = { docs: XP.amounts.docRevision / total, comm: XP.amounts.docRevisionComm / total };
  const perDay = {};
  for (const r of applied) {
    const w = works.get(String(r.work));
    if (!w || String(w.author) === String(userId)) continue;   // own work: always 0
    const day = utcDay(r.appliedAt);
    perDay[day] = (perDay[day] || 0) + 1;
    if (perDay[day] > XP.docRevisions.perDay) continue;
    const small = DocRevision.diffChars(r.previous, r.text) < XP.docRevisions.smallDiffChars;
    entries.push({ at: r.appliedAt, kind: 'doc-revision',
                   amount: round1(total * (small ? XP.docRevisions.smallDiffFactor : 1)),
                   vec, workId: w._id, workTitle: w.title });
  }
}

/* ---- source: moderation ratified (E12 → comm) ----
   A mod action pays only once it has stood unoverturned past the window;
   overturning later removes the entry on recompute, as always. */
async function modActionEntries(userId, entries) {
  const { ModAction } = models();
  const ripeBefore = new Date(Date.now() - XP.moderationRatify.days * 86400e3);
  const acts = await ModAction.find({ mod: userId, overturnedAt: null, createdAt: { $lte: ripeBefore } })
    .sort({ createdAt: 1 });
  const perDay = {};
  for (const a of acts) {
    const day = utcDay(a.createdAt);
    perDay[day] = (perDay[day] || 0) + 1;
    if (perDay[day] > XP.moderationRatify.perDay) continue;
    entries.push({ at: new Date(a.createdAt.getTime() + XP.moderationRatify.days * 86400e3),
                   kind: 'moderation', amount: XP.amounts.moderation, vec: { comm: 1 }, social: true });
  }
}

/* ---- source: intro (one-time, derived) ----
   A real bio pays a single small Community receipt — the first entry on a
   new account's ledger, the first movement of the bar. Derived from the bio
   existing right now, so it reverses itself if the bio goes. This is the
   only self-action XP in the system; keep it that way. */
async function introEntries(userId, entries) {
  const { User } = models();
  const user = await User.findById(userId).select('bio createdAt');
  if (!user || (user.bio || '').trim().length < XP.intro.bioMinChars) return;
  entries.push({ at: user.createdAt, kind: 'profile-bio', amount: XP.intro.bioAmount,
                 vec: { comm: 1 }, social: true });
}

/* The registry: every place XP can come from, in one list. Talk votes are,
   by deliberate omission, not on it and never will be. */
const SOURCES = [workEntries, talkEntries, standardEntries, producedEntries, docRevisionEntries, modActionEntries, introEntries];

/* One walk over the domain data yields both the totals and the receipts.
   §7.1's ledger tab is this same list rendered — every number on a profile
   decomposes into entries anyone can read, and the two views cannot drift
   because they are one computation. */
async function ledgerFor(userId, { withNames = false } = {}) {
  const entries = [];   // { at, kind, amount, split, workId, workTitle, who, social? }
  for (const source of SOURCES) await source(userId, entries);

  /* Resolve the splits; optionally resolve names for display. */
  for (const e of entries) {
    e.split = {};
    for (const [cat, frac] of Object.entries(e.vec)) e.split[cat] = Math.round(e.amount * frac * 10) / 10;
    if (e.innov) e.split.innov = e.innov;
    delete e.vec;
  }
  if (withNames) {
    const ids = [...new Set(entries.map(e => e.who).filter(Boolean).map(String))];
    const users = await models().User.find({ _id: { $in: ids } }).select('username');
    const names = new Map(users.map(u => [String(u._id), u.username]));
    for (const e of entries) if (e.who) e.whoName = names.get(String(e.who)) || null;
  }
  return entries;
}

/* Everything one user has earned, from scratch: the ledger, folded.
   Social XP (E10–E12) is tracked apart from work XP: both feed category
   levels in full, but RoboXP weights social at 0.6 — works over chat. */
async function computeUserXp(userId) {
  const totals = zeroTotals();
  let workXp = 0, socialXp = 0;
  for (const e of await ledgerFor(userId)) {
    for (const [cat, amt] of Object.entries(e.split)) {
      totals[cat] += amt;
      if (e.social) socialXp += amt; else workXp += amt;
    }
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 10) / 10;
  return { cats: totals, workXp: Math.round(workXp * 10) / 10, socialXp: Math.round(socialXp * 10) / 10 };
}

/* Recompute and cache. Call with the users an action touched;
   the nightly pass calls it for everyone. */
async function recomputeUsers(userIds) {
  const { User } = models();
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  for (const id of unique) {
    const xp = await computeUserXp(id);
    xp.updatedAt = new Date();
    await User.updateOne({ _id: id }, { $set: { xp } });
  }
  return unique.length;
}

async function recomputeAll() {
  const ids = await models().User.find().select('_id');
  return recomputeUsers(ids.map(u => u._id));
}

/* ---------- views ---------- */

const roboXpOf = (user) => {
  const xp = user.xp || {};
  return Math.round(((xp.workXp || 0) + XP.roboXp.socialWeight * (xp.socialXp || 0)) * 10) / 10;
};

function badgesFor(user, downloads) {
  const badges = [];
  const ageHours = (Date.now() - new Date(user.createdAt).getTime()) / 3600e3;
  const { totalLevel } = levelsOf(user);
  const totalXp = Object.values((user.xp && user.xp.cats) || {}).reduce((a, b) => a + b, 0);
  if (ageHours < XP.badges.newUserMaxAgeHours || totalXp < XP.badges.newUserMaxXp) badges.push('new user');
  for (const tier of XP.badges.downloadTiers) {
    if (downloads >= tier) badges.push(`${tier >= 1000 ? tier / 1000 + 'k' : tier} downloads`);
  }
  if (XP.visibleCategoryIds.every(id => levelFor(((user.xp || {}).cats || {})[id] || 0) >= XP.levelCurve.cap)) {
    badges.push('Maxed');
  }
  return { badges, totalLevel };
}

/* The profile's skill panel, straight off the cached totals. */
function xpView(user, downloads = 0) {
  const cats = (user.xp && user.xp.cats) || {};
  const skills = XP.categories.filter(c => !c.hidden).map(c => {
    const xp = Math.round((cats[c.id] || 0) * 10) / 10;
    const level = levelFor(xp);
    const nextAt = level >= XP.levelCurve.cap ? null : xpForLevel(level + 1);
    return {
      id: c.id, name: c.name, icon: c.icon, color: c.color, scope: c.scope, xp, level,
      title: titleFor(c.id, level),
      nextLevelXp: nextAt,
      levelFloorXp: xpForLevel(level),
    };
  });
  // Mastery (99) permanently sets that category's colour into the ring.
  const mastery = skills.filter(s => s.level >= XP.levelCurve.cap).map(s => s.color);
  const top = [...skills].sort((a, b) => b.xp - a.xp)[0];
  const primaryTitle = top && top.xp > 0 ? (top.title || null) : null;
  const innovXp = Math.round((cats.innov || 0) * 10) / 10;
  const { badges, totalLevel } = badgesFor(user, downloads);
  return {
    skills,
    mastery,
    primaryTitle,
    totalLevel,
    roboXp: roboXpOf(user),
    innovation: (innovXp > 0 || XP.innovationDisplay === 'greyed')
      ? { xp: innovXp, tier: innovationTier(innovXp) }
      : null,
    badges,
  };
}

/* §7.1 inline presence: one chip, no more. The primary category is the one
   with the most XP; brand-new accounts self-identify instead. */
function chipFor(user) {
  const cats = (user.xp && user.xp.cats) || {};
  const ageHours = (Date.now() - new Date(user.createdAt).getTime()) / 3600e3;
  const totalXp = XP.visibleCategoryIds.reduce((a, id) => a + (cats[id] || 0), 0);
  if (ageHours < XP.badges.newUserMaxAgeHours || totalXp < XP.badges.newUserMaxXp) {
    return { newUser: true };
  }
  const [topId] = XP.visibleCategoryIds
    .map(id => [id, cats[id] || 0]).sort((a, b) => b[1] - a[1])[0];
  const cat = CATS.get(topId);
  const level = levelFor(cats[topId] || 0);
  return { newUser: false, name: cat.name, color: cat.color, level, title: titleFor(topId, level) || cat.name };
}

module.exports = {
  config: XP,
  levelFor, xpForLevel, titleFor, innovationTier,
  effectiveWeights, dominantCategory,
  voterWeight, levelsOf,
  computeUserXp, recomputeUsers, recomputeAll, ledgerFor, chipFor,
  reasonState, reasonFrozen,
  roboXpOf, xpView,
};

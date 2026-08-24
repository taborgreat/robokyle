/* ============================================================
   Ring detection (§8.3): the nightly walk over the vote graph.

   Three lenses, each producing FLAGS for human review — never automatic
   punishment. Voiding is a deliberate act afterwards, and the lifetime
   voter→author cap already damps the XP itself, so a ring's upside is
   bounded even before anyone looks at the flag.

   - Reciprocity: two accounts pushing serious vote XP at each other.
   - Clusters: small connected groups exchanging most of their vote XP
     internally — the you-vote-mine-I-vote-yours economy.
   - Bursts: one work upvoted by several accounts created within the same
     day — the freshly-minted fan club.
   ============================================================ */
const XP = require('../config/xp');

const models = () => ({
  Design: require('../models/Design'),
  User: require('../models/User'),
  Flag: require('../models/Flag'),
});

/* One pass over every work's upvotes yields the whole weighted vote graph:
   voter → author edges carrying vote XP, plus each work's voter roster for
   the burst lens. Downvotes carry negative XP and buy a ring nothing, so
   only positive edges matter here. */
async function voteGraph() {
  const { Design } = models();
  const edges = new Map();            // "voter:author" -> xp
  const perWork = [];                 // { workId, title, author, voters: [{user, at}] }
  const works = await Design.find().select('title author upvotes');
  for (const w of works) {
    const author = String(w.author);
    const voters = [];
    for (const v of w.upvotes || []) {
      if (!v.user) continue;
      const voter = String(v.user);
      if (voter === author) continue;
      const key = `${voter}:${author}`;
      edges.set(key, (edges.get(key) || 0) + XP.amounts.vote * (v.weight || XP.voteWeight.min));
      voters.push({ user: voter, at: v.at });
    }
    if (voters.length) perWork.push({ workId: w._id, title: w.title, author, voters });
  }
  return { edges, perWork };
}

function findReciprocity(edges, flags) {
  const seen = new Set();
  for (const [key, xpAB] of edges) {
    const [a, b] = key.split(':');
    const pair = [a, b].sort().join(':');
    if (seen.has(pair)) continue;
    seen.add(pair);
    const xpBA = edges.get(`${b}:${a}`) || 0;
    // Mutual benefit is the smaller direction: one-way admiration is fine.
    if (Math.min(xpAB, xpBA) > XP.rings.pairLifetimeXp) {
      flags.push({ kind: 'reciprocity', key: `pair:${pair}`, accounts: [a, b],
                   detail: `mutual vote XP ${Math.round(xpAB)} / ${Math.round(xpBA)}` });
    }
  }
}

function findClusters(edges, flags) {
  // Union-find over meaningful edges, then measure how inward each group is.
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [key, amount] of edges) {
    if (amount < 50) continue;                       // noise floor
    const [a, b] = key.split(':');
    union(a, b);
  }
  const groups = new Map();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }
  for (const members of groups.values()) {
    if (members.length < XP.rings.clusterMinSize || members.length > XP.rings.clusterMaxSize) continue;
    const inside = new Set(members);
    let internal = 0, total = 0;
    for (const [key, amount] of edges) {
      const [a, b] = key.split(':');
      const touches = inside.has(a) || inside.has(b);
      if (!touches) continue;
      total += amount;
      if (inside.has(a) && inside.has(b)) internal += amount;
    }
    if (total > 0 && internal / total > XP.rings.clusterInternalRatio) {
      flags.push({ kind: 'cluster', key: `cluster:${members.sort().join(',')}`, accounts: members,
                   detail: `${members.length} accounts, ${Math.round(100 * internal / total)}% of their vote XP internal` });
    }
  }
}

async function findBursts(perWork, flags) {
  const { User } = models();
  const voterIds = [...new Set(perWork.flatMap(w => w.voters.map(v => v.user)))];
  const created = new Map((await User.find({ _id: { $in: voterIds } }).select('createdAt'))
    .map(u => [String(u._id), u.createdAt.getTime()]));
  const windowMs = XP.rings.burstWindowHours * 3600e3;
  for (const w of perWork) {
    // Sort voters by account creation; a sliding window finds any same-day batch.
    const times = w.voters.map(v => ({ user: v.user, t: created.get(v.user) })).filter(v => v.t)
      .sort((a, b) => a.t - b.t);
    let lo = 0;
    for (let hi = 0; hi < times.length; hi++) {
      while (times[hi].t - times[lo].t > windowMs) lo++;
      const batch = times.slice(lo, hi + 1);
      if (batch.length >= XP.rings.burstMinVotes) {
        flags.push({ kind: 'burst', key: `burst:${w.workId}:${new Date(times[lo].t).toISOString().slice(0, 10)}`,
                     accounts: batch.map(b => b.user),
                     detail: `${batch.length} votes on "${w.title}" from accounts created within ${XP.rings.burstWindowHours}h of each other` });
        break;                                        // one flag per work is enough
      }
    }
  }
}

/* The nightly entry point: computes findings and upserts them as Flag docs.
   Idempotent by key — a persistent ring is one case file, not one per night. */
async function detectRings() {
  const { Flag } = models();
  const { edges, perWork } = await voteGraph();
  const findings = [];
  findReciprocity(edges, findings);
  findClusters(edges, findings);
  await findBursts(perWork, findings);

  let fresh = 0;
  for (const f of findings) {
    const r = await Flag.updateOne({ key: f.key }, { $setOnInsert: f }, { upsert: true });
    if (r.upsertedCount) fresh++;
  }
  if (fresh) console.warn(`[rings] ${fresh} new flag(s) raised — review at /api/users/flags`);
  return { findings: findings.length, fresh };
}

module.exports = { detectRings };

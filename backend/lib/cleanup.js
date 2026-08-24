/* Drops sign-ups that never confirmed their address.
 *
 * An unverified account cannot post a work or a comment, so there is normally
 * nothing attached to one. The content check is still there as a guard: if a
 * row somehow does own something, it is kept and logged rather than taking the
 * work down with it.
 */
const User = require('../models/User');
const Design = require('../models/Design');
const WorkDraft = require('../models/WorkDraft');
const TalkPost = require('../models/TalkPost');
const Comment = require('../models/Comment');
const { UNVERIFIED_TTL_HOURS, DRAFT_EXPIRY_DAYS } = require('./limits');
const XP = require('../config/xp');

async function purgeUnverified() {
  const cutoff = new Date(Date.now() - UNVERIFIED_TTL_HOURS * 3600 * 1000);
  const stale = await User.find({
    emailVerified: false,
    googleId: { $exists: false },     // Google accounts arrive verified
    createdAt: { $lt: cutoff },
  }).select('_id username');

  let removed = 0;
  const kept = [];
  for (const user of stale) {
    const owns = (await Design.exists({ author: user._id }))
      || (await Comment.exists({ author: user._id }))
      || (await TalkPost.exists({ author: user._id }));
    if (owns) { kept.push(user.username); continue; }
    await user.deleteOne();
    removed++;
  }

  if (removed) console.log(`[cleanup] removed ${removed} unverified account(s) older than ${UNVERIFIED_TTL_HOURS}h`);
  if (kept.length) console.log(`[cleanup] kept unverified account(s) that own content: ${kept.join(', ')}`);
  return { removed, kept };
}

/* Drafts idle past the window die; the blob sweep frees their files after. */
async function purgeExpiredDrafts() {
  const cutoff = new Date(Date.now() - DRAFT_EXPIRY_DAYS * 86400e3);
  const res = await WorkDraft.deleteMany({ updatedAt: { $lt: cutoff } });
  if (res.deletedCount) console.log(`[cleanup] removed ${res.deletedCount} draft(s) idle over ${DRAFT_EXPIRY_DAYS} days`);
  return res.deletedCount;
}

/* Produced entries cross their 48h challenge window on the clock, not on a
   request, so the cached state (used only by aggregation counts) is kept warm
   here — and a state flip moves real XP, so the flip recomputes its people.
   The derived entryState() stays the truth; this only chases it. */
async function refreshProducedStates() {
  const ProducedEntry = require('../models/ProducedEntry');
  const xp = require('./xp');
  const candidates = await ProducedEntry.find({ cachedState: 'pending' }).populate('work', 'author');
  const touched = [];
  let flipped = 0;
  for (const e of candidates) {
    const state = e.entryState();
    if (state === e.cachedState) continue;
    e.cachedState = state;
    await e.save();
    flipped++;
    touched.push(e.poster, e.work && e.work.author);
  }
  if (flipped) {
    console.log(`[cleanup] ${flipped} Produced entr${flipped === 1 ? 'y' : 'ies'} changed state`);
    await xp.recomputeUsers(touched.filter(Boolean)).catch(err => console.error('[xp]', err.message));
  }
  return flipped;
}

/* Community acceptance for doc revisions (Part I §5b): approval past the bar,
   the author's veto window over, no veto — the sweep applies it and E8 fires
   through the recompute. */
async function applyRipeDocRevisions() {
  const DocRevision = require('../models/DocRevision');
  const xp = require('./xp');
  const open = await DocRevision.find({ appliedAt: null, 'authorAction.type': null });
  let applied = 0;
  for (const r of open) {
    if (!r.communityRipe()) continue;
    if (await r.apply(null)) {
      applied++;
      await xp.recomputeUsers([r.author]).catch(err => console.error('[xp]', err.message));
    }
  }
  if (applied) console.log(`[cleanup] ${applied} doc revision(s) community-accepted`);
  return applied;
}

/* Deployment liveness (Part II §1): re-ping stale links so the live/offline
   chip stays honest. A dead link never voids anything — it just shows. */
async function checkDeploymentLinks() {
  const ProducedEntry = require('../models/ProducedEntry');
  const stale = new Date(Date.now() - XP.produced.linkCheckDays * 86400e3);
  const entries = await ProducedEntry.find({
    type: 'deployment', link: { $ne: '' },
    $or: [{ 'linkStatus.checkedAt': null }, { 'linkStatus.checkedAt': { $lt: stale } }],
  }).limit(50);
  for (const e of entries) {
    const ok = await fetch(e.link, { signal: AbortSignal.timeout(5000), redirect: 'follow' })
      .then(r => r.status < 500).catch(() => false);
    e.linkStatus = { ok, checkedAt: new Date() };
    await e.save();
  }
  return entries.length;
}

/* Talk threads age out; works don't. Idle threads go read-only — except
   became-work threads, which live as long as their work (Talk Spec §3).
   Revival is the inverse: linking a work or promoting clears archivedAt. */
async function archiveIdleTalk() {
  const cutoff = new Date(Date.now() - XP.talk.archiveDays * 86400e3);
  const res = await TalkPost.updateMany(
    { archivedAt: null, becameWork: null, lastActivityAt: { $lt: cutoff } },
    { $set: { archivedAt: new Date() } },
  );
  if (res.modifiedCount) console.log(`[cleanup] archived ${res.modifiedCount} Talk thread(s) idle over ${XP.talk.archiveDays} days`);
  return res.modifiedCount;
}

module.exports = {
  purgeUnverified, purgeExpiredDrafts, archiveIdleTalk,
  refreshProducedStates, applyRipeDocRevisions, checkDeploymentLinks,
};

/* Drops sign-ups that never confirmed their address.
 *
 * An unverified account cannot post a work or a comment, so there is normally
 * nothing attached to one. The content check is still there as a guard: if a
 * row somehow does own something, it is kept and logged rather than taking the
 * work down with it.
 */
const User = require('../models/User');
const Design = require('../models/Design');
const { UNVERIFIED_TTL_HOURS } = require('./limits');

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
    const owns = await Design.exists({
      $or: [{ author: user._id }, { 'comments.author': user._id }],
    });
    if (owns) { kept.push(user.username); continue; }
    await user.deleteOne();
    removed++;
  }

  if (removed) console.log(`[cleanup] removed ${removed} unverified account(s) older than ${UNVERIFIED_TTL_HOURS}h`);
  if (kept.length) console.log(`[cleanup] kept unverified account(s) that own content: ${kept.join(', ')}`);
  return { removed, kept };
}

module.exports = { purgeUnverified };

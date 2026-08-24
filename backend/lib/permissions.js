/* Every moderation power, phrased as a capability and answered here — never
   as role checks scattered through routes (Talk Spec decision 5). Governance
   evolves by editing these functions, with zero schema churn. */
const xp = require('./xp');

const idOf = (v) => (v && v._id) || v;
const same = (a, b) => a && b && String(idOf(a)) === String(idOf(b));

// The one place that knows which roles exist. Admins hold every capability.
const isMod = (user) => !!user && (user.role === 'admin' || (user.roles || []).includes('mod'));

const isOP = (user, post) => !!user && same(user._id, post.author);

const canEditPost = (user, post) => isOP(user, post) || isMod(user);
const canDeletePost = canEditPost;
const canForkThread = canEditPost;              // "OP or a moderator can slice any reply chain"
const canArchive = (user) => isMod(user);
const canAcceptAnswer = (user, post) => isOP(user, post) || isMod(user);

const canDeleteComment = (user, comment, ownerId) =>
  !!user && (same(user._id, comment.author) || same(user._id, ownerId) || isMod(user));

/* Promotion (plan → work). The OP always can; a participant can once the OP
   approved their request, or once the OP has sat on it past the timeout — an
   absent idea-haver is never a veto. Returns why not, so the route can say. */
function canPromote(user, post) {
  if (!user) return { ok: false, why: 'log in' };
  if (isOP(user, post) || isMod(user)) return { ok: true };
  const isParticipant = (post.plan.participants || []).some(p => same(p.user, user._id));
  if (!isParticipant) return { ok: false, why: 'Join the plan first' };
  const req = post.plan.promotion || {};
  if (!same(req.user, user._id)) return { ok: false, why: 'Ask the plan\'s author first (they have a window to respond)' };
  if (req.approved) return { ok: true };
  const waitedMs = Date.now() - new Date(req.requestedAt || Date.now()).getTime();
  if (waitedMs >= xp.config.talk.promoteTimeoutDays * 86400e3) return { ok: true };
  const daysLeft = Math.ceil(xp.config.talk.promoteTimeoutDays - waitedMs / 86400e3);
  return { ok: false, why: `Waiting on the author (${daysLeft} day(s) before you may promote anyway)` };
}

module.exports = {
  isMod, isOP,
  canEditPost, canDeletePost, canForkThread, canArchive,
  canAcceptAnswer, canDeleteComment, canPromote,
};

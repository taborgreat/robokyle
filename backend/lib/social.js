/* ============================================================
   The social machinery every votable thing shares: weighted votes,
   downvote reason cards, and the judging loop on those reasons.
   Works, Talk posts and Talk comments embed these same schemas, so
   the accountability rules exist in exactly one place. What differs
   per host is only the stakes: work votes feed the XP recompute;
   Talk votes are display-only by construction (lib/xp.js never
   reads them).
   ============================================================ */
const mongoose = require('mongoose');
const xp = require('./xp');

/* A vote records the voter's expertise weight as it stood when they voted.
   Freezing it is what lets XP be recomputed from the domain data alone:
   weights derive from levels and levels from XP, so a live lookup would be
   circular. */
const voteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weight: { type: Number, default: 0.2 },
  at: { type: Date, default: Date.now },
}, { _id: false });

const reasonVoteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dir: { type: Number, enum: [1, -1], required: true },
  weight: { type: Number, default: 0.2 },
  at: { type: Date, default: Date.now },
}, { _id: false });
// Note what is absent: a reason field. Reason-votes are terminal by schema.

/* A downvote's written reason: a visible object in the thread, judged by the
   community. Shown without a username — the author is stored (penalties and
   ring detection need identity) but never serialized. Its state (standing /
   endorsed / struck) is derived from rvotes, never stored, so a shift in the
   judgment re-routes the XP on the next recompute by construction. */
const downvoteReasonSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weight: { type: Number, default: 0.2 },      // the E4 weight, for the E13 sting
  text: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
  rvotes: { type: [reasonVoteSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

// Spread into a schema definition: `...votableFields()`.
const votableFields = () => ({
  upvotes: { type: [voteSchema], default: [] },
  downvotes: { type: [voteSchema], default: [] },
  downvoteReasons: { type: [downvoteReasonSchema], default: [] },
});

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

/* One toggle for both directions on any votable doc: a vote toggles itself
   and displaces its opposite. A downvote is a claim, and claims are
   accountable: no reason, no vote. Mutates the doc; the caller saves. */
function castVote(doc, user, direction, { weight, reason } = {}) {
  const uid = user._id;
  const mine = (list) => list.findIndex(v => v.user && v.user.equals(uid));
  const dropReason = () => {
    const i = doc.downvoteReasons.findIndex(r => r.user.equals(uid));
    // A struck card is a verdict, not a claim: retracting the vote does not
    // erase it, or the penalty would be dodgeable by withdrawing after losing.
    if (i !== -1 && xp.reasonState(doc.downvoteReasons[i]) !== 'struck') {
      doc.downvoteReasons.splice(i, 1);
    }
  };
  const [same, other] = direction === 'up'
    ? [doc.upvotes, doc.downvotes] : [doc.downvotes, doc.upvotes];

  const at = mine(same);
  if (at !== -1) {
    same.splice(at, 1);                          // toggling off
    if (direction === 'down') dropReason();      // the claim goes with the vote
  } else {
    if (direction === 'down') {
      const text = String(reason || '').trim();
      if (text.length < xp.config.accountability.reasonMinLength) {
        fail(400, `Say why, in at least ${xp.config.accountability.reasonMinLength} characters. The reason is posted without your name.`);
      }
      doc.downvoteReasons.push({ user: uid, weight, text: text.slice(0, 2000) });
    }
    const opposite = mine(other);
    if (opposite !== -1) {
      other.splice(opposite, 1);
      if (direction === 'up') dropReason();      // switching to an upvote withdraws the claim
    }
    same.push({ user: uid, weight, at: new Date() });
  }
  return {
    upvoted: mine(doc.upvotes) !== -1,
    downvoted: mine(doc.downvotes) !== -1,
    upvoteCount: doc.upvotes.length,
    downvoteCount: doc.downvotes.length,
  };
}

/* Judging a reason card. Terminal by design: a direction and nothing else,
   so the accountability chain is one level deep and stops. `authorId` is
   whoever the downvote targeted — they answer criticism by replying, not by
   voting it away. Mutates the doc; the caller saves. */
function judgeReason(doc, reasonId, user, { weight, authorId, dir }) {
  const reason = doc.downvoteReasons.id(reasonId);
  if (!reason) fail(404, 'No such reason card');
  if (authorId && authorId.equals(user._id)) {
    fail(403, 'Authors answer criticism by replying, not by voting it away');
  }
  if (reason.user.equals(user._id)) fail(403, 'You wrote this reason');
  if (xp.reasonFrozen(reason)) fail(403, 'This card\'s state is final');
  if (dir !== 1 && dir !== -1) fail(400, 'dir must be 1 or -1');

  const i = reason.rvotes.findIndex(v => v.user.equals(user._id));
  if (i !== -1 && reason.rvotes[i].dir === dir) {
    reason.rvotes.splice(i, 1);                                  // toggle off
  } else {
    if (i !== -1) reason.rvotes.splice(i, 1);                    // switch direction
    reason.rvotes.push({ user: user._id, dir, weight, at: new Date() });
  }
  return reason;
}

/* Anonymous in public, attributed in the database: no username leaves here.
   The viewer learns only which cards are their own. */
function serializeReasons(doc, user) {
  return (doc.downvoteReasons || []).map(r => {
    const state = xp.reasonState(r);
    const myVote = user && r.rvotes.find(v => v.user.equals(user._id));
    return {
      id: r._id, text: r.text, state, createdAt: r.createdAt,
      frozen: xp.reasonFrozen(r),
      voteCount: new Set(r.rvotes.map(v => String(v.user))).size,
      myVote: myVote ? myVote.dir : 0,
      mine: !!(user && r.user.equals(user._id)),
    };
  });
}

const voted = (doc, user, list) =>
  !!(user && (doc[list] || []).some(v => v.user && String(v.user) === String(user._id)));

// Weighted net score: the "usefulness" number Talk sorts by. Display only.
const netScore = (doc) =>
  (doc.upvotes || []).reduce((a, v) => a + (v.weight || 0), 0) -
  (doc.downvotes || []).reduce((a, v) => a + (v.weight || 0), 0);

module.exports = {
  voteSchema, reasonVoteSchema, downvoteReasonSchema, votableFields,
  castVote, judgeReason, serializeReasons, voted, netScore,
};

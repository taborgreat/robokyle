const mongoose = require('mongoose');
const { votableFields, downvoteReasonSchema } = require('../lib/social');
const XP = require('../config/xp');

/* Produced (Part II): the proof layer — the gallery of real-world results on
   a work. Physical builds need media; deployments need a live link; usage
   entries are the Ability-relevant type. Entries are pinned to the numeric
   work version they were made from, so v4's outcome bar never inherits v1's
   failures.

   Verification state is DERIVED, never stored as truth: an entry is verified
   once the challenge window has passed with every challenge either absent or
   struck, and rejected the moment a challenge is endorsed. The XP walk reads
   this same function, so voiding a fraudulent entry (endorsing its challenge)
   reverses the poster's E5 and the author's E6 on the next recompute by
   construction. `cachedState` exists only so card counts can aggregate; the
   sweep keeps it warm and nothing trusts it for XP. */

const mediaSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  storedName: { type: String, required: true },     // CAS hash — checked at the route
  mimeType: String,
  size: Number,
}, { _id: true });

const producedSchema = new mongoose.Schema({
  work: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', required: true, index: true },
  workVersion: { type: Number, required: true },
  poster: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['physical', 'deployment', 'usage'], required: true },
  media: { type: [mediaSchema], default: [] },
  link: { type: String, trim: true, maxlength: 2000, default: '' },
  // Printer/material/settings, or hosting/env, or the context of use.
  process: { type: String, trim: true, maxlength: 2000, default: '' },
  outcome: { type: String, enum: ['success', 'modified', 'failed'], required: true },
  modifications: { type: String, trim: true, maxlength: 4000, default: '' },
  fitFindings: { type: String, trim: true, maxlength: 4000, default: '' },

  // Entry votes mean "was this result useful?" — they hit the poster, never
  // the work's author, and a documented failure deserves them.
  ...votableFields(),
  /* Challenges (§6 gate 3): a claim against the entry, judged exactly like a
     downvote reason — same schema, same quorums, same freeze. */
  challenges: { type: [downvoteReasonSchema], default: [] },

  // Weekly deployment liveness ping (§1): a live/offline chip, not a gate.
  linkStatus: {
    ok: { type: Boolean, default: null },
    checkedAt: { type: Date, default: null },
  },
  cachedState: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
}, { timestamps: true });

producedSchema.index({ work: 1, createdAt: -1 });
producedSchema.index({ cachedState: 1 });

/* The one place that says what an entry's state is. Pure over the document:
   an endorsed challenge rejects it; the 48h window or a still-open challenge
   holds it; everything else — struck or expired claims included — verifies. */
producedSchema.methods.entryState = function (now = Date.now()) {
  const { reasonState, reasonFrozen } = require('../lib/xp');
  const challenges = this.challenges || [];
  if (challenges.some(c => reasonState(c, now) === 'endorsed')) return 'rejected';
  // An unsaved entry has no timestamp yet; it is pending by definition.
  const created = this.createdAt ? this.createdAt.getTime() : now;
  if (now - created < XP.produced.challengeWindowHours * 3600e3) return 'pending';
  if (challenges.some(c => reasonState(c, now) === 'standing' && !reasonFrozen(c, now))) return 'pending';
  return 'verified';
};

producedSchema.methods.refreshCache = function () {
  this.cachedState = this.entryState();
  return this.cachedState;
};

/* The XP category an entry lives in: fabrication for prints, software for
   deployments (systems when the deployed work composes others), ability for
   real use. `work` needs `uses` loaded for the deployment case. */
producedSchema.methods.category = function (work) {
  if (this.type === 'physical') return 'fab';
  if (this.type === 'usage') return 'abil';
  return (work && work.uses && work.uses.length) ? 'sys' : 'soft';
};

/* §6 gate 1: standing to post. Cheap and per-poster, checked at the route. */
producedSchema.statics.posterQualifies = function (user) {
  const ageHours = (Date.now() - new Date(user.createdAt).getTime()) / 3600e3;
  const totalXp = Object.values((user.xp && user.xp.cats) || {}).reduce((a, b) => a + b, 0);
  return ageHours >= XP.produced.minAgeHours || totalXp >= XP.produced.minXp;
};

module.exports = mongoose.model('ProducedEntry', producedSchema);

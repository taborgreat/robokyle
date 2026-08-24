const mongoose = require('mongoose');
const { votableFields } = require('../lib/social');

/* Talk: the work incubator with a comment section (Talk Spec).
   Boards are the visible XP categories — one vocabulary everywhere — and
   there are exactly three post types, no free-form fourth: everything worth
   saying is about a work (linked), toward a work (plan), or a question. */

const participantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const talkPostSchema = new mongoose.Schema({
  // A visible category id (config/xp.js) — validated at the route.
  board: { type: String, required: true, index: true },
  type: { type: String, enum: ['linked', 'plan', 'question'], required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  body: { type: String, trim: true, maxlength: 8000, default: '' },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Linked posts require a work; questions may add one. The card pins on top.
  work: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', default: null },
  workVersion: { type: Number, default: null },

  /* The plan header: the incubator's structured part. `needed` lists the
     skill categories the plan is looking for — the matchmaker view queries
     it — and needTags reuse the works vocabulary so need → plan → work is
     one chain. */
  plan: {
    goal: { type: String, trim: true, maxlength: 500, default: '' },
    needed: { type: [String], default: [] },
    status: { type: String, enum: ['open', 'in-progress', 'became-work', 'abandoned'], default: 'open' },
    participants: { type: [participantSchema], default: [] },
    needTags: { type: [String], default: [] },
    /* Non-OP promotion: a participant asks, the OP approves — and an OP
       silent past the timeout stops being a veto (Talk Spec decision 2). */
    promotion: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      requestedAt: { type: Date, default: null },
      approved: { type: Boolean, default: false },
    },
  },
  // Set when a plan publishes through the wizard; such threads never archive.
  becameWork: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', default: null },

  // E10: the one XP that exists in Talk. acceptedAt drives the per-day cap.
  acceptedAnswer: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  acceptedAt: { type: Date, default: null },

  // Fork-the-derail provenance: which thread this tangent was sliced out of.
  forkedFrom: {
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'TalkPost', default: null },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  },

  /* SENTINEL — Talk votes are display-only and MUST emit zero XP.
     The ledger walk in lib/xp.js reads Design votes and Talk accepted
     answers, nothing else; do not teach it these fields. Locked in by the
     Talk Spec ("fuel removal") and asserted by test/talk-no-xp.test.js. */
  ...votableFields(),

  // Comments bump this; the archive sweep reads it. Archived = read-only.
  lastActivityAt: { type: Date, default: Date.now },
  archivedAt: { type: Date, default: null },
}, { timestamps: true });

talkPostSchema.index({ board: 1, createdAt: -1 });
talkPostSchema.index({ type: 1, 'plan.status': 1 });
talkPostSchema.index({ 'plan.needed': 1 });        // "Plans needing ⚡"
talkPostSchema.index({ work: 1 });
talkPostSchema.index({ archivedAt: 1, lastActivityAt: 1 });
talkPostSchema.index({ title: 'text', body: 'text' });

module.exports = mongoose.model('TalkPost', talkPostSchema);

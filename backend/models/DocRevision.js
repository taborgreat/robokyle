const mongoose = require('mongoose');
const { reasonVoteSchema } = require('../lib/social');
const XP = require('../config/xp');

/* Doc revisions (Part I §5): anyone proposes better words for any work — the
   "good product, bad docs — fix it with your skill" path. A revision targets
   one text: the work's description, or one step's instructions. Acceptance,
   first to trigger wins: the author accepts with a click, or the community's
   docs-weighted approval clears the bar after the author's veto window with
   no veto. A veto closes it (the submitter can always fork; CAS makes forks
   cheap). Applying bumps the work's version like any other edit. */
const docRevisionSchema = new mongoose.Schema({
  work: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  target: { type: String, enum: ['description', 'step'], required: true },
  step: { type: mongoose.Schema.Types.ObjectId, default: null },
  // What the text said when the revision was written — the diff's other half,
  // shown to voters and used for the small-diff scale at apply time.
  previous: { type: String, default: '' },
  text: { type: String, required: true, trim: true, maxlength: 20000 },
  note: { type: String, trim: true, maxlength: 300, default: '' },
  // Docs-expertise-weighted approval; terminal like every judging vote.
  votes: { type: [reasonVoteSchema], default: [] },
  authorAction: {
    type: { type: String, enum: ['accepted', 'vetoed', null], default: null },
    at: { type: Date, default: null },
  },
  appliedAt: { type: Date, default: null },
}, { timestamps: true });

docRevisionSchema.index({ work: 1, appliedAt: 1 });

docRevisionSchema.methods.state = function () {
  if (this.appliedAt) return 'applied';
  if (this.authorAction && this.authorAction.type === 'vetoed') return 'vetoed';
  return 'open';
};

docRevisionSchema.methods.netApproval = function () {
  return (this.votes || []).reduce((a, v) => a + v.dir * (v.weight || 0), 0);
};

/* Ready for community acceptance: bar cleared, veto window over, no veto. */
docRevisionSchema.methods.communityRipe = function (now = Date.now()) {
  return this.state() === 'open'
    && this.netApproval() >= XP.docRevisions.communityAcceptNet
    && now - this.createdAt.getTime() >= XP.docRevisions.authorWindowHours * 3600e3;
};

/* How much actually changed, for the E8 small-diff scale: the text minus the
   longest common prefix and suffix. Crude and cheap, and exactly as gameable
   as re-typing a paragraph — which is more work than writing a real one. */
docRevisionSchema.statics.diffChars = function (before, after) {
  const a = String(before || ''), b = String(after || '');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return Math.max(a.length, b.length) - p - s;
};

/* Applies the revision to its work: history version, text swap, timestamps.
   Used by the author-accept route and the community-acceptance sweep. */
docRevisionSchema.methods.apply = async function (acceptedBy) {
  const Design = mongoose.model('Design');
  const work = await Design.findById(this.work);
  if (!work) return null;
  const current = this.target === 'description'
    ? work.description
    : (work.steps.id(this.step) || {}).body;
  if (current === undefined) return null;             // the step is gone

  work.history.push({
    version: work.version,
    title: work.title, description: work.description, tags: [...work.tags],
    files: work.files.map(f => f.toObject()),
    links: work.links.map(l => l.toObject()),
    uses: work.uses.map(c => c.toObject()),
    steps: work.steps.map(st => st.toObject()),
    changes: ['Documentation revised'],
    editedBy: this.author,
    editNote: this.note || 'Doc revision accepted',
  });
  work.version += 1;
  if (this.target === 'description') work.description = this.text;
  else work.steps.id(this.step).body = this.text;

  await work.save();
  this.appliedAt = new Date();
  if (acceptedBy) this.authorAction = { type: 'accepted', at: new Date() };
  await this.save();
  return work;
};

module.exports = mongoose.model('DocRevision', docRevisionSchema);

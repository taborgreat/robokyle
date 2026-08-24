const mongoose = require('mongoose');
const { votableFields } = require('../lib/social');

/* One comments collection for the entire site — work pages and Talk posts.
   Work threads stay flat (parent always null); Talk threads use `parent`
   for the tree the depth-collapse renders. Standalone rather than embedded
   because fork-the-derail re-homes whole reply chains: moving a subtree to
   another post is a metadata update here, and would be a cross-document
   data move if comments lived inside their targets. */
const commentSchema = new mongoose.Schema({
  targetType: { type: String, enum: ['design', 'talk', 'produced'], required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, trim: true, maxlength: 4000, default: '' },
  /* Comment votes carry the full accountability machinery at display-level
     stakes: reasons required, judged, state derived — but zero XP, because
     the ledger walk in lib/xp.js never reads them. */
  ...votableFields(),
  // Fork-the-derail: this comment's replies continued as their own post.
  // The comment itself stays put as the stub the spec requires.
  forkedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'TalkPost', default: null },
  // A parent with replies is blanked, not removed, so the thread keeps its shape.
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

commentSchema.index({ targetType: 1, target: 1, createdAt: 1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parent: 1 });

module.exports = mongoose.model('Comment', commentSchema);

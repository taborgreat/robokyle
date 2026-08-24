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

/* One-time move of the comments that used to live embedded on Design.
   The field is gone from the Design schema, so this reads the raw collection;
   inserts go through the raw collection too, to keep the original timestamps.
   Idempotent: run on every boot, does nothing once the arrays are gone. */
commentSchema.statics.migrateEmbedded = async function () {
  const designs = mongoose.connection.collection('designs');
  let moved = 0;
  for await (const d of designs.find({ 'comments.0': { $exists: true } }, { projection: { comments: 1 } })) {
    // A crash between insert and unset would re-run this design; skip the insert then.
    if (!(await this.exists({ targetType: 'design', target: d._id }))) {
      await this.collection.insertMany(d.comments.map(c => ({
        targetType: 'design', target: d._id, parent: null,
        author: c.author, body: c.body,
        upvotes: [], downvotes: [], downvoteReasons: [],
        forkedTo: null, deletedAt: null,
        createdAt: c.createdAt || new Date(), updatedAt: c.updatedAt || c.createdAt || new Date(),
      })));
      moved += d.comments.length;
    }
    await designs.updateOne({ _id: d._id }, { $unset: { comments: '' } });
  }
  if (moved) console.log(`[migrate] moved ${moved} embedded work comment(s) into the comments collection`);
  return moved;
};

module.exports = mongoose.model('Comment', commentSchema);

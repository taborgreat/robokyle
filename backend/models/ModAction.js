const mongoose = require('mongoose');

/* The moderation log (E12): every power a mod exercises on someone else's
   content lands here. An action that stands unoverturned past the ratify
   window earns; an overturned one never does — and because the ledger reads
   this collection, overturning after the fact claws the XP back on recompute.
   Reversing an action (unarchiving, say) marks the original overturned. */
const modActionSchema = new mongoose.Schema({
  mod: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, enum: ['archive-thread', 'delete-post', 'delete-comment'], required: true },
  targetType: { type: String, enum: ['talk', 'comment'], required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true },
  // A one-line record of what was acted on, since the target may be gone.
  summary: { type: String, trim: true, maxlength: 200, default: '' },
  overturnedAt: { type: Date, default: null },
  overturnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

modActionSchema.index({ mod: 1, createdAt: -1 });

module.exports = mongoose.model('ModAction', modActionSchema);

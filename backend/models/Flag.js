const mongoose = require('mongoose');

/* Ring-detection findings (§8.3). A flag is a case file for a human, never a
   punishment: the nightly job writes them, admins read them, and voiding is a
   deliberate act afterwards. `key` makes each finding idempotent, so a ring
   that persists shows up once, not once per night. */
const flagSchema = new mongoose.Schema({
  kind: { type: String, enum: ['reciprocity', 'cluster', 'burst'], required: true },
  key: { type: String, required: true, unique: true },
  accounts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  detail: { type: String, trim: true, maxlength: 500, default: '' },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

flagSchema.index({ resolvedAt: 1, createdAt: -1 });

module.exports = mongoose.model('Flag', flagSchema);

const mongoose = require('mongoose');

/* Case files for a human, never a punishment. Ring-detection findings (§8.3)
   arrive from the nightly job; member reports ('report') arrive from the
   work page's flag button. Admins read them; any voiding is a deliberate act
   afterwards. `key` makes each finding idempotent, so a ring that persists
   shows up once, not once per night, and one member flags one work once. */
const flagSchema = new mongoose.Schema({
  kind: { type: String, enum: ['reciprocity', 'cluster', 'burst', 'report'], required: true },
  key: { type: String, required: true, unique: true },
  accounts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  detail: { type: String, trim: true, maxlength: 500, default: '' },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

flagSchema.index({ resolvedAt: 1, createdAt: -1 });

module.exports = mongoose.model('Flag', flagSchema);

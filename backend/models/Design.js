const mongoose = require('mongoose');
const { kindFor } = require('../lib/files');

const fileSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  storedName: { type: String, required: true },
  mimeType: String,
  size: Number,
  // Drives how the file is grouped in the UI: image / model / doc / archive / other.
  kind: { type: String, enum: ['image', 'model', 'doc', 'archive', 'other'], default: 'other' },
  caption: { type: String, trim: true, maxlength: 200, default: '' },
  order: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

// Files hosted somewhere else (Printables, a Drive folder, a YouTube build video).
// Lets a design point at a 400MB STEP file without this box storing it.
const linkSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 120 },
  url: { type: String, required: true, trim: true, maxlength: 2000 },
  kind: { type: String, enum: ['files', 'video', 'docs', 'parts', 'other'], default: 'other' },
  note: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: true });

const stepSchema = new mongoose.Schema({
  title: { type: String, trim: true, maxlength: 160, default: '' },
  body: { type: String, trim: true, maxlength: 8000, default: '' },
  // Optional id of one of the design's own image files, shown alongside the step.
  imageFile: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { _id: false });

const guideSchema = new mongoose.Schema({
  summary: { type: String, trim: true, maxlength: 4000, default: '' },
  printSettings: { type: String, trim: true, maxlength: 2000, default: '' },
  materials: { type: [String], default: [] },
  tools: { type: [String], default: [] },
  steps: { type: [stepSchema], default: [] },
}, { _id: false });

// A snapshot of the editable fields, taken every time the design actually changes.
// `changes` is the auto-generated summary of the edit that closed this version.
const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  title: String,
  description: String,
  tags: [String],
  files: [fileSchema],
  links: [linkSchema],
  guide: guideSchema,
  changes: { type: [String], default: [] },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  editNote: String,
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const commentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, maxlength: 4000 },
}, { timestamps: true });

const designSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 20000 },
  tags: { type: [String], default: [] },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  files: { type: [fileSchema], default: [] },
  links: { type: [linkSchema], default: [] },
  guide: { type: guideSchema, default: () => ({}) },
  version: { type: Number, default: 1 },
  history: { type: [versionSchema], default: [] },
  downloadCount: { type: Number, default: 0 },
  upvotes: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  comments: { type: [commentSchema], default: [] },
}, { timestamps: true });

designSchema.index({ title: 'text', description: 'text', tags: 'text' });
designSchema.index({ createdAt: -1 });

// Designs created before `kind` existed have no grouping info; fill it in from
// the filename so the gallery and file groups work on old rows too.
designSchema.statics.backfillFileKinds = async function () {
  const stale = await this.find({
    $or: [
      { files: { $elemMatch: { kind: { $exists: false } } } },
      { 'history.files': { $elemMatch: { kind: { $exists: false } } } },
    ],
  });
  for (const design of stale) {
    for (const f of design.files) f.kind = kindFor(f.originalName);
    for (const h of design.history) for (const f of h.files) f.kind = kindFor(f.originalName);
    await design.save();
  }
  return stale.length;
};

module.exports = mongoose.model('Design', designSchema);

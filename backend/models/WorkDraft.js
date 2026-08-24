const mongoose = require('mongoose');

/* An unpublished work in progress. Everything autosaves here, per field,
   so closing the tab mid-step loses nothing; nothing is public and no XP
   fires until it is published, at which point the draft becomes the work
   (or the work's next version) and this row is deleted. The blob sweep
   treats a draft's attachments as live references, so an idle draft keeps
   its files until it expires. */
const draftFileSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  storedName: { type: String, required: true },
  mimeType: String,
  size: Number,
  kind: { type: String, enum: ['image', 'model', 'doc', 'archive', 'other'], default: 'other' },
  caption: { type: String, trim: true, maxlength: 200, default: '' },
  order: { type: Number, default: 0 },
}, { _id: true });

const draftStepSchema = new mongoose.Schema({
  title: { type: String, trim: true, maxlength: 160, default: '' },
  body: { type: String, trim: true, maxlength: 8000, default: '' },
  attachments: { type: [draftFileSchema], default: [] },
  links: { type: [{ label: String, url: String, kind: String, note: String }], default: [] },
  workRef: {
    work: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', default: null },
    version: { type: Number, default: null },
  },
  duration: { type: String, trim: true, maxlength: 80, default: '' },
  needs: { type: [String], default: [] },
}, { _id: true });

const workDraftSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Editing an existing work reopens the same wizard; publishing makes a version.
  fromWork: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', default: null },
  /* A promoted Talk plan: the wizard opened pre-filled from the plan post.
     On publish the plan flips to became-work and pins the work (Talk Spec §2). */
  fromTalkPost: { type: mongoose.Schema.Types.ObjectId, ref: 'TalkPost', default: null },
  stage: { type: Number, default: 1, min: 1, max: 3 },
  title: { type: String, trim: true, maxlength: 120, default: '' },
  description: { type: String, trim: true, maxlength: 20000, default: '' },
  /* Ports Spec: kept loose here (drafts autosave half-finished thoughts) and
     validated strictly by lib/ports.js at publish, same as the other fields. */
  type: { type: String, enum: ['design', 'standard'], default: 'design' },
  standard: { type: mongoose.Schema.Types.Mixed, default: null },       // {portName, fields[]}
  ports: { type: mongoose.Schema.Types.Mixed, default: null },          // {provides[], accepts[]}
  tags: { type: [String], default: [] },
  needTags: { type: [String], default: [] },
  files: { type: [draftFileSchema], default: [] },          // overview / hero shots
  steps: { type: [draftStepSchema], default: [] },
  categories: { type: [{ id: String, weight: Number }], default: [] },
  links: { type: [{ label: String, url: String, kind: String, note: String }], default: [] },
  requires: { type: mongoose.Schema.Types.Mixed, default: () => ({ equipment: [], materials: [] }) },
  facets: { type: [String], default: [] },
  editNote: { type: String, trim: true, maxlength: 300, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('WorkDraft', workDraftSchema);

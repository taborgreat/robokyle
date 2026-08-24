const fs = require('fs');
const mongoose = require('mongoose');
const { blobPath, IS_HASH } = require('../lib/storage');
const { votableFields, reasonVoteSchema } = require('../lib/social');

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

/* Another work used as a part of this one: the spoon inside the eating kit.
   `version: null` follows the component wherever it goes, so fixing the spoon
   fixes every kit that uses it. A number pins it, for when a build only works
   against the version it was tested with. */
const componentSchema = new mongoose.Schema({
  work: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', required: true },
  version: { type: Number, default: null },
  label: { type: String, trim: true, maxlength: 120, default: '' },
  note: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: true });

const stepSchema = new mongoose.Schema({
  title: { type: String, trim: true, maxlength: 160, default: '' },
  body: { type: String, trim: true, maxlength: 8000, default: '' },
  /* The photo of the jig lives on the step that uses the jig; the bracket STL
     on the printing step. The work's overall file list is the union of these
     plus the overview files — assembled at read time, never kept by hand. */
  attachments: { type: [fileSchema], default: [] },
  /* External links, per step: the STL on Printables, the wiring photo, the
     walkthrough video — attached to the step that uses them. While uploads
     are admin-only this is how most members attach anything at all. */
  links: { type: [linkSchema], default: [] },
  /* A step can BE another work: "Step 3: build the Quick-Release Connector".
     version null follows latest; a number pins (the default in the UI). */
  workRef: {
    work: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', default: null },
    version: { type: Number, default: null },
  },
  duration: { type: String, trim: true, maxlength: 80, default: '' },
  // Delta B: equipment ids this step needs, from the work's requires list.
  needs: { type: [String], default: [] },
}, { _id: true });

// A snapshot of the editable fields, taken every time the design actually changes.
// `changes` is the auto-generated summary of the edit that closed this version.
const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  title: String,
  description: String,
  tags: [String],
  files: [fileSchema],
  links: [linkSchema],
  uses: [componentSchema],
  steps: [stepSchema],
  changes: { type: [String], default: [] },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  editNote: String,
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

/* Ports (Ports Spec §0): named connection points defined by standards.
   `provides` = "this work offers this interface" (with the standard's declared
   field values and a per-declaration verification state); `accepts` = "this
   work connects to that interface" — unverified by design, the proof of an
   accept is a composite that works. Compatibility is a graph query over these
   two indexed arrays. */
const providesSchema = new mongoose.Schema({
  standard: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', required: true },
  version: { type: Number, default: null },          // pin a standard version; null follows latest
  fieldValues: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // D5 flow per declaration: claimed until a qualified review flips it (E9).
  status: { type: String, enum: ['claimed', 'verified'], default: 'claimed' },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  verifiedAt: { type: Date, default: null },
}, { _id: true });

const acceptsSchema = new mongoose.Schema({
  standard: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', required: true },
  version: { type: Number, default: null },
  /* Body mounts (delta A): a device accepting a body:* site states which side
     it fits and its fit numbers against the site's fields, so the anatomy hub
     can filter by fit. Empty for ordinary standards. */
  laterality: { type: String, enum: ['left', 'right', 'either', null], default: null },
  fieldValues: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { _id: true });

const designSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  // Soft per the wizard's checklist: nudged, never blocking.
  description: { type: String, trim: true, maxlength: 20000, default: '' },
  /* D16: a standard IS a work — its content is the human spec, and `standard`
     below is its machine-readable half. Everything else stays a design. */
  type: { type: String, enum: ['design', 'standard'], default: 'design' },
  standard: {
    portName: { type: String, trim: true, lowercase: true, maxlength: 40, default: '' },
    // Flat name/unit/required rows — never a nested schema builder (Ports §1).
    fields: { type: [{ name: String, unit: String, required: Boolean }], default: [] },
  },
  ports: {
    provides: { type: [providesSchema], default: [] },
    accepts: { type: [acceptsSchema], default: [] },
  },
  tags: { type: [String], default: [] },
  /* Delta B: what building this takes. Equipment is owned, materials are
     consumed; both from the curated vocabulary. Pure information: no XP
     touches this layer, so there is nothing to farm. */
  requires: {
    equipment: { type: [{ item: String, note: { type: String, default: '' } }], default: [] },
    materials: { type: [{ item: String, qty: Number, unit: String, note: { type: String, default: '' } }], default: [] },
  },
  /* Delta C: zero-XP discovery tags for software works (server, firmware...).
     The nine categories stay frozen; facets slice inside them. */
  facets: { type: [String], default: [] },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  files: { type: [fileSchema], default: [] },
  links: { type: [linkSchema], default: [] },
  /* Derived from the reference-steps on every save (syncUses): kept as its own
     array so the lineage queries, XP walk and used-in lookups stay one indexed
     field. Never written directly. */
  uses: { type: [componentSchema], default: [] },
  steps: { type: [stepSchema], default: [] },
  version: { type: Number, default: 1 },
  history: { type: [versionSchema], default: [] },

  /* Where this work came from.
     `parent` is the work it was built on, `parentVersion` the version that was
     taken, and `root` the original everything in the family descends from. An
     original is its own root, so one indexed query returns a whole family tree
     no matter how deep it goes. */
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', default: null },
  parentVersion: { type: Number, default: null },
  root: { type: mongoose.Schema.Types.ObjectId, ref: 'Design', index: true },
  depth: { type: Number, default: 0 },
  /* A remix's one-line answer to "what are you changing?", captured at remix
     time (the only moment the author certainly knows) and shown as the
     subtitle wherever the lineage appears. Empty on originals. */
  remixNote: { type: String, trim: true, maxlength: 200, default: '' },
  downloadCount: { type: Number, default: 0 },
  // Weighted votes + reason cards, shared with Talk (lib/social.js). Here they
  // feed the XP recompute; the accountability rules are identical everywhere.
  ...votableFields(),

  /* §2A: claims that the declared categories are wrong, judged like downvote
     reasons (terminal, expertise-weighted). Endorsement rewrites the
     declaration; since XP recomputes from current data, everything that ever
     routed through the old vector re-routes automatically. */
  categoryDisputes: { type: [new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },  // stored, never shown
    text: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    proposed: { type: [{ id: String, weight: Number }], required: true },
    previous: { type: [{ id: String, weight: Number }], default: [] },
    rvotes: { type: [reasonVoteSchema], default: [] },
    appliedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  }, { _id: true })], default: [] },

  /* Category declaration (§2A): 1–3 categories with integer weights summing
     to 100. The only input XP routing reads. */
  categories: { type: [{ id: String, weight: Number }], default: [] },
  /* Need tags (§2B): what human need this serves. Discovery only, zero XP,
     so there is nothing to stuff. */
  needTags: { type: [String], default: [] },
  // Comments live in the site-wide comments collection (models/Comment.js,
  // targetType 'design'); Comment.migrateEmbedded moved the old arrays out.
}, { timestamps: true });

designSchema.index({ title: 'text', description: 'text', tags: 'text', needTags: 'text' });
designSchema.index({ needTags: 1 });
designSchema.index({ 'categories.id': 1 });
designSchema.index({ createdAt: -1 });
designSchema.index({ parent: 1 });
designSchema.index({ 'uses.work': 1 });
designSchema.index({ 'requires.equipment.item': 1 });
designSchema.index({ facets: 1 });
// The hub queries (Ports Spec §3): providers, consumers, adapters of a standard.
designSchema.index({ 'ports.provides.standard': 1 });
designSchema.index({ 'ports.accepts.standard': 1 });

/* The Built-from list is the reference-steps, deduplicated. */
designSchema.methods.syncUses = function () {
  const seen = new Map();
  for (const step of this.steps || []) {
    const ref = step.workRef && step.workRef.work;
    if (!ref || seen.has(String(ref))) continue;
    seen.set(String(ref), {
      work: ref, version: step.workRef.version ?? null,
      label: step.title || '', note: '',
    });
  }
  this.uses = [...seen.values()];
};
// Asked on every delete, to find out whether a blob still has a referrer.
designSchema.index({ 'files.storedName': 1 });
designSchema.index({ 'history.files.storedName': 1 });

/* Would adding these components to `designId` make something use itself, at any
   depth? Walks what the candidates already use and looks for the way back. A
   cycle would make a bill of materials impossible to render or to build. */
designSchema.statics.wouldCycle = async function (designId, componentIds) {
  const target = String(designId);
  const seen = new Set();
  let frontier = componentIds.map(String);

  while (frontier.length) {
    if (frontier.includes(target)) return true;
    const next = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = await this.findById(id).select('uses.work');
      for (const c of (doc && doc.uses) || []) next.push(String(c.work));
    }
    frontier = next;
  }
  return false;
};

/* Reclaims stored files that nothing points at any more.
 *
 * Deleting a work does not unlink anything: checking "is this referenced?" and
 * unlinking are two steps, and between them a fork or an upload of the same
 * bytes can take a new reference on a blob that is about to disappear. Sweeping
 * instead, and only touching blobs that have been untouched for a while, closes
 * that window entirely: anything in flight has long since finished.
 *
 * A file is an orphan only when no work and no version of any work names it, so
 * a file that ten thousand people reference survives until the last of them is
 * gone.
 */
designSchema.statics.sweepOrphanBlobs = async function ({ minAgeMinutes = 60, dryRun = false } = {}) {
  const fsp = fs.promises;
  const path = require('path');
  const { UPLOAD_DIR } = require('../lib/storage');

  const referenced = new Set();
  for (const design of await this.find().select('files.storedName steps.attachments.storedName history.files.storedName history.steps.attachments.storedName')) {
    for (const name of this.blobsOf(design)) referenced.add(name);
  }
  // A draft in progress holds its files too; they release when the draft dies.
  const WorkDraft = require('./WorkDraft');
  for (const draft of await WorkDraft.find().select('files.storedName steps.attachments.storedName')) {
    for (const f of draft.files || []) referenced.add(f.storedName);
    for (const st of draft.steps || []) for (const f of st.attachments || []) referenced.add(f.storedName);
  }

  async function walk(dir) {
    const out = [];
    for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full));
      else out.push(full);
    }
    return out;
  }

  // Matched by path, not by name: a store that happens to live under a folder
  // called tmp would otherwise have every blob mistaken for an abandoned upload.
  const tempPrefix = path.join(UPLOAD_DIR, 'tmp') + path.sep;
  const cutoff = Date.now() - minAgeMinutes * 60 * 1000;
  const result = { removed: 0, bytes: 0, kept: referenced.size, missing: [], temp: 0 };

  for (const file of await walk(UPLOAD_DIR)) {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat || stat.mtimeMs > cutoff) continue;

    // Abandoned multipart uploads: nothing ever references these.
    const isTemp = file.startsWith(tempPrefix);
    if (isTemp) {
      if (stat.mtimeMs < Date.now() - 24 * 3600 * 1000) {
        if (!dryRun) await fsp.unlink(file).catch(() => {});
        result.temp++;
      }
      continue;
    }

    if (referenced.has(path.basename(file))) continue;
    result.removed++;
    result.bytes += stat.size;
    if (!dryRun) await fsp.unlink(file).catch(() => {});
  }

  // The opposite problem: a row naming a file that is not on disk. A name
  // that is not a hash cannot be in the store at all; report it, don't throw.
  for (const name of referenced) {
    if (!IS_HASH.test(String(name))) { result.missing.push(name); continue; }
    const there = await fsp.access(blobPath(name)).then(() => true).catch(() => false);
    if (!there) result.missing.push(name);
  }
  return result;
};

/* §8.1 novelty: CAS makes this a set-intersection over content hashes. A new
   upload sharing most of its files with an existing work is a version of that
   work, not a new one — it publishes at the derived rate with a provenance
   link, so re-uploading someone's files earns fork XP, not author XP. */
designSchema.statics.noveltyMatch = async function (fileNames) {
  if (!fileNames.length) return null;
  const { novelty } = require('../config/xp');
  const candidates = await this.find({ 'files.storedName': { $in: fileNames } })
    .select('files.storedName root depth version');
  for (const cand of candidates) {
    const theirs = new Set(cand.files.map(f => f.storedName));
    const overlap = fileNames.filter(n => theirs.has(n)).length / fileNames.length;
    if (overlap > novelty.overlapThreshold) return cand;
  }
  return null;
};

/* Every stored file a work points at, current and historical. */
designSchema.statics.blobsOf = function (design) {
  const stepFiles = (steps) => (steps || []).flatMap(s => s.attachments || []);
  return [
    ...design.files, ...stepFiles(design.steps),
    ...design.history.flatMap(h => [...(h.files || []), ...stepFiles(h.steps)]),
  ].map(f => f.storedName);
};

module.exports = mongoose.model('Design', designSchema);

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const Design = require('../models/Design');
const WorkDraft = require('../models/WorkDraft');
const User = require('../models/User');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { parseRequires } = require('../lib/requires');
const { ALLOWED_EXT, kindFor } = require('../lib/files');
const { UPLOAD_DIR, IS_HASH, ingest } = require('../lib/storage');
const xp = require('../lib/xp');
const ports = require('../lib/ports');

const router = express.Router();
router.use(requireAuth, requireVerified);

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(ALLOWED_EXT.has(ext) ? null : new Error(`"${ext}" files are not accepted`), ALLOWED_EXT.has(ext));
  },
});

async function myDraft(req, res) {
  const draft = await WorkDraft.findOne({ _id: req.params.id, author: req.user._id });
  if (!draft) res.status(404).json({ error: 'No such draft' });
  return draft;
}

const shape = (d) => ({
  id: d._id, stage: d.stage, fromWork: d.fromWork, fromTalkPost: d.fromTalkPost,
  title: d.title, description: d.description,
  tags: d.tags, needTags: d.needTags,
  files: d.files, steps: d.steps, categories: d.categories, links: d.links,
  type: d.type, standard: d.standard, ports: d.ports, requires: d.requires, facets: d.facets,
  editNote: d.editNote, updatedAt: d.updatedAt,
});

// GET /api/drafts  -- the caller's works in progress
router.get('/', async (req, res, next) => {
  try {
    const drafts = await WorkDraft.find({ author: req.user._id }).sort({ updatedAt: -1 });
    res.json({ items: drafts.map(d => ({ id: d._id, title: d.title, stage: d.stage, fromWork: d.fromWork, updatedAt: d.updatedAt })) });
  } catch (err) { next(err); }
});

/* POST /api/drafts  { fromWork? } — a fresh draft, or the wizard reopened on a
   published work. One draft per (author, work) so edits resume, not multiply. */
router.post('/', async (req, res, next) => {
  try {
    if (req.body && req.body.fromWork) {
      const work = await Design.findById(req.body.fromWork);
      if (!work) return res.status(404).json({ error: 'Design not found' });
      const authorId = work.author._id || work.author;
      if (!authorId.equals(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only the author can edit this work' });
      }
      const existing = await WorkDraft.findOne({ author: req.user._id, fromWork: work._id });
      if (existing) return res.json(shape(existing));
      const draft = await WorkDraft.create({
        author: req.user._id, fromWork: work._id, stage: 1,
        title: work.title, description: work.description,
        tags: [...work.tags], needTags: [...work.needTags],
        files: work.files.map(f => f.toObject()),
        steps: work.steps.map(s => s.toObject()),
        categories: work.categories.map(c => ({ id: c.id, weight: c.weight })),
        links: work.links.map(l => ({ label: l.label, url: l.url, kind: l.kind, note: l.note })),
        type: work.type,
        standard: work.type === 'standard'
          ? { portName: work.standard.portName, fields: work.standard.fields.map(f => ({ name: f.name, unit: f.unit, required: f.required })) }
          : null,
        ports: {
          provides: (work.ports.provides || []).map(p => ({ standard: p.standard, version: p.version, fieldValues: p.fieldValues })),
          accepts: (work.ports.accepts || []).map(a => ({ standard: a.standard, version: a.version })),
        },
      });
      return res.status(201).json(shape(draft));
    }
    const draft = await WorkDraft.create({ author: req.user._id });
    res.status(201).json(shape(draft));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try { const d = await myDraft(req, res); if (d) res.json(shape(d)); } catch (err) { next(err); }
});

/* A file reference in an autosave body is only ever a CAS hash this server
   handed out (POST /:id/files) or one already on the work being edited. The
   hash check is what makes that true: a storedName is a content address, and
   anything else ("../../.env") must never reach a database row — every
   download resolves storedName under the blob store. blobPath() re-checks as
   the backstop. */
const cleanFileRefs = (list, max = 20) => (Array.isArray(list) ? list : [])
  .filter(f => f && IS_HASH.test(String(f.storedName)))
  .slice(0, max);

// PUT /api/drafts/:id — the autosave. Partial: only sent fields change.
router.put('/:id', async (req, res, next) => {
  try {
    const draft = await myDraft(req, res);
    if (!draft) return;
    const b = req.body || {};
    for (const k of ['title', 'description', 'editNote']) if (b[k] !== undefined) draft[k] = String(b[k]);
    for (const k of ['tags', 'needTags']) if (Array.isArray(b[k])) draft[k] = b[k].map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 15);
    if (Array.isArray(b.steps)) {
      draft.steps = b.steps.slice(0, 60).map(st => ({ ...st, attachments: cleanFileRefs(st && st.attachments) }));
    }
    if (Array.isArray(b.files)) draft.files = cleanFileRefs(b.files);
    if (Array.isArray(b.categories)) draft.categories = b.categories.slice(0, 6);
    if (Array.isArray(b.links)) draft.links = b.links.slice(0, 12);
    if (b.requires && typeof b.requires === 'object') draft.requires = b.requires;
    if (Array.isArray(b.facets)) draft.facets = b.facets.slice(0, 10);
    /* Ports draft loosely but in a bounded shape; lib/ports.js re-validates
       everything (existence, required fields) at publish. A half-typed port
       name must autosave, so the standard def is bounded by hand here. */
    if (b.type === 'design' || b.type === 'standard') draft.type = b.type;
    if (b.standard !== undefined) {
      draft.standard = b.standard && typeof b.standard === 'object'
        ? { portName: String(b.standard.portName || '').slice(0, 40),
            fields: (Array.isArray(b.standard.fields) ? b.standard.fields : []).slice(0, 12)
              .map(f => ({ name: String((f && f.name) || '').slice(0, 40),
                           unit: String((f && f.unit) || '').slice(0, 20),
                           required: !!(f && f.required) })) }
        : null;
    }
    if (b.ports !== undefined) {
      try { draft.ports = ports.parsePorts(b.ports); } catch { /* malformed autosave: keep the last good one */ }
    }
    if (b.stage) draft.stage = Math.max(1, Math.min(3, Number(b.stage) || 1));
    await draft.save();
    res.json(shape(draft));
  } catch (err) {
    if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

/* POST /api/drafts/:id/files — upload into the CAS store, return the refs.
   The client places them (overview or a step) and autosaves the placement;
   an upload never placed is released by the blob sweep. */
const UPLOADS_ADMIN_ONLY = process.env.UPLOADS_ADMIN_ONLY !== 'false';
router.post('/:id/files', (req, res, next) => {
  if (UPLOADS_ADMIN_ONLY && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'File uploads are admin-only for now. Add an external link instead.' });
  }
  next();
}, upload.array('files'), async (req, res, next) => {
  try {
    const draft = await myDraft(req, res);
    if (!draft) { for (const f of req.files || []) fs.unlink(path.join(TEMP_DIR, f.filename), () => {}); return; }
    const out = [];
    for (const f of req.files || []) {
      const storedName = await ingest(path.join(TEMP_DIR, f.filename));
      out.push({ originalName: f.originalname, storedName, mimeType: f.mimetype, size: f.size, kind: kindFor(f.originalname) });
    }
    res.status(201).json({ files: out });
  } catch (err) { next(err); }
});

/* POST /api/drafts/:id/publish — Stage 3's button. Validates, then the draft
   becomes a live work (E1 and the reference XP fire through the recompute) or
   the next version of the work it was opened from. The draft dies either way. */
router.post('/:id/publish', async (req, res, next) => {
  try {
    const draft = await myDraft(req, res);
    if (!draft) return;

    // The two hard requirements; everything else was a soft checklist warning.
    if (!draft.title.trim()) return res.status(400).json({ error: 'The work needs a name' });
    const hasContent = draft.files.length || draft.steps.some(st => st.title || st.body || st.attachments.length || (st.workRef && st.workRef.work));
    if (!hasContent) return res.status(400).json({ error: 'Add at least one file or one step' });

    const declaration = (draft.categories || []).filter(c => xp.config.categoryIds.includes(c.id) && c.id !== 'innov' && c.weight > 0);
    const declSum = declaration.reduce((a, c) => a + c.weight, 0);
    if (declaration.length < xp.config.declaration.min || declaration.length > xp.config.declaration.max || declSum !== xp.config.declaration.sum) {
      return res.status(400).json({ error: `Declare ${xp.config.declaration.min}-${xp.config.declaration.max} categories with weights summing to ${xp.config.declaration.sum}` });
    }

    // Ports Spec: drafts hold declarations loosely; publishing is where they
    // must hold up — standards exist, required field values stated.
    const type = draft.type === 'standard' ? 'standard' : 'design';
    let standardDef, declaredPorts;
    try {
      // A leftover definition on a non-standard draft (the checkbox was
      // toggled and back) must not block publishing a plain work.
      standardDef = type === 'standard' ? ports.parseStandardDef(draft.standard) : null;
      declaredPorts = await ports.checkPorts(Design, ports.parsePorts(draft.ports), { selfId: draft.fromWork });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    if (type === 'standard' && !standardDef && !draft.fromWork) {
      return res.status(400).json({ error: 'A standard needs a port name and its fields' });
    }

    const refs = [...new Set(draft.steps.map(st => st.workRef && st.workRef.work).filter(Boolean).map(String))];
    for (const ref of refs) {
      if (draft.fromWork && String(draft.fromWork) === ref) return res.status(400).json({ error: 'A work cannot use itself' });
      if (!(await Design.exists({ _id: ref }))) return res.status(400).json({ error: 'A referenced work no longer exists' });
    }
    if (draft.fromWork && refs.length && await Design.wouldCycle(draft.fromWork, refs)) {
      return res.status(400).json({ error: 'That would make these works use each other in a loop' });
    }

    const strip = (f) => ({ originalName: f.originalName, storedName: f.storedName, mimeType: f.mimeType, size: f.size, kind: f.kind, caption: f.caption, order: f.order });
    const requires = parseRequires(draft.requires) || { equipment: [], materials: [] };
    const facetOk = new Set(xp.config.softwareFacets);
    const facets = (draft.facets || []).filter(f => facetOk.has(f));
    const stepDocs = draft.steps.map(st => ({
      title: st.title, body: st.body, duration: st.duration,
      needs: (st.needs || []).filter(n => xp.config.equipmentItems.includes(n)),
      attachments: (st.attachments || []).map(strip),
      workRef: { work: (st.workRef && st.workRef.work) || null, version: (st.workRef && st.workRef.version) ?? null },
    }));

    let work;
    if (draft.fromWork) {
      // Publishing an edit: a new version, changelog required.
      work = await Design.findById(draft.fromWork);
      if (!work) return res.status(404).json({ error: 'The work this draft edits no longer exists' });
      if (!(work.author._id || work.author).equals(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only the author can publish this edit' });
      }
      const { describeChanges } = require('../lib/changes');
      const snap = (d) => ({
        title: d.title, description: d.description, tags: [...d.tags],
        categories: d.categories.map(c => ({ id: c.id, weight: c.weight })),
        needTags: [...d.needTags],
        files: d.files.map(f => (f.toObject ? f.toObject() : f)),
        links: d.links.map(l => (l.toObject ? l.toObject() : l)),
        uses: d.uses.map(c => (c.toObject ? c.toObject() : c)),
        steps: d.steps.map(st => (st.toObject ? st.toObject() : st)),
        portsShape: ports.portShape(d.ports),
        standardShape: JSON.stringify(d.type !== 'standard' ? null
          : [d.standard.portName, (d.standard.fields || []).map(f => [f.name, f.unit, !!f.required])]),
      });
      const before = snap(work);
      work.title = draft.title; work.description = draft.description;
      work.tags = draft.tags; work.needTags = draft.needTags;
      work.categories = declaration;
      work.files = draft.files.map(strip);
      work.steps = stepDocs;
      work.links = draft.links.map(l => ({ label: l.label, url: l.url, kind: l.kind, note: l.note }));
      work.requires = requires;
      work.facets = facets;
      // Edits re-claim: verification survives only for unchanged declarations.
      // The work's type never changes after creation (works point at standards).
      if (declaredPorts) {
        work.ports.provides = ports.reconcileProvides(work.ports.provides, declaredPorts.provides);
        work.ports.accepts = declaredPorts.accepts;
      }
      if (work.type === 'standard' && standardDef) work.standard = standardDef;
      work.syncUses();
      const changes = describeChanges(before, snap(work));
      if (changes.length) {
        if (!draft.editNote.trim()) return res.status(400).json({ error: 'Add a one-line changelog for this version' });
        work.history.push({ version: work.version, ...before, changes, editedBy: req.user._id, editNote: draft.editNote });
        work.version += 1;
      }
      await work.save();
    } else {
      work = new Design({
        title: draft.title, description: draft.description,
        tags: draft.tags, needTags: draft.needTags,
        categories: declaration, author: req.user._id,
        files: draft.files.map(strip), steps: stepDocs,
        links: draft.links.map(l => ({ label: l.label, url: l.url, kind: l.kind, note: l.note })),
        type,
        standard: type === 'standard' ? standardDef : undefined,
        ports: declaredPorts
          ? { provides: ports.reconcileProvides([], declaredPorts.provides), accepts: declaredPorts.accepts }
          : undefined,
        requires, facets,
      });
      work.root = work._id;
      work.syncUses();
      // Mostly someone else's bytes publishes as a version of their work (§8.1).
      const match = await Design.noveltyMatch(Design.blobsOf(work));
      if (match) {
        work.parent = match._id; work.parentVersion = match.version;
        work.root = match.root || match._id; work.depth = (match.depth || 0) + 1;
      }
      await work.save();
    }

    /* A promoted plan permanently flips to became-work: the work card pins,
       the thread becomes the work's founding discussion, and the thread now
       lives as long as the work (never archives). The plan's XP reward is the
       work itself — E1 and everything downstream, no new event. */
    if (draft.fromTalkPost && !draft.fromWork) {
      const TalkPost = require('../models/TalkPost');
      await TalkPost.updateOne({ _id: draft.fromTalkPost, type: 'plan' }, {
        $set: { 'plan.status': 'became-work', becameWork: work._id, archivedAt: null, lastActivityAt: new Date() },
      });
    }

    await draft.deleteOne();
    try {
      const ids = [req.user._id];
      for (const ref of refs) { const r = await Design.findById(ref).select('author'); if (r) ids.push(r.author); }
      await xp.recomputeUsers(ids);
    } catch (err) { console.error('[xp]', err.message); }
    res.status(draft.fromWork ? 200 : 201).json({ id: work._id, version: work.version });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try { const d = await myDraft(req, res); if (d) { await d.deleteOne(); res.json({ ok: true }); } } catch (err) { next(err); }
});

module.exports = router;

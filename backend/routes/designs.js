const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Design = require('../models/Design');
const { requireAuth, optionalAuth, requireVerified } = require('../middleware/auth');
const { ALLOWED_EXT, kindFor, inlineMimeFor } = require('../lib/files');
const { describeChanges } = require('../lib/changes');
const { cardPipeline, shapeCards } = require('../lib/cards');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);
const MAX_FILES = 20;
const MAX_LINKS = 25;
// Uploads eat disk on the box hosting this, so they start out admin-only.
// Everyone else attaches external links instead. Flip to false to open it up.
const UPLOADS_ADMIN_ONLY = process.env.UPLOADS_ADMIN_ONLY !== 'false';

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const limits = { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: MAX_FILES, fieldSize: 1024 * 1024 };

const upload = multer({
  storage,
  limits,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`File type ${ext || '(none)'} is not allowed`));
    cb(null, true);
  },
});

// Same parser, but refuses every file before a byte reaches disk.
const uploadDenied = multer({
  limits,
  fileFilter: (req, file, cb) => cb(new Error('File uploads are admin-only for now. Add an external link instead.')),
});

// Anything multer wrote for a request we are about to reject.
const discardUploads = (req) => removeStoredFiles((req.files || []).map(f => ({ storedName: f.filename })));

const canUpload = (user) => !!user && (!UPLOADS_ADMIN_ONLY || user.role === 'admin');

// Chooses the parser per request, so a non-admin posting a file is rejected
// rather than silently having it stored, and turns parser complaints into
// useful 4xx messages instead of the generic 500 the error handler would give.
function acceptUpload(req, res, next) {
  const allowed = canUpload(req.user);
  const parser = allowed ? upload : uploadDenied;
  parser.array('files', MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    discardUploads(req);
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Each file must be ${MAX_UPLOAD_MB} MB or smaller`
        : err.code === 'LIMIT_FILE_COUNT' ? `At most ${MAX_FILES} files per design`
        : err.message;
      return res.status(400).json({ error: msg });
    }
    res.status(allowed ? 400 : 403).json({ error: err.message });
  });
}

const POPULATE = [
  { path: 'author', select: 'username' },
  { path: 'comments.author', select: 'username' },
  { path: 'history.editedBy', select: 'username' },
];

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map(t => String(t).trim()).filter(Boolean).slice(0, 20);
  if (typeof raw === 'string') return raw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
  return [];
}

function parseJson(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Malformed JSON field'), { status: 400 }); }
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

function parseLinks(raw) {
  const items = parseJson(raw, null);
  if (!Array.isArray(items)) return null;
  return items.slice(0, MAX_LINKS).map(l => {
    const url = clean(l.url, 2000);
    let parsed;
    try { parsed = new URL(url); } catch { throw Object.assign(new Error(`"${url}" is not a valid URL`), { status: 400 }); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw Object.assign(new Error('Links must start with http:// or https://'), { status: 400 });
    }
    return {
      label: clean(l.label, 120) || parsed.hostname.replace(/^www\./, ''),
      url,
      kind: ['files', 'video', 'docs', 'parts', 'other'].includes(l.kind) ? l.kind : 'other',
      note: clean(l.note, 300),
    };
  }).filter(l => l.url);
}

function parseGuide(raw) {
  const g = parseJson(raw, null);
  if (!g || typeof g !== 'object') return null;
  const strList = (v) => (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map(s => clean(s, 200)).filter(Boolean).slice(0, 40);
  return {
    summary: clean(g.summary, 4000),
    printSettings: clean(g.printSettings, 2000),
    materials: strList(g.materials),
    tools: strList(g.tools),
    steps: (Array.isArray(g.steps) ? g.steps : []).slice(0, 60).map(s => ({
      title: clean(s.title, 160),
      body: clean(s.body, 8000),
      imageFile: /^[a-f0-9]{24}$/i.test(String(s.imageFile || '')) ? String(s.imageFile) : null,
    })).filter(s => s.title || s.body || s.imageFile),
  };
}

// Applies captions / ordering the client sent for files that are already stored.
function applyFileMeta(design, raw) {
  const meta = parseJson(raw, null);
  if (!Array.isArray(meta)) return;
  const byId = new Map(meta.map(m => [String(m.id), m]));
  for (const f of design.files) {
    const m = byId.get(f._id.toString());
    if (!m) continue;
    if (m.caption !== undefined) f.caption = clean(m.caption, 200);
    if (m.order !== undefined) f.order = Number(m.order) || 0;
  }
}

// Captions for the files in this request, aligned with the order they were sent.
function toFileMeta(files, captionsRaw, startOrder = 0) {
  const captions = parseJson(captionsRaw, null);
  return (files || []).map((f, i) => ({
    originalName: f.originalname,
    storedName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
    kind: kindFor(f.originalname),
    caption: Array.isArray(captions) ? clean(captions[i], 200) : '',
    order: startOrder + i,
  }));
}

function canEdit(user, design) {
  if (!user) return false;
  const authorId = design.author._id || design.author;
  return authorId.equals(user._id) || user.role === 'admin';
}

const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || new Date(a.uploadedAt) - new Date(b.uploadedAt);

function withUrls(designId, files) {
  return [...files].sort(byOrder).map(f => ({
    ...f,
    url: `/api/designs/${designId}/files/${f._id}`,
    viewUrl: inlineMimeFor(f.originalName) ? `/api/designs/${designId}/files/${f._id}/view` : null,
  }));
}

function serialize(design, user) {
  const obj = design.toObject({ virtuals: false });
  obj.id = obj._id;
  obj.upvoteCount = obj.upvotes.length;
  obj.upvoted = !!(user && obj.upvotes.some(id => id.equals(user._id)));
  delete obj.upvotes;
  obj.files = withUrls(obj._id, obj.files);
  obj.history = obj.history.map(h => ({ ...h, files: withUrls(obj._id, h.files || []) }));
  obj.canUpload = canUpload(user);
  obj.canEdit = canEdit(user, design);
  return obj;
}

function removeStoredFiles(files) {
  for (const f of files) {
    if (f.storedName) fs.unlink(path.join(UPLOAD_DIR, f.storedName), () => {});
  }
}

// GET /api/designs?q=&tag=&sort=new|top|downloads&page=&limit=
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { q, tag, sort = 'new' } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = {};
    if (q) filter.$text = { $search: String(q) };
    if (tag) filter.tags = String(tag);
    const [items, total] = await Promise.all([
      Design.aggregate(cardPipeline({
        match: filter, sort, skip: (page - 1) * limit, limit, viewerId: req.user ? req.user._id : null,
      })),
      Design.countDocuments(filter),
    ]);
    const shaped = shapeCards(items);
    res.json({ items: shaped, page, limit, total });
  } catch (err) { next(err); }
});

// POST /api/designs  (multipart: title, description, tags, links, guide, captions, files[])
router.post('/', requireAuth, requireVerified, acceptUpload, async (req, res, next) => {
  try {
    const { title, description } = req.body;
    if (!title || !description) {
      discardUploads(req);
      return res.status(400).json({ error: 'title and description are required' });
    }
    const links = parseLinks(req.body.links);
    const guide = parseGuide(req.body.guide);
    const design = await Design.create({
      title, description,
      tags: parseTags(req.body.tags),
      author: req.user._id,
      files: toFileMeta(req.files, req.body.captions),
      links: links || [],
      guide: guide || {},
    });
    await design.populate(POPULATE);
    res.status(201).json(serialize(design, req.user));
  } catch (err) {
    discardUploads(req);
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// GET /api/designs/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).populate(POPULATE);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    res.json(serialize(design, req.user));
  } catch (err) { next(err); }
});

// PUT /api/designs/:id  (multipart: title?, description?, tags?, links?, guide?, editNote?,
//                        removeFiles? (ids), fileMeta? (captions/order), captions?, files[] to add)
// Snapshots the previous state into history whenever something actually changed,
// together with an auto-generated summary of the change.
router.put('/:id', requireAuth, requireVerified, acceptUpload, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) {
      discardUploads(req);
      return res.status(404).json({ error: 'Design not found' });
    }
    if (!canEdit(req.user, design)) {
      discardUploads(req);
      return res.status(403).json({ error: 'Only the author can edit this design' });
    }

    const before = {
      title: design.title,
      description: design.description,
      tags: [...design.tags],
      files: design.files.map(f => f.toObject()),
      links: design.links.map(l => l.toObject()),
      guide: design.guide ? design.guide.toObject() : {},
    };

    if (req.body.title !== undefined) design.title = req.body.title;
    if (req.body.description !== undefined) design.description = req.body.description;
    if (req.body.tags !== undefined) design.tags = parseTags(req.body.tags);
    if (req.body.links !== undefined) {
      const links = parseLinks(req.body.links);
      if (links) design.links = links;
    }
    if (req.body.guide !== undefined) {
      const guide = parseGuide(req.body.guide);
      if (guide) design.guide = guide;
    }

    const removeIds = new Set(parseTags(req.body.removeFiles));
    // Files are kept on disk because history versions still reference them.
    design.files = design.files.filter(f => !removeIds.has(f._id.toString()));
    applyFileMeta(design, req.body.fileMeta);
    const nextOrder = design.files.reduce((max, f) => Math.max(max, f.order || 0), -1) + 1;
    design.files.push(...toFileMeta(req.files, req.body.captions, nextOrder));

    const after = {
      title: design.title,
      description: design.description,
      tags: [...design.tags],
      files: design.files.map(f => (f.toObject ? f.toObject() : f)),
      links: design.links.map(l => (l.toObject ? l.toObject() : l)),
      guide: design.guide ? (design.guide.toObject ? design.guide.toObject() : design.guide) : {},
    };
    const changes = describeChanges(before, after);

    // No change, no new version - the history only records real edits.
    if (changes.length) {
      design.history.push({
        version: design.version,
        ...before,
        changes,
        editedBy: req.user._id,
        editNote: req.body.editNote || '',
      });
      design.version += 1;
    }

    await design.save();
    await design.populate(POPULATE);
    res.json({ ...serialize(design, req.user), changes });
  } catch (err) {
    discardUploads(req);
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/designs/:id
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    if (!canEdit(req.user, design)) return res.status(403).json({ error: 'Only the author can delete this design' });
    const all = [...design.files, ...design.history.flatMap(h => h.files)];
    await design.deleteOne();
    removeStoredFiles(all);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

function findFile(design, fileId) {
  return design.files.id(fileId)
    || design.history.flatMap(h => h.files).find(f => f._id.toString() === fileId);
}

// GET /api/designs/:id/files/:fileId  downloads a file and bumps the counter
router.get('/:id/files/:fileId', async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const file = findFile(design, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    await Design.updateOne({ _id: design._id }, { $inc: { downloadCount: 1 } });
    res.download(path.join(UPLOAD_DIR, file.storedName), file.originalName);
  } catch (err) { next(err); }
});

// GET /api/designs/:id/files/:fileId/view  inline preview for the gallery.
// Raster images only, and it deliberately does not count as a download.
router.get('/:id/files/:fileId/view', async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const file = findFile(design, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    const mime = inlineMimeFor(file.originalName);
    if (!mime) return res.status(415).json({ error: 'This file type cannot be previewed' });
    res.type(mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.join(UPLOAD_DIR, file.storedName));
  } catch (err) { next(err); }
});

// POST /api/designs/:id/upvote  toggles the current user's upvote
router.post('/:id/upvote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const idx = design.upvotes.findIndex(id => id.equals(req.user._id));
    if (idx === -1) design.upvotes.push(req.user._id); else design.upvotes.splice(idx, 1);
    await design.save();
    res.json({ upvoted: idx === -1, upvoteCount: design.upvotes.length });
  } catch (err) { next(err); }
});

// POST /api/designs/:id/comments  { body }
router.post('/:id/comments', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    design.comments.push({ author: req.user._id, body });
    await design.save();
    await design.populate({ path: 'comments.author', select: 'username' });
    res.status(201).json(design.comments[design.comments.length - 1]);
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/designs/:id/comments/:commentId  comment author, design author, or admin
router.delete('/:id/comments/:commentId', requireAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const comment = design.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (!comment.author.equals(req.user._id) && !canEdit(req.user, design)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    comment.deleteOne();
    await design.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

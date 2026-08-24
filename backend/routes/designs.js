const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const Design = require('../models/Design');
const { requireAuth, optionalAuth, requireVerified } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { ALLOWED_EXT, kindFor, inlineMimeFor } = require('../lib/files');
const { describeChanges } = require('../lib/changes');
const { cardPipeline, familyCardPipeline, shapeCards } = require('../lib/cards');
const xp = require('../lib/xp');
const social = require('../lib/social');
const ports = require('../lib/ports');
const { parseRequires, effectiveRequires, readiness } = require('../lib/requires');
const { sanitizeLinks, isImageUrl } = require('../lib/links');
const User = require('../models/User');
const Comment = require('../models/Comment');

const router = express.Router();
const { UPLOAD_DIR, blobPath, ingest } = require('../lib/storage');

// Uploads land here first and are moved into the content store once accepted,
// so a rejected request never leaves anything in among the real blobs.
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);
const MAX_FILES = 20;
const MAX_LINKS = 25;
// Uploads eat disk on the box hosting this, so they start out admin-only.
// Everyone else attaches external links instead. Flip to false to open it up.
const UPLOADS_ADMIN_ONLY = process.env.UPLOADS_ADMIN_ONLY !== 'false';

const storage = multer.diskStorage({
  destination: TEMP_DIR,
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
const discardUploads = (req) => {
  for (const f of req.files || []) fs.unlink(path.join(TEMP_DIR, f.filename), () => {});
};

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
  { path: 'parent', select: 'title author version', populate: { path: 'author', select: 'username' } },
  // Components carry their provides so the Built-from list can show mates.
  { path: 'uses.work', select: 'title author version ports.provides', populate: { path: 'author', select: 'username' } },
  { path: 'steps.workRef.work', select: 'title author version', populate: { path: 'author', select: 'username' } },
  { path: 'author', select: 'username' },
  { path: 'history.editedBy', select: 'username' },
  // categories/uses ride along so the verify gate can weigh the reviewer's
  // level in the standard's dominant category.
  { path: 'ports.provides.standard', select: 'title version standard.portName categories uses author' },
  { path: 'ports.accepts.standard', select: 'title version standard.portName' },
];

/* Ports Spec §2: a provides claim is verified by a third party with standing —
   level `ports.verifyMinLevel` in the standard's dominant category. Neither
   the claiming author nor the standard's author qualifies: one wrote the
   claim, the other is paid by it (E9). Admins are exempt from the level bar. */
function canVerifyPort(user, design, decl) {
  const std = decl.standard;
  if (!std || !std.title) return false;
  if ((design.author._id || design.author).equals(user._id)) return false;
  if (std.author && String(std.author) === String(user._id)) return false;
  if (user.role === 'admin') return true;
  const { levels } = xp.levelsOf(user);
  return (levels[xp.dominantCategory(std)] || 0) >= xp.config.ports.verifyMinLevel;
}

/* A work's comment thread, from the site-wide comments collection.
   §7.1 inline presence: one chip per author, computed server-side so the
   payload stays lean and the client renders without thinking. Part III makes
   these accountability targets: votable at display-level stakes, downvotes
   with reason cards — and zero XP, since the ledger never reads them. */
async function commentsFor(designId, user) {
  const comments = await Comment.find({ targetType: 'design', target: designId, deletedAt: null })
    .sort({ createdAt: 1 })
    .populate('author', 'username xp createdAt');
  return comments.map(c => ({
    _id: c._id, body: c.body, createdAt: c.createdAt,
    author: c.author ? { _id: c.author._id, username: c.author.username, chip: xp.chipFor(c.author) } : null,
    upvoteCount: (c.upvotes || []).length,
    downvoteCount: (c.downvotes || []).length,
    upvoted: social.voted(c, user, 'upvotes'),
    downvoted: social.voted(c, user, 'downvotes'),
    reasonCards: social.serializeReasons(c, user),
  }));
}

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
  return sanitizeLinks(items, { max: MAX_LINKS });
}

/* §2A: the uploader chooses 1–3 categories with integer weights summing to
   100. This vector is the only input XP routing ever reads, so it is strict:
   spreading wide gains nothing, and the claim is public and disputable. */
function parseCategories(raw) {
  const items = parseJson(raw, null);
  if (items === null) return null;                 // field absent: leave as-is on edit
  if (!Array.isArray(items)) throw Object.assign(new Error('categories must be a list'), { status: 400 });
  const { min, max, sum } = xp.config.declaration;
  const seen = new Set();
  const out = [];
  for (const c of items) {
    const id = String(c.id || '');
    if (!xp.config.categoryIds.includes(id) || id === 'innov') {
      throw Object.assign(new Error(`"${id}" is not a category you can declare`), { status: 400 });
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, weight: Math.round(Number(c.weight) || 0) });
  }
  if (out.length < min || out.length > max) {
    throw Object.assign(new Error(`Declare between ${min} and ${max} categories`), { status: 400 });
  }
  const total = out.reduce((a, c) => a + c.weight, 0);
  if (total !== sum || out.some(c => c.weight <= 0)) {
    throw Object.assign(new Error(`Category weights must be positive and sum to ${sum}`), { status: 400 });
  }
  return out;
}

/* §2B: need tags drive discovery and never touch XP. */
/* Delta C: facets come from the fixed list; anything else is dropped. */
function parseFacets(raw) {
  if (raw === undefined || raw === null) return null;
  const items = Array.isArray(raw) ? raw : String(raw).split(',');
  const ok = new Set(xp.config.softwareFacets);
  return [...new Set(items.map(t => String(t).trim().toLowerCase()).filter(t => ok.has(t)))];
}

function parseNeedTags(raw) {
  if (raw === undefined || raw === null) return null;
  const items = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(items.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 15);
}

/* Every referenced component has to exist, and none of it may loop back to
   this work. Components enter only through reference-steps (checkStepRefs). */
async function checkComponents(components, designId) {
  if (!components || !components.length) return;
  const ids = components.map(c => String(c.work));
  if (designId && ids.includes(String(designId))) {
    throw Object.assign(new Error('A work cannot use itself'), { status: 400 });
  }
  const found = await Design.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) {
    throw Object.assign(new Error('One of those works does not exist'), { status: 400 });
  }
  if (designId && await Design.wouldCycle(designId, ids)) {
    throw Object.assign(new Error('That would make these works use each other in a loop'), { status: 400 });
  }
}

/* Steps arrive as JSON: [{title, body, duration, attachments, workRef}].
   Attachments are CAS refs the caller already owns (uploaded via a draft, or
   already on this work); anything else is dropped rather than trusted. */
function parseSteps(raw, ownedByName) {
  const items = parseJson(raw, null);
  if (items === null) return null;
  if (!Array.isArray(items)) throw Object.assign(new Error('steps must be a list'), { status: 400 });
  return items.slice(0, 60).map((st, i) => ({
    title: clean(st.title, 160),
    body: clean(st.body, 8000),
    duration: clean(st.duration, 80),
    attachments: (Array.isArray(st.attachments) ? st.attachments : []).slice(0, 20)
      .filter(a => a && ownedByName.has(String(a.storedName)))
      .map((a, j) => {
        const known = ownedByName.get(String(a.storedName));
        return { ...known, caption: clean(a.caption, 200), order: j };
      }),
    needs: (Array.isArray(st.needs) ? st.needs : []).slice(0, 8)
      .map(String).filter(n => xp.config.equipmentItems.includes(n)),
    links: sanitizeLinks(Array.isArray(st.links) ? st.links : [], { max: 8 }),
    workRef: {
      work: /^[a-f0-9]{24}$/i.test(String(st.workRef && st.workRef.work || '')) ? String(st.workRef.work) : null,
      version: st.workRef && st.workRef.version != null && st.workRef.version !== ''
        ? Math.max(1, parseInt(st.workRef.version, 10) || 1) : null,
    },
  })).filter(st => st.title || st.body || st.attachments.length || st.links.length || st.workRef.work);
}

/* Which stored files may this request attach to steps? Its own draft's, and
   the work's existing ones on edit. Keyed by content hash. */
function ownedFileMap(...fileLists) {
  const map = new Map();
  for (const list of fileLists) for (const f of list || []) {
    map.set(String(f.storedName), {
      originalName: f.originalName, storedName: f.storedName,
      mimeType: f.mimeType, size: f.size, kind: f.kind,
    });
  }
  return map;
}

async function checkStepRefs(steps, designId) {
  const refs = [...new Set((steps || []).map(st => st.workRef.work).filter(Boolean))];
  if (!refs.length) return;
  await checkComponents(refs.map(work => ({ work })), designId);
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
async function toFileMeta(files, captionsRaw, startOrder = 0) {
  const captions = parseJson(captionsRaw, null);
  const meta = [];
  for (const [i, f] of (files || []).entries()) {
    // The hash is the name: identical bytes from anyone land on one blob.
    const storedName = await ingest(path.join(TEMP_DIR, f.filename));
    meta.push({
      originalName: f.originalname,
      storedName,
      mimeType: f.mimetype,
      size: f.size,
      kind: kindFor(f.originalname),
      caption: Array.isArray(captions) ? clean(captions[i], 200) : '',
      order: startOrder + i,
    });
  }
  return meta;
}

/* Recompute the users an action touched: the author, plus authors of anything
   this work references (their reference XP may have changed). Never fails the
   request: the nightly full pass self-heals anything missed. */
async function refreshXp(design, extraIds = []) {
  try {
    const ids = [design.author._id || design.author, ...extraIds];
    for (const u of design.uses || []) {
      const w = await Design.findById(u.work).select('author');
      if (w) ids.push(w.author);
    }
    await xp.recomputeUsers(ids);
  } catch (err) { console.error('[xp]', err.message); }
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
  obj.downvoteCount = (obj.downvotes || []).length;
  obj.upvoted = !!(user && obj.upvotes.some(v => v.user && String(v.user) === String(user._id)));
  obj.downvoted = !!(user && (obj.downvotes || []).some(v => v.user && String(v.user) === String(user._id)));
  delete obj.upvotes;
  delete obj.downvotes;
  obj.dominantCategory = xp.dominantCategory(design);
  obj.reasonCards = social.serializeReasons(design, user);
  delete obj.downvoteReasons;
  obj.disputes = serializeDisputes(design, user);
  obj.canDispute = !!user && !(design.author._id || design.author).equals(user._id)
    && (user.role === 'admin' || design.categories.some(c =>
        (xp.levelsOf(user).levels[c.id] || 0) >= xp.config.accountability.disputeMinLevel));
  delete obj.categoryDisputes;
  obj.comments = [];   // the GET /:id route attaches the real thread
  obj.overviewFiles = withUrls(obj._id, obj.files);
  obj.steps = (obj.steps || []).map((st, i) => {
    const live = design.steps[i];
    const ref = live && live.workRef && live.workRef.work;
    const resolved = ref && ref.title ? {
      id: ref._id, title: ref.title, author: ref.author && ref.author.username,
      latestVersion: ref.version,
      pinnedVersion: live.workRef.version,
      follows: live.workRef.version === null,
      behind: live.workRef.version !== null && ref.version > live.workRef.version,
    } : (st.workRef && st.workRef.work ? { id: st.workRef.work, missing: true } : null);
    return {
      id: st._id, title: st.title, body: st.body, duration: st.duration, needs: st.needs || [],
      attachments: withUrls(obj._id, st.attachments || []),
      // A link that is itself an image renders inline in the step, like a photo.
      links: (st.links || []).map(l => ({ ...l, image: isImageUrl(l.url) })),
      workRef: resolved,
    };
  });
  // The work's file list is the union of overview + step attachments,
  // assembled here and never maintained by hand.
  obj.files = [...obj.overviewFiles, ...obj.steps.flatMap(st => st.attachments)];
  obj.history = obj.history.map(h => ({ ...h, files: withUrls(obj._id, h.files || []), steps: undefined }));
  obj.canUpload = canUpload(user);
  obj.canEdit = canEdit(user, design);
  // Authorship and moderation are different powers: an admin can delete
  // anything, but "update this page" belongs to the author alone.
  obj.isAuthor = !!(user && (design.author._id || design.author).equals(user._id));
  // Components, resolved: a pinned one says whether the part has moved on since.
  obj.uses = (design.uses || []).map(c => {
    const w = c.work;
    if (!w || !w.title) return { id: c.work, missing: true, label: c.label, note: c.note, version: c.version };
    return {
      id: w._id,
      title: w.title,
      author: w.author && w.author.username,
      latestVersion: w.version,
      pinnedVersion: c.version,
      follows: c.version === null,
      behind: c.version !== null && w.version > c.version,
      label: c.label,
      note: c.note,
    };
  });
  // Ports, resolved: each chip names its standard and links to the hub.
  const portChip = (p) => {
    const s = p.standard;
    return s && s.title
      ? { id: p._id, standard: s._id, title: s.title,
          portName: (s.standard && s.standard.portName) || '',
          pinnedVersion: p.version, latestVersion: s.version }
      : { id: p._id, standard: p.standard, missing: true, pinnedVersion: p.version };
  };
  obj.ports = {
    provides: (design.ports.provides || []).map(p => ({
      ...portChip(p),
      fieldValues: p.fieldValues || {},
      status: p.status,
      verifiedAt: p.verifiedAt,
      // The viewer's standing to review this claim (Ports Spec §2).
      canVerify: !!user && p.status === 'claimed' && canVerifyPort(user, design, p),
      canUnverify: !!user && p.status === 'verified'
        && (user.role === 'admin' || (p.verifiedBy && String(p.verifiedBy) === String(user._id))),
    })),
    accepts: (design.ports.accepts || []).map(a => ({
      ...portChip(a),
      // Body mounts (delta A): which side the device fits and its fit numbers.
      laterality: a.laterality || null,
      fieldValues: a.fieldValues || {},
    })),
  };
  if (obj.standard && design.type !== 'standard') delete obj.standard;
  obj.uses.forEach((u, i) => {
    const w = design.uses[i] && design.uses[i].work;
    // Which of this work's accepts does the part provide? The mate-check.
    u.mates = w && w.title ? ports.matesFor(design, w).map(m => {
      const a = (design.ports.accepts || []).find(x => ports.idOf(x.standard) === m.standard);
      const s = a && a.standard;
      return { standard: m.standard, verified: m.verified,
               portName: (s && s.standard && s.standard.portName) || '' };
    }) : [];
  });
  obj.lineage = {
    parent: design.parent && design.parent.title
      ? { id: design.parent._id, title: design.parent.title, version: design.parentVersion,
          author: design.parent.author && design.parent.author.username }
      : null,
    root: design.root,
    depth: design.depth || 0,
    // Depth, not the parent link, decides this: a revision whose original has
    // since been deleted is still a revision, it just cannot point at one.
    isOriginal: (design.depth || 0) === 0,
    parentMissing: (design.depth || 0) > 0 && !design.parent,
  };
  return obj;
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
    // ?by=username: one member's works, for the profile's bank view.
    if (req.query.by) {
      const owner = await User.findOne({ usernameLower: String(req.query.by).toLowerCase() }).select('_id');
      if (!owner) return res.json({ items: [], page, limit, total: 0 });
      filter.author = owner._id;
    }
    // The standard pickers (ports editor) browse standards only.
    if (req.query.type === 'standard' || req.query.type === 'design') filter.type = req.query.type;
    if (req.query.facet && xp.config.softwareFacets.includes(req.query.facet)) filter.facets = req.query.facet;
    /* ?need=one-handed,feeding — exact needTags intersection. Structured,
       unlike the text search: a work matches by declaring the need, not by
       happening to mention the word. Custom tags filter like curated ones. */
    if (req.query.need) {
      const needs = String(req.query.need).split(',')
        .map(t => t.trim().toLowerCase())
        .filter(t => /^[a-z0-9][a-z0-9-]{0,39}$/.test(t))
        .slice(0, 6);
      if (needs.length) filter.needTags = { $all: needs };
    }
    // Buildable with my equipment: the work's own list is a subset of what the
    // viewer owns. Composite-deep readiness lives on the work page.
    if (req.query.buildable === '1' && req.user) {
      filter.$expr = { $setIsSubset: [{ $ifNull: ['$requires.equipment.item', []] }, req.user.equipment || []] };
    }
    /* Lineage modes. Default browse is family-aware: one card per family,
       wearing the sibling count as a stack badge, so three remixes of one
       spoon read as one spoon with depth, not three near-identical cards.
       'roots' and 'remixes' filter flat; 'all' is the old flat everything.
       Profile banks (?by=) and the standard pickers (?type=) list flat. */
    const lineageMode = ['all', 'roots', 'remixes'].includes(req.query.lineage) ? req.query.lineage
      : (req.query.by || req.query.type) ? 'all' : 'families';
    if (lineageMode === 'roots') filter.depth = { $in: [0, null] };
    if (lineageMode === 'remixes') filter.depth = { $gt: 0 };

    const pipeline = lineageMode === 'families' ? familyCardPipeline : cardPipeline;
    const countFamilies = () => Design.aggregate([
      { $match: filter },
      { $group: { _id: { $ifNull: ['$root', '$_id'] } } },
      { $count: 'n' },
    ]).then(r => (r[0] ? r[0].n : 0));
    const [items, total] = await Promise.all([
      Design.aggregate(pipeline({
        match: filter, sort, skip: (page - 1) * limit, limit, viewerId: req.user ? req.user._id : null,
      })),
      lineageMode === 'families' ? countFamilies() : Design.countDocuments(filter),
    ]);
    const shaped = shapeCards(items).map(card => {
      const { requiredEquipment, ...rest } = card;
      if (!req.user) return rest;
      const owned = new Set(req.user.equipment || []);
      const missing = (requiredEquipment || []).filter(i => !owned.has(i));
      return { ...rest, buildable: missing.length === 0, missingEquipment: missing };
    });
    res.json({ items: shaped, page, limit, total });
  } catch (err) { next(err); }
});

// POST /api/designs  (multipart: title, description, tags, links, guide, captions, files[])
router.post('/', requireAuth, requireVerified, acceptUpload, async (req, res, next) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      discardUploads(req);
      return res.status(400).json({ error: 'title is required' });
    }
    const links = parseLinks(req.body.links);
    const categories = parseCategories(req.body.categories);
    if (!categories) {
      discardUploads(req);
      return res.status(400).json({ error: 'Declare 1-3 categories for this work' });
    }
    const type = req.body.type === 'standard' ? 'standard' : 'design';
    const standardDef = type === 'standard' ? ports.parseStandardDef(req.body.standard) : null;
    if (type === 'standard' && !standardDef) {
      discardUploads(req);
      return res.status(400).json({ error: 'A standard needs a port name and its fields' });
    }
    const declaredPorts = await ports.checkPorts(Design, ports.parsePorts(req.body.ports));
    const files = await toFileMeta(req.files, req.body.captions);
    const requires = parseRequires(req.body.requires);
    const facets = parseFacets(req.body.facets);
    const steps = parseSteps(req.body.steps, ownedFileMap(files)) || [];
    await checkStepRefs(steps, null);
    const design = new Design({
      title, description,
      tags: parseTags(req.body.tags),
      needTags: parseNeedTags(req.body.needTags) || [],
      categories,
      author: req.user._id,
      files,
      steps,
      links: links || [],
      type,
      standard: type === 'standard' ? standardDef : undefined,
      ports: declaredPorts
        ? { provides: ports.reconcileProvides([], declaredPorts.provides), accepts: declaredPorts.accepts }
        : undefined,
      requires: requires || { equipment: [], materials: [] },
      facets: facets || [],
    });
    design.syncUses();
    design.root = design._id;          // an original is the root of its own family

    // Mostly someone else's bytes? Then this is a version of their work, with
    // the provenance link recorded, and it earns fork XP rather than author XP.
    const match = await Design.noveltyMatch(Design.blobsOf(design));
    if (match) {
      design.parent = match._id;
      design.parentVersion = match.version;
      design.root = match.root || match._id;
      design.depth = (match.depth || 0) + 1;
    }
    await design.save();
    refreshXp(design);
    await design.populate(POPULATE);
    res.status(201).json(serialize(design, req.user));
  } catch (err) {
    discardUploads(req);   // temp files; any stored blob is left to the sweep
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});


/* ---------------- general flag ----------------
   The work page's flag button, beyond category disputes: spam, stolen work,
   safety. Files a case for a human (models/Flag.js), shown in the admin flags
   view. One open flag per member per work; resolving reopens the slot. */
router.post('/:id/report', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const Flag = require('../models/Flag');
    const design = await Design.findById(req.params.id).select('title');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const kinds = ['spam', 'stolen', 'unsafe', 'other'];
    const kind = kinds.includes(req.body && req.body.kind) ? req.body.kind : 'other';
    const reason = String((req.body && req.body.reason) || '').trim();
    if (reason.length < 10) return res.status(400).json({ error: 'Say what is wrong, in at least 10 characters' });
    const key = `report:${design._id}:${req.user._id}`;
    const detail = `[${kind}] "${design.title}" (/works/${design._id}): ${reason}`.slice(0, 500);
    const existing = await Flag.findOne({ key });
    if (existing && !existing.resolvedAt) {
      return res.status(409).json({ error: 'You already have an open flag on this work' });
    }
    if (existing) {
      existing.resolvedAt = null; existing.resolvedBy = null; existing.detail = detail;
      await existing.save();
    } else {
      await Flag.create({ kind: 'report', key, accounts: [req.user._id], detail });
    }
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------- lineage ----------------
   A revision is a work of its own: its author owns it, edits it and versions it
   like any other. What ties it to the original is `parent`, and every work in a
   family carries the same `root`, so the whole tree is one query.            */

/* Starting a revision of someone else's work is a DRAFT operation: the wizard
   opens on a copy (POST /api/drafts { forkOf }) and nothing publishes until
   the builder ships. Publish stamps parent/root/depth from the draft. */

// GET /api/designs/:id/lineage  -- every work in this family, flat
router.get('/:id/lineage', async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).select('root');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const rootId = design.root || design._id;

    const family = await Design.aggregate([
      { $match: { $or: [{ root: rootId }, { _id: rootId }] } },
      { $sort: { depth: 1, createdAt: 1 } },
      { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'author' } },
      { $unwind: '$author' },
      // Verified builds per branch: the number that says which branch won.
      { $lookup: {
        from: 'producedentries', as: 'producedDocs',
        let: { id: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$work', '$$id'] }, { $eq: ['$cachedState', 'verified'] }] } } },
          { $count: 'n' },
        ],
      } },
      { $project: {
        id: '$_id', title: 1, parent: 1, parentVersion: 1, depth: 1, version: 1,
        createdAt: 1, downloadCount: 1, remixNote: 1,
        producedCount: { $ifNull: [{ $first: '$producedDocs.n' }, 0] },
        upvoteCount: { $size: '$upvotes' },
        author: { _id: 1, username: 1 },
      } },
    ]);

    res.json({ rootId, count: family.length, items: family });
  } catch (err) { next(err); }
});



// GET /api/designs/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).populate(POPULATE);
    if (!design) return res.status(404).json({ error: 'Design not found' });

    const rootId = design.root || design._id;
    const [children, familyCount, usedIn] = await Promise.all([
      Design.find({ parent: design._id })
        .select('title author version createdAt upvotes remixNote')
        .populate('author', 'username')
        .sort({ createdAt: 1 })
        .limit(50),
      Design.countDocuments({ $or: [{ root: rootId }, { _id: rootId }] }),
      Design.find({ 'uses.work': design._id })
        .select('title author version')
        .populate('author', 'username')
        .sort({ createdAt: -1 })
        .limit(50),
    ]);
    const body = serialize(design, req.user);
    body.effectiveRequires = await effectiveRequires(Design, design);
    if (req.user) body.readiness = readiness(body.effectiveRequires, req.user.equipment);
    body.comments = await commentsFor(design._id, req.user);
    const authorDoc = await User.findById(design.author._id).select('xp');
    if (authorDoc) body.author.roboXp = xp.roboXpOf(authorDoc);
    body.usedIn = usedIn.map(w => ({
      id: w._id, title: w.title, version: w.version, author: w.author && w.author.username,
    }));
    body.lineage.familyCount = familyCount;
    /* The Family panel's branch scoreboard: each remix with its note and its
       verified-build count, the number that says which branch is winning. */
    const ProducedEntry = require('../models/ProducedEntry');
    const childBuilds = children.length ? await ProducedEntry.aggregate([
      { $match: { work: { $in: children.map(c => c._id) }, cachedState: 'verified' } },
      { $group: { _id: '$work', n: { $sum: 1 } } },
    ]) : [];
    const buildsOf = new Map(childBuilds.map(x => [String(x._id), x.n]));
    body.lineage.children = children.map(c => ({
      id: c._id, title: c.title, version: c.version, createdAt: c.createdAt,
      upvoteCount: c.upvotes.length, author: c.author && c.author.username,
      remixNote: c.remixNote || '', producedCount: buildsOf.get(String(c._id)) || 0,
    }));
    if ((design.depth || 0) > 0 && String(rootId) !== String(design._id)) {
      const rootDoc = await Design.findById(rootId).select('title');
      if (rootDoc) body.lineage.rootTitle = rootDoc.title;
    }
    res.json(body);
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

    const standardShape = (d) => JSON.stringify(d.type !== 'standard' ? null
      : [d.standard.portName, (d.standard.fields || []).map(f => [f.name, f.unit, !!f.required])]);
    const before = {
      title: design.title,
      description: design.description,
      tags: [...design.tags],
      categories: design.categories.map(c => ({ id: c.id, weight: c.weight })),
      needTags: [...design.needTags],
      files: design.files.map(f => f.toObject()),
      links: design.links.map(l => l.toObject()),
      uses: design.uses.map(c => c.toObject()),
      steps: design.steps.map(st => st.toObject()),
      portsShape: ports.portShape(design.ports),
      standardShape: standardShape(design),
    };

    const newCategories = parseCategories(req.body.categories);
    if (newCategories) design.categories = newCategories;
    const newNeedTags = parseNeedTags(req.body.needTags);
    if (newNeedTags !== null) design.needTags = newNeedTags;

    /* Ports: an edit is a re-claim — verification survives only for provides
       whose standard, version and values are unchanged (lib/ports.js). The
       work's type never changes after creation: works point at standards, and
       a standard demoting itself would strand every declaration against it. */
    const newPorts = await ports.checkPorts(Design, ports.parsePorts(req.body.ports), { selfId: design._id });
    const newRequires = parseRequires(req.body.requires);
    if (newRequires) design.requires = newRequires;
    const newFacets = parseFacets(req.body.facets);
    if (newFacets !== null) design.facets = newFacets;
    if (newPorts) {
      design.ports.provides = ports.reconcileProvides(design.ports.provides, newPorts.provides);
      design.ports.accepts = newPorts.accepts;
    }
    if (design.type === 'standard') {
      const def = ports.parseStandardDef(req.body.standard);
      if (def) design.standard = def;
    }

    if (req.body.title !== undefined) design.title = req.body.title;
    if (req.body.description !== undefined) design.description = req.body.description;
    if (req.body.tags !== undefined) design.tags = parseTags(req.body.tags);
    if (req.body.links !== undefined) {
      const links = parseLinks(req.body.links);
      if (links) design.links = links;
    }
    const removeIds = new Set(parseTags(req.body.removeFiles));
    // Files are kept on disk because history versions still reference them.
    design.files = design.files.filter(f => !removeIds.has(f._id.toString()));
    applyFileMeta(design, req.body.fileMeta);
    const nextOrder = design.files.reduce((max, f) => Math.max(max, f.order || 0), -1) + 1;
    design.files.push(...await toFileMeta(req.files, req.body.captions, nextOrder));

    if (req.body.steps !== undefined) {
      const owned = ownedFileMap(design.files,
        ...design.steps.map(st => st.attachments),
        ...design.history.flatMap(h => (h.steps || []).map(st => st.attachments)));
      const steps = parseSteps(req.body.steps, owned);
      if (steps) {
        await checkStepRefs(steps, design._id);
        design.steps = steps;
        design.syncUses();
      }
    }

    const after = {
      title: design.title,
      description: design.description,
      tags: [...design.tags],
      categories: design.categories.map(c => ({ id: c.id, weight: c.weight })),
      needTags: [...design.needTags],
      files: design.files.map(f => (f.toObject ? f.toObject() : f)),
      links: design.links.map(l => (l.toObject ? l.toObject() : l)),
      uses: design.uses.map(c => (c.toObject ? c.toObject() : c)),
      steps: design.steps.map(st => (st.toObject ? st.toObject() : st)),
      portsShape: ports.portShape(design.ports),
      standardShape: standardShape(design),
    };
    const changes = describeChanges(before, after);

    // No change, no new version - the history only records real edits.
    if (changes.length) {
      // A version needs a line of changelog: readers deserve to know why v3 exists.
      if (!clean(req.body.editNote, 300)) {
        discardUploads(req);
        return res.status(400).json({ error: 'Add a one-line changelog for this version' });
      }
      design.history.push({
        version: design.version,
        ...before,
        changes,
        editedBy: req.user._id,
        editNote: clean(req.body.editNote, 300),
      });
      design.version += 1;
    }

    await design.save();
    await design.populate(POPULATE);
    res.json({ ...serialize(design, req.user), changes });
  } catch (err) {
    discardUploads(req);   // temp files; any stored blob is left to the sweep
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
    // Only this work goes away. Its files stay on disk for as long as any other
    // work or version still points at them, and the sweep reclaims them once
    // nothing does. Unlinking here instead would race with a fork or an upload
    // taking a fresh reference on the same bytes.
    const touched = [design.author._id || design.author,
      ...(design.uses || []).map(u => u.work)];
    await design.deleteOne();
    await Comment.deleteMany({ targetType: 'design', target: design._id });
    // The proof and the proposed words go with their subject; their XP follows
    // on recompute because the sources are gone.
    const ProducedEntry = require('../models/ProducedEntry');
    const entryIds = (await ProducedEntry.find({ work: design._id }).select('_id')).map(e => e._id);
    if (entryIds.length) {
      await Comment.deleteMany({ targetType: 'produced', target: { $in: entryIds } });
      await ProducedEntry.deleteMany({ work: design._id });
    }
    await require('../models/DocRevision').deleteMany({ work: design._id });
    // The deleted work's XP (and the reference XP it granted) vanishes on
    // recompute, because the source object is gone.
    try {
      const ids = [touched[0]];
      for (const w of touched.slice(1)) {
        const ref = await Design.findById(w).select('author');
        if (ref) ids.push(ref.author);
      }
      await xp.recomputeUsers(ids);
    } catch (err) { console.error('[xp]', err.message); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

function findFile(design, fileId) {
  const inSteps = (steps) => (steps || []).flatMap(st => st.attachments || []);
  return design.files.id(fileId)
    || inSteps(design.steps).find(f => f._id.toString() === fileId)
    || [...design.history.flatMap(h => h.files || []), ...design.history.flatMap(h => inSteps(h.steps))]
        .find(f => f._id.toString() === fileId);
}

// GET /api/designs/:id/files/:fileId  downloads a file and bumps the counter
router.get('/:id/files/:fileId', async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const file = findFile(design, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    await Design.updateOne({ _id: design._id }, { $inc: { downloadCount: 1 } });
    res.download(blobPath(file.storedName), file.originalName);
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
    res.sendFile(blobPath(file.storedName));
  } catch (err) { next(err); }
});

// POST /api/designs/:id/upvote  toggles the current user's upvote
/* One handler for both directions, on the shared toggle (lib/social.js). The
   voter's weight (§4) is frozen onto the vote, in the work's dominant
   category, so XP stays a pure recompute. */
async function castVote(req, res, next, direction) {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const result = social.castVote(design, req.user, direction, {
      weight: xp.voterWeight(req.user, xp.dominantCategory(design)),
      reason: req.body && req.body.reason,
    });
    await design.save();
    refreshXp(design, [req.user._id]);
    res.json({ ...result, reasonCards: social.serializeReasons(design, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/* POST /api/designs/:id/reasons/:reasonId/vote  { dir: 1 | -1 }
   Terminal by design: the route accepts a direction and nothing else, so the
   accountability chain is one level deep and stops. */
router.post('/:id/reasons/:reasonId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const reason = social.judgeReason(design, req.params.reasonId, req.user, {
      weight: xp.voterWeight(req.user, xp.dominantCategory(design)),
      authorId: design.author._id || design.author,
      dir: Number(req.body && req.body.dir),
    });
    await design.save();
    // A state flip moves XP for the work's author and for the critic.
    refreshXp(design, [reason.user]);
    res.json({ reasonCards: social.serializeReasons(design, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* POST /api/designs/:id/disputes  { reason, categories }
   Flagging a wrong declaration (§2A). Takes standing: level disputeMinLevel in
   one of the work's declared categories (admins exempt), because the flag is a
   public claim that will itself be judged. */
router.post('/:id/disputes', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const authorId = design.author._id || design.author;
    if (authorId.equals(req.user._id)) {
      return res.status(400).json({ error: 'It is your work: just edit the categories' });
    }
    if (design.categoryDisputes.some(d => d.user.equals(req.user._id) && !d.appliedAt && xp.reasonState(d) === 'standing')) {
      return res.status(409).json({ error: 'You already have an open dispute on this work' });
    }
    if (req.user.role !== 'admin') {
      const { levels } = xp.levelsOf(req.user);
      const standing = design.categories.some(c => (levels[c.id] || 0) >= xp.config.accountability.disputeMinLevel);
      if (!standing) {
        return res.status(403).json({ error: `Disputing a declaration takes level ${xp.config.accountability.disputeMinLevel} in one of its declared categories` });
      }
    }

    const text = String((req.body && req.body.reason) || '').trim();
    if (text.length < xp.config.accountability.reasonMinLength) {
      return res.status(400).json({ error: `Say why, in at least ${xp.config.accountability.reasonMinLength} characters` });
    }
    const proposed = parseCategories(JSON.stringify((req.body && req.body.categories) || []));
    if (!proposed) return res.status(400).json({ error: 'Propose the split you think is right' });
    const key = (list) => JSON.stringify([...list].map(c => [c.id, c.weight]).sort());
    if (key(proposed) === key(design.categories)) {
      return res.status(400).json({ error: 'That is the declaration the work already has' });
    }

    design.categoryDisputes.push({
      user: req.user._id, text: text.slice(0, 2000),
      proposed, previous: design.categories.map(c => ({ id: c.id, weight: c.weight })),
    });
    await design.save();
    res.status(201).json({ disputes: serializeDisputes(design, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* POST /api/designs/:id/disputes/:disputeId/vote  { dir } — terminal, like
   reason-votes. Endorsement applies the proposed declaration on the spot; the
   next recompute re-routes every point that flowed through the old vector. */
router.post('/:id/disputes/:disputeId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const dispute = design.categoryDisputes.id(req.params.disputeId);
    if (!dispute) return res.status(404).json({ error: 'No such dispute' });
    if (dispute.appliedAt) return res.status(403).json({ error: 'This dispute was already applied' });

    const authorId = design.author._id || design.author;
    if (authorId.equals(req.user._id)) {
      return res.status(403).json({ error: 'Authors answer a dispute by editing the categories or replying, not by voting it away' });
    }
    if (dispute.user.equals(req.user._id)) return res.status(403).json({ error: 'You raised this dispute' });
    if (xp.reasonFrozen(dispute)) return res.status(403).json({ error: 'This dispute is final' });
    const dir = Number(req.body && req.body.dir);
    if (dir !== 1 && dir !== -1) return res.status(400).json({ error: 'dir must be 1 or -1' });

    const i = dispute.rvotes.findIndex(v => v.user.equals(req.user._id));
    if (i !== -1 && dispute.rvotes[i].dir === dir) dispute.rvotes.splice(i, 1);
    else {
      if (i !== -1) dispute.rvotes.splice(i, 1);
      dispute.rvotes.push({ user: req.user._id, dir,
        weight: xp.voterWeight(req.user, xp.dominantCategory(design)), at: new Date() });
    }

    if (xp.reasonState(dispute) === 'endorsed' && !dispute.appliedAt) {
      design.categories = dispute.proposed.map(c => ({ id: c.id, weight: c.weight }));
      design.syncUses();
      dispute.appliedAt = new Date();
    }
    await design.save();
    refreshXp(design, [dispute.user]);
    res.json({ disputes: serializeDisputes(design, req.user), categories: design.categories });
  } catch (err) { next(err); }
});

function serializeDisputes(design, user) {
  return (design.categoryDisputes || []).map(d => {
    const state = d.appliedAt ? 'endorsed' : xp.reasonState(d);
    const myVote = user && d.rvotes.find(v => v.user.equals(user._id));
    return {
      id: d._id, text: d.text, state, applied: !!d.appliedAt,
      proposed: d.proposed.map(c => ({ id: c.id, weight: c.weight })),
      previous: d.previous.map(c => ({ id: c.id, weight: c.weight })),
      createdAt: d.createdAt, frozen: !!d.appliedAt || xp.reasonFrozen(d),
      voteCount: new Set(d.rvotes.map(v => String(v.user))).size,
      myVote: myVote ? myVote.dir : 0,
      mine: !!(user && d.user.equals(user._id)),
    };
  });
}

/* ---------------- ports (Ports Spec) ---------------- */

/* POST /api/designs/:id/ports/:portId/verify — the D5 flow per declaration:
   a qualified third party reviews a provides claim and flips it to verified,
   which is what makes E9 fire for the standard's author on recompute. */
router.post('/:id/ports/:portId/verify', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id)
      .populate({ path: 'ports.provides.standard', select: 'title version standard.portName categories uses author' });
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const decl = design.ports.provides.id(req.params.portId);
    if (!decl) return res.status(404).json({ error: 'No such port declaration' });
    if (decl.status === 'verified') return res.status(409).json({ error: 'Already verified' });
    if (!canVerifyPort(req.user, design, decl)) {
      return res.status(403).json({ error: `Verifying a claim takes level ${xp.config.ports.verifyMinLevel} in the standard's field, and neither author qualifies` });
    }
    decl.status = 'verified';
    decl.verifiedBy = req.user._id;
    decl.verifiedAt = new Date();
    await design.save();
    // E9 pays the standard's author; the recompute picks it up from the state.
    if (decl.standard.author) xp.recomputeUsers([decl.standard.author]).catch(err => console.error('[xp]', err.message));
    res.json({ ok: true, status: decl.status });
  } catch (err) { next(err); }
});

/* DELETE …/verify — the verifier withdrawing their review, or an admin voiding
   a fraudulent one (§8.5): back to claimed, E9 reverses on recompute. */
router.delete('/:id/ports/:portId/verify', requireAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).populate({ path: 'ports.provides.standard', select: 'author' });
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const decl = design.ports.provides.id(req.params.portId);
    if (!decl || decl.status !== 'verified') return res.status(404).json({ error: 'No verified declaration to withdraw' });
    if (req.user.role !== 'admin' && String(decl.verifiedBy) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the verifier or an admin can withdraw a verification' });
    }
    const standardAuthor = decl.standard && decl.standard.author;
    decl.status = 'claimed';
    decl.verifiedBy = null;
    decl.verifiedAt = null;
    await design.save();
    if (standardAuthor) xp.recomputeUsers([standardAuthor]).catch(err => console.error('[xp]', err.message));
    res.json({ ok: true, status: decl.status });
  } catch (err) { next(err); }
});

/* GET /api/designs/:id/hub — the standard's ecosystem, auto-generated from the
   graph (Ports Spec §3): providers (verified first), consumers, adapters, and
   the open plans designing around it. */
router.get('/:id/hub', optionalAuth, async (req, res, next) => {
  try {
    const std = await Design.findById(req.params.id).select('title version type standard author createdAt')
      .populate('author', 'username');
    if (!std) return res.status(404).json({ error: 'Design not found' });
    if (std.type !== 'standard') return res.status(400).json({ error: 'Only standards have hubs' });

    const [providers, consumers] = await Promise.all([
      Design.find({ 'ports.provides.standard': std._id })
        .select('title author version downloadCount upvotes files ports').populate('author', 'username').limit(200),
      Design.find({ 'ports.accepts.standard': std._id })
        .select('title author version ports').populate('author', 'username').limit(200),
    ]);

    const thumb = (w) => {
      const f = (w.files || []).find(x => x.kind === 'image' && inlineMimeFor(x.originalName));
      return f ? `/api/designs/${w._id}/files/${f._id}/view` : null;
    };
    const shape = (w) => ({
      id: w._id, title: w.title, version: w.version,
      author: w.author && w.author.username,
    });
    // An adapter is any work whose ports span this standard and another one.
    const spansOut = (w) => {
      const other = (id) => String(id && (id._id || id)) !== String(std._id);
      return (w.ports.provides || []).some(p => other(p.standard))
          || (w.ports.accepts || []).some(a => other(a.standard));
    };

    const seenAdapters = new Set();
    const adapters = [...providers, ...consumers].filter(w => {
      if (!spansOut(w) || seenAdapters.has(String(w._id))) return false;
      seenAdapters.add(String(w._id));
      return true;
    }).map(shape);

    // Open plans mentioning the port, plus any linked straight to the standard.
    const TalkPost = require('../models/TalkPost');
    const planFilter = { type: 'plan', 'plan.status': { $in: ['open', 'in-progress'] } };
    const [linkedPlans, namedPlans] = await Promise.all([
      TalkPost.find({ ...planFilter, work: std._id }).select('title board').limit(10),
      std.standard.portName
        ? TalkPost.find({ ...planFilter, $text: { $search: `"${std.standard.portName}"` } }).select('title board').limit(10)
        : [],
    ]);
    const seenPlans = new Set();
    const plans = [...linkedPlans, ...namedPlans].filter(p => {
      if (seenPlans.has(String(p._id))) return false;
      seenPlans.add(String(p._id));
      return true;
    }).map(p => ({ id: p._id, title: p.title, board: p.board }));

    res.json({
      standard: {
        id: std._id, title: std.title, version: std.version,
        portName: std.standard.portName, fields: std.standard.fields,
        author: std.author && std.author.username,
      },
      providers: providers.map(w => {
        const decl = (w.ports.provides || []).find(p => String(p.standard) === String(std._id));
        return { ...shape(w), thumbUrl: thumb(w),
                 upvoteCount: (w.upvotes || []).length, downloadCount: w.downloadCount,
                 verified: !!decl && decl.status === 'verified',
                 pinnedVersion: decl ? decl.version : null,
                 fieldValues: (decl && decl.fieldValues) || {} };
      }).sort((a, b) => (b.verified - a.verified) || (b.upvoteCount - a.upvoteCount)),
      consumers: consumers.map(shape),
      adapters,
      plans,
    });
  } catch (err) { next(err); }
});

router.post('/:id/upvote', requireAuth, requireVerified, (req, res, next) => castVote(req, res, next, 'up'));
router.post('/:id/downvote', requireAuth, requireVerified, (req, res, next) => castVote(req, res, next, 'down'));

// One bucket across every work's thread, same shape as Talk's write limit.
const commentLimit = rateLimit({ windowMs: 60 * 1000, max: 20, key: 'design-comment', message: 'Slow down a moment.' });

// POST /api/designs/:id/comments  { body }  — flat thread, site-wide collection
router.post('/:id/comments', requireAuth, requireVerified, commentLimit, async (req, res, next) => {
  try {
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    if (!(await Design.exists({ _id: req.params.id }))) return res.status(404).json({ error: 'Design not found' });
    const comment = await Comment.create({
      targetType: 'design', target: req.params.id, author: req.user._id, body,
    });
    res.status(201).json({
      _id: comment._id, body: comment.body, createdAt: comment.createdAt,
      author: { _id: req.user._id, username: req.user.username, chip: xp.chipFor(req.user) },
    });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/designs/:id/comments/:commentId  comment author, design author, or admin
router.delete('/:id/comments/:commentId', requireAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).select('author');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const comment = await Comment.findOne({ _id: req.params.commentId, targetType: 'design', target: design._id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (!comment.author.equals(req.user._id) && !canEdit(req.user, design)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    // Part I §9 governance: an admin removing someone else's words on someone
    // else's work is a mod action, logged for ratification (E12).
    if (req.user.role === 'admin' && !comment.author.equals(req.user._id)
        && !(design.author._id || design.author).equals(req.user._id)) {
      const ModAction = require('../models/ModAction');
      await ModAction.create({ mod: req.user._id, action: 'delete-comment', targetType: 'comment',
                               target: comment._id, summary: comment.body.slice(0, 200) });
    }
    await comment.deleteOne();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------------- comment accountability (Part III) ----------------
   Work-thread comments are votable at display-level stakes: weighted votes,
   reason-carded downvotes, judged reasons — and zero XP by construction,
   because the ledger never reads design-comment votes. */

async function loadDesignComment(req) {
  const design = await Design.findById(req.params.id).select('author categories uses');
  if (!design) throw Object.assign(new Error('Design not found'), { status: 404 });
  const comment = await Comment.findOne({ _id: req.params.commentId, targetType: 'design', target: design._id });
  if (!comment) throw Object.assign(new Error('Comment not found'), { status: 404 });
  return { design, comment };
}

// POST /api/designs/:id/comments/:commentId/vote  { dir: 'up'|'down', reason? }
router.post('/:id/comments/:commentId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const { design, comment } = await loadDesignComment(req);
    if (comment.deletedAt) return res.status(400).json({ error: 'That comment was deleted' });
    const dir = req.body && req.body.dir === 'down' ? 'down' : 'up';
    const result = social.castVote(comment, req.user, dir, {
      weight: xp.voterWeight(req.user, xp.dominantCategory(design)),
      reason: req.body && req.body.reason,
    });
    await comment.save();
    res.json({ ...result, reasonCards: social.serializeReasons(comment, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/designs/:id/comments/:commentId/reasons/:reasonId/vote  { dir }
router.post('/:id/comments/:commentId/reasons/:reasonId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const { design, comment } = await loadDesignComment(req);
    social.judgeReason(comment, req.params.reasonId, req.user, {
      weight: xp.voterWeight(req.user, xp.dominantCategory(design)),
      authorId: comment.author,
      dir: Number(req.body && req.body.dir),
    });
    await comment.save();
    res.json({ reasonCards: social.serializeReasons(comment, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- doc revisions (Part I §5) ----------------
   Anyone proposes better words for any work; the author accepts with a click
   or the community's docs-weighted approval clears it after the veto window.
   E8 fires on acceptance — never for your own work (F5). */
const DocRevision = require('../models/DocRevision');
const revisionLimit = rateLimit({ windowMs: 60 * 1000, max: 5, key: 'doc-revision', message: 'Slow down a moment.' });

function serializeRevision(r, design, user) {
  const myVote = user && r.votes.find(v => v.user.equals(user._id));
  return {
    id: r._id, target: r.target, step: r.step,
    previous: r.previous, text: r.text, note: r.note,
    state: r.state(), netApproval: Math.round(r.netApproval() * 10) / 10,
    acceptBar: xp.config.docRevisions.communityAcceptNet,
    createdAt: r.createdAt, appliedAt: r.appliedAt,
    author: r.author && r.author.username
      ? { username: r.author.username, chip: xp.chipFor(r.author) } : null,
    myVote: myVote ? myVote.dir : 0,
    mine: !!(user && (r.author._id || r.author).equals(user._id)),
    canDecide: !!user && canEdit(user, design),
  };
}

// GET /api/designs/:id/revisions — open first, then the recent decided ones
router.get('/:id/revisions', optionalAuth, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).select('author');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const revisions = await DocRevision.find({ work: design._id })
      .sort({ appliedAt: 1, createdAt: -1 }).limit(50)
      .populate('author', 'username xp createdAt');
    res.json({ items: revisions.map(r => serializeRevision(r, design, req.user)) });
  } catch (err) { next(err); }
});

// POST /api/designs/:id/revisions  { target: 'description'|'step', step?, text, note? }
router.post('/:id/revisions', requireAuth, requireVerified, revisionLimit, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    if ((design.author._id || design.author).equals(req.user._id)) {
      return res.status(400).json({ error: 'It is your work: just edit it' });
    }
    const target = req.body.target === 'step' ? 'step' : 'description';
    let previous = design.description;
    let step = null;
    if (target === 'step') {
      const st = design.steps.id(req.body.step);
      if (!st) return res.status(404).json({ error: 'No such step' });
      previous = st.body;
      step = st._id;
    }
    const text = clean(req.body.text, 20000);
    if (!text || text === previous) return res.status(400).json({ error: 'Propose actual changes' });

    const revision = await DocRevision.create({
      work: design._id, author: req.user._id, target, step, previous, text,
      note: clean(req.body.note, 300),
    });
    await revision.populate('author', 'username xp createdAt');
    res.status(201).json(serializeRevision(revision, design, req.user));
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/designs/:id/revisions/:rid/vote  { dir: 1 | -1 } — docs-weighted approval
router.post('/:id/revisions/:rid/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).select('author');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const revision = await DocRevision.findOne({ _id: req.params.rid, work: design._id })
      .populate('author', 'username xp createdAt');
    if (!revision) return res.status(404).json({ error: 'No such revision' });
    if (revision.state() !== 'open') return res.status(403).json({ error: 'This revision is decided' });
    if ((revision.author._id || revision.author).equals(req.user._id)) {
      return res.status(403).json({ error: 'You wrote this revision' });
    }
    const dir = Number(req.body && req.body.dir);
    if (dir !== 1 && dir !== -1) return res.status(400).json({ error: 'dir must be 1 or -1' });
    const i = revision.votes.findIndex(v => v.user.equals(req.user._id));
    if (i !== -1 && revision.votes[i].dir === dir) revision.votes.splice(i, 1);
    else {
      if (i !== -1) revision.votes.splice(i, 1);
      // Approval weighs docs expertise (§5): a level-40 docs account counts most.
      revision.votes.push({ user: req.user._id, dir, weight: xp.voterWeight(req.user, 'docs'), at: new Date() });
    }
    await revision.save();
    res.json(serializeRevision(revision, design, req.user));
  } catch (err) { next(err); }
});

// POST /api/designs/:id/revisions/:rid/accept — the author's single click
router.post('/:id/revisions/:rid/accept', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).select('author');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    if (!canEdit(req.user, design)) return res.status(403).json({ error: 'Only the author decides' });
    const revision = await DocRevision.findOne({ _id: req.params.rid, work: design._id });
    if (!revision) return res.status(404).json({ error: 'No such revision' });
    if (revision.state() !== 'open') return res.status(403).json({ error: 'This revision is decided' });
    const applied = await revision.apply(req.user._id);
    if (!applied) return res.status(409).json({ error: 'The text this revised no longer exists' });
    // E8 flows to the revision author on recompute.
    xp.recomputeUsers([revision.author]).catch(err => console.error('[xp]', err.message));
    await revision.populate('author', 'username xp createdAt');
    res.json(serializeRevision(revision, design, req.user));
  } catch (err) { next(err); }
});

// POST /api/designs/:id/revisions/:rid/veto — closed; the submitter can fork
router.post('/:id/revisions/:rid/veto', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const design = await Design.findById(req.params.id).select('author');
    if (!design) return res.status(404).json({ error: 'Design not found' });
    if (!canEdit(req.user, design)) return res.status(403).json({ error: 'Only the author decides' });
    const revision = await DocRevision.findOne({ _id: req.params.rid, work: design._id });
    if (!revision) return res.status(404).json({ error: 'No such revision' });
    if (revision.state() !== 'open') return res.status(403).json({ error: 'This revision is decided' });
    revision.authorAction = { type: 'vetoed', at: new Date() };
    await revision.save();
    await revision.populate('author', 'username xp createdAt');
    res.json(serializeRevision(revision, design, req.user));
  } catch (err) { next(err); }
});

module.exports = router;

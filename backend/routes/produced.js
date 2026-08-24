const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const Design = require('../models/Design');
const ProducedEntry = require('../models/ProducedEntry');
const Comment = require('../models/Comment');
const { requireAuth, optionalAuth, requireVerified } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { UPLOAD_DIR, blobPath, ingest } = require('../lib/storage');
const { inlineMimeFor } = require('../lib/files');
const xp = require('../lib/xp');
const social = require('../lib/social');
const can = require('../lib/permissions');

/* Produced (Part II): the gallery of real-world results, mounted under
   /api/designs/:designId/produced. Posting a result is as easy as commenting;
   nothing emits XP until the §6 gates pass (models/ProducedEntry). */
const router = express.Router({ mergeParams: true });

const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

/* Build photos are the core loop, so they upload for every verified member
   even while design files stay admin-only: images only, few and small. */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: xp.config.produced.maxMedia },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(IMAGE_EXT.has(ext) ? null : new Error('Result media must be photos'), IMAGE_EXT.has(ext));
  },
});
const discard = (req) => { for (const f of req.files || []) fs.unlink(path.join(TEMP_DIR, f.filename), () => {}); };
const writeLimit = rateLimit({ windowMs: 60 * 1000, max: 10, key: 'produced-write', message: 'Slow down a moment.' });

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

async function loadWork(req) {
  const work = await Design.findById(req.params.designId).select('title author version uses files steps history');
  if (!work) fail(404, 'Design not found');
  return work;
}
async function loadEntry(req, work) {
  const entry = await ProducedEntry.findOne({ _id: req.params.eid, work: work._id });
  if (!entry) fail(404, 'No such entry');
  return entry;
}

// The viewer's standing to challenge: level in the entry's own category (§6).
function canChallenge(user, entry, work) {
  if (!user) return false;
  if (entry.poster.equals(user._id)) return false;
  if (user.role === 'admin') return true;
  const { levels } = xp.levelsOf(user);
  return (levels[entry.category(work)] || 0) >= xp.config.produced.challengeMinLevel;
}

function serializeEntry(entry, work, user, posterDoc) {
  const state = entry.entryState();
  return {
    id: entry._id,
    type: entry.type,
    workVersion: entry.workVersion,
    poster: posterDoc ? { username: posterDoc.username, chip: xp.chipFor(posterDoc) } : null,
    media: (entry.media || []).map(m => ({
      id: m._id, name: m.originalName,
      url: `/api/designs/${work._id}/produced/${entry._id}/media/${m._id}`,
    })),
    link: entry.link || null,
    linkStatus: entry.type === 'deployment' ? entry.linkStatus : undefined,
    process: entry.process,
    outcome: entry.outcome,
    modifications: entry.modifications,
    fitFindings: entry.fitFindings,
    state,                                        // pending | verified | rejected
    createdAt: entry.createdAt,
    upvoteCount: (entry.upvotes || []).length,
    downvoteCount: (entry.downvotes || []).length,
    upvoted: social.voted(entry, user, 'upvotes'),
    downvoted: social.voted(entry, user, 'downvotes'),
    reasonCards: social.serializeReasons(entry, user),
    // Challenges are reason cards with different stakes: they gate the XP.
    challenges: (entry.challenges || []).map(c => {
      const myVote = user && c.rvotes.find(v => v.user.equals(user._id));
      return {
        id: c._id, text: c.text, state: xp.reasonState(c), createdAt: c.createdAt,
        frozen: xp.reasonFrozen(c),
        voteCount: new Set(c.rvotes.map(v => String(v.user))).size,
        myVote: myVote ? myVote.dir : 0,
        mine: !!(user && c.user.equals(user._id)),
      };
    }),
    canChallenge: !!user && state !== 'rejected' && canChallenge(user, entry, work)
      && !(entry.challenges || []).some(c => c.user.equals(user._id)),
    mine: !!(user && entry.poster.equals(user._id)),
    canDelete: !!user && (entry.poster.equals(user._id) || can.isMod(user)),
  };
}

// The users an entry's XP touches: its poster and the work's author.
const touched = (entry, work) => [entry.poster, work.author._id || work.author];

/* GET / — the gallery: entries (default all outcomes — failures are not
   hidden), plus the outcome bar and the trust count of verified results. */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const filter = { work: work._id };
    if (['physical', 'deployment', 'usage'].includes(req.query.type)) filter.type = req.query.type;
    if (['success', 'modified', 'failed'].includes(req.query.outcome)) filter.outcome = req.query.outcome;
    if (req.query.version) filter.workVersion = Math.max(1, parseInt(req.query.version, 10) || 1);

    const entries = await ProducedEntry.find(filter).sort({ createdAt: -1 }).limit(100)
      .populate('poster', 'username xp createdAt');
    const all = await ProducedEntry.find({ work: work._id }).select('outcome challenges createdAt');
    const verified = all.filter(e => e.entryState() === 'verified');
    const outcomes = { success: 0, modified: 0, failed: 0 };
    for (const e of verified) outcomes[e.outcome]++;

    const comments = await Comment.find({ targetType: 'produced', target: { $in: entries.map(e => e._id) }, deletedAt: null })
      .sort({ createdAt: 1 }).populate('author', 'username xp createdAt');
    const byEntry = new Map();
    for (const c of comments) {
      const key = String(c.target);
      if (!byEntry.has(key)) byEntry.set(key, []);
      byEntry.get(key).push({
        _id: c._id, body: c.body, createdAt: c.createdAt,
        author: c.author ? { _id: c.author._id, username: c.author.username, chip: xp.chipFor(c.author) } : null,
      });
    }

    res.json({
      producedCount: verified.length,
      outcomes,
      canPost: !!req.user && ProducedEntry.posterQualifies(req.user),
      items: entries.map(e => ({
        ...serializeEntry(e, work, req.user, e.poster),
        comments: byEntry.get(String(e._id)) || [],
      })),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* POST / — "I made this". Multipart: type, outcome, process, modifications,
   fitFindings, link, files[]. The §6 gates that can be checked now, are:
   poster standing, per-type requirements, duplicate media, link resolution.
   The challenge window does the rest by existing. */
router.post('/', requireAuth, requireVerified, writeLimit, upload.array('files', xp.config.produced.maxMedia), async (req, res, next) => {
  try {
    const work = await loadWork(req);
    if (!ProducedEntry.posterQualifies(req.user)) {
      discard(req);
      return res.status(403).json({ error: `Posting results opens after ${xp.config.produced.minAgeHours}h on the site or ${xp.config.produced.minXp} XP` });
    }
    const type = String(req.body.type || '');
    if (!['physical', 'deployment', 'usage'].includes(type)) { discard(req); return res.status(400).json({ error: 'type must be physical, deployment or usage' }); }
    const outcome = String(req.body.outcome || '');
    if (!['success', 'modified', 'failed'].includes(outcome)) { discard(req); return res.status(400).json({ error: 'outcome must be success, modified or failed' }); }
    const modifications = clean(req.body.modifications, 4000);
    if (outcome === 'modified' && !modifications) { discard(req); return res.status(400).json({ error: 'Say what you changed' }); }
    const fitFindings = clean(req.body.fitFindings, 4000);
    const link = clean(req.body.link, 2000);

    if (type === 'physical' && !(req.files || []).length) { discard(req); return res.status(400).json({ error: 'A physical result needs at least one photo' }); }
    if (type === 'usage' && !(req.files || []).length && !fitFindings) { discard(req); return res.status(400).json({ error: 'A usage report needs a photo or written fit findings' }); }
    if (type === 'deployment') {
      if (!/^https?:\/\//.test(link)) { discard(req); return res.status(400).json({ error: 'A deployment needs its live link' }); }
      const ok = await fetch(link, { signal: AbortSignal.timeout(5000), redirect: 'follow' })
        .then(r => r.status < 500).catch(() => false);
      if (!ok) { discard(req); return res.status(400).json({ error: 'That link does not resolve right now' }); }
    }

    // Ingest, then the duplicate gate: media identical to the work's own files
    // or another entry's media proves nothing (§6 gate 2, exact-match via CAS).
    const media = [];
    for (const f of req.files || []) {
      const storedName = await ingest(path.join(TEMP_DIR, f.filename));
      media.push({ originalName: f.originalname, storedName, mimeType: f.mimetype, size: f.size });
    }
    const ownBlobs = new Set(Design.blobsOf(work));
    const siblings = await ProducedEntry.find({ work: work._id }).select('media.storedName');
    for (const s of siblings) for (const m of s.media || []) ownBlobs.add(m.storedName);
    const dup = media.find(m => ownBlobs.has(m.storedName));
    if (dup) return res.status(400).json({ error: `"${dup.originalName}" already appears on this work. Post your own photos` });

    const entry = new ProducedEntry({
      work: work._id, workVersion: work.version, poster: req.user._id,
      type, outcome, modifications, fitFindings, link,
      process: clean(req.body.process, 2000),
      media,
      linkStatus: type === 'deployment' ? { ok: true, checkedAt: new Date() } : undefined,
    });
    entry.refreshCache();
    await entry.save();
    res.status(201).json(serializeEntry(entry, work, req.user, req.user));
  } catch (err) {
    discard(req);
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// GET /:eid/media/:mid — inline photo, straight off the CAS store.
router.get('/:eid/media/:mid', async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    const m = entry.media.id(req.params.mid);
    if (!m) return res.status(404).json({ error: 'File not found' });
    const mime = inlineMimeFor(m.originalName);
    if (!mime) return res.status(415).json({ error: 'This file type cannot be previewed' });
    res.type(mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(blobPath(m.storedName));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* POST /:eid/vote  { dir: 'up'|'down', reason? } — "was this result useful?"
   Votes hit the POSTER, never the work's author: burying fake or lazy proof
   is the point; punishing an author for someone else's failed print is not. */
router.post('/:eid/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    const dir = req.body && req.body.dir === 'down' ? 'down' : 'up';
    social.castVote(entry, req.user, dir, {
      weight: xp.voterWeight(req.user, entry.category(work)),
      reason: req.body && req.body.reason,
    });
    await entry.save();
    xp.recomputeUsers([entry.poster]).catch(err => console.error('[xp]', err.message));
    await entry.populate('poster', 'username xp createdAt');
    res.json(serializeEntry(entry, work, req.user, entry.poster));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /:eid/reasons/:reasonId/vote — judge an entry downvote's reason.
router.post('/:eid/reasons/:reasonId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    social.judgeReason(entry, req.params.reasonId, req.user, {
      weight: xp.voterWeight(req.user, entry.category(work)),
      authorId: entry.poster,
      dir: Number(req.body && req.body.dir),
    });
    await entry.save();
    xp.recomputeUsers([entry.poster]).catch(err => console.error('[xp]', err.message));
    await entry.populate('poster', 'username xp createdAt');
    res.json(serializeEntry(entry, work, req.user, entry.poster));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* POST /:eid/challenge  { reason } — §6 gate 3: a standing claim against the
   entry's authenticity, judged by the community like any reason card. An
   endorsed challenge rejects the entry and reverses everything it emitted. */
router.post('/:eid/challenge', requireAuth, requireVerified, writeLimit, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    if (!canChallenge(req.user, entry, work)) {
      return res.status(403).json({ error: `Challenging takes level ${xp.config.produced.challengeMinLevel} in the entry's field` });
    }
    if ((entry.challenges || []).some(c => c.user.equals(req.user._id))) {
      return res.status(409).json({ error: 'You already challenged this entry' });
    }
    const text = clean(req.body && req.body.reason, 2000);
    if (text.length < xp.config.accountability.reasonMinLength) {
      return res.status(400).json({ error: `Say why, in at least ${xp.config.accountability.reasonMinLength} characters` });
    }
    entry.challenges.push({ user: req.user._id, weight: xp.voterWeight(req.user, entry.category(work)), text });
    entry.refreshCache();
    await entry.save();
    xp.recomputeUsers(touched(entry, work)).catch(err => console.error('[xp]', err.message));
    await entry.populate('poster', 'username xp createdAt');
    res.status(201).json(serializeEntry(entry, work, req.user, entry.poster));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /:eid/challenges/:reasonId/vote — the community judging a challenge.
router.post('/:eid/challenges/:reasonId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    const challenge = entry.challenges.id(req.params.reasonId);
    if (!challenge) return res.status(404).json({ error: 'No such challenge' });
    if (entry.poster.equals(req.user._id)) return res.status(403).json({ error: 'Posters answer a challenge by replying, not by voting it away' });
    if (challenge.user.equals(req.user._id)) return res.status(403).json({ error: 'You raised this challenge' });
    if (xp.reasonFrozen(challenge)) return res.status(403).json({ error: 'This challenge is final' });
    const dir = Number(req.body && req.body.dir);
    if (dir !== 1 && dir !== -1) return res.status(400).json({ error: 'dir must be 1 or -1' });
    const i = challenge.rvotes.findIndex(v => v.user.equals(req.user._id));
    if (i !== -1 && challenge.rvotes[i].dir === dir) challenge.rvotes.splice(i, 1);
    else {
      if (i !== -1) challenge.rvotes.splice(i, 1);
      challenge.rvotes.push({ user: req.user._id, dir,
        weight: xp.voterWeight(req.user, entry.category(work)), at: new Date() });
    }
    entry.refreshCache();
    await entry.save();
    // A state flip moves the poster's E5 and the author's E6.
    xp.recomputeUsers(touched(entry, work)).catch(err => console.error('[xp]', err.message));
    await entry.populate('poster', 'username xp createdAt');
    res.json(serializeEntry(entry, work, req.user, entry.poster));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// DELETE /:eid — the poster taking it back, or a mod. XP follows the source.
router.delete('/:eid', requireAuth, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    if (!entry.poster.equals(req.user._id) && !can.isMod(req.user)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const ids = touched(entry, work);
    await Comment.deleteMany({ targetType: 'produced', target: entry._id });
    await entry.deleteOne();
    xp.recomputeUsers(ids).catch(err => console.error('[xp]', err.message));
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* Entry threads (§5): where "print and comment" lives — the builder posts the
   result, the author asks "which nozzle?", the next builder reads the answer. */
router.post('/:eid/comments', requireAuth, requireVerified, writeLimit, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    const body = clean(req.body && req.body.body, 4000);
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    const comment = await Comment.create({ targetType: 'produced', target: entry._id, author: req.user._id, body });
    res.status(201).json({
      _id: comment._id, body: comment.body, createdAt: comment.createdAt,
      author: { _id: req.user._id, username: req.user.username, chip: xp.chipFor(req.user) },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/:eid/comments/:cid', requireAuth, async (req, res, next) => {
  try {
    const work = await loadWork(req);
    const entry = await loadEntry(req, work);
    const comment = await Comment.findOne({ _id: req.params.cid, targetType: 'produced', target: entry._id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (!comment.author.equals(req.user._id) && !entry.poster.equals(req.user._id) && !can.isMod(req.user)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    await comment.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

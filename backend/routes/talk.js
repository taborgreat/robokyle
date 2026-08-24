const express = require('express');
const TalkPost = require('../models/TalkPost');
const Comment = require('../models/Comment');
const Design = require('../models/Design');
const WorkDraft = require('../models/WorkDraft');
const ModAction = require('../models/ModAction');
const { requireAuth, optionalAuth, requireVerified } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { inlineMimeFor } = require('../lib/files');
const xp = require('../lib/xp');
const social = require('../lib/social');
const can = require('../lib/permissions');

const router = express.Router();

/* Talk (Talk Spec): boards are the visible XP categories, posts are one of
   exactly three types, and the only XP in the whole section is the accepted
   answer (E10). Post and comment votes here are display-only by construction
   — the ledger walk in lib/xp.js never reads them — so weighted voting sorts
   threads by usefulness without ever paying for engagement. */

// One shared bucket for everything Talk writes, so spraying threads is the
// same as flooding one. Generous for a person, tight for a script.
const writeLimit = rateLimit({ windowMs: 60 * 1000, max: 20, key: 'talk-write', message: 'Slow down a moment.' });

const BOARDS = xp.config.visibleCategoryIds;
const isBoard = (b) => BOARDS.includes(b);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

/* Votes in Talk weigh by the board's category — the category you level in is
   the board you talk in — purely for the usefulness sort. */
const weightFor = (user, post) => xp.voterWeight(user, post.board);

async function loadPost(req) {
  const post = await TalkPost.findById(req.params.id);
  if (!post) fail(404, 'No such thread');
  return post;
}

// Archived = read-only: the campfire went out; the works are the buildings.
const assertWritable = (post) => { if (post.archivedAt) fail(403, 'This thread is archived. Link a work or promote a plan to revive it.'); };

/* The pinned work card (linked posts and became-work threads). */
async function workCard(workId) {
  if (!workId) return null;
  const w = await Design.findById(workId)
    .select('title version author files downloadCount upvotes')
    .populate('author', 'username');
  if (!w) return { id: workId, missing: true };
  const thumb = (w.files || []).find(f => f.kind === 'image' && inlineMimeFor(f.originalName));
  return {
    id: w._id, title: w.title, version: w.version,
    author: w.author && w.author.username,
    downloadCount: w.downloadCount, upvoteCount: (w.upvotes || []).length,
    thumbUrl: thumb ? `/api/designs/${w._id}/files/${thumb._id}/view` : null,
  };
}

const chipAuthor = (a) => a
  ? { _id: a._id, username: a.username, chip: xp.chipFor(a) }
  : null;

function serializeComment(c, post, user) {
  return {
    _id: c._id, parent: c.parent, createdAt: c.createdAt,
    author: c.deletedAt ? null : chipAuthor(c.author),
    body: c.deletedAt ? '' : c.body,
    deleted: !!c.deletedAt,
    forkedTo: c.forkedTo || null,
    accepted: !!(post.acceptedAnswer && String(post.acceptedAnswer) === String(c._id)),
    upvoteCount: (c.upvotes || []).length,
    downvoteCount: (c.downvotes || []).length,
    upvoted: social.voted(c, user, 'upvotes'),
    downvoted: social.voted(c, user, 'downvotes'),
    score: Math.round(social.netScore(c) * 10) / 10,   // usefulness sort key, display-only
    reasonCards: social.serializeReasons(c, user),
    mine: !!(user && c.author && String(c.author._id || c.author) === String(user._id)),
  };
}

async function serializePost(post, user, { withThread = false } = {}) {
  await post.populate('author', 'username xp createdAt');
  const promo = post.plan && post.plan.promotion;
  const body = {
    id: post._id, board: post.board, type: post.type,
    title: post.title, body: post.body,
    author: chipAuthor(post.author),
    createdAt: post.createdAt, lastActivityAt: post.lastActivityAt,
    archived: !!post.archivedAt,
    workVersion: post.workVersion,
    work: await workCard(post.becameWork || post.work),
    becameWork: post.becameWork || null,
    forkedFrom: post.forkedFrom && post.forkedFrom.post ? post.forkedFrom : null,
    acceptedAnswer: post.acceptedAnswer || null,
    upvoteCount: post.upvotes.length,
    downvoteCount: post.downvotes.length,
    upvoted: social.voted(post, user, 'upvotes'),
    downvoted: social.voted(post, user, 'downvotes'),
    score: Math.round(social.netScore(post) * 10) / 10,
    reasonCards: social.serializeReasons(post, user),
    canEdit: can.canEditPost(user, post),
    canFork: can.canForkThread(user, post),
    canAccept: post.type === 'question' && can.canAcceptAnswer(user, post),
    canArchive: can.canArchive(user),
  };
  if (post.type === 'plan') {
    const participants = await TalkPost.populate(post, { path: 'plan.participants.user', select: 'username' });
    body.plan = {
      goal: post.plan.goal, needed: post.plan.needed, status: post.plan.status,
      needTags: post.plan.needTags,
      participants: (participants.plan.participants || [])
        .filter(p => p.user).map(p => ({ username: p.user.username, at: p.at })),
      joined: !!(user && post.plan.participants.some(p => String(p.user._id || p.user) === String(user._id))),
      promotion: promo && promo.user
        ? { requestedAt: promo.requestedAt, approved: promo.approved,
            mine: !!(user && String(promo.user) === String(user._id)) }
        : null,
    };
    const p = can.canPromote(user, post);
    body.canPromote = p.ok && ['open', 'in-progress'].includes(post.plan.status) && !post.becameWork;
    body.promoteWhy = p.ok ? null : p.why;
  }
  if (withThread) {
    const comments = await Comment.find({ targetType: 'talk', target: post._id })
      .sort({ createdAt: 1 })
      .populate('author', 'username xp createdAt');
    body.comments = comments.map(c => serializeComment(c, post, user));
  }
  return body;
}

// GET /api/talk/boards — the nine categories, with what is happening on each
router.get('/boards', async (req, res, next) => {
  try {
    const counts = await TalkPost.aggregate([
      { $group: {
        _id: '$board',
        posts: { $sum: 1 },
        openPlans: { $sum: { $cond: [{ $and: [
          { $eq: ['$type', 'plan'] }, { $in: ['$plan.status', ['open', 'in-progress']] },
        ] }, 1, 0] } },
      } },
    ]);
    const byBoard = new Map(counts.map(c => [c._id, c]));
    res.json({
      boards: xp.config.categories.filter(c => !c.hidden).map(c => ({
        id: c.id, name: c.name, icon: c.icon, color: c.color, scope: c.scope,
        posts: (byBoard.get(c.id) || {}).posts || 0,
        openPlans: (byBoard.get(c.id) || {}).openPlans || 0,
      })),
    });
  } catch (err) { next(err); }
});

/* GET /api/talk?board=&type=&status=&needed=&work=&q=&sort=useful|new|active&page=&limit=
   Default sort = usefulness (weighted net votes). Never "hot", never
   engagement-ranked; new-ness is a filter, not the default (Talk Spec §3).
   ?needed=elec is the matchmaker: plans looking for a skill. */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const match = {};
    if (isBoard(req.query.board)) match.board = req.query.board;
    if (['linked', 'plan', 'question'].includes(req.query.type)) match.type = req.query.type;
    if (['open', 'in-progress', 'became-work', 'abandoned'].includes(req.query.status)) {
      match.type = 'plan';
      match['plan.status'] = req.query.status;
    }
    if (isBoard(req.query.needed)) { match.type = 'plan'; match['plan.needed'] = req.query.needed; }
    const workFilter = /^[a-f0-9]{24}$/i.test(String(req.query.work || '')) ? String(req.query.work) : null;
    if (workFilter) {
      match.$or = [{ work: workFilter }, { becameWork: workFilter }];
    }
    if (req.query.q) match.$text = { $search: String(req.query.q) };

    const SORTS = {
      useful: { score: -1, createdAt: -1 },
      new: { createdAt: -1 },
      active: { lastActivityAt: -1 },
    };
    const items = await TalkPost.aggregate([
      { $match: match },
      { $addFields: { score: { $subtract: [{ $sum: '$upvotes.weight' }, { $sum: '$downvotes.weight' }] } } },
      { $sort: SORTS[req.query.sort] || SORTS.useful },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $lookup: {
        from: 'comments', as: 'commentDocs', let: { id: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$targetType', 'talk'] }, { $eq: ['$target', '$$id'] }] } } },
          { $count: 'n' },
        ],
      } },
      { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'author' } },
      { $unwind: '$author' },
      { $project: {
        id: '$_id', board: 1, type: 1, title: 1, createdAt: 1, lastActivityAt: 1,
        score: { $round: ['$score', 1] },
        upvoteCount: { $size: '$upvotes' },
        commentCount: { $ifNull: [{ $first: '$commentDocs.n' }, 0] },
        archived: { $ne: ['$archivedAt', null] },
        answered: { $ne: ['$acceptedAnswer', null] },
        plan: { status: '$plan.status', needed: '$plan.needed',
                participants: { $size: { $ifNull: ['$plan.participants', []] } } },
        work: { $ifNull: ['$becameWork', '$work'] },
        author: { _id: '$author._id', username: '$author.username' },
      } },
    ]);
    const total = await TalkPost.countDocuments(match);

    /* Filtering by a work also hands back its whole neighborhood: the family
       (revisions back to the root) and the parts it is built from, each with
       its thread count. The Talk page renders this as the tree you walk to
       every conversation the design descends from or depends on. */
    let related = null;
    if (workFilter) {
      const w = await Design.findById(workFilter).select('title version root uses');
      if (w) {
        const rootId = w.root || w._id;
        const [family, parts] = await Promise.all([
          Design.find({ $or: [{ root: rootId }, { _id: rootId }] })
            .select('title version depth').sort({ depth: 1, createdAt: 1 }).limit(50),
          (w.uses || []).length
            ? Design.find({ _id: { $in: w.uses.map(u => u.work) } }).select('title version')
            : [],
        ]);
        const ids = [...family.map(f => f._id), ...parts.map(p => p._id)];
        const counts = await TalkPost.aggregate([
          { $match: { $or: [{ work: { $in: ids } }, { becameWork: { $in: ids } }] } },
          { $project: { ref: { $ifNull: ['$becameWork', '$work'] } } },
          { $group: { _id: '$ref', n: { $sum: 1 } } },
        ]);
        const threadsFor = new Map(counts.map(c => [String(c._id), c.n]));
        const shape = (d) => ({ id: d._id, title: d.title, version: d.version,
                                depth: d.depth || 0, threads: threadsFor.get(String(d._id)) || 0 });
        related = {
          current: { id: w._id, title: w.title, version: w.version },
          family: family.map(shape),
          parts: parts.map(shape),
        };
      }
    }
    res.json({ items, page, limit, total, related });
  } catch (err) { next(err); }
});

// POST /api/talk  { board, type, title, body, work?, workVersion?, plan? }
router.post('/', requireAuth, requireVerified, writeLimit, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!isBoard(b.board)) return res.status(400).json({ error: 'Pick a board' });
    if (!['linked', 'plan', 'question'].includes(b.type)) return res.status(400).json({ error: 'Post type must be linked, plan or question' });
    const title = clean(b.title, 160);
    if (!title) return res.status(400).json({ error: 'The post needs a title' });

    // Linked posts require the work; questions may add one. Context stays in the room.
    let work = null, workVersion = null;
    if (b.work || b.type === 'linked') {
      if (!/^[a-f0-9]{24}$/i.test(String(b.work || ''))) {
        return res.status(400).json({ error: 'A linked post needs the work it is about' });
      }
      const w = await Design.findById(b.work).select('version');
      if (!w) return res.status(404).json({ error: 'That work does not exist' });
      work = w._id;
      workVersion = b.workVersion ? Math.max(1, Math.min(w.version, parseInt(b.workVersion, 10) || w.version)) : null;
    }

    const post = new TalkPost({
      board: b.board, type: b.type, title,
      body: clean(b.body, 8000),
      author: req.user._id, work, workVersion,
    });
    if (b.type === 'plan') {
      const plan = b.plan || {};
      post.plan.goal = clean(plan.goal, 500);
      post.plan.needed = [...new Set((Array.isArray(plan.needed) ? plan.needed : []).filter(isBoard))];
      post.plan.needTags = [...new Set((Array.isArray(plan.needTags) ? plan.needTags : [])
        .map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 15);
      post.plan.participants = [{ user: req.user._id }];   // the OP is in by definition
    }
    await post.save();
    res.status(201).json(await serializePost(post, req.user));
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// GET /api/talk/:id — the thread
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    res.json(await serializePost(post, req.user, { withThread: true }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// PUT /api/talk/:id — OP or mod. Linking a work revives an archived thread.
router.put('/:id', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (!can.canEditPost(req.user, post)) return res.status(403).json({ error: 'Only the author can edit this post' });
    const b = req.body || {};
    if (b.title !== undefined) {
      const t = clean(b.title, 160);
      if (!t) return res.status(400).json({ error: 'The post needs a title' });
      post.title = t;
    }
    if (b.body !== undefined) post.body = clean(b.body, 8000);
    if (isBoard(b.board)) post.board = b.board;
    if (b.work !== undefined && post.type !== 'linked') {
      if (b.work === null) { post.work = null; post.workVersion = null; }
      else if (/^[a-f0-9]{24}$/i.test(String(b.work)) && await Design.exists({ _id: b.work })) {
        post.work = b.work;
        // The one key that unlocks a dead thread is a work (decision 1).
        post.archivedAt = null;
      }
    }
    if (post.type === 'plan' && b.plan) {
      if (b.plan.goal !== undefined) post.plan.goal = clean(b.plan.goal, 500);
      if (Array.isArray(b.plan.needed)) post.plan.needed = [...new Set(b.plan.needed.filter(isBoard))];
      if (Array.isArray(b.plan.needTags)) {
        post.plan.needTags = [...new Set(b.plan.needTags.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 15);
      }
      // became-work is only ever set by publishing the promoted draft.
      if (['open', 'in-progress', 'abandoned'].includes(b.plan.status) && post.plan.status !== 'became-work') {
        post.plan.status = b.plan.status;
      }
    }
    await post.save();
    res.json(await serializePost(post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/talk/:id — OP or mod; the thread's comments go with it
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (!can.canDeletePost(req.user, post)) return res.status(403).json({ error: 'Only the author can delete this post' });
    const answerer = post.acceptedAnswer
      ? (await Comment.findById(post.acceptedAnswer).select('author') || {}).author : null;
    // A mod removing someone else's thread is a logged action (E12).
    if (!can.isOP(req.user, post) && can.isMod(req.user)) {
      await ModAction.create({ mod: req.user._id, action: 'delete-post', targetType: 'talk',
                               target: post._id, summary: post.title.slice(0, 200) });
    }
    await Comment.deleteMany({ targetType: 'talk', target: post._id });
    await post.deleteOne();
    // The E10 source is gone; the answerer's XP follows it on recompute.
    if (answerer) xp.recomputeUsers([answerer]).catch(err => console.error('[xp]', err.message));
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- votes (display-only, zero XP) ---------------- */

// POST /api/talk/:id/vote  { dir: 'up'|'down', reason? }
router.post('/:id/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    assertWritable(post);
    const dir = req.body && req.body.dir === 'down' ? 'down' : 'up';
    const result = social.castVote(post, req.user, dir, {
      weight: weightFor(req.user, post), reason: req.body && req.body.reason,
    });
    await post.save();
    res.json({ ...result, score: Math.round(social.netScore(post) * 10) / 10,
               reasonCards: social.serializeReasons(post, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/talk/:id/reasons/:reasonId/vote  { dir: 1 | -1 }
router.post('/:id/reasons/:reasonId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    social.judgeReason(post, req.params.reasonId, req.user, {
      weight: weightFor(req.user, post), authorId: post.author._id || post.author,
      dir: Number(req.body && req.body.dir),
    });
    await post.save();
    res.json({ reasonCards: social.serializeReasons(post, req.user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- comments ---------------- */

// POST /api/talk/:id/comments  { body, parent? }
router.post('/:id/comments', requireAuth, requireVerified, writeLimit, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    assertWritable(post);
    const body = clean(req.body && req.body.body, 4000);
    if (!body) return res.status(400).json({ error: 'Comment body is required' });
    let parent = null;
    if (req.body.parent) {
      const p = await Comment.findOne({ _id: req.body.parent, targetType: 'talk', target: post._id });
      if (!p) return res.status(400).json({ error: 'That comment is not on this thread' });
      if (p.forkedTo) return res.status(400).json({ error: 'This tangent continued in its own post. Reply there' });
      parent = p._id;
    }
    const comment = await Comment.create({
      targetType: 'talk', target: post._id, parent, author: req.user._id, body,
    });
    post.lastActivityAt = new Date();
    await post.save();
    await comment.populate('author', 'username xp createdAt');
    res.status(201).json(serializeComment(comment, post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

async function loadComment(req, post) {
  const comment = await Comment.findOne({ _id: req.params.cid, targetType: 'talk', target: post._id })
    .populate('author', 'username xp createdAt');
  if (!comment) fail(404, 'Comment not found');
  return comment;
}

// POST /api/talk/:id/comments/:cid/vote  { dir: 'up'|'down', reason? }
router.post('/:id/comments/:cid/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    assertWritable(post);
    const comment = await loadComment(req, post);
    if (comment.deletedAt) return res.status(400).json({ error: 'That comment was deleted' });
    const dir = req.body && req.body.dir === 'down' ? 'down' : 'up';
    social.castVote(comment, req.user, dir, {
      weight: weightFor(req.user, post), reason: req.body && req.body.reason,
    });
    await comment.save();
    res.json(serializeComment(comment, post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// POST /api/talk/:id/comments/:cid/reasons/:reasonId/vote  { dir: 1 | -1 }
router.post('/:id/comments/:cid/reasons/:reasonId/vote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    const comment = await loadComment(req, post);
    social.judgeReason(comment, req.params.reasonId, req.user, {
      weight: weightFor(req.user, post),
      authorId: comment.author && (comment.author._id || comment.author),
      dir: Number(req.body && req.body.dir),
    });
    await comment.save();
    res.json(serializeComment(comment, post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/talk/:id/comments/:cid — author, OP or mod. A parent with
// replies is blanked in place so the thread under it keeps its shape.
router.delete('/:id/comments/:cid', requireAuth, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    const comment = await loadComment(req, post);
    if (!can.canDeleteComment(req.user, comment, post.author)) return res.status(403).json({ error: 'Not allowed' });
    // Mod power on someone else's words in someone else's thread: logged (E12).
    const commentAuthor = comment.author && (comment.author._id || comment.author);
    if (can.isMod(req.user) && !can.isOP(req.user, post)
        && commentAuthor && !commentAuthor.equals(req.user._id)) {
      await ModAction.create({ mod: req.user._id, action: 'delete-comment', targetType: 'comment',
                               target: comment._id, summary: (comment.body || '').slice(0, 200) });
    }
    const wasAccepted = post.acceptedAnswer && String(post.acceptedAnswer) === String(comment._id);
    if (await Comment.exists({ parent: comment._id })) {
      comment.body = '';
      comment.deletedAt = new Date();
      await comment.save();
    } else {
      await comment.deleteOne();
    }
    if (wasAccepted) {
      const answerer = comment.author && (comment.author._id || comment.author);
      post.acceptedAnswer = null;
      post.acceptedAt = null;
      await post.save();
      xp.recomputeUsers([answerer]).catch(err => console.error('[xp]', err.message));
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- the accepted answer (E10, the only Talk XP) ---------------- */

// POST /api/talk/:id/accept  { commentId } — or null to un-accept
router.post('/:id/accept', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (post.type !== 'question') return res.status(400).json({ error: 'Only questions take an accepted answer' });
    if (!can.canAcceptAnswer(req.user, post)) return res.status(403).json({ error: 'Only the asker can accept an answer' });

    const touched = [];
    if (post.acceptedAnswer) {
      const old = await Comment.findById(post.acceptedAnswer).select('author');
      if (old) touched.push(old.author);
    }
    if (req.body && req.body.commentId) {
      const comment = await Comment.findOne({ _id: req.body.commentId, targetType: 'talk', target: post._id });
      if (!comment || comment.deletedAt) return res.status(404).json({ error: 'Comment not found' });
      if (comment.author.equals(post.author._id || post.author)) {
        return res.status(400).json({ error: 'You cannot accept your own answer' });
      }
      post.acceptedAnswer = comment._id;
      post.acceptedAt = new Date();
      touched.push(comment.author);
    } else {
      post.acceptedAnswer = null;
      post.acceptedAt = null;
    }
    await post.save();
    // E10 flows (or un-flows) through the recompute; nothing is granted by fiat.
    xp.recomputeUsers(touched).catch(err => console.error('[xp]', err.message));
    res.json(await serializePost(post, req.user, { withThread: true }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- plans: join, promote ---------------- */

router.post('/:id/join', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    assertWritable(post);
    if (post.type !== 'plan') return res.status(400).json({ error: 'Only plans have participants' });
    if (!['open', 'in-progress'].includes(post.plan.status)) return res.status(400).json({ error: 'This plan is closed' });
    // Joining signals commitment, no XP — there is nothing here to farm.
    if (!post.plan.participants.some(p => String(p.user) === String(req.user._id))) {
      post.plan.participants.push({ user: req.user._id });
      await post.save();
    }
    res.json(await serializePost(post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/leave', requireAuth, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (post.type !== 'plan') return res.status(400).json({ error: 'Only plans have participants' });
    if (String(post.author._id || post.author) === String(req.user._id)) {
      return res.status(400).json({ error: 'The author is in by definition' });
    }
    post.plan.participants = post.plan.participants.filter(p => String(p.user) !== String(req.user._id));
    await post.save();
    res.json(await serializePost(post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* Non-OP promotion, decision 2: a participant asks; the OP approves; an OP
   silent past the timeout stops being a veto (lib/permissions.js). */
router.post('/:id/promote-request', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (post.type !== 'plan') return res.status(400).json({ error: 'Only plans promote' });
    if (can.isOP(req.user, post)) return res.status(400).json({ error: 'You are the author: just promote it' });
    if (!post.plan.participants.some(p => String(p.user) === String(req.user._id))) {
      return res.status(403).json({ error: 'Join the plan first' });
    }
    const existing = post.plan.promotion;
    if (existing && existing.user && String(existing.user) !== String(req.user._id) && !existing.approved) {
      return res.status(409).json({ error: 'Someone else already asked; one request at a time' });
    }
    post.plan.promotion = { user: req.user._id, requestedAt: new Date(), approved: false };
    await post.save();
    res.json(await serializePost(post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/promote-approve', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (!can.isOP(req.user, post) && !can.isMod(req.user)) return res.status(403).json({ error: 'Only the author approves' });
    if (!post.plan.promotion || !post.plan.promotion.user) return res.status(404).json({ error: 'No promotion request to approve' });
    post.plan.promotion.approved = true;
    await post.save();
    res.json(await serializePost(post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* POST /api/talk/:id/promote — opens the creation wizard pre-filled from the
   plan. The plan's XP reward is the work itself (E1 and everything
   downstream); the flip to became-work happens when the draft publishes. */
router.post('/:id/promote', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (post.type !== 'plan') return res.status(400).json({ error: 'Only plans promote' });
    if (post.becameWork || post.plan.status === 'became-work') return res.status(400).json({ error: 'This plan already became a work' });
    if (!['open', 'in-progress'].includes(post.plan.status)) return res.status(400).json({ error: 'This plan is closed' });
    const p = can.canPromote(req.user, post);
    if (!p.ok) return res.status(403).json({ error: p.why });

    let draft = await WorkDraft.findOne({ author: req.user._id, fromTalkPost: post._id });
    if (!draft) {
      // A starting declaration from the needed skills; the wizard makes it theirs.
      const needed = (post.plan.needed || []).slice(0, xp.config.declaration.max);
      const even = Math.floor(100 / (needed.length || 1));
      draft = await WorkDraft.create({
        author: req.user._id, fromTalkPost: post._id, stage: 1,
        title: post.title,
        description: [post.plan.goal, post.body].filter(Boolean).join('\n\n'),
        needTags: [...post.plan.needTags],
        categories: needed.map((id, i) => ({ id, weight: i === 0 ? 100 - even * (needed.length - 1) : even })),
      });
    }
    if (post.plan.status === 'open') {
      post.plan.status = 'in-progress';
      await post.save();
    }
    res.status(201).json({ draftId: draft._id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- fork-the-derail (Talk Spec §3) ---------------- */

/* POST /api/talk/:id/fork  { commentId, title?, board? }
   Slices a reply chain into its own post: the root comment's text becomes the
   new post's body (credited to its author), its replies move over, and the
   root stays behind as the stub link. Non-destructive, ledger-friendly. */
router.post('/:id/fork', requireAuth, requireVerified, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (!can.canForkThread(req.user, post)) return res.status(403).json({ error: 'Only the author or a moderator can fork a tangent' });
    const root = await Comment.findOne({ _id: req.body && req.body.commentId, targetType: 'talk', target: post._id });
    if (!root) return res.status(404).json({ error: 'Comment not found' });
    if (root.forkedTo) return res.status(400).json({ error: 'Already forked' });
    if (root.deletedAt) return res.status(400).json({ error: 'That comment was deleted' });

    const board = isBoard(req.body.board) ? req.body.board : post.board;
    // Good tangents become plans: posts become plans, plans become works.
    const forked = await TalkPost.create({
      board, type: 'plan',
      title: clean(req.body.title, 160) || `${root.body.slice(0, 120)}${root.body.length > 120 ? '…' : ''}`,
      body: root.body,
      author: root.author,
      plan: { participants: [{ user: root.author }] },
      forkedFrom: { post: post._id, comment: root._id },
    });

    // Move the whole reply subtree; the root's direct replies become top-level.
    const all = await Comment.find({ targetType: 'talk', target: post._id }).select('parent');
    const children = new Map();
    for (const c of all) {
      const key = String(c.parent || '');
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(c._id);
    }
    const subtree = [];
    let frontier = children.get(String(root._id)) || [];
    while (frontier.length) {
      subtree.push(...frontier);
      frontier = frontier.flatMap(id => children.get(String(id)) || []);
    }
    if (subtree.length) {
      await Comment.updateMany({ _id: { $in: subtree } }, { $set: { target: forked._id } });
      await Comment.updateMany({ _id: { $in: children.get(String(root._id)) || [] } }, { $set: { parent: null } });
    }
    root.forkedTo = forked._id;   // the stub that remains
    await root.save();
    res.status(201).json({ id: forked._id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ---------------- moderation ---------------- */

router.post('/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const post = await loadPost(req);
    if (!can.canArchive(req.user)) return res.status(403).json({ error: 'Moderators only' });
    if (post.archivedAt) {
      // Unarchiving overturns the archive that put it away — E12 never pays for it.
      post.archivedAt = null;
      await ModAction.findOneAndUpdate(
        { action: 'archive-thread', target: post._id, overturnedAt: null },
        { $set: { overturnedAt: new Date(), overturnedBy: req.user._id } },
        { sort: { createdAt: -1 } },
      );
    } else {
      post.archivedAt = new Date();
      await ModAction.create({ mod: req.user._id, action: 'archive-thread', targetType: 'talk',
                               target: post._id, summary: post.title.slice(0, 200) });
    }
    await post.save();
    res.json(await serializePost(post, req.user));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

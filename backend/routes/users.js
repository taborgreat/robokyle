const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Design = require('../models/Design');
const Comment = require('../models/Comment');
const TalkPost = require('../models/TalkPost');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { cardPipeline, shapeCards } = require('../lib/cards');
const xp = require('../lib/xp');

const router = express.Router();
const RECENT_COMMENTS = 15;
const WORKS_ON_PROFILE = 24;

/* GET /api/users?sort=roboxp&category=mech&page=&limit=
   The Creators page: every account ranked by RoboXP — verified value produced,
   works weighted over chat — or by one category's XP for the specialty view. */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const category = xp.config.categoryIds.includes(req.query.category) ? req.query.category : null;
    const sort = req.query.sort === 'level' ? 'level' : 'roboxp';

    const users = await User.find().select('username role createdAt xp bio');
    const ranked = users
      .map(u => ({
        username: u.username, role: u.role, joined: u.createdAt,
        bio: u.bio || '',
        roboXp: xp.roboXpOf(u),
        totalLevel: xp.levelsOf(u).totalLevel,
        categoryXp: category ? Math.round((((u.xp || {}).cats || {})[category] || 0) * 10) / 10 : null,
        categoryLevel: category ? xp.levelFor((((u.xp || {}).cats || {})[category] || 0)) : null,
      }))
      .sort((a, b) => category ? b.categoryXp - a.categoryXp
        : sort === 'level' ? (b.totalLevel - a.totalLevel) || (b.roboXp - a.roboXp)
        : b.roboXp - a.roboXp);

    res.json({
      items: ranked.slice((page - 1) * limit, page * limit),
      total: ranked.length, page, limit, category,
    });
  } catch (err) { next(err); }
});

// PATCH /api/users/me  { bio }  -- the only thing a member can edit about themselves
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    if (req.body.bio !== undefined) req.user.bio = String(req.body.bio).slice(0, 600);
    if (Array.isArray(req.body.equipment)) {
      const ok = new Set(xp.config.equipmentItems);
      req.user.equipment = [...new Set(req.body.equipment.map(String).filter(i => ok.has(i)))];
    }
    await req.user.save();
    /* The intro receipt (a real bio) is derived; AWAIT the recompute so the
       response — and the page's immediate refetch — already carries the XP.
       One account, a handful of queries: fast enough to sit on. */
    if (req.body.bio !== undefined) {
      await xp.recomputeUsers([req.user._id]).catch(err => console.error('[xp]', err.message));
      const fresh = await User.findById(req.user._id).select('xp');
      if (fresh) req.user.xp = fresh.xp;
    }
    res.json({ user: req.user.toPublic() });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

/* ---------------- moderation visibility (admins) ----------------
   Defined before the /:username routes so the paths never shadow. */

const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' });

// GET /api/users/flags — the ring-detection case files (§8.3), open first.
router.get('/flags', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const Flag = require('../models/Flag');
    const flags = await Flag.find().sort({ resolvedAt: 1, createdAt: -1 }).limit(100)
      .populate('accounts', 'username');
    res.json({ items: flags.map(f => ({
      id: f._id, kind: f.kind, detail: f.detail, createdAt: f.createdAt,
      accounts: f.accounts.map(a => a.username),
      resolved: !!f.resolvedAt,
    })) });
  } catch (err) { next(err); }
});

// POST /api/users/flags/:id/resolve — reviewed; any voiding is a separate act.
router.post('/flags/:id/resolve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const Flag = require('../models/Flag');
    const flag = await Flag.findById(req.params.id);
    if (!flag) return res.status(404).json({ error: 'No such flag' });
    flag.resolvedAt = new Date();
    flag.resolvedBy = req.user._id;
    await flag.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* POST /api/users/mod-actions/:id/overturn — governance over hard-deleted
   targets: marks the action overturned, which removes its E12 on recompute. */
router.post('/mod-actions/:id/overturn', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const ModAction = require('../models/ModAction');
    const action = await ModAction.findById(req.params.id);
    if (!action) return res.status(404).json({ error: 'No such action' });
    if (action.overturnedAt) return res.json({ ok: true, changed: false });
    action.overturnedAt = new Date();
    action.overturnedBy = req.user._id;
    await action.save();
    xp.recomputeUsers([action.mod]).catch(err => console.error('[xp]', err.message));
    res.json({ ok: true, changed: true });
  } catch (err) { next(err); }
});

/* GET /api/users/:username/avatar.svg — the adaptive avatar (Avatar Spec):
   a pure function of the cached levels and the username, so it is cheap to
   compute and honest to cache. The ETag is the content; levels change rarely
   (the curve guarantees it), so nearly every fetch is a 304. */
router.get('/:username/avatar.svg', async (req, res, next) => {
  try {
    const user = await User.findOne({ usernameLower: String(req.params.username).toLowerCase() })
      .select('username xp createdAt');
    if (!user) return res.status(404).json({ error: 'No such member' });
    const { avatarSvg } = require('../lib/avatar');
    const svg = avatarSvg(xp.levelsOf(user).levels, user.username);
    const etag = `"${crypto.createHash('sha1').update(svg).digest('hex').slice(0, 16)}"`;
    res.set('Cache-Control', 'public, max-age=300');
    res.set('ETag', etag);
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('image/svg+xml').send(svg);
  } catch (err) { next(err); }
});

// GET /api/users/:username  -- public profile: who they are, what they have posted
router.get('/:username', optionalAuth, async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'No such member' });

    const viewer = req.user;
    const viewerId = viewer ? viewer._id : null;
    const isSelf = !!viewer && viewer._id.equals(user._id);

    const [works, totals, commentTotal, comments] = await Promise.all([
      Design.aggregate(cardPipeline({
        match: { author: user._id }, sort: 'new', limit: WORKS_ON_PROFILE, viewerId,
      })),
      // Everything their works have earned between them.
      Design.aggregate([
        { $match: { author: user._id } },
        { $group: {
          _id: null,
          works: { $sum: 1 },
          downloads: { $sum: '$downloadCount' },
          upvotes: { $sum: { $size: '$upvotes' } },
          files: { $sum: { $size: '$files' } },
          guides: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$steps', []] } }, 0] }, 1, 0] } },
        } },
      ]),
      Comment.countDocuments({ author: user._id, deletedAt: null }),
      // Their own comments, newest first, each pointing back at its home —
      // a work page or a Talk thread.
      Comment.find({ author: user._id, deletedAt: null })
        .sort({ createdAt: -1 }).limit(RECENT_COMMENTS)
        .then(async (recent) => {
          const titles = async (Model, ids) => new Map(
            (await Model.find({ _id: { $in: ids } }).select('title'))
              .map(d => [String(d._id), d.title]));
          const of = (type) => recent.filter(c => c.targetType === type).map(c => c.target);
          // A comment on a Produced entry points home to the entry's work.
          const ProducedEntry = require('../models/ProducedEntry');
          const producedWorks = new Map((await ProducedEntry.find({ _id: { $in: of('produced') } })
            .select('work')).map(e => [String(e._id), e.work]));
          const [workTitles, talkTitles] = await Promise.all([
            titles(Design, [...of('design'), ...producedWorks.values()]), titles(TalkPost, of('talk')),
          ]);
          return recent.map(c => {
            const workId = c.targetType === 'design' ? c.target
              : c.targetType === 'produced' ? producedWorks.get(String(c.target)) : null;
            return {
              id: c._id, body: c.body, createdAt: c.createdAt,
              work: workId ? { id: workId, title: workTitles.get(String(workId)) || 'a removed work' } : null,
              post: c.targetType === 'talk'
                ? { id: c.target, title: talkTitles.get(String(c.target)) || 'a removed thread' } : null,
            };
          });
        }),
    ]);

    const sum = totals[0] || {};
    res.json({
      xp: xp.xpView(user, (totals[0] || {}).downloads || 0),
      username: user.username,
      bio: user.bio || '',
      role: user.role,
      joined: user.createdAt,
      isSelf,
      equipment: isSelf ? (user.equipment || []) : undefined,
      // Admins can change anyone's role but their own, which keeps them from
      // locking themselves out by accident.
      canManageRole: !!viewer && viewer.role === 'admin' && !isSelf,
      stats: {
        works: sum.works || 0,
        downloads: sum.downloads || 0,
        upvotes: sum.upvotes || 0,
        files: sum.files || 0,
        guides: sum.guides || 0,
        comments: commentTotal,
      },
      works: shapeCards(works),
      comments,
    });
  } catch (err) { next(err); }
});

/* GET /api/users/:username/ledger — the receipts (§7.1): every gain and loss,
   newest first, derived from the same walk that produces the totals. Public by
   default: a thousand eyes on open ledgers spot rings faster than any job. */
router.get('/:username/ledger', async (req, res, next) => {
  try {
    const user = await User.findOne({ usernameLower: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'No such member' });
    let entries = await xp.ledgerFor(user._id, { withNames: true });
    entries.sort((a, b) => new Date(b.at) - new Date(a.at));
    /* ?category=mech — one skill's receipts: only the entries that actually
       routed XP into that category, so the profile's skill grid can answer
       "where did this number come from?" per cell. */
    const category = xp.config.categoryIds.includes(req.query.category) ? req.query.category : null;
    if (category) entries = entries.filter(e => (e.split[category] || 0) !== 0);
    res.json({
      username: user.username,
      category,
      entries: entries.slice(0, 100).map(e => ({
        at: e.at, kind: e.kind, amount: Math.round((e.amount + (e.split.innov || 0)) * 10) / 10,
        split: e.split, workId: e.workId, workTitle: e.workTitle,
        talkId: e.talkId || null, talkTitle: e.talkTitle || null,
        by: e.whoName || null, refTitle: e.refTitle || null, refId: e.refId || null,
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/users/:username/role  { role } | { mod: true|false }
// Admins promoting and demoting; `mod` toggles the Talk moderator capability
// (lib/permissions.js is the only place that reads it).
router.post('/:username/role', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'No such member' });

    if (typeof req.body.mod === 'boolean') {
      const has = (user.roles || []).includes('mod');
      if (req.body.mod !== has) {
        user.roles = req.body.mod ? [...(user.roles || []), 'mod'] : user.roles.filter(r => r !== 'mod');
        await user.save();
      }
      return res.json({ user: user.toPublic(), changed: req.body.mod !== has });
    }

    const role = req.body.role;
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: 'role must be "admin" or "user"' });
    }
    if (user._id.equals(req.user._id)) {
      return res.status(400).json({ error: 'Ask another admin to change your own role' });
    }

    if (user.role === role) return res.json({ user: user.toPublic(), changed: false });

    // Never leave the site with nobody who can administer it.
    if (user.role === 'admin' && role === 'user' && (await User.countDocuments({ role: 'admin' })) <= 1) {
      return res.status(400).json({ error: 'That is the last admin. Promote someone else first.' });
    }

    user.role = role;
    await user.save();
    res.json({ user: user.toPublic(), changed: true });
  } catch (err) { next(err); }
});

module.exports = router;

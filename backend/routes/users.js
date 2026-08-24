const express = require('express');
const User = require('../models/User');
const Design = require('../models/Design');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { cardPipeline, shapeCards } = require('../lib/cards');

const router = express.Router();
const RECENT_COMMENTS = 15;
const WORKS_ON_PROFILE = 24;

// PATCH /api/users/me  { bio }  -- the only thing a member can edit about themselves
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    if (req.body.bio !== undefined) req.user.bio = String(req.body.bio).slice(0, 600);
    await req.user.save();
    res.json({ user: req.user.toPublic() });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
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
          guides: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$guide.steps', []] } }, 0] }, 1, 0] } },
        } },
      ]),
      Design.aggregate([
        { $match: { 'comments.author': user._id } },
        { $project: { n: { $size: { $filter: { input: '$comments', as: 'c', cond: { $eq: ['$$c.author', user._id] } } } } } },
        { $group: { _id: null, comments: { $sum: '$n' } } },
      ]),
      // Their own comments, newest first, each pointing back at the work.
      Design.aggregate([
        { $match: { 'comments.author': user._id } },
        { $unwind: '$comments' },
        { $match: { 'comments.author': user._id } },
        { $sort: { 'comments.createdAt': -1 } },
        { $limit: RECENT_COMMENTS },
        { $project: {
          _id: 0,
          id: '$comments._id',
          body: '$comments.body',
          createdAt: '$comments.createdAt',
          work: { id: '$_id', title: '$title' },
        } },
      ]),
    ]);

    const sum = totals[0] || {};
    res.json({
      username: user.username,
      bio: user.bio || '',
      role: user.role,
      joined: user.createdAt,
      isSelf,
      // Admins can change anyone's role but their own, which keeps them from
      // locking themselves out by accident.
      canManageRole: !!viewer && viewer.role === 'admin' && !isSelf,
      stats: {
        works: sum.works || 0,
        downloads: sum.downloads || 0,
        upvotes: sum.upvotes || 0,
        files: sum.files || 0,
        guides: sum.guides || 0,
        comments: (commentTotal[0] || {}).comments || 0,
      },
      works: shapeCards(works),
      comments,
    });
  } catch (err) { next(err); }
});

// POST /api/users/:username/role  { role }  -- admins promoting and demoting
router.post('/:username/role', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

    const role = req.body.role;
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: 'role must be "admin" or "user"' });
    }

    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'No such member' });
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

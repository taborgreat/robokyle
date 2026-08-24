const express = require('express');
const Design = require('../models/Design');
const User = require('../models/User');
const TalkPost = require('../models/TalkPost');
const ProducedEntry = require('../models/ProducedEntry');
const XP = require('../config/xp');
const xpLib = require('../lib/xp');

const router = express.Router();

/* The homepage title screen: four live counters and a short public activity
   ticker. Every number is real. The ticker only carries event kinds whose XP
   amount is fixed by config (publishes, verified builds, fit reports), so the
   amount shown is the amount the ledger pays; vote-derived XP never appears
   here because its amount depends on the voter.

   Cached in memory for a minute: the homepage can be hammered, the counts
   cannot drift meaningfully in sixty seconds. */
let cache = null;
const TTL_MS = 60 * 1000;

router.get('/', async (req, res, next) => {
  try {
    if (cache && Date.now() - cache.at < TTL_MS) return res.json(cache.body);

    const [works, produced, creators, openPlans, designs, entries] = await Promise.all([
      Design.countDocuments({}),
      ProducedEntry.countDocuments({}),
      User.countDocuments({}),
      TalkPost.countDocuments({ type: 'plan', 'plan.status': { $in: ['open', 'in-progress'] } }),
      Design.find({}).sort({ createdAt: -1 }).limit(12)
        .select('title author createdAt depth parent').populate('author', 'username xp').populate('parent', 'title'),
      ProducedEntry.find({ cachedState: 'verified' }).sort({ createdAt: -1 }).limit(8)
        .select('work poster createdAt type').populate('poster', 'username xp').populate('work', 'title'),
    ]);

    const events = [];

    /* Publishes past the daily cap earn 0, so they never make the ticker.
       The cap check only sees this window of recent works, which is exactly
       the set the ticker draws from. */
    const perDay = {};
    for (const w of [...designs].reverse()) {
      if (!w.author) continue;
      const day = `${w.author._id}:${w.createdAt.toISOString().slice(0, 10)}`;
      perDay[day] = (perDay[day] || 0) + 1;
      if (perDay[day] > XP.caps.publishesPerDay) continue;
      const derived = (w.depth || 0) > 0;
      events.push({
        at: w.createdAt,
        amount: derived ? XP.amounts.publishDerived : XP.amounts.publishOriginal,
        who: w.author.username,
        level: xpLib.levelsOf(w.author).totalLevel,
        what: derived
          ? `remixed ${w.parent && w.parent.title ? w.parent.title : 'a work'} into`
          : 'published',
        title: w.title,
        workId: w._id,
      });
    }

    for (const e of entries) {
      if (!e.poster || !e.work) continue;
      events.push({
        at: e.createdAt,
        amount: e.type === 'usage' ? XP.amounts.fitReport : XP.amounts.buildBuilder,
        who: e.poster.username,
        level: xpLib.levelsOf(e.poster).totalLevel,
        what: e.type === 'usage' ? 'reported using' : 'built',
        title: e.work.title,
        workId: e.work._id,
      });
    }

    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    const body = { works, produced, creators, openPlans, activity: events.slice(0, 6) };
    cache = { at: Date.now(), body };
    res.json(body);
  } catch (err) { next(err); }
});

module.exports = router;

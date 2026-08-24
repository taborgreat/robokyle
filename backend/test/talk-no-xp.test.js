/* The Talk Spec's load-bearing guarantee: Talk votes emit ZERO XP, and the
   only XP in the whole section is the accepted answer (E10 → comm). The
   guarantee holds by construction — the ledger walk never reads Talk votes —
   and this test is the tripwire for anyone who extends the SOURCES registry
   carelessly. Needs a local MongoDB (skips cleanly without one). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const xp = require('../lib/xp');
const User = require('../models/User');
const Design = require('../models/Design');
const TalkPost = require('../models/TalkPost');
const Comment = require('../models/Comment');

const URI = process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/robokyle_talk_test';
let db = false;

before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2000 });
    await mongoose.connection.dropDatabase();
    db = true;
  } catch { /* no Mongo here; every test skips */ }
});
after(async () => { if (db) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } });

const user = (name) => User.create({
  username: name, usernameLower: name, email: `${name}@example.test`,
  passwordHash: 'x', emailVerified: true,
});

test('talk votes emit zero XP; the accepted answer emits E10 into comm', async (t) => {
  if (!db) return t.skip('MongoDB not available');

  const [asker, answerer, voter] = await Promise.all([user('asker'), user('answerer'), user('voter')]);

  const post = await TalkPost.create({
    board: 'elec', type: 'question', title: 'Which driver for a 28BYJ-48?',
    author: asker._id,
    // Heavily-voted post: if any of this ever reaches the ledger, we failed.
    upvotes: [{ user: voter._id, weight: 5 }],
    downvotes: [],
  });
  const answer = await Comment.create({
    targetType: 'talk', target: post._id, author: answerer._id, body: 'A ULN2003 board.',
    upvotes: [{ user: voter._id, weight: 5 }, { user: asker._id, weight: 5 }],
  });
  post.acceptedAnswer = answer._id;
  post.acceptedAt = new Date();
  await post.save();

  for (const u of [asker, voter]) {
    const entries = await xp.ledgerFor(u._id);
    assert.deepStrictEqual(entries, [], `${u.username} must earn nothing from Talk votes`);
  }

  const entries = await xp.ledgerFor(answerer._id);
  assert.strictEqual(entries.length, 1, 'exactly one entry: the accepted answer');
  assert.strictEqual(entries[0].kind, 'accepted-answer');
  assert.strictEqual(entries[0].split.comm, xp.config.amounts.acceptedAnswer);

  // E10 is social XP: full category credit, discounted in RoboXP.
  const totals = await xp.computeUserXp(answerer._id);
  assert.strictEqual(totals.cats.comm, xp.config.amounts.acceptedAnswer);
  assert.strictEqual(totals.workXp, 0);
  assert.strictEqual(totals.socialXp, xp.config.amounts.acceptedAnswer);
});

test('self-accepted answers and the daily E10 cap earn nothing extra', async (t) => {
  if (!db) return t.skip('MongoDB not available');

  const [asker, answerer] = await Promise.all([user('asker2'), user('answerer2')]);

  // One post is a self-answer (author == answerer): must emit nothing.
  const own = await TalkPost.create({ board: 'mech', type: 'question', title: 'own', author: answerer._id });
  const ownAnswer = await Comment.create({ targetType: 'talk', target: own._id, author: answerer._id, body: 'me' });
  own.acceptedAnswer = ownAnswer._id;
  own.acceptedAt = new Date();
  await own.save();

  // Then one more acceptance than the daily cap allows, all on the same day.
  const overCap = xp.config.caps.acceptedAnswersPerDay + 1;
  for (let i = 0; i < overCap; i++) {
    const p = await TalkPost.create({ board: 'mech', type: 'question', title: `q${i}`, author: asker._id });
    const a = await Comment.create({ targetType: 'talk', target: p._id, author: answerer._id, body: `a${i}` });
    p.acceptedAnswer = a._id;
    p.acceptedAt = new Date();
    await p.save();
  }

  const entries = await xp.ledgerFor(answerer._id);
  assert.strictEqual(entries.filter(e => e.kind === 'accepted-answer').length,
    xp.config.caps.acceptedAnswersPerDay, 'capped per UTC day, self-accept excluded');
});

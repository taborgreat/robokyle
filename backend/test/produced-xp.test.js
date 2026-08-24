/* Part II: the proof layer's XP. E5 pays the poster of a verified entry (plus
   the ability rider for fit findings), E6 pays the author scaled by the
   poster's credibility (F6) and never for failures, E11 handles usage, and
   nothing at all fires while an entry is pending or self-posted. E8 and E12
   ride along here. Needs a local MongoDB (skips cleanly without one). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const xp = require('../lib/xp');
const XP = require('../config/xp');
const User = require('../models/User');
const Design = require('../models/Design');
const ProducedEntry = require('../models/ProducedEntry');
const DocRevision = require('../models/DocRevision');
const ModAction = require('../models/ModAction');

const URI = process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/robokyle_produced_test';
let db = false;

before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2000 });
    await mongoose.connection.dropDatabase();
    db = true;
  } catch { /* no Mongo here; every test skips */ }
});
after(async () => { if (db) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } });

const user = (name, cats = {}) => User.create({
  username: name, usernameLower: name, email: `${name}@example.test`,
  passwordHash: 'x', emailVerified: true, xp: { cats },
});
const PAST = new Date(Date.now() - 3 * 86400e3);          // safely past the 48h window
const entry = (fields) => ProducedEntry.collection.insertOne({
  workVersion: 1, media: [], link: '', process: '', modifications: '', fitFindings: '',
  upvotes: [], downvotes: [], downvoteReasons: [], challenges: [],
  cachedState: 'pending', createdAt: PAST, updatedAt: PAST, ...fields,
});

test('E5/E6/E11: verified proof pays both sides by the rules', async (t) => {
  if (!db) return t.skip('MongoDB not available');
  // The poster has 250 total XP, so the author's side pays at credibility 0.5.
  const [author, builder] = await Promise.all([user('author'), user('builder', { fab: 250 })]);
  const work = await Design.create({
    title: 'Adaptive Spoon', description: 'x', author: author._id,
    categories: [{ id: 'mech', weight: 100 }],
  });

  await entry({ work: work._id, poster: builder._id, type: 'physical', outcome: 'success', fitFindings: 'fits well' });
  await entry({ work: work._id, poster: builder._id, type: 'physical', outcome: 'failed' });
  // Still inside the challenge window: emits nothing yet.
  await ProducedEntry.collection.insertOne({
    work: work._id, poster: builder._id, type: 'physical', outcome: 'success',
    workVersion: 1, media: [], link: '', process: '', modifications: '', fitFindings: '',
    upvotes: [], downvotes: [], downvoteReasons: [], challenges: [],
    cachedState: 'pending', createdAt: new Date(), updatedAt: new Date(),
  });

  const builderLedger = await xp.ledgerFor(builder._id);
  const builds = builderLedger.filter(e => e.kind === 'build');
  assert.strictEqual(builds.length, 2, 'both verified builds pay E5 — the failure included');
  assert.strictEqual(builds[0].split.fab, XP.amounts.buildBuilder);
  assert.strictEqual(builderLedger.filter(e => e.kind === 'build-fit').length, 1, 'fit findings add the ability rider once');

  const authorLedger = await xp.ledgerFor(author._id);
  const e6 = authorLedger.filter(e => e.kind === 'build-author');
  assert.strictEqual(e6.length, 1, 'E6 once per unique poster per work, never for failed');
  assert.strictEqual(e6[0].split.innov, XP.amounts.buildAuthorInnov * 0.5, 'credibility 0.5 halves the innovation');
  assert.strictEqual(e6[0].split.mech, XP.amounts.buildAuthorSplit * 0.5);

  // A usage entry pays the reviewer as social XP and the author's aura.
  const [reviewer] = await Promise.all([user('reviewer', { abil: 500 })]);
  await entry({ work: work._id, poster: reviewer._id, type: 'usage', outcome: 'success', fitFindings: 'used daily' });
  const revLedger = await xp.ledgerFor(reviewer._id);
  const fit = revLedger.find(e => e.kind === 'fit-report');
  assert.strictEqual(fit.split.abil, XP.amounts.fitReport);
  assert.ok(fit.social, 'E11 counts as social XP (E10–E12 weight 0.6 in RoboXP)');
  const confirmed = (await xp.ledgerFor(author._id)).find(e => e.kind === 'fit-confirmed');
  assert.strictEqual(confirmed.split.innov, XP.amounts.fitAuthorInnov, 'full-credibility reviewer confirms real use');
});

test('an endorsed challenge rejects the entry and reverses everything', async (t) => {
  if (!db) return t.skip('MongoDB not available');
  const [author, builder] = await Promise.all([user('author2'), user('builder2', { fab: 9999 })]);
  const work = await Design.create({
    title: 'Hinge', description: 'x', author: author._id, categories: [{ id: 'mech', weight: 100 }],
  });
  const { insertedId } = await entry({ work: work._id, poster: builder._id, type: 'physical', outcome: 'success' });

  assert.ok((await xp.ledgerFor(builder._id)).some(e => e.kind === 'build'), 'verified before the challenge');

  // An endorsed challenge: enough weighted votes from enough voters.
  const judges = await Promise.all([user('judge1'), user('judge2'), user('judge3')]);
  const doc = await ProducedEntry.findById(insertedId);
  doc.challenges.push({ user: judges[0]._id, weight: 1, text: 'photo is a render, not a print',
    rvotes: judges.map(j => ({ user: j._id, dir: 1, weight: 6, at: new Date() })) });
  await doc.save();

  assert.strictEqual(doc.entryState(), 'rejected');
  assert.ok(!(await xp.ledgerFor(builder._id)).some(e => e.kind === 'build'), 'E5 gone on recompute');
  assert.ok(!(await xp.ledgerFor(author._id)).some(e => e.kind === 'build-author'), 'E6 gone on recompute');
});

test('intro XP: a real bio pays once, derived — and reverses if it goes', async (t) => {
  if (!db) return t.skip('MongoDB not available');
  const u = await user('newbie');
  assert.strictEqual((await xp.ledgerFor(u._id)).length, 0, 'empty account, empty ledger');

  u.bio = 'hi';                                          // below the sincerity bar
  await u.save();
  assert.strictEqual((await xp.ledgerFor(u._id)).length, 0, 'a token bio pays nothing');

  u.bio = 'I print adaptive grips for my brother and want to learn electronics.';
  await u.save();
  const entries = await xp.ledgerFor(u._id);
  assert.strictEqual(entries.length, 1, 'exactly one intro receipt, ever');
  assert.strictEqual(entries[0].kind, 'profile-bio');
  assert.strictEqual(entries[0].split.comm, XP.intro.bioAmount);
  assert.ok(entries[0].social, 'social-weighted in RoboXP');
  const totals = await xp.computeUserXp(u._id);
  assert.ok(totals.cats.comm < XP.levelCurve.base, 'buys no level');
  assert.ok(totals.cats.comm < XP.badges.newUserMaxXp, 'the new-user ring stays on');

  u.bio = '';
  await u.save();
  assert.strictEqual((await xp.ledgerFor(u._id)).length, 0, 'bio gone, XP gone — derived like everything else');
});

test('E8 pays applied revisions on other works; E12 pays ratified mod actions', async (t) => {
  if (!db) return t.skip('MongoDB not available');
  const [owner, editor, mod] = await Promise.all([user('owner'), user('editor'), user('mod')]);
  const work = await Design.create({
    title: 'Guide', description: 'terse original words', author: owner._id,
    categories: [{ id: 'docs', weight: 100 }],
  });
  await DocRevision.create({
    work: work._id, author: editor._id, target: 'description',
    previous: 'terse original words',
    text: 'A rewritten, genuinely substantive walkthrough. '.repeat(8),
    appliedAt: new Date(),
  });
  // Their own work never pays (F5).
  await DocRevision.create({
    work: (await Design.create({ title: 'Own', description: 'y', author: editor._id, categories: [{ id: 'docs', weight: 100 }] }))._id,
    author: editor._id, target: 'description', previous: 'y', text: 'z'.repeat(300), appliedAt: new Date(),
  });
  const ledger = await xp.ledgerFor(editor._id);
  const e8 = ledger.filter(e => e.kind === 'doc-revision');
  assert.strictEqual(e8.length, 1, 'only the other-work revision pays');
  const total = XP.amounts.docRevision + XP.amounts.docRevisionComm;
  assert.strictEqual(e8[0].amount, total, 'a substantive diff pays in full');
  assert.strictEqual(Math.round(e8[0].split.docs + e8[0].split.comm), total);

  // E12: an action past the window pays; an overturned one never does.
  await ModAction.create({ mod: mod._id, action: 'archive-thread', targetType: 'talk',
    target: new mongoose.Types.ObjectId(), createdAt: new Date(Date.now() - 8 * 86400e3) });
  await ModAction.create({ mod: mod._id, action: 'delete-post', targetType: 'talk',
    target: new mongoose.Types.ObjectId(), createdAt: new Date(Date.now() - 8 * 86400e3), overturnedAt: new Date() });
  const modLedger = await xp.ledgerFor(mod._id);
  const e12 = modLedger.filter(e => e.kind === 'moderation');
  assert.strictEqual(e12.length, 1, 'ratified once, overturned never');
  assert.strictEqual(e12[0].split.comm, XP.amounts.moderation);
  assert.ok(e12[0].social);
});

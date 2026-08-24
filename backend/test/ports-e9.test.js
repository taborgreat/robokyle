/* Ports Spec §2: E9 fires to the standard's author when a provides claim on
   someone else's work is verified — per unique complying work, once. Claimed
   declarations, self-compliance, and accepts emit nothing. Needs a local
   MongoDB (skips cleanly without one). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const xp = require('../lib/xp');
const User = require('../models/User');
const Design = require('../models/Design');

const URI = process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/robokyle_ports_test';
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

test('verified compliance pays the standard author; claimed and self emit nothing', async (t) => {
  if (!db) return t.skip('MongoDB not available');

  const [stdAuthor, maker, verifier] = await Promise.all([user('stdauthor'), user('maker'), user('verifier')]);
  const std = await Design.create({
    title: 'RK Quick-Release qr-15', description: 'the spec', author: stdAuthor._id,
    type: 'standard', standard: { portName: 'qr-15', fields: [{ name: 'face-diameter', unit: 'mm', required: true }] },
    categories: [{ id: 'mech', weight: 100 }],
  });

  // Another author's work: one verified provides, one merely claimed accept-side consumer.
  await Design.create({
    title: 'Wrist Cradle', description: 'provides qr-15', author: maker._id,
    categories: [{ id: 'mech', weight: 100 }],
    ports: { provides: [{ standard: std._id, version: null, fieldValues: { 'face-diameter': 15 },
                          status: 'verified', verifiedBy: verifier._id, verifiedAt: new Date() }] },
  });
  await Design.create({
    title: 'Spoon Head', description: 'accepts qr-15', author: maker._id,
    categories: [{ id: 'mech', weight: 100 }],
    ports: { accepts: [{ standard: std._id, version: null }] },
  });
  // The standard author's own compliant work: never pays them (self earns 0).
  await Design.create({
    title: 'Reference Cradle', description: 'own', author: stdAuthor._id,
    categories: [{ id: 'mech', weight: 100 }],
    ports: { provides: [{ standard: std._id, status: 'verified', verifiedBy: verifier._id, verifiedAt: new Date() }] },
  });
  // A claimed (unverified) declaration: nothing until review.
  await Design.create({
    title: 'Unreviewed Cradle', description: 'claimed', author: verifier._id,
    categories: [{ id: 'mech', weight: 100 }],
    ports: { provides: [{ standard: std._id, status: 'claimed' }] },
  });

  const entries = await xp.ledgerFor(stdAuthor._id);
  const e9 = entries.filter(e => e.kind === 'standard-compliance');
  assert.strictEqual(e9.length, 1, 'exactly one verified compliance by another author');
  assert.strictEqual(e9[0].split.docs, xp.config.amounts.standardComplianceDocs);
  assert.strictEqual(e9[0].split.innov, xp.config.amounts.standardComplianceInnov);
  assert.strictEqual(e9[0].refTitle, 'Wrist Cradle');

  // The complying maker earns publish XP but nothing extra from providing.
  const makerEntries = await xp.ledgerFor(maker._id);
  assert.ok(makerEntries.every(e => e.kind !== 'standard-compliance'));
});

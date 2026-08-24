/* Avatar Spec §5: avatarSvg is a pure function — same inputs, identical bytes,
   forever — because the cache keys and ETags depend on exactly that. No
   database needed; this suite always runs. */
const { test } = require('node:test');
const assert = require('node:assert');
const { avatarSvg } = require('../lib/avatar');
const XP = require('../config/xp');

const LEVELS = { mech: 42, fab: 12, elec: 0, soft: 7, sys: 99, abil: 3, docs: 20, dsgn: 0, comm: 55 };

test('deterministic: same inputs produce identical bytes', () => {
  assert.strictEqual(avatarSvg(LEVELS, 'kyle'), avatarSvg(LEVELS, 'kyle'));
  assert.strictEqual(avatarSvg(LEVELS, 'Kyle'), avatarSvg(LEVELS, 'kyle'), 'case-insensitive identity');
});

test('the mark distinguishes people; the wedges distinguish progress', () => {
  assert.notStrictEqual(avatarSvg(LEVELS, 'kyle'), avatarSvg(LEVELS, 'jules'));
  assert.notStrictEqual(avatarSvg(LEVELS, 'kyle'), avatarSvg({ ...LEVELS, mech: 43 }, 'kyle'));
});

test('stays a small standalone SVG', () => {
  const svg = avatarSvg(LEVELS, 'someone-with-a-long-name');
  assert.ok(svg.startsWith('<svg xmlns='), 'standalone svg document');
  assert.ok(svg.length < 4096, `stays tiny (got ${svg.length} bytes)`);
  assert.ok(!svg.includes('<script'), 'never any script');
  assert.ok(!svg.includes('someone'), 'the username itself never appears in the bytes');
});

test('every visible category paints, a maxed ring fills every wedge', () => {
  const maxed = Object.fromEntries(XP.visibleCategoryIds.map(id => [id, XP.levelCurve.cap]));
  const svg = avatarSvg(maxed, 'maxie');
  for (const cat of XP.categories.filter(c => !c.hidden)) {
    assert.ok(svg.includes(`fill="${cat.color}"/>`), `${cat.id} wedge filled solid`);
  }
  // Absurd inputs clamp instead of distorting the geometry.
  assert.ok(avatarSvg({ mech: 5000, fab: -3 }, 'maxie').startsWith('<svg'));
});

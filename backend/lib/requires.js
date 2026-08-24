/* ============================================================
   Delta B: the requirements layer. What a build takes, stated
   against curated vocabularies, aggregated across composites,
   and matched against what a member owns. No XP anywhere in
   this file by design: requirements are information.
   ============================================================ */
const XP = require('../config/xp');

const EQUIPMENT = new Set(XP.equipmentItems);
const MATERIALS = new Set(XP.materialItems);
const UNITS = new Set(XP.materialUnits);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/* Strict against the vocabulary: an id the list does not carry is dropped,
   because a free-text id would break summation and buildable-by-you. */
function parseRequires(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let r = raw;
  if (typeof raw === 'string') {
    // Client input: malformed JSON is the caller's 400, never our 500.
    try { r = JSON.parse(raw); }
    catch { throw Object.assign(new Error('Malformed JSON field'), { status: 400 }); }
  }
  if (!r || typeof r !== 'object') return null;
  const equipment = (Array.isArray(r.equipment) ? r.equipment : []).slice(0, 20)
    .filter(e => e && EQUIPMENT.has(String(e.item)))
    .map(e => ({ item: String(e.item), note: clean(e.note, 120) }));
  const seen = new Set();
  return {
    equipment: equipment.filter(e => !seen.has(e.item) && seen.add(e.item)),
    materials: (Array.isArray(r.materials) ? r.materials : []).slice(0, 30)
      .filter(m => m && MATERIALS.has(String(m.item)))
      .map(m => ({
        item: String(m.item),
        qty: Math.max(0, Number(m.qty) || 0),
        unit: UNITS.has(String(m.unit)) ? String(m.unit) : 'count',
        note: clean(m.note, 120),
      })),
  };
}

/* A composite's effective requirements: its own plus every referenced work's,
   walked to depth, equipment deduped, material quantities summed per item and
   unit. Update the spoon's bolts and the kit's BOM updates itself. */
async function effectiveRequires(Design, design, depth = 0, seen = new Set()) {
  const key = String(design._id);
  if (seen.has(key) || depth > 6) return { equipment: [], materials: [] };
  seen.add(key);

  const equipment = new Map();   // item -> {item, note, from[]}
  const materials = new Map();   // item|unit -> {item, qty, unit, from[]}
  const fold = (req, fromTitle) => {
    for (const e of (req && req.equipment) || []) {
      const cur = equipment.get(e.item) || { item: e.item, note: e.note || '', from: [] };
      if (fromTitle && !cur.from.includes(fromTitle)) cur.from.push(fromTitle);
      if (!cur.note && e.note) cur.note = e.note;
      equipment.set(e.item, cur);
    }
    for (const m of (req && req.materials) || []) {
      const k = `${m.item}|${m.unit}`;
      const cur = materials.get(k) || { item: m.item, qty: 0, unit: m.unit, from: [] };
      cur.qty += m.qty || 0;
      if (fromTitle && !cur.from.includes(fromTitle)) cur.from.push(fromTitle);
      materials.set(k, cur);
    }
  };

  fold(design.requires, null);
  // uses.work may arrive populated (a full document) or as a bare id.
  const idOf = (w) => String(w && w._id ? w._id : w);
  const refs = [...new Set((design.uses || []).map(u => idOf(u.work)).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
  for (const refId of refs) {
    const ref = await Design.findById(refId).select('title requires uses');
    if (!ref) continue;
    const sub = await effectiveRequires(Design, ref, depth + 1, seen);
    fold({ equipment: sub.equipment, materials: sub.materials }, ref.title);
  }
  return {
    equipment: [...equipment.values()],
    materials: [...materials.values()].map(m => ({ ...m, qty: Math.round(m.qty * 100) / 100 })),
  };
}

/* Buildable-by-you (decision E3): equipment gates, materials only display. */
function readiness(effective, ownedList) {
  const owned = new Set(ownedList || []);
  const missing = (effective.equipment || []).map(e => e.item).filter(i => !owned.has(i));
  return { buildable: missing.length === 0, missing };
}

module.exports = { parseRequires, effectiveRequires, readiness };

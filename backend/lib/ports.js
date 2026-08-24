/* ============================================================
   Ports & compatibility (Ports Spec).

   A port is a named connection point defined by a standard-type work.
   Every work may declare `provides` (this work offers this interface)
   and `accepts` (this work connects to that interface); compatibility
   is then a graph query, not a judgment call. This module owns the
   parsing, validation and reconciliation that the designs and drafts
   routes share, so a declaration means the same thing on every path
   into the database.
   ============================================================ */
const XP = require('../config/xp');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const idOf = (v) => String((v && v._id) || v);

// Port and field names are storage keys and URL fragments: slugs only.
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const slug = (v) => String(v || '').trim().toLowerCase();

/* The machine-readable half of a standard: flat name/unit/required rows,
   deliberately never a nested schema builder — a standard needing structure
   puts it in its documents, not its fields (Ports Spec §1). */
const parseMaybeJson = (raw) => {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { fail(400, 'Malformed JSON field'); }
};

function parseStandardDef(raw) {
  if (raw === undefined || raw === null || raw === '') return null;   // absent: leave as-is
  const def = parseMaybeJson(raw);
  const portName = slug(def.portName);
  if (!SLUG.test(portName)) {
    fail(400, 'A standard needs a port name: lowercase letters, digits and dashes (e.g. "qr-15")');
  }
  const seen = new Set();
  const fields = [];
  for (const f of (Array.isArray(def.fields) ? def.fields : []).slice(0, XP.ports.maxFieldsPerStandard)) {
    const name = slug(f && f.name);
    if (!SLUG.test(name) || seen.has(name)) continue;
    seen.add(name);
    fields.push({
      name,
      unit: String((f && f.unit) || '').trim().slice(0, 20),
      required: !!(f && f.required),
    });
  }
  return { portName, fields };
}

// A declared field value: numbers stay numbers (the hub sorts and filters on
// them); everything else becomes a short trimmed string.
function cleanValue(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  if (String(v).trim() !== '' && Number.isFinite(n)) return n;
  return String(v ?? '').trim().slice(0, 120);
}

/* The two declaration lists, shape-checked only — existence and field rules
   need the database and live in checkPorts. Returns null when absent (edit
   semantics: leave as-is), or {provides, accepts}. */
function parsePorts(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const p = parseMaybeJson(raw);
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter(x => {
      const key = `${idOf(x.standard)}@${x.version ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const version = (v) => v === null || v === undefined || v === '' ? null : Math.max(1, parseInt(v, 10) || 1);

  const provides = dedupe((Array.isArray(p.provides) ? p.provides : []).slice(0, XP.ports.maxPerWork)
    .filter(x => x && isId(x.standard))
    .map(x => {
      const fieldValues = {};
      for (const [k, v] of Object.entries(x.fieldValues && typeof x.fieldValues === 'object' ? x.fieldValues : {})) {
        const name = slug(k);
        if (SLUG.test(name)) fieldValues[name] = cleanValue(v);
      }
      return { standard: String(x.standard), version: version(x.version), fieldValues };
    }));
  const accepts = dedupe((Array.isArray(p.accepts) ? p.accepts : []).slice(0, XP.ports.maxPerWork)
    .filter(x => x && isId(x.standard))
    .map(x => {
      const out = { standard: String(x.standard), version: version(x.version) };
      // Body-mount extras (delta A) ride along when present: which side the
      // device fits, and its fit numbers against the site's declared fields.
      if (['left', 'right', 'either'].includes(x.laterality)) out.laterality = x.laterality;
      const fieldValues = {};
      for (const [k, v] of Object.entries(x.fieldValues && typeof x.fieldValues === 'object' ? x.fieldValues : {})) {
        const name = slug(k);
        if (SLUG.test(name)) fieldValues[name] = cleanValue(v);
      }
      if (Object.keys(fieldValues).length) out.fieldValues = fieldValues;
      return out;
    }));
  return { provides, accepts };
}

/* The database half: every referenced standard must exist and be a standard,
   a standard cannot port to itself, and a provides declaration must state the
   standard's required fields (unknown field names are dropped). Mutates the
   parsed object into its final storable shape. */
async function checkPorts(Design, ports, { selfId = null } = {}) {
  if (!ports) return null;
  const ids = [...new Set([...ports.provides, ...ports.accepts].map(x => String(x.standard)))];
  if (!ids.length) return ports;
  if (selfId && ids.includes(String(selfId))) fail(400, 'A work cannot declare a port against itself');

  const standards = await Design.find({ _id: { $in: ids } }).select('type standard version');
  const byId = new Map(standards.map(s => [String(s._id), s]));
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) fail(400, 'A declared standard no longer exists');
    if (s.type !== 'standard') fail(400, 'Ports declare against standard works only');
  }
  for (const decl of [...ports.provides, ...ports.accepts]) {
    const s = byId.get(String(decl.standard));
    if (decl.version !== null && decl.version > s.version) decl.version = s.version;  // can't pin the future
  }
  for (const p of ports.provides) {
    const def = byId.get(String(p.standard)).standard || {};
    const known = new Map((def.fields || []).map(f => [f.name, f]));
    for (const name of Object.keys(p.fieldValues)) {
      if (!known.has(name)) delete p.fieldValues[name];             // never store undeclared keys
    }
    for (const f of known.values()) {
      if (f.required && (p.fieldValues[f.name] === undefined || p.fieldValues[f.name] === '')) {
        fail(400, `"${def.portName}" requires a value for ${f.name}${f.unit ? ` (${f.unit})` : ''}`);
      }
    }
  }
  return ports;
}

/* Editing a declaration is re-claiming it: verification carries over only for
   provides entries whose standard, version and stated values are unchanged.
   Everything else starts back at "claimed". */
function reconcileProvides(previous, next) {
  const key = (p) => `${idOf(p.standard)}@${p.version ?? ''}|` +
    JSON.stringify(Object.entries(p.fieldValues || {}).sort());
  const verified = new Map((previous || [])
    .filter(p => p.status === 'verified')
    .map(p => [key(p), p]));
  return next.map(p => {
    const prior = verified.get(key(p));
    return prior
      ? { ...p, status: 'verified', verifiedBy: prior.verifiedBy, verifiedAt: prior.verifiedAt }
      : { ...p, status: 'claimed', verifiedBy: null, verifiedAt: null };
  });
}

/* Which of `work`'s accepts does `component` provide? The wizard's green
   mate-check and the Built-from chips are this intersection. Both sides may
   hold populated docs or raw ids. */
function matesFor(work, component) {
  const provided = new Map(((component.ports && component.ports.provides) || [])
    .map(p => [idOf(p.standard), p]));
  const mates = [];
  for (const a of (work.ports && work.ports.accepts) || []) {
    const p = provided.get(idOf(a.standard));
    if (p) mates.push({ standard: idOf(a.standard), verified: p.status === 'verified' });
  }
  return mates;
}

// A short stable fingerprint of both lists, for the version changelog.
const portShape = (ports) => JSON.stringify({
  p: ((ports && ports.provides) || []).map(p =>
    [idOf(p.standard), p.version ?? null, Object.entries(p.fieldValues || {}).sort()]).sort(),
  a: ((ports && ports.accepts) || []).map(a => [idOf(a.standard), a.version ?? null]).sort(),
});

module.exports = { parseStandardDef, parsePorts, checkPorts, reconcileProvides, matesFor, portShape, idOf };

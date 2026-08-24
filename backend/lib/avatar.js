/* ============================================================
   The adaptive avatar (Avatar Spec): the profile picture IS the
   stat sheet. Nine fixed wedges — one per visible category, same
   category in the same position for every account (mech at 12
   o'clock, then clockwise in registry order) — each filling
   radially with its category color as that skill levels. A new
   account is a near-black ring; a maxed account is the full
   rainbow. The center holds a deterministic monochrome glyph
   seeded from the username: the wedges own all color, the mark
   owns character.

   Pure function of (levels, username): same inputs → identical
   bytes, forever (the cache and the ETag depend on it). ~2 KB of
   static SVG — no animation, no filters, no client JS.
   ============================================================ */
const crypto = require('crypto');
const XP = require('../config/xp');

const CATS = XP.categories.filter(c => !c.hidden);

// Geometry: one fixed frame, precomputed once.
const C = 50;                 // center
const R_OUT = 47;             // ring outer radius
const R_IN = 29;              // ring inner radius (the disc edge)
const SPAN = R_OUT - R_IN;
const WEDGE = 360 / CATS.length;
const GAP = 1.6;              // degrees of breathing room per wedge edge

// Palette. The wedge colors come from the categories config (one source of
// truth with the grid, chips and boards); these three are the avatar's own
// dark-parchment neutrals, fixed here so the SVG stands alone anywhere.
const RING_BASE = '#1b1815';
const DISC = '#141210';
const BONE = '#e9e3d5';

const r2 = (n) => Math.round(n * 100) / 100;   // stable bytes: fixed precision
const pos = (r, deg) => {
  const rad = (deg - 90) * Math.PI / 180;      // 0° = 12 o'clock, clockwise
  return `${r2(C + r * Math.cos(rad))} ${r2(C + r * Math.sin(rad))}`;
};

/* An annular sector between two radii across [a0, a1] degrees. */
function sector(rInner, rOuter, a0, a1) {
  return `M${pos(rOuter, a0)} A${r2(rOuter)} ${r2(rOuter)} 0 0 1 ${pos(rOuter, a1)}` +
         ` L${pos(rInner, a1)} A${r2(rInner)} ${r2(rInner)} 0 0 0 ${pos(rInner, a0)} Z`;
}
const arc = (r, a0, a1) => `M${pos(r, a0)} A${r2(r)} ${r2(r)} 0 0 1 ${pos(r, a1)}`;

/* The nine wedges. Base is a ghost tint of the category color — the map is
   advertised without lying about progress (open decision 1) — and the fill
   rises from the inner edge as level/99. Notch lines cross the filled part at
   each title band (10/20/30/40/50): countable at profile size, gone at 24px. */
function wedges(levels, gap = GAP) {
  const cap = XP.levelCurve.cap;
  const parts = [];
  CATS.forEach((cat, i) => {
    const a0 = i * WEDGE + gap;
    const a1 = (i + 1) * WEDGE - gap;
    const level = Math.max(0, Math.min(cap, (levels && levels[cat.id]) || 0));
    parts.push(`<path d="${sector(R_IN, R_OUT, a0, a1)}" fill="${cat.color}" fill-opacity=".13"/>`);
    if (level > 0) {
      parts.push(`<path d="${sector(R_IN, R_IN + SPAN * level / cap, a0, a1)}" fill="${cat.color}"/>`);
    }
    for (let band = 10; band <= 50 && band <= level; band += 10) {
      parts.push(`<path d="${arc(R_IN + SPAN * band / cap, a0, a1)}" stroke="${RING_BASE}" stroke-width=".7" fill="none"/>`);
    }
  });
  return parts.join('');
}

/* ---------- the center mark ----------
   A symmetric geometric glyph from a small parametric family, every number
   drawn from sha256(username). Deterministic: the same name is the same mark
   forever, everywhere — recognizable identity without uploads. */
function glyph(username) {
  const seed = crypto.createHash('sha256').update(String(username).toLowerCase()).digest();
  const byte = (i) => seed[i % seed.length];
  const pick = (i, lo, hi) => lo + (byte(i) % (hi - lo + 1));   // inclusive ints
  const stroke = `stroke="${BONE}" stroke-width="2.2" stroke-linecap="round" fill="none"`;
  const spin = pick(1, 0, 359);                                 // seeded base rotation
  const P = (r, deg) => pos(r, deg + spin);

  switch (byte(0) % 5) {
    case 0: {   // spokes: k lines radiating from a small core
      const k = pick(2, 3, 6), r1 = pick(3, 4, 7), r0 = pick(4, 14, 20);
      const lines = Array.from({ length: k }, (_, j) =>
        `<path d="M${P(r1, j * 360 / k)} L${P(r0, j * 360 / k)}" ${stroke}/>`).join('');
      return `${lines}<circle cx="${C}" cy="${C}" r="${pick(5, 2, 3)}" fill="${BONE}"/>`;
    }
    case 1: {   // twin arcs: two mirrored crescents
      const r = pick(2, 12, 19), sweep = pick(3, 70, 130), tilt = pick(4, 0, 89);
      const one = (a) => `<path d="${arc(r, a - sweep / 2 + spin, a + sweep / 2 + spin)}" ${stroke}/>`;
      return one(tilt) + one(tilt + 180);
    }
    case 2: {   // polygon: a regular n-gon with a center dot
      const n = pick(2, 3, 6), r = pick(3, 12, 19);
      const pts = Array.from({ length: n }, (_, j) => P(r, j * 360 / n)).join(' L');
      return `<path d="M${pts} Z" ${stroke}/><circle cx="${C}" cy="${C}" r="2.2" fill="${BONE}"/>`;
    }
    case 3: {   // chevrons: a stack of two or three, mirror-symmetric
      const n = pick(2, 2, 3), w = pick(3, 8, 13), h = pick(4, 5, 8);
      return Array.from({ length: n }, (_, j) => {
        const y = C - ((n - 1) / 2 - j) * (h + 3);
        return `<path d="M${r2(C - w)} ${r2(y + h / 2)} L${C} ${r2(y - h / 2)} L${r2(C + w)} ${r2(y + h / 2)}" ${stroke} transform="rotate(${spin} ${C} ${C})"/>`;
      }).join('');
    }
    default: {  // orbit: a ring with k satellite dots
      const k = pick(2, 2, 4), r = pick(3, 9, 13), ro = pick(4, 16, 20);
      const dots = Array.from({ length: k }, (_, j) => {
        const [x, y] = P(ro, j * 360 / k).split(' ');
        return `<circle cx="${x}" cy="${y}" r="2" fill="${BONE}"/>`;
      }).join('');
      return `<circle cx="${C}" cy="${C}" r="${r}" ${stroke}/>${dots}`;
    }
  }
}

/* levels: { mech: 12, fab: 3, ... } — the visible categories' cached levels.
   Returns the complete standalone SVG document. */
/* Below ~64px the wedge gaps read as a loading spinner, so the small
   variant (Avatar Spec size rule) drops them: a solid ring of color mass. */
function avatarSvg(levels, username, { gaps = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="skill avatar">` +
    `<circle cx="${C}" cy="${C}" r="${R_OUT + 1}" fill="${RING_BASE}"/>` +
    wedges(levels, gaps ? GAP : 0) +
    `<circle cx="${C}" cy="${C}" r="${R_IN - 1}" fill="${DISC}"/>` +
    glyph(username) +
    `</svg>`;
}

module.exports = { avatarSvg };

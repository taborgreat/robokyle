// Single source of truth for which uploads are allowed and how they are grouped.
const path = require('path');

const KINDS = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
  model: ['.stl', '.obj', '.3mf', '.step', '.stp', '.scad', '.f3d', '.gcode'],
  doc: ['.pdf', '.txt', '.md', '.csv'],
  archive: ['.zip'],
};

const EXT_KIND = new Map();
for (const [kind, exts] of Object.entries(KINDS)) {
  for (const ext of exts) EXT_KIND.set(ext, kind);
}

const ALLOWED_EXT = new Set(EXT_KIND.keys());

// Extensions we are happy to hand back with an inline Content-Type. Anything
// else is always served as an attachment so a stray .svg/.pdf can't be used as
// a script host on the API origin.
const INLINE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const kindFor = (name) => EXT_KIND.get(path.extname(String(name || '')).toLowerCase()) || 'other';
const inlineMimeFor = (name) => INLINE_MIME[path.extname(String(name || '')).toLowerCase()] || null;

module.exports = { KINDS, ALLOWED_EXT, kindFor, inlineMimeFor };

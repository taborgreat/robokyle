/* One definition of an external link, shared by every path that stores one:
   the work's own links, and each step's links (which are how most members
   attach anything at all while file uploads stay admin-only). http(s) only,
   bounded lengths, label defaulting to the host. */

const KINDS = ['files', 'video', 'docs', 'parts', 'other'];
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

function sanitizeLinks(items, { max = 25 } = {}) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, max).map(l => {
    const url = clean(l && l.url, 2000);
    let parsed;
    try { parsed = new URL(url); } catch {
      throw Object.assign(new Error(`"${url}" is not a valid URL`), { status: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw Object.assign(new Error('Links must start with http:// or https://'), { status: 400 });
    }
    return {
      label: clean(l.label, 120) || parsed.hostname.replace(/^www\./, ''),
      url,
      kind: KINDS.includes(l.kind) ? l.kind : 'other',
      note: clean(l.note, 300),
    };
  }).filter(l => l.url);
}

// A link that is itself an image renders inline in the step, like a photo.
const isImageUrl = (url) => /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(String(url || ''));

module.exports = { sanitizeLinks, isImageUrl };

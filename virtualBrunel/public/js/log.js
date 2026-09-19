import { h } from './dom.js';

const MAX_ROWS = 200;
const KEEPALIVE = '/safety/keepalive';

const clock = (time) => new Date(time).toLocaleTimeString([], { hour12: false });
const pretty = (value) => JSON.stringify(value, null, 2);

// Live feed of every request the hand's API receives, newest first. Repeats of the same
// call collapse into one row with a counter so streaming clients stay readable.
export function createLog(root) {
  const rows = h('div', { className: 'rows' });
  const showKeepalive = h('input', {
    type: 'checkbox',
    onchange: () => root.classList.toggle('show-keepalive', showKeepalive.checked),
  });
  root.append(
    h('div', { className: 'panel-head' }, h('h2', {}, 'Incoming API'), h('label', { className: 'toggle' }, showKeepalive, 'show keepalives')),
    rows,
  );

  // Keepalives are tracked apart so they do not break up runs of other calls.
  const latest = { keepalive: null, other: null };

  function add(entry) {
    const kind = entry.path === KEEPALIVE ? 'keepalive' : 'other';
    const signature = `${entry.method} ${entry.path} ${entry.status}`;
    let row = latest[kind];

    if (row?.isConnected && row.signature === signature) {
      row.count += 1;
    } else {
      row = Object.assign(h('details', { className: `entry ${kind} s${Math.floor(entry.status / 100)}` }), {
        signature,
        count: 1,
      });
      latest[kind] = row;
    }

    const open = row.open;
    row.replaceChildren(
      h(
        'summary',
        {},
        h('time', {}, clock(entry.time)),
        h('b', {}, entry.method),
        h('span', { className: 'path' }, entry.path),
        row.count > 1 && h('span', { className: 'count' }, `×${row.count}`),
        h('span', { className: 'status' }, `${entry.status}`),
        h('span', { className: 'ms' }, `${entry.ms} ms`),
      ),
      entry.request && h('pre', {}, pretty(entry.request)),
      h('pre', {}, pretty(entry.response)),
    );
    row.open = open;

    rows.prepend(row);
    if (rows.childElementCount > MAX_ROWS) rows.lastElementChild.remove();
  }

  // The server replays its history on every (re)connect.
  function load(entries) {
    rows.replaceChildren();
    entries.forEach(add);
  }

  return { add, load };
}

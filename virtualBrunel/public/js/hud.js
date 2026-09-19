import { api } from './api-client.js';
import { h } from './dom.js';

const JOINT_LABELS = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
  thumb_rotator: 'Thumb rot.',
};

const ESTOP_REASONS = { command: 'ESTOP', watchdog: 'ESTOP · watchdog', reboot: 'ESTOP · rebooting' };

const MODES = {
  emg: 'Drive the hand from the simulated EMG band',
  api: 'Build API requests by hand',
};

// Header (mode switch, device status, keepalive, ESTOP) and the live joint read-out.
// `onMode` is called with 'emg' or 'api' whenever the mode changes.
export function createHud(header, jointsRoot, { keepalive, onMode }) {
  const chip = (text) => h('span', { className: 'chip', textContent: text });
  const link = chip('connecting');
  const estop = chip('');
  const watchdog = chip('');
  const motion = chip('');
  const speed = chip('');

  const keepaliveBox = h('input', { type: 'checkbox', onchange: () => keepalive.set(keepaliveBox.checked) });
  const release = h('button', {
    className: 'release',
    textContent: 'Release ESTOP',
    hidden: true,
    onclick: () => api('POST', '/safety/estop/release', { confirm: true }),
  });
  const stop = h('button', { className: 'estop', textContent: 'E-STOP', onclick: () => api('POST', '/safety/estop', {}) });

  const modeButtons = Object.entries(MODES).map(([mode, title]) =>
    h('button', { textContent: mode.toUpperCase(), title, value: mode, onclick: () => setMode(mode) }),
  );
  function setMode(mode) {
    for (const button of modeButtons) button.classList.toggle('active', button.value === mode);
    onMode(mode);
  }

  header.append(
    h('h1', {}, 'Virtual Brunel Hand'),
    h('div', { className: 'modes' }, modeButtons),
    h('div', { className: 'chips' }, link, estop, watchdog, motion, speed),
    h('label', { className: 'toggle', title: 'POST /safety/keepalive every 500 ms' }, keepaliveBox, 'Keepalive'),
    release,
    stop,
  );

  const bars = {};
  for (const [joint, label] of Object.entries(JOINT_LABELS)) {
    const fill = h('i');
    const value = h('b');
    bars[joint] = { fill, value };
    jointsRoot.append(h('div', { className: 'joint' }, h('span', {}, label), h('div', { className: 'bar' }, fill), value));
  }

  const set = (el, text, tone) => Object.assign(el, { textContent: text, className: `chip ${tone}` });

  return {
    setMode,

    setConnected(connected) {
      set(link, connected ? 'viewer linked' : 'viewer offline', connected ? 'good' : 'bad');
    },

    setKeepalive(on) {
      keepaliveBox.checked = on;
      keepalive.set(on);
    },

    update({ estop: reason, watchdog: dog, motion: label, speed: pct, offline }) {
      set(estop, offline ? 'off network' : (ESTOP_REASONS[reason] ?? 'ready'), reason || offline ? 'bad' : 'good');
      set(watchdog, !dog.ok ? 'watchdog expired' : dog.armed ? 'watchdog armed' : 'watchdog idle', dog.ok ? '' : 'bad');
      set(motion, label, '');
      set(speed, `speed ${pct}%`, '');
      release.hidden = !reason;
    },

    setPose(pose) {
      for (const [joint, { fill, value }] of Object.entries(bars)) {
        fill.style.width = `${pose[joint]}%`;
        value.textContent = Math.round(pose[joint]);
      }
    },
  };
}

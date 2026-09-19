import { h } from './dom.js';

const JOINT_LABELS = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
  thumb_rotator: 'Thumb rot.',
};

// ESTOP and the watchdog are switched off in the simulator for now (SAFETY_INTERLOCKS in
// src/constants.js), so the only stop the page can see is the one a reboot causes.
const STOP_REASONS = { command: 'stopped', watchdog: 'stopped · watchdog', reboot: 'rebooting' };

const MODES = {
  emg: 'Drive the hand from the simulated EMG band',
  api: 'Build API requests by hand',
};

// Header (mode switch, device status) and the live joint read-out.
// `onMode` is called with 'emg' or 'api' whenever the mode changes.
export function createHud(header, jointsRoot, { onMode }) {
  const chip = (text) => h('span', { className: 'chip', textContent: text });
  const link = chip('connecting');
  const device = chip('');
  const motion = chip('');
  const speed = chip('');

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
    h('div', { className: 'chips' }, link, device, motion, speed),
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

    update({ estop: reason, motion: label, speed: pct, offline }) {
      set(device, offline ? 'off network' : (STOP_REASONS[reason] ?? 'ready'), reason || offline ? 'bad' : 'good');
      set(motion, label, '');
      set(speed, `speed ${pct}%`, '');
    },

    setPose(pose) {
      for (const [joint, { fill, value }] of Object.entries(bars)) {
        fill.style.width = `${pose[joint]}%`;
        value.textContent = Math.round(pose[joint]);
      }
    },
  };
}

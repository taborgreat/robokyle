import { api } from '../api-client.js';
import { h } from '../dom.js';
import { createArmView, SENSOR_COLORS } from './arm-view.js';
import { EmgController } from './controller.js';
import { DEFAULT_GRIP, GRIPS } from './grips.js';
import { createJoystick } from './joystick.js';
import { createSignal } from './signal.js';
import { createWheel } from './wheel.js';

// Hold-to-contract inputs. `meter` is the effort channel whose level the input displays.
// The co-contraction input also grabs the joystick that stands in for arm rotation.
const INPUTS = [
  { key: 'f', label: 'Flexor', hint: 'close', drives: ['flex'], meter: 'flex' },
  { key: 'e', label: 'Extensor', hint: 'open', drives: ['ext'], meter: 'ext' },
  { key: 'c', label: 'Both', hint: 'hold + drag', drives: ['flex', 'ext'], joystick: true },
];
const WHEEL_HINT = 'Move toward a grip, let go to select';
const HAPTICS = { short: '▪ buzz', long: '▬▬ long buzz', double: '▪ ▪ double buzz' };

const SETTINGS = [
  ['flexOn', 'Flexor threshold', 0.05, 0.9],
  ['extOn', 'Extensor threshold', 0.05, 0.9],
  ['flexStrength', 'Flexor squeeze', 0.1, 1],
  ['extStrength', 'Extensor squeeze', 0.1, 1],
  ['maxSpeed', 'Max speed (closures/s)', 0.5, 4],
];

// The hand, as the band's adapter sees it: three Brunel API calls.
const hand = {
  show: ({ gesture, intent }, speed) =>
    intent ? api('POST', '/intent/execute', { intent }) : api('POST', '/gesture/execute', { gesture, speed }),
  getFingers: () => api('GET', '/finger/position'),
  setFingers: (positions, speed) =>
    api('POST', '/finger/position', {
      fingers: Object.fromEntries(Object.entries(positions).map(([finger, position]) => [finger, { position, speed }])),
    }),
};

// EMG mode: simulated flexor / extensor effort and arm orientation run through the
// band's control scheme. `onEnable` fires when the mode turns on (the band keeps the
// hand's watchdog fed). Returns { setEnabled, setHalted }.
export function createEmgPanel(root, { onEnable }) {
  const settings = { flexOn: 0.25, extOn: 0.25, flexStrength: 0.8, extStrength: 0.8, maxSpeed: 2, openFirst: false };
  const signal = createSignal(settings);
  const joystick = createJoystick();
  const buzz = h('span', { className: 'buzz' });
  const controller = new EmgController({
    hand,
    grips: GRIPS,
    settings,
    haptic: (pattern) => {
      buzz.textContent = HAPTICS[pattern];
      buzz.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1200 });
    },
  });

  // ── Live adapter state ──
  const state = h('span', { className: 'chip' });
  const grip = h('b');
  const closure = h('i');
  const head = h(
    'div',
    { className: 'emg-head' },
    h('h2', {}, 'EMG band'),
    state,
    h('span', { className: 'grip' }, 'grip ', grip),
    h('div', { className: 'bar closure', title: 'Grip closure' }, closure),
  );

  // ── Inputs ──
  function press(input, down) {
    input.drives.forEach((channel) => signal.hold(channel, down));
    if (!input.joystick) return;
    if (down) joystick.grab();
    else joystick.release();
  }

  const meters = [];
  const inputs = INPUTS.map((input) => {
    const { key, label, hint, meter } = input;
    const hold = h('button', { className: 'hold' }, `${label} (${key.toUpperCase()})`, h('small', {}, hint));
    hold.addEventListener('pointerdown', (event) => {
      hold.setPointerCapture(event.pointerId);
      press(input, true);
    });
    hold.addEventListener('pointerup', () => press(input, false));
    hold.addEventListener('pointercancel', () => press(input, false));

    const fill = h('i');
    if (meter) fill.style.background = SENSOR_COLORS[meter];
    const marker = h('em');
    if (meter) meters.push({ channel: meter, fill, marker });
    return h('div', { className: 'channel' }, meter && h('div', { className: 'bar effort' }, fill, marker), hold);
  });

  // ── The band on the arm ──
  const armCanvas = h('canvas');
  const arm = createArmView(armCanvas);
  const hint = h('span', { className: 'hint', textContent: WHEEL_HINT, hidden: true });
  const legend = (channel, label) => h('span', { className: `legend ${channel}` }, h('i', { style: `background:${SENSOR_COLORS[channel]}` }), label);
  const armView = h('div', { className: 'arm-view' }, armCanvas, legend('ext', 'Ext'), legend('flex', 'Flex'));

  const wheelCanvas = h('canvas', { className: 'grip-wheel' });
  const drawWheel = createWheel(wheelCanvas, GRIPS);

  const sliders = SETTINGS.map(([key, label, min, max]) => {
    const value = h('b', {}, settings[key]);
    const range = h('input', { type: 'range', min, max, step: 0.05, value: settings[key] });
    range.oninput = () => (value.textContent = settings[key] = Number(range.value));
    return h('label', { className: 'field' }, h('span', {}, label), range, value);
  });

  const openFirst = h('input', { type: 'checkbox', onchange: () => (settings.openFirst = openFirst.checked) });
  sliders.push(h('label', { className: 'toggle', title: 'Band spec: a grip change must never drop what the hand is holding' }, openFirst, 'Wheel only when the hand is open'));

  root.append(
    head,
    h('div', { className: 'channels' }, inputs),
    h('div', { className: 'band-status' }, hint, buzz),
    h('div', { className: 'band-row' }, armView, wheelCanvas),
    h('details', { className: 'section' }, h('summary', {}, 'Band settings'), h('div', { className: 'section-body settings' }, sliders)),
  );

  // ── Keyboard ──
  let enabled = false;
  const inputFor = (event) => INPUTS.find(({ key }) => key === event.key.toLowerCase());
  const typing = (event) => event.target.matches('input:not([type=range], [type=checkbox]), textarea, select');
  const releaseAll = () => INPUTS.forEach((input) => press(input, false));
  addEventListener('keydown', (event) => {
    const input = inputFor(event);
    if (input && enabled && !event.repeat && !typing(event)) press(input, true);
  });
  addEventListener('keyup', (event) => {
    const input = inputFor(event);
    if (input) press(input, false);
  });
  addEventListener('blur', releaseAll);

  // ── Loop ──
  let last = 0;
  let running = false;
  function frame(now) {
    running = enabled;
    if (!running) return;
    signal.update(now - last);
    last = now;
    const orientation = joystick.orientation;
    controller.update({ ...signal.effort, ...orientation }, now);

    const view = controller.view;
    state.textContent = view.state;
    state.className = `chip ${view.state.toLowerCase()}`;
    grip.textContent = view.ready ? view.grip : `${view.grip}…`;
    closure.style.width = `${view.closure * 100}%`;
    for (const { channel, fill, marker } of meters) {
      fill.style.width = `${signal.effort[channel] * 100}%`;
      marker.style.left = `${settings[`${channel}On`] * 100}%`;
    }
    drawWheel(view.wheel, orientation);

    hint.hidden = view.wheel === null;
    arm.draw({
      effort: signal.effort,
      active: { flex: signal.effort.flex >= settings.flexOn, ext: signal.effort.ext >= settings.extOn },
      orientation,
    });
    requestAnimationFrame(frame);
  }

  // Turning the mode on re-syncs the hand to the adapter's grip, since API mode may
  // have left it in any pose.
  function setEnabled(on) {
    enabled = on;
    releaseAll();
    if (!on) return;
    onEnable();
    controller.selectGrip(controller.view.index ?? DEFAULT_GRIP);
    last = performance.now();
    if (!running) requestAnimationFrame(frame);
  }

  return { setEnabled, setHalted: (halted) => controller.setHalted(halted) };
}

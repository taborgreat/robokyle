import { api } from './api-client.js';
import { h } from './dom.js';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const ACTUATORS = ['thumb_flexor', 'thumb_rotator', 'index_flexor', 'middle_flexor', 'ring_pinky_flexor'];
const SENSORS = ['emg', 'imu', 'force', 'tactile'];

const QUERIES = [
  ['Health', '/status/health'],
  ['Battery', '/status/battery'],
  ['Faults', '/status/faults'],
  ['Safety config', '/safety/config'],
  ['Positions', '/finger/position'],
  ['Range', '/finger/range'],
  ['Actuators', '/actuator/state'],
  ['Intent map', '/intent/mapping'],
];

const button = (label, onclick, className = '') => h('button', { textContent: label, onclick, className });
const numberInput = (value, min, max, step = 1) => h('input', { type: 'number', value, min, max, step });
const select = (options) => h('select', {}, options.map((option) => h('option', { value: option, textContent: option })));
const field = (label, control) => h('label', { className: 'field' }, h('span', {}, label), control);
const section = (title, open, ...children) =>
  h('details', { className: 'section', open }, h('summary', {}, title), h('div', { className: 'section-body' }, children));

// Request builder with an expandable section per endpoint category.
export function createConsole(root) {
  const lastResponse = h('pre', { className: 'response', textContent: 'No request sent yet.' });

  async function send(method, path, body) {
    const { status, body: response } = await api(method, path, body);
    lastResponse.textContent = `${method} ${path} → ${status}\n${JSON.stringify(response, null, 2)}`;
    lastResponse.classList.toggle('error', status >= 400 || status === 0);
    return response;
  }

  // ── Fingers ──
  const fingerSpeed = numberInput(60, 0, 100);
  const sliders = Object.fromEntries(
    FINGERS.map((finger) => {
      const value = h('b', {}, '0');
      const range = h('input', { type: 'range', min: 0, max: 100, value: 0, oninput: () => (value.textContent = range.value) });
      return [finger, { range, row: h('label', { className: 'field' }, h('span', {}, finger), range, value) }];
    }),
  );
  const sendFingers = () => {
    const speed = Number(fingerSpeed.value);
    const fingers = Object.fromEntries(FINGERS.map((finger) => [finger, { position: Number(sliders[finger].range.value), speed }]));
    send('POST', '/finger/position', { fingers });
  };
  const fingers = section(
    'Fingers',
    true,
    FINGERS.map((finger) => sliders[finger].row),
    field('speed', fingerSpeed),
    h(
      'div',
      { className: 'row' },
      button('Send positions', sendFingers, 'primary'),
      button('Set global speed', () => send('POST', '/finger/speed', { speed: Number(fingerSpeed.value) })),
    ),
  );

  // ── Gestures ──
  const gestureSpeed = numberInput(60, 0, 100);
  const gestureButtons = h('div', { className: 'grid' });
  const gestureName = h('input', { type: 'text', placeholder: 'my_grip', maxLength: 24 });
  const overwrite = h('input', { type: 'checkbox' });

  const execute = (gesture) => send('POST', '/gesture/execute', { gesture, speed: Number(gestureSpeed.value) });
  async function refreshGestures() {
    const { data } = await send('GET', '/gesture/list');
    if (!data) return;
    gestureButtons.replaceChildren(
      ...data.predefined.map((name) => button(name, () => execute(name))),
      ...data.custom.map((name) =>
        h(
          'span',
          { className: 'custom' },
          button(name, () => execute(name)),
          button('×', async () => {
            await send('DELETE', `/gesture/${name}`);
            refreshGestures();
          }),
        ),
      ),
    );
  }
  const saveGesture = async () => {
    const response = await send('POST', '/gesture/save', { name: gestureName.value, overwrite: overwrite.checked });
    if (response.status === 'ok') refreshGestures();
  };
  const gestures = section(
    'Gestures',
    true,
    field('speed', gestureSpeed),
    gestureButtons,
    h('div', { className: 'row' }, gestureName, h('label', { className: 'toggle' }, overwrite, 'overwrite'), button('Save pose', saveGesture)),
  );

  // ── Intents ──
  const intentSelect = h('select');
  const sizeSelect = select(['medium', 'small', 'large']);
  const force = numberInput(50, 0, 100);
  const sendIntent = () =>
    send('POST', '/intent/execute', { intent: intentSelect.value, object_size: sizeSelect.value, force_pct: Number(force.value) });
  const intents = section(
    'Intents',
    false,
    field('intent', intentSelect),
    field('object size', sizeSelect),
    field('force %', force),
    button('Execute intent', sendIntent, 'primary'),
  );
  async function loadIntents() {
    const { data } = await send('GET', '/intent/list');
    intentSelect.replaceChildren(...(data?.intents ?? []).map(({ name }) => h('option', { value: name, textContent: name })));
  }

  // ── Actuators ──
  const actuator = select(ACTUATORS);
  const pwm = numberInput(180, 0, 255);
  const duration = numberInput(500, 1, 5000);
  const sendPwm = () =>
    send('POST', '/actuator/pwm', { actuator: actuator.value, pwm: Number(pwm.value), duration_ms: Number(duration.value) });
  const actuators = section(
    'Actuators',
    false,
    field('actuator', actuator),
    field('pwm', pwm),
    field('duration ms', duration),
    h(
      'div',
      { className: 'row' },
      button('Apply PWM', sendPwm, 'primary'),
      button('Calibrate', () => send('POST', '/actuator/calibrate', { actuator: actuator.value })),
    ),
  );

  // ── Status, safety, sensors ──
  const forceLimit = numberInput(15, 1, 30, 0.5);
  const setSensors = (enabled) => send('POST', '/sensor/config', Object.fromEntries(SENSORS.map((kind) => [kind, { enabled }])));
  const device = section(
    'Status · safety · sensors',
    false,
    h('div', { className: 'grid' }, QUERIES.map(([label, path]) => button(label, () => send('GET', path)))),
    h(
      'div',
      { className: 'row' },
      field('force limit N', forceLimit),
      button('Set', () => send('POST', '/safety/force_limit', { max_force_n: Number(forceLimit.value) })),
    ),
    h(
      'div',
      { className: 'grid' },
      button('Sensors on', () => setSensors(true)),
      button('Sensors off', () => setSensors(false)),
      SENSORS.map((kind) => button(kind, () => send('GET', `/sensor/${kind}`))),
    ),
    button('Reboot device', () => send('POST', '/status/reboot', { confirm: true })),
  );

  // ── Raw ──
  const method = select(['POST', 'GET', 'DELETE']);
  const path = h('input', { type: 'text', value: '/gesture/execute' });
  const rawBody = h('textarea', { rows: 4, value: '{ "gesture": "pinch", "speed": 70 }' });
  const sendRaw = () => {
    try {
      send(method.value, path.value, method.value === 'GET' || !rawBody.value.trim() ? undefined : JSON.parse(rawBody.value));
    } catch (err) {
      lastResponse.textContent = `Body is not valid JSON: ${err.message}`;
      lastResponse.classList.add('error');
    }
  };
  const raw = section('Raw request', false, h('div', { className: 'row' }, method, path), rawBody, button('Send', sendRaw, 'primary'));

  root.append(h('div', { className: 'panel-head' }, h('h2', {}, 'Send API')), fingers, gestures, intents, actuators, device, raw, lastResponse);

  refreshGestures().then(loadIntents);
}

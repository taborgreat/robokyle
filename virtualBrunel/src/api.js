import { FINGERS, MAX_BODY_BYTES, SIZE_SCALE, WATCHDOG_TIMEOUT_MS } from './constants.js';
import { ApiError } from './errors.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Non-GET requests under these paths are refused while ESTOP is engaged (spec section 7).
const MOTION_PATHS = ['/finger/', '/gesture/', '/actuator/', '/intent/'];
const SENSORS = ['emg', 'imu', 'force', 'tactile'];
const GESTURE_NAME = /^\w{1,24}$/;

const invalid = (message) => new ApiError('INVALID_PARAM', message);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function object(value, name) {
  if (!isObject(value)) throw invalid(`Field '${name}' must be an object.`);
  return value;
}

function number(source, key, min, max, { integer = true, fallback } = {}) {
  const value = source[key];
  if (value === undefined && fallback !== undefined) return fallback;
  const valid = typeof value === 'number' && value >= min && value <= max && (!integer || Number.isInteger(value));
  if (!valid) throw invalid(`Field '${key}' must be ${integer ? 'an integer' : 'a number'} in range ${min}–${max}.`);
  return value;
}

function string(source, key) {
  const value = source[key];
  if (typeof value !== 'string' || !value) throw invalid(`Field '${key}' is required.`);
  return value;
}

function boolean(source, key, fallback) {
  const value = source[key] ?? fallback;
  if (typeof value !== 'boolean') throw invalid(`Field '${key}' must be a boolean.`);
  return value;
}

function confirmed(body) {
  if (body.confirm !== true) throw invalid("Field 'confirm' must be true.");
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw invalid(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw invalid('JSON parse failed.');
  }
}

// Returns a (req, res) handler serving the Brunel Hand API for `hand`.
// `onRequest` receives a log entry for every request once its response is sent.
export function createApi(hand, { onRequest = () => {} } = {}) {
  // Handlers return { message, data?, status? }. `body()` reads and parses the request
  // body on demand, so ESTOP and keepalive act the moment the route is matched.
  const routes = {
    'POST /finger/position': async ({ body }) => {
      const fingers = Object.entries(object((await body()).fingers, 'fingers'));
      if (!fingers.length) throw invalid("Field 'fingers' needs at least one entry.");
      const moves = {};
      for (const [finger, move] of fingers) {
        if (!FINGERS.includes(finger)) throw invalid(`Unknown finger '${finger}'.`);
        object(move, `fingers.${finger}`);
        moves[finger] = {
          position: number(move, 'position', 0, 100),
          speed: number(move, 'speed', 0, 100, { fallback: hand.speed }),
        };
      }
      hand.moveFingers(moves);
      return { message: 'Finger positions updated', data: { applied: Object.keys(moves) } };
    },

    'GET /finger/position': () => ({ message: 'Finger target positions', data: hand.fingerTargets() }),

    'POST /finger/speed': async ({ body }) => {
      const speed = number(await body(), 'speed', 0, 100);
      hand.setSpeed(speed);
      return { message: `Global speed set to ${speed}%`, data: { speed } };
    },

    'GET /finger/range': () => ({ message: 'Finger range of motion', data: hand.fingerRange() }),

    'POST /gesture/execute': async ({ body }) => {
      const request = await body();
      const gesture = string(request, 'gesture');
      const speed = number(request, 'speed', 0, 100, { fallback: hand.speed });
      const estimated_duration_ms = hand.executeGesture(gesture, speed);
      return { message: `Gesture '${gesture}' executing`, data: { estimated_duration_ms } };
    },

    'GET /gesture/list': () => ({ message: 'Available gestures', data: hand.gestures() }),

    'POST /gesture/save': async ({ body }) => {
      const request = await body();
      const name = string(request, 'name');
      if (!GESTURE_NAME.test(name)) {
        throw invalid("Field 'name' must be 1–24 characters: letters, digits and underscores only.");
      }
      const snapshot = hand.saveGesture(name, boolean(request, 'overwrite', false));
      return { message: `Gesture '${name}' saved to EEPROM`, data: { name, snapshot } };
    },

    'DELETE /gesture/:name': ({ param }) => {
      hand.deleteGesture(param);
      return { message: `Gesture '${param}' deleted` };
    },

    'POST /actuator/pwm': async ({ body }) => {
      const request = await body();
      const actuator = string(request, 'actuator');
      const pwm = number(request, 'pwm', 0, 255);
      const duration_ms = number(request, 'duration_ms', 1, 5000, { fallback: 200 });
      hand.applyPwm(actuator, pwm, duration_ms);
      return { message: 'PWM applied', data: { actuator, pwm, duration_ms } };
    },

    'GET /actuator/state': () => ({ message: 'Actuator state', data: hand.actuatorState() }),

    // Spec 5.3 shows a 200 with results, 11.7 requires an immediate 202 for long
    // operations. The sweep runs asynchronously, so 202 it is, with the 5.3 payload.
    'POST /actuator/calibrate': async ({ body }) => {
      const data = hand.calibrate(string(await body(), 'actuator'));
      return { status: 202, message: `Calibration started for ${data.actuator}`, data };
    },

    'GET /status/health': () => ({ message: 'System health', data: hand.health() }),
    'GET /status/battery': () => ({ message: 'Battery status', data: hand.battery() }),
    'GET /status/faults': () => ({ message: 'Fault log', data: hand.faults() }),

    'POST /status/reboot': async ({ body }) => {
      confirmed(await body());
      hand.reboot();
      return { message: 'Rebooting in 500ms. Reconnect after 5 seconds.' };
    },

    'POST /safety/estop': () => {
      const engaged = hand.estop();
      return { message: engaged ? 'ESTOP engaged. All actuators halted.' : 'ESTOP is disabled on this simulator. Nothing was halted.' };
    },

    'POST /safety/estop/release': async ({ body }) => {
      confirmed(await body());
      hand.releaseEstop();
      return { message: 'ESTOP released. Motion commands re-enabled.' };
    },

    'POST /safety/force_limit': async ({ body }) => {
      const max_force_n = number(await body(), 'max_force_n', 1, 30, { integer: false });
      hand.setForceLimit(max_force_n);
      return { message: 'Force limit set', data: { max_force_n } };
    },

    'GET /safety/config': () => ({ message: 'Safety configuration', data: hand.safetyConfig() }),

    'POST /safety/keepalive': () => {
      const armed = hand.keepalive();
      return {
        message: armed ? 'Watchdog reset' : 'Watchdog is disabled on this simulator. Keepalive ignored.',
        data: { next_deadline_ms: WATCHDOG_TIMEOUT_MS },
      };
    },

    // force_pct is validated but has no visible effect: the virtual hand grips nothing.
    'POST /intent/execute': async ({ body }) => {
      const request = await body();
      const intent = string(request, 'intent');
      const size = request.object_size ?? 'medium';
      if (!Object.hasOwn(SIZE_SCALE, size)) throw invalid("Field 'object_size' must be 'small', 'medium' or 'large'.");
      number(request, 'force_pct', 0, 100, { fallback: 50 });
      return { message: `Intent '${intent}' executing`, data: hand.executeIntent(intent, size) };
    },

    'GET /intent/list': () => ({ message: 'Available intents', data: { intents: hand.intents() } }),
    'GET /intent/mapping': () => ({ message: 'Intent to gesture mapping', data: { mapping: hand.intentMapping() } }),

    'POST /sensor/config': async ({ body }) => {
      const request = await body();
      const changes = {};
      for (const [kind, change] of Object.entries(request)) {
        if (!SENSORS.includes(kind)) throw invalid(`Unknown sensor '${kind}'.`);
        changes[kind] = { enabled: boolean(object(change, kind), 'enabled') };
        if (kind === 'emg' && change.sample_rate_hz !== undefined) {
          changes.emg.sample_rate_hz = number(change, 'sample_rate_hz', 1, 1000);
        }
      }
      return { message: 'Sensor configuration updated', data: hand.configureSensors(changes) };
    },
  };

  for (const kind of SENSORS) {
    routes[`GET /sensor/${kind}`] = () => ({ message: `Sensor '${kind}' reading`, data: hand.readSensor(kind) });
  }

  function match(method, path) {
    const exact = routes[`${method} ${path}`];
    if (exact) return { handler: exact };
    const gesture = method === 'DELETE' && path.match(/^\/gesture\/([^/]+)$/);
    if (gesture) return { handler: routes['DELETE /gesture/:name'], param: gesture[1] };
    throw new ApiError('NOT_FOUND', 'Endpoint not found.');
  }

  async function respond(req, path) {
    let request = null;
    try {
      const { handler, param } = match(req.method, path);
      if (req.method !== 'GET' && MOTION_PATHS.some((prefix) => path.startsWith(prefix))) hand.assertNotStopped();
      const body = async () => (request = object(await readJson(req), 'body'));
      const { status = 200, message, data } = await handler({ body, param });
      return { status, request, payload: { status: 'ok', message, ...(data && { data }) } };
    } catch (err) {
      if (!(err instanceof ApiError)) {
        console.error(err);
        err = new ApiError('INTERNAL_ERROR', 'Internal simulator error.');
      }
      return { status: err.status, request, payload: { status: 'error', error_code: err.code, message: err.message } };
    }
  }

  return async function handle(req, res) {
    // Mid-reboot the device is off the network.
    if (hand.offline) return void req.socket.destroy();
    if (req.method === 'OPTIONS') return void res.writeHead(204, CORS).end();

    const startedAt = Date.now();
    const path = new URL(req.url.replace(/^\/+/, '/'), 'http://hand').pathname;
    const { status, request, payload } = await respond(req, path);

    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
    onRequest({ time: startedAt, ms: Date.now() - startedAt, method: req.method, path, status, request, response: payload });
  };
}

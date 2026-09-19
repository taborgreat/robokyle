import { EventEmitter } from 'node:events';
import {
  ACTUATORS, DEFAULT_FORCE_LIMIT_N, DEFAULT_SPEED, FINGERS, FINGER_RANGE, FIRMWARE, GESTURES, INTENTS, JOINTS,
  MAX_CUSTOM_GESTURES, MAX_FAULTS, REBOOT_DELAY_MS, REBOOT_OFFLINE_MS, SIZE_SCALE, WATCHDOG_TIMEOUT_MS,
} from './constants.js';
import { ApiError } from './errors.js';
import { Joints, travelMs } from './motion.js';

const CALIBRATION_SPEED = 25;
const WAVE_CURL = 70;

const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const clampPct = (value) => Math.min(100, Math.max(0, Math.round(value)));
const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key]]));
const atSpeed = (pose, speed) =>
  Object.fromEntries(Object.entries(pose).map(([joint, position]) => [joint, { position, speed }]));

// The simulated device. Emits 'state' whenever something a viewer should see changes.
export class Hand extends EventEmitter {
  #joints = new Joints(JOINTS);
  #store;
  #custom;
  #estop = null; // null, or why it engaged: 'command' | 'watchdog' | 'reboot'
  #motion = 'idle';
  #busyUntil = 0;
  #nextStep = null;
  #watchdog = null;
  #watchdogOk = true;
  #offlineUntil = 0;
  #bootedAt;
  #speed;
  #maxForce;
  #faults;
  #sensors;

  constructor({ store }) {
    super();
    this.#store = store;
    this.#custom = store.load().gestures ?? {};
    this.#boot();
  }

  // Everything that does not survive a power cycle.
  #boot() {
    this.#bootedAt = Date.now();
    this.#speed = DEFAULT_SPEED;
    this.#maxForce = DEFAULT_FORCE_LIMIT_N;
    this.#faults = [];
    this.#sensors = {
      emg: { enabled: false, sample_rate_hz: 200 },
      imu: { enabled: false },
      force: { enabled: false },
      tactile: { enabled: false },
    };
  }

  get speed() {
    return this.#speed;
  }

  get offline() {
    return Date.now() < this.#offlineUntil;
  }

  snapshot() {
    return {
      joints: this.#joints.snapshot(),
      estop: this.#estop,
      motion: this.#motion,
      speed: this.#speed,
      watchdog: { armed: this.#watchdog !== null, ok: this.#watchdogOk },
      offline: this.offline,
    };
  }

  close() {
    clearTimeout(this.#nextStep);
    clearTimeout(this.#watchdog);
  }

  // ── Motion ────────────────────────────────────────────────────────────────

  assertNotStopped() {
    if (this.#estop === 'watchdog') {
      throw new ApiError('WATCHDOG_TIMEOUT', 'Watchdog expired and engaged ESTOP. Restore keepalive, then release ESTOP.');
    }
    if (this.#estop) throw new ApiError('ESTOP_ACTIVE', 'ESTOP is engaged.');
  }

  // Runs a list of steps back to back; each step maps joints to { position, speed }.
  // Returns the estimated total duration in ms.
  #run(label, steps) {
    this.assertNotStopped();
    if (this.#nextStep || Date.now() < this.#busyUntil) {
      throw new ApiError('MOTION_IN_PROGRESS', `Motion '${this.#motion}' is still executing.`);
    }

    const at = Object.fromEntries(JOINTS.map((joint) => [joint, this.#joints.position(joint)]));
    let estimate = 0;
    for (const step of steps) {
      const times = Object.entries(step).map(([joint, { position, speed }]) => travelMs(at[joint], position, speed));
      estimate += Math.max(...times);
      for (const [joint, { position }] of Object.entries(step)) at[joint] = position;
    }

    this.#motion = label;
    this.#step(steps);
    return Math.round(estimate);
  }

  #step([moves, ...rest]) {
    const now = Date.now();
    const times = Object.entries(moves).map(([joint, move]) => this.#joints.move(joint, move, now));
    const duration = Math.max(...times);
    this.#busyUntil = now + duration;
    this.#nextStep = rest.length ? setTimeout(() => this.#step(rest), duration) : null;
    this.emit('state');
  }

  // ── Fingers ───────────────────────────────────────────────────────────────

  fingerTargets() {
    return Object.fromEntries(FINGERS.map((finger) => [finger, this.#joints.target(finger)]));
  }

  moveFingers(moves) {
    this.#run('finger/position', [moves]);
  }

  setSpeed(speed) {
    this.#speed = speed;
    this.emit('state');
  }

  fingerRange() {
    return Object.fromEntries(
      Object.entries(FINGER_RANGE).map(([finger, { actuator, max_deg }]) => {
        const { min_pwm, max_pwm } = ACTUATORS[actuator];
        return [finger, { min_pwm, max_pwm, min_deg: 0, max_deg }];
      }),
    );
  }

  // ── Gestures ──────────────────────────────────────────────────────────────

  gestures() {
    return { predefined: Object.keys(GESTURES), custom: Object.keys(this.#custom) };
  }

  executeGesture(name, speed = this.#speed) {
    const pose = own(GESTURES, name) ?? own(this.#custom, name);
    if (!pose) throw new ApiError('UNKNOWN_GESTURE', `Gesture '${name}' not found.`);
    return this.#run(`gesture:${name}`, [atSpeed(pose, speed)]);
  }

  saveGesture(name, overwrite) {
    if (own(GESTURES, name)) throw new ApiError('PREDEFINED_GESTURE', `'${name}' is a predefined gesture.`);
    const exists = Boolean(own(this.#custom, name));
    if (exists && !overwrite) throw new ApiError('GESTURE_NAME_EXISTS', `Gesture '${name}' already exists.`);
    if (!exists && Object.keys(this.#custom).length >= MAX_CUSTOM_GESTURES) {
      throw new ApiError('EEPROM_WRITE_FAIL', `EEPROM is full (${MAX_CUSTOM_GESTURES} custom gestures).`);
    }
    const pose = Object.fromEntries(JOINTS.map((joint) => [joint, this.#joints.target(joint)]));
    this.#persist({ ...this.#custom, [name]: pose });
    return pick(pose, FINGERS);
  }

  deleteGesture(name) {
    if (own(GESTURES, name)) throw new ApiError('PREDEFINED_GESTURE', `'${name}' is a predefined gesture.`);
    if (!own(this.#custom, name)) throw new ApiError('UNKNOWN_GESTURE', `Gesture '${name}' not found.`);
    const rest = { ...this.#custom };
    delete rest[name];
    this.#persist(rest);
  }

  #persist(gestures) {
    try {
      this.#store.save({ gestures });
    } catch (err) {
      throw new ApiError('EEPROM_WRITE_FAIL', `EEPROM write failed: ${err.message}`);
    }
    this.#custom = gestures;
  }

  // ── Intents ───────────────────────────────────────────────────────────────

  intents() {
    return Object.entries(INTENTS).map(([name, { description, sized }]) => ({ name, description, supports_size: sized }));
  }

  intentMapping() {
    return Object.fromEntries(
      Object.entries(INTENTS).map(([name, { gesture, pose }]) => [name, { gesture, base_targets: pick(pose, FINGERS) }]),
    );
  }

  executeIntent(name, size = 'medium') {
    const intent = own(INTENTS, name);
    if (!intent) throw new ApiError('UNKNOWN_INTENT', `Intent '${name}' not found.`);

    const scale = intent.sized ? SIZE_SCALE[size] : 1;
    const pose = { ...intent.pose };
    for (const finger of FINGERS) pose[finger] = clampPct(pose[finger] * scale);

    const steps = [atSpeed(pose, this.#speed)];
    const curled = { index: WAVE_CURL, middle: WAVE_CURL, ring: WAVE_CURL, pinky: WAVE_CURL };
    for (let i = 0; i < (intent.waves ?? 0); i++) {
      steps.push(atSpeed(curled, this.#speed), atSpeed(pick(pose, Object.keys(curled)), this.#speed));
    }

    const estimated_duration_ms = this.#run(`intent:${name}`, steps);
    return { resolved_gesture: intent.gesture, finger_targets: pick(pose, FINGERS), estimated_duration_ms };
  }

  // ── Actuators ─────────────────────────────────────────────────────────────

  #actuator(id) {
    const actuator = own(ACTUATORS, id);
    if (!actuator) throw new ApiError('UNKNOWN_ACTUATOR', `Actuator '${id}' not found.`);
    return actuator;
  }

  // A raw PWM value is a position on the calibrated range; the actuator drives
  // towards it at full speed until the pulse ends.
  applyPwm(id, pwm, durationMs) {
    const { joints, min_pwm, max_pwm } = this.#actuator(id);
    const position = clampPct(((pwm - min_pwm) / (max_pwm - min_pwm)) * 100);
    const move = { position, speed: 100, maxMs: durationMs, pwm };
    this.#run(`pwm:${id}`, [Object.fromEntries(joints.map((joint) => [joint, move]))]);
  }

  actuatorState() {
    return Object.fromEntries(
      Object.entries(ACTUATORS).map(([id, { joints }]) => {
        const drives = joints.map((joint) => this.#joints.drive(joint));
        return [id, { ...(drives.find((drive) => drive.pwm) ?? drives[0]), fault: false }];
      }),
    );
  }

  // Sweeps the actuator to both end stops. The simulated mechanism has fixed limits,
  // so the recorded boundaries never change.
  calibrate(id) {
    const { joints, min_pwm, max_pwm } = this.#actuator(id);
    const sweep = (position) => Object.fromEntries(joints.map((joint) => [joint, { position, speed: CALIBRATION_SPEED }]));
    const duration_ms = this.#run(`calibrate:${id}`, [sweep(100), sweep(0)]);
    return { actuator: id, min_pwm, max_pwm, duration_ms };
  }

  // ── Safety ────────────────────────────────────────────────────────────────

  estop(reason = 'command') {
    clearTimeout(this.#nextStep);
    this.#nextStep = null;
    this.#busyUntil = 0;
    this.#joints.freeze();
    this.#estop ??= reason;
    this.#motion = 'idle';
    this.emit('state');
  }

  releaseEstop() {
    this.#estop = null;
    this.emit('state');
  }

  // The watchdog arms on the first keepalive, so the hand is usable from curl without
  // a heartbeat. Once armed, a missed deadline engages ESTOP until the next keepalive.
  keepalive() {
    const changed = this.#watchdog === null || !this.#watchdogOk;
    clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => this.#watchdogExpired(), WATCHDOG_TIMEOUT_MS).unref();
    this.#watchdogOk = true;
    if (changed) this.emit('state');
  }

  #watchdogExpired() {
    this.#watchdog = null;
    this.#watchdogOk = false;
    this.#fault('WATCHDOG_TIMEOUT', 'Keepalive missed');
    this.estop('watchdog');
  }

  setForceLimit(newtons) {
    this.#maxForce = newtons;
  }

  safetyConfig() {
    return {
      estop_active: this.#estop !== null,
      max_force_n: this.#maxForce,
      compliance_mode: 'soft',
      watchdog_timeout_ms: WATCHDOG_TIMEOUT_MS,
      low_battery_estop: true,
      temp_estop_c: 70,
    };
  }

  // ── Status ────────────────────────────────────────────────────────────────

  #uptimeMs() {
    return Date.now() - this.#bootedAt;
  }

  #fault(code, detail, actuator) {
    this.#faults.push({ uptime_s: Math.floor(this.#uptimeMs() / 1000), code, ...(actuator && { actuator }), detail });
    if (this.#faults.length > MAX_FAULTS) this.#faults.shift();
  }

  health() {
    return {
      firmware: FIRMWARE,
      uptime_s: Math.floor(this.#uptimeMs() / 1000),
      wifi_rssi_dbm: -55,
      temperature_c: 34.2,
      cpu_load_pct: 12,
      estop_active: this.#estop !== null,
      watchdog_ok: this.#watchdogOk,
    };
  }

  battery() {
    return { voltage_v: 7.4, percent: 82, charging: false, low_battery_alert: false };
  }

  faults() {
    return { fault_count: this.#faults.length, faults: this.#faults };
  }

  // ESTOP, wait, reset volatile state, then drop off the network while "Wi-Fi reconnects".
  reboot() {
    this.estop('reboot');
    setTimeout(() => {
      clearTimeout(this.#watchdog);
      this.#watchdog = null;
      this.#watchdogOk = true;
      this.#estop = null;
      this.#offlineUntil = Date.now() + REBOOT_OFFLINE_MS;
      this.#boot();
      this.emit('state');
      setTimeout(() => this.emit('state'), REBOOT_OFFLINE_MS).unref();
    }, REBOOT_DELAY_MS).unref();
  }

  // ── Sensors ───────────────────────────────────────────────────────────────

  configureSensors(changes) {
    for (const [kind, change] of Object.entries(changes)) Object.assign(this.#sensors[kind], change);
    return this.#sensors;
  }

  // No sensor hardware is modelled: an enabled sensor reports a hand at rest.
  readSensor(kind) {
    if (!this.#sensors[kind].enabled) throw new ApiError('SENSOR_UNAVAILABLE', `Sensor '${kind}' is disabled.`);
    const zero = { x: 0, y: 0, z: 0 };
    switch (kind) {
      case 'emg':
        return {
          channels: [
            { id: 0, raw: 20, normalized: 0.02, label: 'flexor' },
            { id: 1, raw: 18, normalized: 0.02, label: 'extensor' },
          ],
          sample_rate_hz: this.#sensors.emg.sample_rate_hz,
          timestamp_ms: this.#uptimeMs(),
        };
      case 'force':
        return { ...Object.fromEntries(FINGERS.map((finger) => [finger, 0])), total_n: 0 };
      case 'imu':
        return { accel: { ...zero, y: -9.81 }, gyro: zero, orientation: { roll: 0, pitch: 0, yaw: 0 } };
      case 'tactile':
        return { finger: 'index', grid_rows: 4, grid_cols: 4, values: Array.from({ length: 4 }, () => [0, 0, 0, 0]) };
    }
  }
}

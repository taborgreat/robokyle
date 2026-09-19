import { FULL_TRAVEL_MS } from './constants.js';

// Speed 0 is in the API's valid range; treat it as 1 so every move terminates.
const msPerPct = (speed) => FULL_TRAVEL_MS / Math.max(speed, 1);

export const travelMs = (from, to, speed) => Math.abs(to - from) * msPerPct(speed);

// Joint positions (0–100 %) are evaluated lazily from the last commanded move,
// so the simulation needs no tick loop.
export class Joints {
  #moves = {};

  constructor(names) {
    for (const name of names) this.#moves[name] = { from: 0, to: 0, startedAt: 0, duration: 0, pwm: 0 };
  }

  position(name, now = Date.now()) {
    const { from, to, startedAt, duration } = this.#moves[name];
    if (now >= startedAt + duration) return to;
    return from + ((to - from) * (now - startedAt)) / duration;
  }

  target(name) {
    return this.#moves[name].to;
  }

  // Starts a move and returns its duration. With `maxMs` the joint stops wherever it
  // has got to when the time runs out (raw PWM pulses).
  move(name, { position, speed, maxMs = Infinity, pwm = Math.round(speed * 2.55) }, now) {
    const from = this.position(name, now);
    let to = position;
    if (travelMs(from, to, speed) > maxMs) {
      to = Math.round(from + (Math.sign(to - from) * maxMs) / msPerPct(speed));
    }
    const duration = travelMs(from, to, speed);
    this.#moves[name] = { from, to, startedAt: now, duration, pwm };
    return duration;
  }

  freeze(now = Date.now()) {
    for (const name of Object.keys(this.#moves)) {
      const at = Math.round(this.position(name, now));
      this.#moves[name] = { from: at, to: at, startedAt: now, duration: 0, pwm: 0 };
    }
  }

  // What the motor driver is doing right now, in /actuator/state terms.
  drive(name, now = Date.now()) {
    const { from, to, startedAt, duration, pwm } = this.#moves[name];
    if (now >= startedAt + duration) return { pwm: 0, direction: 'idle' };
    return { pwm, direction: to > from ? 'forward' : 'reverse' };
  }

  // `rate` is % per ms; clients animate towards `target` at that rate.
  snapshot(now = Date.now()) {
    const out = {};
    for (const [name, { from, to, startedAt, duration }] of Object.entries(this.#moves)) {
      const moving = now < startedAt + duration;
      out[name] = {
        position: this.position(name, now),
        target: to,
        rate: moving ? Math.abs(to - from) / duration : 0,
      };
    }
    return out;
  }
}

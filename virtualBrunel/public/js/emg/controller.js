// The band-to-hand adapter from the EMG band spec (section 7), driving the hand through
// nothing but the Brunel API. DOM-free: feed it effort and orientation, it sends commands.
//
//   flexor effort   → close the selected grip, speed proportional to effort
//   extensor effort → open it, speed proportional to effort
//   co-contraction  → open the grip wheel
//   roll / pitch    → point at a wheel sector; the hand previews that grip
//
// The wheel works two ways. Hold the co-contraction, point, and let go to select. Or
// let go straight away and the wheel stays open under the band spec's rules: dwell on a
// grip or return to centre to select, extensor burst or 3 s idle to cancel.
// ESTOP is deliberately not on a muscle gesture; it belongs to a dedicated button.
//
// The Brunel API has no velocity or force endpoint and refuses a new motion while one
// is executing (409). So the adapter integrates effort into a grip closure (0–1) and
// streams it as small /finger/position steps, each sized to land within one tick.

const TICK_MS = 100; // command cadence to the hand
const DEBOUNCE_MS = 60; // effort must stay past its threshold this long to count (3 band frames)
const COCONTRACT_MS = 150;
const PREVIEW_INTERVAL_MS = 400;
const PREVIEW_SPEED = 80; // brisk, so the hand keeps up with a sweep round the wheel
const DWELL_MS = 1000; // pointing at one sector this long selects it
const IDLE_MS = 3000; // wheel closes if the arm never leaves centre
export const DEAD_ZONE_DEG = 10; // wheel centre: no sector selected
const OPEN_ENOUGH = 0.15; // closure below which the hand counts as open
const SPEED_PER_PCT = 6; // speed that completes a step of N % within a tick
const MAX_FRAME_MS = 100; // a stalled frame loop must not turn into one big jump

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Tracks how long a channel has been above its ON threshold.
class Channel {
  #since = null;

  update(effort, threshold, now) {
    if (effort < threshold) this.#since = null;
    else this.#since ??= now;
  }

  heldFor(now) {
    return this.#since === null ? 0 : now - this.#since;
  }
}

// Sector index for an offset from the wheel centre; null inside the dead zone.
function sectorAt(roll, pitch, count) {
  if (Math.hypot(roll, pitch) < DEAD_ZONE_DEG) return null;
  const turn = Math.atan2(roll, pitch) / (2 * Math.PI); // 0 = up, clockwise
  return ((Math.round(turn * count) % count) + count) % count;
}

export class EmgController {
  #hand;
  #grips;
  #settings;
  #haptic;

  #flex = new Channel();
  #ext = new Channel();
  #state = 'REST';
  #grip = null; // { index, targets }; targets stay null until learned from the hand
  #closure = 0;
  #wheel = null;
  #onset = null; // arm orientation when the current co-contraction began
  #lockout = false; // muscles must relax after the wheel closes before they drive the grip
  #halted = false;
  #lastUpdate = null;

  #queue = [];
  #inFlight = false;
  #lastTick = 0;
  #lastSent = null;

  // hand:     { show(grip, speed), setFingers(positions, speed), getFingers() },
  //           each resolving to { ok, status, body }
  // settings: { flexOn, extOn, maxSpeed, openFirst } with efforts on 0–1, maxSpeed in closures
  //           per second, and openFirst making the wheel wait until the hand is open
  // haptic:   called with 'short' | 'long' | 'double'
  constructor({ hand, grips, settings, haptic }) {
    this.#hand = hand;
    this.#grips = grips;
    this.#settings = settings;
    this.#haptic = haptic;
  }

  get view() {
    return {
      state: this.#state,
      index: this.#grip?.index,
      grip: this.#grip && this.#grips[this.#grip.index].label,
      ready: Boolean(this.#grip?.targets),
      closure: this.#closure,
      wheel: this.#wheel && { center: this.#wheel.center, sector: this.#wheel.sector, shown: this.#wheel.shown },
    };
  }

  selectGrip(index) {
    this.#preview(index);
    this.#adopt(index);
  }

  // Adopts the grip the hand is showing: reads back the finger targets its gesture
  // resolved to, which become the fully-closed end of proportional control.
  #adopt(index) {
    this.#grip = { index, targets: null };
    this.#closure = 1;
    this.#enqueue({
      kind: 'learn',
      run: () => this.#hand.getFingers(),
      done: ({ body }) => {
        this.#grip.targets = body.data;
        this.#lastSent = body.data;
      },
    });
  }

  // While the hand is ESTOPped the adapter idles; commands would only bounce.
  setHalted(halted) {
    if (halted === this.#halted) return;
    this.#halted = halted;
    this.#queue = [];
    this.#wheel = null;
    this.#lastSent = null;
    this.#state = 'REST';
  }

  // input: { flex, ext } efforts on 0–1, { roll, pitch } in degrees. Call every frame.
  update({ flex, ext, roll, pitch }, now) {
    const dt = Math.min(now - (this.#lastUpdate ?? now), MAX_FRAME_MS);
    this.#lastUpdate = now;
    this.#flex.update(flex, this.#settings.flexOn, now);
    this.#ext.update(ext, this.#settings.extOn, now);
    const both = Math.min(this.#flex.heldFor(now), this.#ext.heldFor(now));
    if (!both) this.#onset = null;
    else this.#onset ??= { roll, pitch };

    if (this.#halted) return;

    if (this.#wheel) this.#updateWheel(roll, pitch, both, now);
    else if (both >= COCONTRACT_MS) this.#openWheel(now);
    else if (!both) this.#updateGrip(flex, ext, dt, now);

    this.#pump(now);
  }

  // ── Proportional open / close ─────────────────────────────────────────────

  #updateGrip(flex, ext, dt, now) {
    const held = this.#flex.heldFor(now) || this.#ext.heldFor(now);
    if (this.#lockout && held) return;
    this.#lockout = false;

    const { flexOn, extOn, maxSpeed } = this.#settings;
    const drive = (effort, on) => clamp((effort - on) / (1 - on), 0, 1);

    let velocity = 0;
    if (this.#flex.heldFor(now) >= DEBOUNCE_MS) velocity = drive(flex, flexOn);
    else if (this.#ext.heldFor(now) >= DEBOUNCE_MS) velocity = -drive(ext, extOn);

    this.#closure = clamp(this.#closure + (velocity * maxSpeed * dt) / 1000, 0, 1);
    this.#state = velocity > 0 ? 'CLOSING' : velocity < 0 ? 'OPENING' : this.#closure > 0 ? 'HOLD' : 'REST';

    // Commands only flow while the wearer is driving, so nothing moves by itself
    // after an ESTOP release.
    if (!velocity || !this.#grip?.targets) return;

    const positions = {};
    for (const [finger, target] of Object.entries(this.#grip.targets)) positions[finger] = Math.round(target * this.#closure);

    // After an ESTOP the hand's pose is unknown, so the first step goes out at preview speed.
    const last = this.#lastSent;
    const step = last && Math.max(...Object.keys(positions).map((finger) => Math.abs(positions[finger] - last[finger])));
    if (step === 0) return;
    const speed = last ? clamp(Math.ceil(step * SPEED_PER_PCT), 1, 100) : PREVIEW_SPEED;

    this.#enqueue({
      kind: 'positions',
      run: () => this.#hand.setFingers(positions, speed),
      done: () => (this.#lastSent = positions),
    });
  }

  // ── Grip wheel ────────────────────────────────────────────────────────────

  // The wheel is centred on where the arm was when the co-contraction began, however
  // long opening takes (it waits for a grip that is still being learned).
  #openWheel(now) {
    if (!this.#grip?.targets) return;
    // The band spec's guard against dropping a held object: no grip change until the hand is open.
    if (this.#settings.openFirst && this.#closure > OPEN_ENOUGH) return;
    this.#state = 'WHEEL';
    this.#wheel = {
      center: this.#onset,
      sector: null, // where the arm points
      shown: null, // the grip the hand was last told to preview
      openedAt: now,
      changedAt: now,
      nextPreviewAt: 0,
      hasLeftCenter: false,
      released: false, // the co-contraction that opened the wheel has been let go
    };
    this.#haptic('short');
  }

  #updateWheel(roll, pitch, both, now) {
    const wheel = this.#wheel;
    const sector = sectorAt(roll - wheel.center.roll, pitch - wheel.center.pitch, this.#grips.length);
    const extOnly = this.#ext.heldFor(now) >= DEBOUNCE_MS && !this.#flex.heldFor(now);

    if (sector !== wheel.sector) {
      wheel.sector = sector;
      wheel.changedAt = now;
      if (sector !== null) {
        wheel.hasLeftCenter = true;
        this.#haptic('short');
      }
    }

    // Only ever the current sector, and at most one preview per interval.
    if (sector !== null && sector !== wheel.shown && now >= wheel.nextPreviewAt) {
      wheel.shown = sector;
      wheel.nextPreviewAt = now + PREVIEW_INTERVAL_MS;
      this.#preview(sector);
    }

    // Held open: browse freely. Letting go selects whatever the hand is showing; with
    // nothing shown yet the wheel stays open and the spec's timeouts start from here.
    if (both) return;
    if (!wheel.released) {
      if (extOnly) return; // the two channels rarely let go on the same frame
      wheel.released = true;
      wheel.openedAt = wheel.changedAt = now;
      if (wheel.shown !== null) return this.#closeWheel(true);
    }

    const returned = wheel.hasLeftCenter && sector === null;
    const dwelled = sector !== null && sector === wheel.shown && now - wheel.changedAt >= DWELL_MS;
    const idle = !wheel.hasLeftCenter && now - wheel.openedAt >= IDLE_MS;

    if (extOnly) this.#closeWheel(false);
    else if (returned || dwelled) this.#closeWheel(true);
    else if (idle) this.#closeWheel(false);
  }

  // Confirmed: the hand keeps the grip it is showing. Cancelled: back to the previous one.
  #closeWheel(confirmed) {
    const { shown } = this.#wheel;
    this.#wheel = null;
    this.#lockout = true;
    this.#state = 'REST';
    if (confirmed && shown !== null) {
      this.#haptic('long');
      this.#adopt(shown);
    } else {
      this.#haptic('double');
      if (shown === null) return;
      this.#closure = 1;
      this.#lastSent = this.#grip.targets;
      this.#preview(this.#grip.index);
    }
  }

  #preview(index) {
    this.#enqueue({ kind: 'preview', run: () => this.#hand.show(this.#grips[index], PREVIEW_SPEED) });
  }

  // ── Command pump ──────────────────────────────────────────────────────────

  // The newest command of a kind supersedes an unsent older one.
  #enqueue(command) {
    this.#queue = this.#queue.filter((queued) => queued.kind !== command.kind);
    this.#queue.push(command);
  }

  // One command per tick, one in flight at a time. A 409 means the hand is still
  // moving: try again next tick unless something newer has replaced the command.
  async #pump(now) {
    if (this.#inFlight || !this.#queue.length || now - this.#lastTick < TICK_MS) return;
    this.#lastTick = now;
    this.#inFlight = true;

    const command = this.#queue.shift();
    const response = await command.run();
    const superseded = this.#queue.some((queued) => queued.kind === command.kind);
    if (response.status === 409 && !superseded) this.#queue.unshift(command);
    else if (response.ok) command.done?.(response);

    this.#inFlight = false;
  }
}

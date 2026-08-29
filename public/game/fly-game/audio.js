/* ==================================================================
   Fly Game, sound.

   Synthesised rather than sampled, the same way Undead Nightmare
   does it: nothing to download, nothing to cache, and the engine
   note can follow the throttle continuously instead of crossfading
   between clips.

   Everything hangs off one master gain so a single mute is honest,
   and the context is only created after a real gesture because
   browsers will not start one otherwise.
   ================================================================== */

export function createAudio() {
  let ctx = null;
  let master = null;
  let engine = null;
  let wind = null;
  let siren = null;
  let started = false;
  let muted = false;
  let volume = 0.7;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    return ctx;
  }

  // A short burst of noise, reused for wind, gunfire and pops.
  function noiseBuffer(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Distance attenuation. Nothing fancy, just enough that a hillside three
  // hundred units away does not sound like it is in the cockpit.
  function falloff(dist) {
    const d = Math.max(0, dist || 0);
    return 1 / (1 + (d / 190) * (d / 190));
  }

  // At ten rounds a second every impact would be its own voice. Cap it.
  let impactTokens = 6;
  let impactClock = 0;
  function impactBudget() {
    const now = ctx ? ctx.currentTime : 0;
    impactTokens = Math.min(6, impactTokens + (now - impactClock) * 9);
    impactClock = now;
    if (impactTokens < 1) return false;
    impactTokens -= 1;
    return true;
  }

  function startLoops() {
    if (started || !ctx) return;
    started = true;

    // Engine: two detuned saws through a lowpass. Detuning is what stops it
    // sounding like a test tone; the filter is what stops it sounding like a
    // wasp. Both ends move with the throttle.
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscB.detune.value = 11;

    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 700;
    engFilter.Q.value = 0.8;

    const engGain = ctx.createGain();
    engGain.gain.value = 0;

    oscA.connect(engFilter);
    oscB.connect(engFilter);
    engFilter.connect(engGain);
    engGain.connect(master);
    oscA.start();
    oscB.start();

    engine = { oscA, oscB, filter: engFilter, gain: engGain };

    // Wind: looping noise through a bandpass that opens up with speed.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2.5);
    src.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;

    const windGain = ctx.createGain();
    windGain.gain.value = 0;

    src.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    src.start();

    wind = { filter: windFilter, gain: windGain };

    // The dive siren. A continuous voice like the engine rather than a clip,
    // so it winds up and down with the dive instead of being triggered. Two
    // detuned saws through a resonant bandpass is what gives it the reedy
    // scream rather than a clean tone.
    const sA = ctx.createOscillator();
    const sB = ctx.createOscillator();
    sA.type = 'sawtooth';
    sB.type = 'sawtooth';
    sB.detune.value = 22;

    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = 'bandpass';
    sirenFilter.frequency.value = 900;
    sirenFilter.Q.value = 6.5;

    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;

    sA.connect(sirenFilter);
    sB.connect(sirenFilter);
    sirenFilter.connect(sirenGain);
    sirenGain.connect(master);
    sA.start();
    sB.start();

    siren = { oscA: sA, oscB: sB, filter: sirenFilter, gain: sirenGain };
  }

  return {
    // Called from the first click or key, where a context is allowed to start.
    resume() {
      ensure();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      startLoops();
    },

    setVolume(v) {
      volume = v;
      if (master) master.gain.value = muted ? 0 : volume;
    },

    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : volume;
    },

    // throttle and speed both run 0 to 1.
    flight(throttle, speed) {
      if (!ctx || !engine) return;
      const t = ctx.currentTime;
      const hz = 58 + throttle * 96;
      engine.oscA.frequency.setTargetAtTime(hz, t, 0.09);
      engine.oscB.frequency.setTargetAtTime(hz * 1.5, t, 0.09);
      engine.filter.frequency.setTargetAtTime(420 + throttle * 1500, t, 0.12);
      engine.gain.gain.setTargetAtTime(0.05 + throttle * 0.1, t, 0.12);

      wind.gain.gain.setTargetAtTime(speed * 0.05, t, 0.2);
      wind.filter.frequency.setTargetAtTime(380 + speed * 900, t, 0.2);
    },

    // dive runs 0 to 1: how steeply and how fast you are going down.
    dive(amount) {
      if (!ctx || !siren) return;
      const t = ctx.currentTime;
      const a = Math.max(0, Math.min(1, amount));
      const hz = 320 + a * 900;
      siren.oscA.frequency.setTargetAtTime(hz, t, 0.12);
      siren.oscB.frequency.setTargetAtTime(hz * 1.005, t, 0.12);
      siren.filter.frequency.setTargetAtTime(hz * 1.6, t, 0.12);
      // Cubed, so it only really shows up in a committed dive rather than
      // wailing quietly every time the nose dips.
      siren.gain.gain.setTargetAtTime(a * a * a * 0.16, t, 0.14);
    },

    gun() {
      if (!ctx) return;
      const t = ctx.currentTime;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.18);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1700, t);
      bp.frequency.exponentialRampToValueAtTime(420, t + 0.13);
      bp.Q.value = 1.1;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.15);

      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.18);

      // A little body under the crack, or it sounds like a hi-hat.
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.1);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.28, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + 0.12);
      osc.connect(og); og.connect(master);
      osc.start(t); osc.stop(t + 0.13);
    },

    pop() {
      if (!ctx) return;
      const t = ctx.currentTime;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.08);
      bp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.42, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.1);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.1);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(240, t + 0.09);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.2, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + 0.1);
      osc.connect(og); og.connect(master);
      osc.start(t); osc.stop(t + 0.11);
    },

    // Impact sounds carry a distance, so a round landing on a hillside a
    // long way off is quieter than one right under the nose. Rate limited
    // too: at ten rounds a second, one sound per round is a buzz.
    dirtHit(dist) {
      if (!ctx || !impactBudget()) return;
      const t = ctx.currentTime;
      const v = falloff(dist) * 0.34;
      if (v < 0.006) return;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.16);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1500, t);
      lp.frequency.exponentialRampToValueAtTime(320, t + 0.13);
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.17);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      const og = ctx.createGain();
      og.gain.setValueAtTime(v * 0.7, t);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.1);
      osc.connect(og); og.connect(master);
      osc.start(t); osc.stop(t + 0.11);
    },

    waterHit(dist) {
      if (!ctx || !impactBudget()) return;
      const t = ctx.currentTime;
      const v = falloff(dist) * 0.3;
      if (v < 0.006) return;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.22);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1800, t);
      bp.frequency.exponentialRampToValueAtTime(520, t + 0.18);
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.22);

      // The little pitched blip of a drop closing over.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(1250, t + 0.07);
      const og = ctx.createGain();
      og.gain.setValueAtTime(v * 0.5, t);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.08);
      osc.connect(og); og.connect(master);
      osc.start(t); osc.stop(t + 0.09);
    },

    // A building coming apart. Deliberately nothing like the aircraft going
    // in: no low boom at all, just timber cracking and masonry falling, so
    // the two are never confused for each other.
    collapse(dist) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = falloff(dist || 0) * 0.62;
      if (v < 0.005) return;

      // Three cracks, slightly apart, which is what makes it read as
      // structure failing rather than one impact.
      for (let i = 0; i < 3; i++) {
        const at = t + i * (0.035 + Math.random() * 0.05);
        const crack = ctx.createBufferSource();
        crack.buffer = noiseBuffer(0.12);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1500 + Math.random() * 900, at);
        bp.frequency.exponentialRampToValueAtTime(500, at + 0.1);
        bp.Q.value = 3.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(v * (0.34 - i * 0.07), at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0005, at + 0.12);
        crack.connect(bp); bp.connect(g); g.connect(master);
        crack.start(at); crack.stop(at + 0.13);
      }

      // Rubble settling underneath.
      const rub = ctx.createBufferSource();
      rub.buffer = noiseBuffer(0.8);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 0.7);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.linearRampToValueAtTime(v * 0.3, t + 0.03);
      rg.gain.exponentialRampToValueAtTime(0.0005, t + 0.75);
      rub.connect(lp); lp.connect(rg); rg.connect(master);
      rub.start(t); rub.stop(t + 0.8);
    },

    // A ship going down. Splintering timber over water rather than fire, and
    // a long wet tail that neither of the other two has.
    shipWreck(dist) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = falloff(dist || 0) * 0.7;
      if (v < 0.005) return;

      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(110, t);
      thump.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.linearRampToValueAtTime(v * 0.2, t + 0.014);
      tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
      thump.connect(tg); tg.connect(master);
      thump.start(t); thump.stop(t + 0.65);

      const timber = ctx.createBufferSource();
      timber.buffer = noiseBuffer(0.6);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1100, t);
      bp.frequency.exponentialRampToValueAtTime(380, t + 0.5);
      bp.Q.value = 1.6;
      const tgg = ctx.createGain();
      tgg.gain.setValueAtTime(0.0001, t);
      tgg.gain.linearRampToValueAtTime(v * 0.34, t + 0.012);
      tgg.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
      timber.connect(bp); bp.connect(tgg); tgg.connect(master);
      timber.start(t); timber.stop(t + 0.62);

      // Water closing over it, arriving a beat late.
      const wash = ctx.createBufferSource();
      wash.buffer = noiseBuffer(1.3);
      const wf = ctx.createBiquadFilter();
      wf.type = 'lowpass';
      wf.frequency.setValueAtTime(2400, t);
      wf.frequency.exponentialRampToValueAtTime(300, t + 1.2);
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.linearRampToValueAtTime(v * 0.26, t + 0.13);
      wg.gain.exponentialRampToValueAtTime(0.0005, t + 1.25);
      wash.connect(wf); wf.connect(wg); wg.connect(master);
      wash.start(t); wash.stop(t + 1.3);
    },

    // A gun going off somewhere out there. Dull, because it is over water
    // and a long way off, and it must not compete with your own guns.
    flakFire(dist) {
      if (!ctx || !impactBudget()) return;
      const t = ctx.currentTime;
      const v = falloff(dist || 0) * 0.5;
      if (v < 0.005) return;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.3);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v * 0.4, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.32);
    },

    // The shell going off. Sharp and close, with a tail of tearing air, and
    // it gets its own voice rather than borrowing the aircraft's explosion.
    flakBurst(dist) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = falloff(dist || 0) * 0.85;
      if (v < 0.004) return;

      const crack = ctx.createBufferSource();
      crack.buffer = noiseBuffer(0.25);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2200, t);
      bp.frequency.exponentialRampToValueAtTime(400, t + 0.2);
      bp.Q.value = 0.9;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.linearRampToValueAtTime(v * 0.42, t + 0.006);
      cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.26);
      crack.connect(bp); bp.connect(cg); cg.connect(master);
      crack.start(t); crack.stop(t + 0.28);

      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(190, t);
      thump.frequency.exponentialRampToValueAtTime(52, t + 0.3);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.linearRampToValueAtTime(v * 0.3, t + 0.01);
      tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
      thump.connect(tg); tg.connect(master);
      thump.start(t); thump.stop(t + 0.36);
    },

    // Fragments going through the airframe. Metallic, and nothing else in
    // the game sounds like it, which is the point: you should know without
    // looking that this one was close.
    shrapnelHit(strength) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = 0.28 + (strength || 0) * 0.4;

      for (let i = 0; i < 3; i++) {
        const at = t + i * (0.012 + Math.random() * 0.03);
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1700 + Math.random() * 1400, at);
        osc.frequency.exponentialRampToValueAtTime(600, at + 0.06);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(v * 0.16, at + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0004, at + 0.07);
        osc.connect(g); g.connect(master);
        osc.start(at); osc.stop(at + 0.08);
      }

      const rip = ctx.createBufferSource();
      rip.buffer = noiseBuffer(0.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(v * 0.3, t);
      rg.gain.exponentialRampToValueAtTime(0.0004, t + 0.18);
      rip.connect(hp); hp.connect(rg); rg.connect(master);
      rip.start(t); rip.stop(t + 0.2);
    },

    // Menus. Quiet and short, because you pass over a lot of buttons.
    uiHover() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(760, t);
      osc.frequency.linearRampToValueAtTime(940, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.07);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + 0.08);
    },

    uiClick() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1250, t);
      osc.frequency.exponentialRampToValueAtTime(430, t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.09);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + 0.1);

      const tick = ctx.createBufferSource();
      tick.buffer = noiseBuffer(0.04);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2600;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.05, t);
      tg.gain.exponentialRampToValueAtTime(0.0004, t + 0.04);
      tick.connect(hp); hp.connect(tg); tg.connect(master);
      tick.start(t); tick.stop(t + 0.05);
    },

    // A round landing on something solid that did not break.
    thud() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + 0.14);
    },

    // Wind the engine and the wind down to nothing. Used on pause and on
    // leaving the flight, where the loop stops calling flight() and the
    // gains would otherwise just hold their last value and drone on.
    idle() {
      if (!ctx || !engine) return;
      const t = ctx.currentTime;
      engine.gain.gain.setTargetAtTime(0, t, 0.05);
      wind.gain.gain.setTargetAtTime(0, t, 0.05);
      if (siren) siren.gain.gain.setTargetAtTime(0, t, 0.05);
    },

    // A crash into land. Body first, then the crack, then a long tail, which
    // is roughly the order a real one arrives in.
    // dist attenuates, scale is how big a thing went up. The player's own
    // crash is the loudest case and it is still well under half of what it
    // was: an instant full level transient right after quiet flying reads as
    // a jump scare rather than as an explosion. Everything now has a short
    // attack rather than starting at full level on the first sample.
    explosion(dist, scale) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = falloff(dist || 0) * (scale == null ? 1 : scale);
      if (v < 0.004) return;
      const A = 0.012;                   // attack, seconds

      const boom = ctx.createOscillator();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(140, t);
      boom.frequency.exponentialRampToValueAtTime(26, t + 0.9);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.22 * v, t + A);
      bg.gain.exponentialRampToValueAtTime(0.0005, t + 1.1);
      boom.connect(bg); bg.connect(master);
      boom.start(t); boom.stop(t + 1.15);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.2 * v, t + A);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.5);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.6);

      // A little edge on top, or it is all rumble and no impact. Much
      // quieter than it was: this was most of the startle.
      const crack = ctx.createBufferSource();
      crack.buffer = noiseBuffer(0.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.linearRampToValueAtTime(0.085 * v, t + A);
      cg.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
      crack.connect(hp); hp.connect(cg); cg.connect(master);
      crack.start(t); crack.stop(t + 0.24);
    },

    // Hitting the water at speed. Heavier and wetter than the skim below.
    bigSplash() {
      if (!ctx) return;
      const t = ctx.currentTime;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1.4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t);
      bp.frequency.exponentialRampToValueAtTime(180, t + 1.1);
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.34, t + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.2);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.4);

      // The thump of displaced water under the spray.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.5);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.24, t + 0.014);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
      osc.connect(og); og.connect(master);
      osc.start(t); osc.stop(t + 0.65);

      // Fine spray falling back, a beat later.
      const spray = ctx.createBufferSource();
      spray.buffer = noiseBuffer(0.9);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2200;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.16, t + 0.14);
      sg.gain.exponentialRampToValueAtTime(0.0008, t + 1.0);
      spray.connect(hp); hp.connect(sg); sg.connect(master);
      spray.start(t); spray.stop(t + 1.0);
    },

    // Water is a duller, longer version of a pop.
    splash() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1400, t);
      lp.frequency.exponentialRampToValueAtTime(300, t + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.4);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.4);
    },
  };
}

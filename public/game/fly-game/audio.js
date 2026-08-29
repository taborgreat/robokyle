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

    // A crash into land. Body first, then the crack, then a long tail, which
    // is roughly the order a real one arrives in.
    explosion() {
      if (!ctx) return;
      const t = ctx.currentTime;

      const boom = ctx.createOscillator();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(140, t);
      boom.frequency.exponentialRampToValueAtTime(26, t + 0.9);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.85, t);
      bg.gain.exponentialRampToValueAtTime(0.0008, t + 1.1);
      boom.connect(bg); bg.connect(master);
      boom.start(t); boom.stop(t + 1.15);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.75, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 1.5);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.6);

      // A short bright crack on top, or it is all rumble and no impact.
      const crack = ctx.createBufferSource();
      crack.buffer = noiseBuffer(0.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.5, t);
      cg.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
      crack.connect(hp); hp.connect(cg); cg.connect(master);
      crack.start(t); crack.stop(t + 0.2);
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
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 1.2);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.4);

      // The thump of displaced water under the spray.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.5);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.55, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
      osc.connect(og); og.connect(master);
      osc.start(t); osc.stop(t + 0.65);

      // Fine spray falling back, a beat later.
      const spray = ctx.createBufferSource();
      spray.buffer = noiseBuffer(0.9);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2200;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.3, t + 0.14);
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

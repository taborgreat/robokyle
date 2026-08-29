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

  // The engine and the wind have their own gain in front of the master, so
  // the drone can be pulled down to nothing without taking the guns and the
  // flak with it. It is the sound you hear for the whole flight, so it is
  // the one worth being able to turn off on its own.
  let drone = null;
  let droneVol = 0.8;

  // Music has its own too, for the same reason in reverse.
  let musicBus = null;
  let musicVol = 0.6;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);

    drone = ctx.createGain();
    drone.gain.value = droneVol;
    drone.connect(master);

    /* The music bus.

       A gentle lowpass, because nothing relaxing has much above 3k in it,
       and a long feedback delay, because the space around a note is most
       of what makes a sparse tune sound like music rather than like a
       sequence of beeps. */
    musicBus = ctx.createGain();
    musicBus.gain.value = musicVol;

    const musicTone = ctx.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 2600;
    musicTone.Q.value = 0.5;

    const echo = ctx.createDelay(1.2);
    echo.delayTime.value = 0.42;
    const echoBack = ctx.createGain();
    echoBack.gain.value = 0.34;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 1500;
    const echoSend = ctx.createGain();
    echoSend.gain.value = 0.45;

    musicBus.connect(musicTone);
    musicTone.connect(master);
    musicTone.connect(echoSend);
    echoSend.connect(echo);
    echo.connect(echoTone);
    echoTone.connect(echoBack);
    echoBack.connect(echo);          // the tail
    echoTone.connect(master);

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
    engGain.connect(drone);
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
    windGain.connect(drone);
    src.start();

    wind = { filter: windFilter, gain: windGain };

    // The dive siren.
    //
    // The real thing is a propeller driven siren, so it is not a tone: it is
    // a fundamental with a hard harmonic on top and a fast chop from the
    // ports passing the opening. Three parts, then: a saw for the body, a
    // square an octave up for the shriek, and a fast tremolo for the chop.
    // Without the chop it is just a whistle, and without the octave it is
    // too soft to be recognisable.
    const sA = ctx.createOscillator();   // body
    const sB = ctx.createOscillator();   // beating against it
    const sC = ctx.createOscillator();   // the octave that does the screaming
    sA.type = 'sawtooth';
    sB.type = 'sawtooth';
    sC.type = 'square';
    sB.detune.value = 14;

    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = 'bandpass';
    sirenFilter.frequency.value = 900;
    sirenFilter.Q.value = 9;

    // the chop: a fast tremolo across the whole voice
    const chop = ctx.createOscillator();
    chop.type = 'sine';
    chop.frequency.value = 26;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0;

    const octGain = ctx.createGain();
    octGain.gain.value = 0.5;

    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;

    sA.connect(sirenFilter);
    sB.connect(sirenFilter);
    sC.connect(octGain); octGain.connect(sirenFilter);
    sirenFilter.connect(sirenGain);
    chop.connect(chopDepth);
    chopDepth.connect(sirenGain.gain);   // modulates the level, not the pitch
    sirenGain.connect(master);
    sA.start(); sB.start(); sC.start(); chop.start();

    siren = { oscA: sA, oscB: sB, oscC: sC, filter: sirenFilter,
              gain: sirenGain, chop, chopDepth };
  }

  /* ===== Music =====

     Generative rather than a fixed tune. A chord underneath, a bass note
     on its root, and a bell picking notes out of a scale over the top at
     places chosen fresh each bar. Nothing ever repeats exactly, which is
     the whole point: a menu you sit on for ten minutes should not turn
     into a nursery rhyme, and the surest way to make a loop irritating is
     to let someone learn it.

     Both tracks are slow, sparse and soft. The difference between them is
     the mode and the register, which is more than enough to make arriving
     on the island feel like somewhere else. */

  const TRACKS = {
    // Higher, brighter, a little quicker. Major sevenths all the way
    // down, which is the friendliest sound there is.
    menu: {
      bpm: 74,
      chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]],
      scale: [72, 74, 76, 79, 81, 84, 86],
      bell: 'triangle', pad: 'sine',
      bellLevel: 0.075, padLevel: 0.03, bassLevel: 0.05, density: 4,
    },
    // Lydian, which is the major scale with the fourth raised: the same
    // warmth with one note in it that keeps wanting to float upward.
    // Slower, lower, and thinner, to sit under an engine.
    island: {
      bpm: 58,
      chords: [[53, 57, 60, 64], [55, 59, 62, 65], [57, 60, 64, 67], [50, 57, 60, 65]],
      scale: [69, 71, 72, 76, 77, 81, 83],
      bell: 'triangle', pad: 'sine',
      bellLevel: 0.055, padLevel: 0.036, bassLevel: 0.045, density: 3,
    },
  };

  let tune = null;        // { name, track, bar, next, timer, voices }
  let wantTune = null;    // asked for before the context was allowed to start

  const midi = m => 440 * Math.pow(2, (m - 69) / 12);

  function voice(note, at, dur, type, level) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midi(note);
    const g = ctx.createGain();
    // Soft in, long out. A hard attack on a triangle is a beep.
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + Math.min(0.3, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(musicBus);
    o.start(at);
    o.stop(at + dur + 0.05);
    if (tune) tune.voices.push({ o, g, until: at + dur + 0.1 });
  }

  function pump() {
    if (!tune || !ctx) return;
    // Drop voices that have finished, or the list grows for the whole
    // session and a track switch has to walk all of it.
    const now = ctx.currentTime;
    tune.voices = tune.voices.filter(v => v.until > now);

    const T = tune.track;
    const beat = 60 / T.bpm;
    const bar = beat * 4;
    while (tune.next < now + 0.9) {
      const at = tune.next;
      const chord = T.chords[tune.bar % T.chords.length];

      for (const n of chord) voice(n + 12, at, bar * 1.1, T.pad, T.padLevel);
      voice(chord[0] - 12, at, bar * 0.85, 'triangle', T.bassLevel);

      const count = T.density + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        // Eighths, but never the first one every bar: a note on every
        // downbeat is what makes a generative loop sound like a metronome.
        const slot = 1 + Math.floor(Math.random() * 7);
        const note = T.scale[Math.floor(Math.random() * T.scale.length)];
        const st = at + slot * beat * 0.5;
        voice(note, st, beat * 1.7, T.bell, T.bellLevel * (0.55 + Math.random() * 0.5));
      }

      tune.bar++;
      tune.next += bar;
    }
  }

  function stopTune(fade) {
    if (!tune) return;
    clearInterval(tune.timer);
    const now = ctx ? ctx.currentTime : 0;
    for (const v of tune.voices) {
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), now);
        v.g.gain.exponentialRampToValueAtTime(0.0001, now + fade);
        v.o.stop(now + fade + 0.02);
      } catch (e) { /* already stopped */ }
    }
    tune = null;
  }

  return {
    // Called from the first click or key, where a context is allowed to start.
    resume() {
      ensure();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      startLoops();
      if (wantTune) { const n = wantTune; wantTune = null; this.music(n); }
    },

    /* Switch tracks, or pass null for silence. Asking for the one already
       playing does nothing, so this can be called every time a screen
       changes without restarting the music each time. */
    music(name) {
      if (tune && tune.name === name) return;
      ensure();
      // Before the first gesture there is no context to schedule into, so
      // remember what was wanted and start it when there is one.
      if (!ctx || ctx.state === 'suspended') { wantTune = name; return; }
      stopTune(0.7);
      const track = TRACKS[name];
      if (!track) return;
      tune = { name, track, bar: 0, next: ctx.currentTime + 0.2, voices: [], timer: 0 };
      pump();
      tune.timer = setInterval(pump, 250);
    },

    setVolume(v) {
      volume = v;
      if (master) master.gain.value = muted ? 0 : volume;
    },

    setMuted(m) {
      muted = m;
      if (master) master.gain.value = muted ? 0 : volume;
    },

    setDrone(v) {
      droneVol = v;
      if (drone) drone.gain.value = droneVol;
    },

    setMusicVolume(v) {
      musicVol = v;
      if (musicBus) musicBus.gain.value = musicVol;
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

      // Winds up over a wide range, which is the part everyone recognises.
      const hz = 260 + a * 760;
      siren.oscA.frequency.setTargetAtTime(hz, t, 0.14);
      siren.oscB.frequency.setTargetAtTime(hz * 1.004, t, 0.14);
      siren.oscC.frequency.setTargetAtTime(hz * 2, t, 0.14);
      siren.filter.frequency.setTargetAtTime(hz * 1.5, t, 0.14);
      // The chop speeds up with it, because on the real thing the same
      // airflow drives both the pitch and the rate of the ports.
      siren.chop.frequency.setTargetAtTime(18 + a * 26, t, 0.2);

      // Cubed, so it only shows up in a committed dive rather than wailing
      // every time the nose dips. Quieter than it was: it sits under the
      // engine rather than over it.
      const level = a * a * a * 0.085;
      siren.gain.gain.setTargetAtTime(level, t, 0.16);
      siren.chopDepth.gain.setTargetAtTime(level * 0.55, t, 0.16);
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
    /* The whine off a round that came back up.

       A tone that falls fast and wide, which is the whole character of it:
       the pitch drop is Doppler on something leaving at speed, and it is
       what makes a spark off a hillside read as a bullet rather than as a
       hit. Quiet, because at ten rounds a second there will be plenty. */
    ricochet(dist) {
      if (!ensure() || !impactBudget()) return;
      const t = ctx.currentTime;
      const k = falloff(dist) * 0.5;
      if (k < 0.012) return;

      const o = ctx.createOscillator();
      o.type = 'triangle';
      const start = 1500 + Math.random() * 1400;
      o.frequency.setValueAtTime(start, t);
      o.frequency.exponentialRampToValueAtTime(start * 0.24, t + 0.32);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16 * k, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

      o.connect(bp); bp.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.36);
    },

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
      if (siren) {
        siren.gain.gain.setTargetAtTime(0, t, 0.05);
        siren.chopDepth.gain.setTargetAtTime(0, t, 0.05);
      }
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

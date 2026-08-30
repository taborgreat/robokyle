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

  // How hard the aircraft is diving, kept so the engine can be pulled down
  // out of the siren's way. Set by dive(), read by flight().
  let diveDuck = 0;

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

  let lastMark = 0;

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

  /* ===== The crew =====

     Recorded cats, because a purr is a very particular thing and nothing
     synthesised sounds like one. Seven of them: two purrs, two trills and
     three mews, picked at random so it never becomes a tic.

     Public domain, from opengameart.org, so there is nothing to credit
     and nothing to keep track of.

     Decoded into buffers rather than played through elements: they are
     short, they are wanted at unpredictable moments, and a buffer starts
     the instant it is asked to. */
  const CAT_DIR = '/public/game/fly-game/cat/';
  const CAT_SOUNDS = [
    // The purrs are loops, so they are held for a few seconds and faded
    // rather than played end to end.
    { file: 'purr-active.wav', gain: 0.5, hold: 4.5, loop: true },
    { file: 'purr-sleepy.ogg', gain: 0.55, hold: 5.5, loop: true },
    { file: 'trill-1.wav', gain: 0.45 },
    { file: 'trill-2.wav', gain: 0.42 },
    { file: 'mew-soft.wav', gain: 0.42 },
    { file: 'mew-food.wav', gain: 0.38 },
    { file: 'mew-kitten.ogg', gain: 0.4 },
  ];
  const catBuffers = new Map();

  function catLoad(name) {
    if (catBuffers.has(name)) return catBuffers.get(name);
    catBuffers.set(name, null);           // in flight, so it is not fetched twice
    fetch(CAT_DIR + name)
      .then(r => r.arrayBuffer())
      .then(b => ctx.decodeAudioData(b))
      .then(buf => catBuffers.set(name, buf))
      // A sound that will not load leaves a quiet cat, not a broken game.
      .catch(() => catBuffers.delete(name));
    return null;
  }

  /* ===== Music =====

     Two recordings rather than the generative thing that was here before.
     Everything else in this file is synthesised because it has to follow
     the game continuously, and a tune does not: it plays, it loops, and
     the only thing the game asks of it is which one.

     They go through a MediaElementSource rather than a decoded buffer, so
     a three megabyte file starts when it has enough of itself rather than
     when it has all of itself, and they still land on the music bus, so
     the music slider governs them like anything else.

       Morning and Evening by Kevin MacLeod (incompetech.com)
       Licensed under Creative Commons: By Attribution 4.0
       https://creativecommons.org/licenses/by/4.0/ */

  const TRACKS = {
    menu:   '/public/game/fly-game/music/morning.mp3',
    island: '/public/game/fly-game/music/evening.mp3',
  };

  let tune = null;        // { name, el, gain }
  let wantTune = null;    // asked for before the context was allowed to start

  function stopTune(fade) {
    if (!tune) return;
    const going = tune;
    tune = null;
    const now = ctx ? ctx.currentTime : 0;
    try {
      going.gain.gain.cancelScheduledValues(now);
      going.gain.gain.setValueAtTime(going.gain.gain.value, now);
      going.gain.gain.linearRampToValueAtTime(0, now + fade);
    } catch (e) { /* nothing scheduled */ }
    // Paused only once it is silent, or the last second of the outgoing
    // track is cut off rather than faded.
    setTimeout(() => { try { going.el.pause(); } catch (e) {} }, fade * 1000 + 120);
  }

  return {
    // Called from the first click or key, where a context is allowed to start.
    resume() {
      ensure();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      startLoops();
      // A megabyte and a half between them, and they are wanted at moments
      // nothing can predict, so they are fetched up front.
      for (const c of CAT_SOUNDS) catLoad(c.file);
      if (wantTune) { const n = wantTune; wantTune = null; this.music(n); }
    },

    /* One of the cats says something.

       Not attenuated and not positioned: they are eighteen inches in front
       of you. Called on a long timer from the flight code, which is what
       keeps it a surprise rather than a metronome. */
    catCall() {
      if (!ensure() || !master) return;
      const pick = CAT_SOUNDS[Math.floor(Math.random() * CAT_SOUNDS.length)];
      const buf = catBuffers.get(pick.file);
      if (!buf) { catLoad(pick.file); return; }

      const t = ctx.currentTime;
      const dur = Math.min(pick.hold || buf.duration, pick.loop ? (pick.hold || 4) : buf.duration);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = !!pick.loop;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pick.gain, t + (pick.loop ? 0.4 : 0.05));
      g.gain.setValueAtTime(pick.gain, t + Math.max(0.1, dur - 0.45));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(g); g.connect(master);
      s.start(t); s.stop(t + dur + 0.05);
    },

    /* Switch tracks, or pass null for silence. Asking for the one already
       playing does nothing, so this can be called every time a screen
       changes without restarting the music each time. */
    music(name) {
      if (tune && tune.name === name) return;
      ensure();
      // Before the first gesture there is no context to play into, so
      // remember what was wanted and start it when there is one.
      if (!ctx || ctx.state === 'suspended') { wantTune = name; return; }

      stopTune(0.9);
      const url = TRACKS[name];
      if (!url) return;

      const el = new Audio(url);
      el.loop = true;
      el.preload = 'auto';
      // A file that fails to load leaves the game silent rather than
      // broken, which is the right way round for background music.
      el.addEventListener('error', () => { if (tune && tune.el === el) tune = null; });

      let node;
      try {
        node = ctx.createMediaElementSource(el);
      } catch (e) {
        return;                       // no route to the bus, so no music
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(musicBus);

      tune = { name, el, gain };
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + 1.4);
      const started = el.play();
      if (started && started.catch) started.catch(() => {});
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
      // Ducked under the siren. In a full dive the engine gives up nearly
      // half its level and the wind rather more, which is what lets the
      // siren be the loudest thing in the aeroplane without simply
      // turning everything up.
      const duck = 1 - diveDuck * 0.45;
      engine.gain.gain.setTargetAtTime((0.05 + throttle * 0.1) * duck, t, 0.12);

      wind.gain.gain.setTargetAtTime(speed * 0.05 * (1 - diveDuck * 0.55), t, 0.2);
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

      /* Loud. It is the whole reason to point the nose down.

         It was cubed and capped at 0.085, which put it under an engine
         that is itself getting louder and higher as the speed builds, and
         the result was a siren you could just about hear behind the drone
         rather than a siren. Squared brings it in sooner and four times
         the ceiling brings it in front, and flight() ducks the engine and
         the wind out of its way besides. */
      diveDuck = a * a;
      const level = a * a * 0.34;
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

      /* A round going into water, not a snare drum.

         Which is what it was: a noise burst through a bandpass at 1800
         with a Q of 1.4 and an instant attack. That is the recipe for a
         snare, near enough, and it is what a snare is. Water has almost
         nothing up there. It is a lowpass that shuts as it goes, a
         softer tail underneath for the spray coming back down, and the
         attack ramped over a few milliseconds rather than stepped, since
         the step is the crack of the stick on the head. */
      const slap = ctx.createBufferSource();
      slap.buffer = noiseBuffer(0.32);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(950, t);
      lp.frequency.exponentialRampToValueAtTime(170, t + 0.17);
      lp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0005, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.007);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
      slap.connect(lp); lp.connect(g); g.connect(master);
      slap.start(t); slap.stop(t + 0.32);

      // The cavity closing over behind it. Quiet, and late enough to be
      // heard as a consequence rather than as part of the impact.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, t + 0.025);
      osc.frequency.exponentialRampToValueAtTime(720, t + 0.12);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0005, t + 0.025);
      og.gain.exponentialRampToValueAtTime(v * 0.3, t + 0.045);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
      osc.connect(og); og.connect(master);
      osc.start(t + 0.025); osc.stop(t + 0.15);
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

    /* The hitmarker.

       Deliberately not a world sound. No distance falloff, no position,
       the same tick whether what you hit was under the nose or eight
       hundred units out, and it does not go through the impact budget
       that thins out the thuds. It is not the sound of a round striking
       metal; it is the game telling you the round struck, and it wants to
       be as immediate and as certain as the flash on the screen.

       Two layers, both very short. A bandpassed noise burst for the snap
       of it, and a high sine dropping a fifth for the pitch that makes it
       read as a confirmation rather than as debris. Both are done inside
       forty five milliseconds, because past that it stops being a click
       and starts being a sound. */
    hitMark() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      // Sustained fire should tick rapidly, not smear into a buzz.
      if (t - lastMark < 0.045) return;
      lastMark = t;

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.06);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2700;
      bp.Q.value = 1.3;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.32, t + 0.002);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      src.connect(bp); bp.connect(ng); ng.connect(master);
      src.start(t); src.stop(t + 0.07);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(2150, t);
      o.frequency.exponentialRampToValueAtTime(1280, t + 0.03);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.24, t + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(og); og.connect(master);
      o.start(t); o.stop(t + 0.07);
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

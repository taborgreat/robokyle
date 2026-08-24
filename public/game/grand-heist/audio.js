// ============================================================
// RoboKyle: Grand Heist — audio
//
// Real recorded samples (all CC0, see audio/CREDITS.txt) rather
// than synthesised beeps. SFX are small and preloaded on the
// first user gesture; music is streamed and lazy-loaded, because
// the tracks are multi-megabyte and the menu must not wait.
// ============================================================
(() => {
  'use strict';

  const GH = window.GH;
  const BASE = 'audio/';

  const SFX = {
    // interface
    click:   'ui_click.ogg',
    hover:   'ui_hover.ogg',
    back:    'ui_back.ogg',
    confirm: 'ui_confirm.ogg',
    error:   'ui_error.ogg',
    open:    'ui_open.ogg',
    close:   'ui_close.ogg',
    select:  'ui_select.ogg',
    toggle:  'ui_toggle.ogg',
    scroll:  'ui_scroll.ogg',
    // world
    cash:      'cash_pickup.ogg',
    register:  'register_break.ogg',
    glass:     'glass_break.ogg',
    hitFlesh:  'hit_flesh.ogg',
    hitArmor:  'hit_armor.ogg',
    meleeSwing:'melee_swing.ogg',
    meleeHit:  'melee_hit.ogg',
    metal:     'metal_hit.ogg',
    drill:     'drill.ogg',
    vault:     'vault_open.ogg',
    step:      'step.ogg',
    down:      'down.ogg',
    revive:    'revive.ogg',
    alarm:     'alarm.ogg',
    // firearms
    gunPistol: 'gun_pistol.wav',
    gunRifle:  'gun_rifle.wav',
    gunShotgun:'gun_shotgun.wav',
    gunHeavy:  'gun_heavy.wav',
  };

  const MUSIC = {
    planning: 'music/planning.ogg',   // menus, map, crew, armory
    heist:    'music/heist.mp3',      // in mission
  };

  let ctx = null, sfxBus = null, musicBus = null;
  const buffers = {};
  let ready = false, loading = null;

  // ---- music runs through <audio> so multi-MB tracks stream ----
  const players = {};
  let currentTrack = null;
  let fadeTimer = null;

  function init() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      sfxBus = ctx.createGain();
      sfxBus.gain.value = GH.settings.sfx;
      sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 1;
      musicBus.connect(ctx.destination);
      return true;
    } catch (e) { ctx = null; return false; }
  }

  function preload() {
    if (loading) return loading;
    if (!init()) return Promise.resolve();
    const names = Object.keys(SFX);
    loading = Promise.all(names.map(n =>
      fetch(BASE + 'sfx/' + SFX[n])
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then(b => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
        .then(buf => { buffers[n] = buf; })
        // A missing or undecodable clip must never break the game.
        .catch(() => { buffers[n] = null; })
    )).then(() => { ready = true; });
    return loading;
  }

  function resume() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    preload();
  }

  // rate/vol let one clip cover a family of weapons
  function play(name, opts) {
    if (!ctx || !ready) return;
    const buf = buffers[name];
    if (!buf) return;
    const o = opts || {};
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate || 1;
    const g = ctx.createGain();
    g.gain.value = (o.vol == null ? 1 : o.vol);
    src.connect(g); g.connect(sfxBus);
    src.start(0, o.offset || 0);
    return src;
  }

  // Slight random pitch stops repeated shots sounding like a machine.
  function playVaried(name, vol, spread) {
    const s = spread == null ? 0.09 : spread;
    play(name, { rate: 1 + (Math.random() * 2 - 1) * s, vol: vol == null ? 1 : vol });
  }

  function setSfxVolume(v) { if (sfxBus) sfxBus.gain.value = v; }
  function setMusicVolume(v) {
    Object.keys(players).forEach(k => {
      if (k === currentTrack) players[k].volume = v;
    });
  }

  function ensurePlayer(track) {
    if (players[track]) return players[track];
    const a = new Audio();
    a.src = BASE + MUSIC[track];
    a.loop = true;
    a.preload = 'none';
    a.volume = 0;
    players[track] = a;
    return a;
  }

  // Crossfade between tracks; a no-op if the track is already playing.
  function music(track) {
    if (currentTrack === track) return;
    const target = GH.settings.music;
    const from = currentTrack ? players[currentTrack] : null;
    currentTrack = track;
    if (!track) {
      if (from) fade(from, 0, 400, () => { from.pause(); });
      return;
    }
    const to = ensurePlayer(track);
    to.volume = 0;
    const p = to.play();
    if (p && p.catch) p.catch(() => {});   // autoplay blocked until a gesture
    if (from) fade(from, 0, 500, () => { from.pause(); });
    fade(to, target, 700);
  }

  function fade(el, to, ms, done) {
    const from = el.volume;
    const start = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / ms);
      try { el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); } catch (e) {}
      if (k < 1) requestAnimationFrame(tick);
      else if (done) done();
    };
    requestAnimationFrame(tick);
  }

  function stopMusic() { music(null); }

  // Map a weapon definition onto the closest recorded firearm, using
  // playback rate to separate light and heavy weapons from one clip.
  function weaponSound(w) {
    switch (w.kind) {
      case 'melee':     return null;
      case 'shotgun':   return { name: 'gunShotgun', rate: 1.0,  vol: 0.95 };
      case 'smg':       return { name: 'gunPistol',  rate: 1.28, vol: 0.55 };
      case 'pistol':    return { name: 'gunPistol',  rate: 1.0,  vol: 0.8 };
      case 'rifle':     return { name: 'gunRifle',   rate: 1.0,  vol: 0.75 };
      case 'lmg':       return { name: 'gunRifle',   rate: 1.18, vol: 0.6 };
      case 'explosive': return { name: 'gunHeavy',   rate: 0.62, vol: 1.0 };
      case 'energy':    return { name: 'gunHeavy',   rate: 1.7,  vol: 0.5 };
      case 'exotic':    return { name: 'gunHeavy',   rate: 0.5,  vol: 1.0 };
      default:          return { name: 'gunPistol',  rate: 1.0,  vol: 0.7 };
    }
  }

  GH.audio = {
    resume, preload, play, playVaried, music, stopMusic,
    setSfxVolume, setMusicVolume, weaponSound,
    get ctx() { return ctx; },
    get ready() { return ready; },
  };
})();

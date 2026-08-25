// ============================================================
// RoboKyle: Grand Heist — configuration tables
//
// Everything tunable lives here so the campaign can be balanced
// without touching engine code. The engine reads GH_DATA and
// never hard-codes a weapon, bank or enemy stat.
// ============================================================
window.GH_DATA = (() => {
  'use strict';

  // ==================== WEAPONS ====================
  // dmg      : damage per bullet (before the Shooting stat)
  // cd       : ms between shots
  // mag/reload: magazine size, reload time in ms
  // spread   : radians of cone (0 = laser accurate)
  // pellets  : projectiles per trigger pull
  // moveMod  : multiplier on move speed while equipped (heavy guns slow you)
  // silent   : true = does not trip the alarm
  const WEAPONS = {
    knife: {
      name: 'Knife', tier: 0, unlock: 1, cost: 0, kind: 'melee',
      dmg: 34, cd: 340, reach: 34, arc: 1.1, silent: true, moveMod: 1.06,
      color: '#C9CFDA',
      blurb: 'Free forever. Silent takedowns. The reason you can never soft-lock.',
    },
    bat: {
      name: 'Baseball Bat', tier: 0, unlock: 1, cost: 200, kind: 'melee',
      dmg: 58, cd: 460, reach: 46, arc: 1.5, silent: true, moveMod: 1.02,
      knockback: 7, color: '#B07C43',
      blurb: 'More damage, more reach, and it knocks them off their feet.',
    },
    glock: {
      name: 'Glock 17', tier: 1, unlock: 2, cost: 800, kind: 'pistol',
      dmg: 26, cd: 165, mag: 17, reload: 900, spread: 0.035, pellets: 1,
      speed: 13, range: 620, auto: false, moveMod: 1.0, color: '#F5E5A0',
      blurb: 'Your first gun. Semi-auto, reliable, loud.',
    },
    shotgun: {
      name: 'Pump Shotgun', tier: 2, unlock: 4, cost: 2000, kind: 'shotgun',
      dmg: 17, cd: 620, mag: 6, reload: 1300, spread: 0.30, pellets: 8,
      speed: 11, range: 300, auto: false, moveMod: 0.97, color: '#FF8A50',
      blurb: 'Devastating in a doorway. Useless across a lobby.',
    },
    smg: {
      name: 'MP5', tier: 3, unlock: 6, cost: 4500, kind: 'smg',
      dmg: 15, cd: 72, mag: 30, reload: 1050, spread: 0.10, pellets: 1,
      speed: 13, range: 520, auto: true, moveMod: 1.0, color: '#FFD070',
      blurb: 'Run-and-gun crowd control. The workhorse of the mid game.',
    },
    rifle: {
      name: 'Assault Rifle', tier: 4, unlock: 8, cost: 9000, kind: 'rifle',
      dmg: 30, cd: 105, mag: 30, reload: 1250, spread: 0.045, pellets: 1,
      speed: 15, range: 780, auto: true, moveMod: 0.98, color: '#FFC46B',
      blurb: 'Accurate, hits hard at range. The dependable all-rounder.',
    },
    lmg: {
      name: 'M249 LMG', tier: 5, unlock: 10, cost: 18000, kind: 'lmg',
      dmg: 26, cd: 68, mag: 100, reload: 2600, spread: 0.11, pellets: 1,
      speed: 15, range: 760, auto: true, moveMod: 0.84, color: '#FFB347',
      blurb: 'Huge belt, brutal suppression. Heavy, and slow to feed.',
    },
    rpg: {
      name: 'RPG-7', tier: 6, unlock: 12, cost: 30000, kind: 'explosive',
      dmg: 130, cd: 1100, mag: 1, reload: 1900, spread: 0, pellets: 1,
      speed: 9, range: 800, auto: false, moveMod: 0.88, color: '#FF5030',
      splash: 105, friendlyFire: true, breaches: true, ammoCost: 1500,
      blurb: 'Opens vault walls. Splash does not care whose crew you are.',
    },
    pulse: {
      name: 'Pulse Rifle', tier: 7, unlock: 14, cost: 60000, kind: 'energy',
      dmg: 40, cd: 96, heat: 1.9, cool: 2.2, spread: 0.03, pellets: 1,
      speed: 19, range: 900, auto: true, moveMod: 0.98, color: '#6FBFCB',
      pierceArmor: true,
      blurb: 'Overheats instead of reloading. Punches straight through armour.',
    },
    arc: {
      name: 'Arc Projector', tier: 8, unlock: 16, cost: 85000, kind: 'energy',
      dmg: 34, cd: 210, heat: 2.6, cool: 2.0, spread: 0.02, pellets: 1,
      speed: 22, range: 640, auto: true, moveMod: 0.96, color: '#9AD8FF',
      chain: 4, chainRange: 130, pierceArmor: true,
      blurb: 'Lightning jumps between anyone standing too close together.',
    },
    minigun: {
      name: 'Minigun', tier: 8, unlock: 17, cost: 98000, kind: 'lmg',
      dmg: 22, cd: 42, mag: 200, reload: 3400, spread: 0.14, pellets: 1,
      speed: 16, range: 700, auto: true, moveMod: 0.72, color: '#FFA23D',
      spinUp: 520,
      blurb: 'Spins up, then does not stop. You will not be outrunning anyone.',
    },
    plasma: {
      name: 'Plasma Cannon', tier: 9, unlock: 18, cost: 120000, kind: 'energy',
      dmg: 105, cd: 780, heat: 4.5, cool: 1.7, spread: 0.01, pellets: 1,
      speed: 12, range: 820, auto: false, moveMod: 0.80, color: '#C08BFF',
      splash: 90, pierceArmor: true, breaches: true,
      blurb: 'Slow, heavy, and it deletes whatever the bolt lands near.',
    },
    singularity: {
      name: '"Singularity" Cannon', tier: 10, unlock: 20, cost: 250000, kind: 'exotic',
      dmg: 240, cd: 1600, heat: 7, cool: 1.3, spread: 0, pellets: 1,
      speed: 8, range: 900, auto: false, moveMod: 0.76, color: '#FF7AF0',
      splash: 210, pierceArmor: true, breaches: true, pull: true,
      blurb: 'Collapses a room into a point. The reward for finishing the grind.',
    },
  };

  const WEAPON_ORDER = ['knife','bat','glock','shotgun','smg','rifle','lmg','rpg','pulse','arc','minigun','plasma','singularity'];

  // ==================== BAGS ====================
  // carry is in dollars.
  const BAGS = {
    none:      { name: 'No Bag',        cost: 0,     carry: 0,      moveMod: 1.00, blurb: 'Pockets only. Whatever your Carry stat gives you.' },
    moneybag:  { name: 'Money Bag',     cost: 500,   carry: 4000,   moveMod: 1.00, blurb: 'The classic. A solid bump for not much cash.' },
    duffel:    { name: 'Duffel Bag',    cost: 1500,  carry: 11000,  moveMod: 0.98, blurb: 'Big mouth, big haul.' },
    cart:      { name: 'Rolling Cart',  cost: 4000,  carry: 26000,  moveMod: 0.82, blurb: 'Enormous capacity. You will be slow leaving.' },
    nanopack:  { name: 'Nanofiber Pack',cost: 12000, carry: 42000,  moveMod: 1.00, blurb: 'Endgame luxury: haul everything, lose nothing.' },
  };
  const BAG_ORDER = ['none','moneybag','duffel','cart','nanopack'];

  // ==================== ARMOR ====================
  const ARMOR = {
    none:   { name: 'No Armour',   cost: 0,    dr: 0,    moveMod: 1.00, blurb: 'Fast and fragile.' },
    kevlar: { name: 'Kevlar Vest', cost: 1000, dr: 0.20, moveMod: 0.99, blurb: 'Takes the edge off a pistol round.' },
    heavy:  { name: 'Heavy Armour',cost: 5000, dr: 0.42, moveMod: 0.86, blurb: 'Soak real punishment, move like it.' },
    riot:   { name: 'Riot Shield', cost: 3000, dr: 0.30, moveMod: 0.90, frontal: 0.85, meleeOnly: true,
              blurb: 'Blocks almost everything from the front, but you can only swing melee.' },
  };
  const ARMOR_ORDER = ['none','kevlar','heavy','riot'];

  // ==================== MASKS ====================
  // Cosmetic identity, with deliberately tiny perks.
  const MASKS = {
    none:     { name: 'Bare Face', cost: 0,   color: null,      blurb: 'No mask. Bold.' },
    ski:      { name: 'Ski Mask',  cost: 150, color: '#22252C', blurb: 'Classic. Tellers give it up a touch faster.', perk: 'loot' },
    bandana:  { name: 'Bandana',   cost: 150, color: '#B4231C', blurb: 'Cheap and it looks good.' },
    balaclava:{ name: 'Balaclava', cost: 250, color: '#15171F', blurb: 'All business.' },
    clown:    { name: 'Clown Mask',cost: 400, color: '#F1E4D2', blurb: 'Unsettling. Very on-brand.', trim: '#E3552B' },
    hockey:   { name: 'Hockey Mask',cost:400, color: '#E8E2D0', blurb: 'Nothing about this is subtle.', trim: '#7C6459' },
    skull:    { name: 'Skull Mask',cost: 650, color: '#EDE6D6', blurb: 'Nearby enemies flinch a little.', perk: 'fear', trim: '#2A2320' },
    pig:      { name: 'Pig Mask',  cost: 650, color: '#E7A0A8', blurb: 'Why not.', trim: '#C4707C' },
    gas:      { name: 'Gas Mask',  cost: 900, color: '#3E4A3A', blurb: 'Military surplus, menacing.', trim: '#6FBFCB' },
  };
  const MASK_ORDER = ['none','ski','bandana','balaclava','clown','hockey','skull','pig','gas'];

  // Outfit colours crew can wear. Purely identity.
  const OUTFITS = [
    { name: 'Charcoal', color: '#2A2E38' },
    { name: 'Oxblood',  color: '#5A1D1D' },
    { name: 'Forest',   color: '#26382A' },
    { name: 'Navy',     color: '#1E2A44' },
    { name: 'Sand',     color: '#6B5A3E' },
    { name: 'Plum',     color: '#3A2440' },
    { name: 'Slate',    color: '#38424A' },
    { name: 'Rust',     color: '#6B3A24' },
  ];

  const SKIN_TONES = ['#D9A97A', '#C08B5E', '#8D5A38', '#6B4226', '#E8C39E', '#A87249'];

  // ==================== ENEMIES ====================
  // 'wpn' names an entry in ENEMY_WEAPONS.
  const ENEMIES = {
    guard_baton: {
      name: 'Security Guard', hp: 55, speed: 1.05, r: 14, wpn: 'baton',
      body: '#3A4450', accent: '#5A6470', dr: 0, points: 10,
    },
    guard_pistol: {
      name: 'Armed Guard', hp: 70, speed: 1.05, r: 14, wpn: 'e_pistol',
      body: '#3A4450', accent: '#6A7480', dr: 0, points: 15,
    },
    guard_smg: {
      name: 'Bank Security', hp: 95, speed: 1.1, r: 14, wpn: 'e_smg',
      body: '#333C46', accent: '#6FBFCB', dr: 0.08, points: 22,
    },
    guard_rifle: {
      name: 'Private Security', hp: 125, speed: 1.1, r: 15, wpn: 'e_rifle',
      body: '#2E3640', accent: '#8FA0AE', dr: 0.14, points: 30,
    },
    cop: {
      name: 'Beat Cop', hp: 65, speed: 1.15, r: 14, wpn: 'e_revolver',
      body: '#1E3A6B', accent: '#3E6BAE', dr: 0, points: 15,
    },
    riot: {
      name: 'Riot Cop', hp: 110, speed: 0.92, r: 15, wpn: 'e_pistol',
      body: '#1A2E52', accent: '#4E7ABE', dr: 0.10, points: 25,
      shield: true, frontalDR: 0.80,
    },
    swat: {
      name: 'SWAT', hp: 140, speed: 1.22, r: 15, wpn: 'e_smg',
      body: '#1A1D24', accent: '#4A5560', dr: 0.22, points: 40,
    },
    heavy: {
      name: 'Heavy SWAT', hp: 240, speed: 0.98, r: 17, wpn: 'e_rifle',
      body: '#14161C', accent: '#7C6459', dr: 0.40, points: 70,
      flashbang: true,
    },
    // ---- boss units ----
    captain: {
      name: 'Bank Captain', hp: 900, speed: 0.90, r: 22, wpn: 'e_shotgun',
      body: '#4A2E22', accent: '#E3552B', dr: 0.30, points: 400,
      boss: true, rally: true,
    },
    nest: {
      name: 'Minigun Nest', hp: 1500, speed: 0, r: 26, wpn: 'e_minigun',
      body: '#2A2E24', accent: '#FFA23D', dr: 0.50, points: 700,
      boss: true, static: true,
    },
    apc: {
      name: 'Police APC', hp: 2600, speed: 0.42, r: 34, wpn: 'e_cannon',
      body: '#1A2432', accent: '#6FBFCB', dr: 0.58, points: 1200,
      boss: true, vehicle: true,
    },
    warden: {
      name: 'The Warden', hp: 4200, speed: 1.05, r: 26, wpn: 'e_rifle',
      body: '#20161C', accent: '#FF7AF0', dr: 0.55, points: 2500,
      boss: true, rally: true, flashbang: true,
    },
  };

  const ENEMY_WEAPONS = {
    baton:      { melee: true, dmg: 11, cd: 700, reach: 30 },
    e_revolver: { dmg: 9,  cd: 900, spread: 0.10, pellets: 1, speed: 9,  range: 420, burst: 1 },
    e_pistol:   { dmg: 10, cd: 760, spread: 0.09, pellets: 1, speed: 10, range: 470, burst: 2 },
    e_shotgun:  { dmg: 8,  cd: 1100,spread: 0.34, pellets: 6, speed: 9,  range: 260, burst: 1 },
    e_smg:      { dmg: 7,  cd: 105, spread: 0.13, pellets: 1, speed: 11, range: 520, burst: 5 },
    e_rifle:    { dmg: 13, cd: 190, spread: 0.07, pellets: 1, speed: 13, range: 640, burst: 3 },
    e_minigun:  { dmg: 9,  cd: 70,  spread: 0.16, pellets: 1, speed: 12, range: 640, burst: 14 },
    e_cannon:   { dmg: 34, cd: 1800,spread: 0.02, pellets: 1, speed: 10, range: 720, burst: 1, splash: 80 },
  };

  // ==================== BANKS ====================
  // guards      : how many pre-placed guards inside
  // guardWpn    : which ENEMIES key those guards use
  // copWaves    : enemy keys the police draw from, with weights
  // respond     : seconds from alarm to police arriving
  // breach      : seconds after police arrive before SWAT storms the building
  // haul        : approximate total cash in the building
  // size        : 'small' | 'mid' | 'large' | 'huge' — drives layout generation
  // drill       : seconds to drill the vault
  const BANKS = [
    { id: 1,  name: 'Pawn & Loan',              act: 1, size: 'small', guards: 1, guardWpn: 'guard_baton',
      copWaves: [], respond: 90, breach: 70, haul: 1210, drill: 12, atms: 1, vaults: 1,
      blurb: 'A counter, a back room, and one bored guard with a stick. Everybody starts here.' },

    { id: 2,  name: 'Corner Credit Union',      act: 1, size: 'small', guards: 2, guardWpn: 'guard_baton',
      copWaves: [['cop', 1]], respond: 80, breach: 68, haul: 2090, drill: 14, atms: 1, vaults: 1,
      blurb: 'First real gunfight. Beat cops roll up slow and shoot slower.' },

    { id: 3,  name: 'Suburb Savings',           act: 1, size: 'small', guards: 3, guardWpn: 'guard_pistol',
      copWaves: [['cop', 1]], respond: 70, breach: 66, haul: 3300, drill: 15, atms: 1, vaults: 1, boxes: 3,
      blurb: 'Deposit boxes in the back for anyone willing to go deeper.' },

    { id: 4,  name: 'Midtown Trust',            act: 1, size: 'mid',   guards: 3, guardWpn: 'guard_pistol',
      copWaves: [['cop', 2], ['riot', 1]], respond: 60, breach: 64, haul: 4840, drill: 17, atms: 2, vaults: 1, boxes: 4,
      blurb: 'Riot shields show up. Get around them or get nowhere.' },

    { id: 5,  name: 'First National',           act: 1, size: 'mid',   guards: 4, guardWpn: 'guard_pistol',
      copWaves: [['riot', 2], ['cop', 1]], respond: 50, breach: 62, haul: 8800, drill: 20, atms: 2, vaults: 1, boxes: 4,
      boss: 'captain', bossName: 'Bank Captain',
      blurb: 'ACT ONE FINALE. An armoured captain holds the vault floor and rallies the guards.' },

    { id: 6,  name: 'Harbor Federal',           act: 2, size: 'mid',   guards: 4, guardWpn: 'guard_pistol',
      copWaves: [['riot', 2], ['swat', 1]], respond: 40, breach: 60, haul: 6500, drill: 18, atms: 2, vaults: 1, boxes: 4,
      blurb: 'SWAT debuts. They move as a unit and they actually aim.' },

    { id: 7,  name: 'Uptown Holdings',          act: 2, size: 'large', guards: 4, guardWpn: 'guard_pistol',
      copWaves: [['swat', 2], ['riot', 1]], respond: 38, breach: 58, haul: 8500, drill: 20, atms: 2, vaults: 1, boxes: 5,
      blurb: 'Big floor plan. The vault is a long, exposed run from the door.' },

    { id: 8,  name: 'Diamond Exchange',         act: 2, size: 'large', guards: 5, guardWpn: 'guard_smg',
      copWaves: [['swat', 3], ['riot', 1]], respond: 36, breach: 56, haul: 11000, drill: 22, atms: 2, vaults: 1, boxes: 6,
      blurb: 'Guards carry SMGs now. The gear gap starts to bite.' },

    { id: 9,  name: 'Continental Bank',         act: 2, size: 'large', guards: 5, guardWpn: 'guard_smg',
      copWaves: [['swat', 3], ['heavy', 1]], respond: 34, breach: 54, haul: 14000, drill: 20, atms: 2, vaults: 2, boxes: 6,
      blurb: 'Two vaults. Twice the drilling, twice the exposure, twice the money.' },

    { id: 10, name: 'Gold Reserve Depository',  act: 2, size: 'large', guards: 6, guardWpn: 'guard_smg',
      copWaves: [['heavy', 2], ['swat', 2]], respond: 32, breach: 52, haul: 24000, drill: 24, atms: 3, vaults: 2, boxes: 6,
      boss: 'nest', bossName: 'Minigun Nest',
      blurb: 'ACT TWO FINALE. A minigun nest covers the street between you and the car.' },

    { id: 11, name: 'Skyline Private Bank',     act: 3, size: 'large', guards: 5, guardWpn: 'guard_smg',
      copWaves: [['heavy', 2], ['swat', 3]], respond: 30, breach: 50, haul: 20000, drill: 22, atms: 3, vaults: 2, boxes: 7,
      blurb: 'Private money, private army. Everything here is tougher than it looks.' },

    { id: 12, name: 'The Vault Club',           act: 3, size: 'huge',  guards: 6, guardWpn: 'guard_smg',
      copWaves: [['heavy', 3], ['swat', 3]], respond: 28, breach: 48, haul: 27000, drill: 25, atms: 3, vaults: 2, boxes: 8,
      breachWalls: true,
      blurb: 'Some walls here are thin enough to blow. An RPG turns the layout inside out.' },

    { id: 13, name: 'Metro Central',            act: 3, size: 'huge',  guards: 6, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 3], ['swat', 3]], respond: 26, breach: 46, haul: 34000, drill: 26, atms: 3, vaults: 2, boxes: 8,
      breachWalls: true,
      blurb: 'Flashbangs come standard. Expect to fight half-blind.' },

    { id: 14, name: 'Titan National',           act: 3, size: 'huge',  guards: 7, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 4], ['swat', 2]], respond: 25, breach: 44, haul: 44000, drill: 28, atms: 3, vaults: 2, boxes: 9,
      breachWalls: true,
      blurb: 'Armour everywhere. Bring something that punches through it.' },

    { id: 15, name: 'The Federal Reserve',      act: 3, size: 'huge',  guards: 8, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 4], ['swat', 3]], respond: 25, breach: 42, haul: 78000, drill: 30, atms: 3, vaults: 2, boxes: 9,
      boss: 'apc', bossName: 'Police APC', breachWalls: true,
      blurb: 'ACT THREE FINALE. An APC parks itself on your extraction and dares you to leave.' },

    { id: 16, name: 'Fort Knox Annex',          act: 4, size: 'huge',  guards: 8, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 5], ['swat', 3]], respond: 25, breach: 40, haul: 88000, drill: 30, atms: 3, vaults: 2, boxes: 10,
      breachWalls: true,
      blurb: 'Post-campaign. The response never really stops coming.' },

    { id: 17, name: 'Blacksite Depository',     act: 4, size: 'huge',  guards: 9, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 5], ['swat', 3]], respond: 25, breach: 38, haul: 100000, drill: 31, atms: 3, vaults: 2, boxes: 10,
      breachWalls: true,
      blurb: 'Officially this building does not exist. Neither will you.' },

    { id: 18, name: 'The Gilded Vault',         act: 4, size: 'huge',  guards: 9, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 6], ['swat', 3]], respond: 25, breach: 36, haul: 115000, drill: 32, atms: 3, vaults: 3, boxes: 11,
      breachWalls: true,
      blurb: 'Three vaults, and enough gold to buy something that fires plasma.' },

    { id: 19, name: 'Continental Reserve',      act: 4, size: 'huge',  guards: 10, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 6], ['swat', 4]], respond: 25, breach: 34, haul: 130000, drill: 33, atms: 3, vaults: 3, boxes: 11,
      breachWalls: true,
      blurb: 'The last stop before the big one. Treat it as a dress rehearsal.' },

    { id: 20, name: 'The Treasury',             act: 4, size: 'huge',  guards: 10, guardWpn: 'guard_rifle',
      copWaves: [['heavy', 7], ['swat', 4]], respond: 25, breach: 32, haul: 190000, drill: 35, atms: 3, vaults: 3, boxes: 12,
      boss: 'warden', bossName: 'The Warden', breachWalls: true,
      blurb: 'THE FINALE. The Warden runs the federal response personally. Clear it and the Singularity is yours.' },
  ];

  // ==================== CREW NAME GENERATOR ====================
  const HANDLES = ['Switch','Ghost','Tank','Diesel','Slugs','Fingers','Vic','Reaper','Nova','Chains',
                   'Wiz','Ace','Kilo','Bishop','Frost','Rico','Tex','Marbles','Static','Dutch',
                   'Cinder','Nickel','Whisper','Bones','Torch','Grip','Sable','Dodger','Havoc','Pike'];
  const PREFIXES = ['Lil','Big','Mad','Slick','Uncle','Cold','Quiet','Fast'];
  const FIRSTS   = ['Vince','Danny','Marco','Ruby','Sal','Otis','June','Kade','Nadia','Cyrus','Wes','Lena'];
  const TAGS     = ['Two-Time','The Drill','Nine Lives','No-Knock','Half-Past','The Nail','Sunday','Clockwork','Loose Change','The Hinge'];

  // ==================== TRAITS ====================
  const TRAITS = {
    none:        { name: '—',             blurb: 'No standout quirk.' },
    triggerhappy:{ name: 'Trigger Happy', blurb: 'Fires faster, reloads slower.', fireRate: 0.85, reloadRate: 1.25 },
    mule:        { name: 'Mule',          blurb: 'Carries more, moves slower.',   carryMul: 1.35, moveMul: 0.90 },
    sponge:      { name: 'Bullet Sponge', blurb: 'Tougher, but a worse shot.',    hpMul: 1.30, shootMul: 0.85 },
    cheapskate:  { name: 'Cheapskate',    blurb: 'Their gear costs 10% less.',    discount: 0.10 },
    lucky:       { name: 'Lucky',         blurb: 'Sometimes survives a fatal hit at 1 HP.', cheatDeath: 0.30 },
  };
  const TRAIT_KEYS = ['none','triggerhappy','mule','sponge','cheapskate','lucky'];

  // ==================== TUNING ====================
  // Optional side loot, as a share of what it costs to crack it open.
  const LOOT = {
    walletMin: 20,      // a customer's pocket money
    walletMax: 85,
    tellerWalletMax: 40,
    atmMin: 260,        // an ATM is worth cracking, and takes longer
    atmMax: 640,
    atmDrill: 4200,     // ms to lever one open
  };

  // Morale. Crew who watch bystanders get shot stop being much use.
  const MORALE = {
    start: 100,
    min: 0,
    civilianKill: -26,      // per civilian killed, to everyone on the job
    crewDeath: -14,         // watching a friend die
    failedJob: -10,
    cleanBonus: 8,          // no civilians harmed, job completed
    benchRecovery: 12,      // per completed job spent on the bench
    benchHealFrac: 0.30,    // and this much max HP back
    // Below `comfortable` morale starts biting; at 0 they are barely useful.
    comfortable: 70,
    worstMultiplier: 0.55,
  };

  const TUNE = {
    // Per-point stat gains, as documented in the design.
    shootDmgPerPoint: 0.08,     // +8% damage
    shootSpreadPerPoint: 0.055, // spread shrinks by this fraction per point
    hpPerPoint: 15,
    carryPerPoint: 1800,        // dollars of carry per Carry point

    roboStart: { hp: 120, shooting: 3, carry: 3 },
    crewStart: { min: 1, max: 3 },

    rosterCap: 8,
    crewPerHeist: 3,

    xpPerLevel: 100,            // level N -> N+1 costs 100 * N
    xpPerKill: 12,
    xpPerCashUnit: 1 / 250,     // xp per dollar carried out
    xpSurvive: 40,

    reviveTime: 1400,           // ms channelling a revive
    downedBleedout: 14000,      // ms before a downed crew member dies
    roboSelfRevive: 5000,       // ms for RoboKyle's once-per-heist self revive

    regenDelay: 4200,           // ms out of combat before regen starts
    regenRate: 5.5,             // hp per second

    hireBaseCost: 0,            // first re-hire free (arcade)
    hireCostPerBank: 220,

    copWaveInterval: 15000,     // ms between police waves once they arrive
    copWaveSizeBase: 3,
    copWaveSizeGrowth: 0.6,
    maxEnemies: 34,             // performance cap for in-browser

    healCostPerHp: 14,          // patching crew up between jobs
  };

  return {
    WEAPONS, WEAPON_ORDER, BAGS, BAG_ORDER, ARMOR, ARMOR_ORDER,
    MASKS, MASK_ORDER, OUTFITS, SKIN_TONES,
    ENEMIES, ENEMY_WEAPONS, BANKS,
    HANDLES, PREFIXES, FIRSTS, TAGS, TRAITS, TRAIT_KEYS, TUNE, LOOT, MORALE,
  };
})();

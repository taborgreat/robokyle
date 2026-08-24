#!/usr/bin/env node
/* Delta A/F: the 24 body-site standards, shipped official.
 *
 *   node scripts/seed-body-sites.js [--user robokyle]
 *
 * The human body is the root interface of every assistive device, so body
 * sites are standards in the ports system, namespaced body:*. Idempotent:
 * a site that already exists (by port name) is updated in place, so re-running
 * after editing the kits below is safe. Owned by a system account, created if
 * missing, so no personal account farms publish XP from seeding.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const mongoose = require('mongoose');
const Design = require('../models/Design');
const User = require('../models/User');

const LIMB = [
  { name: 'circumference-range', unit: 'cm', required: true },
  { name: 'one-handed-donning', unit: 'bool', required: true },
  { name: 'max-load', unit: 'N', required: false },
];
const RESIDUAL = [...LIMB, { name: 'residual-length-min', unit: 'cm', required: true }];
const FRAME = [
  { name: 'tube-diameter-range', unit: 'mm', required: true },
  { name: 'clamp-style', unit: 'text', required: false },
];

/* [portName, title, description, fields] */
const SITES = [
  // Upper limb: the site's center of gravity
  ['body:finger', 'Body site: finger', 'Splints and small tool rings.', LIMB],
  ['body:thumb', 'Body site: thumb', 'Thumb opposition devices, their own world apart from fingers.', LIMB],
  ['body:hand', 'Body site: hand', 'Palm and dorsal mounting: universal cuffs, grip aids.', LIMB],
  ['body:partial-hand', 'Body site: partial hand', 'Partial hand absence. Fit logic inverts from the hand site.', RESIDUAL],
  ['body:wrist', 'Body site: wrist', 'Cuffs and cradles. The FACTUM mount site.', LIMB],
  ['body:forearm', 'Body site: forearm', 'Sleeves, larger cradles, myo band zones.', LIMB],
  ['body:elbow', 'Body site: elbow', 'Elbow orthoses and mounts.', LIMB],
  ['body:upper-arm', 'Body site: upper arm', 'Upper arm cuffs and anchors.', LIMB],
  ['body:transradial', 'Body site: transradial', 'Below elbow residual limb.', RESIDUAL],
  ['body:transhumeral', 'Body site: transhumeral', 'Above elbow residual limb.', RESIDUAL],
  ['body:shoulder', 'Body site: shoulder', 'Harness anchoring and shoulder disarticulation.', LIMB],
  // Lower limb
  ['body:foot', 'Body site: foot', 'Foot orthoses and pedal adaptations.', LIMB],
  ['body:ankle', 'Body site: ankle', 'AFOs and ankle supports.', LIMB],
  ['body:knee', 'Body site: knee', 'Knee orthoses.', LIMB],
  ['body:thigh', 'Body site: thigh', 'Thigh cuffs and anchors.', LIMB],
  ['body:transtibial', 'Body site: transtibial', 'Below knee residual limb.', RESIDUAL],
  ['body:transfemoral', 'Body site: transfemoral', 'Above knee residual limb.', RESIDUAL],
  // Head and torso
  ['body:head', 'Body site: head', 'Head pointers, switch mounts, eye tracker hardware.', LIMB],
  ['body:neck', 'Body site: neck', 'Lanyards and brace mounted tools.', LIMB],
  ['body:torso', 'Body site: torso', 'Vests and chest harnesses.', LIMB],
  ['body:waist', 'Body site: waist', 'Belts and pouch systems.', LIMB],
  // Equipment-adjacent: mounting to the user's gear is mounting to the user
  ['body:chair-frame', 'Body site: wheelchair frame', 'Wheelchair tube and frame mounting.', FRAME],
  ['body:chair-tray', 'Body site: wheelchair tray', 'Tray surface mounting.', FRAME],
  ['body:walker-frame', 'Body site: walker frame', 'Walker tube mounting.', FRAME],
  ['body:table-edge', 'Body site: table edge', 'Clamp on desk and table devices. The environment mount workhorse.', FRAME],
];

async function main() {
  const username = process.argv.includes('--user')
    ? process.argv[process.argv.indexOf('--user') + 1] : 'robokyle';
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/robokyle');

  let owner = await User.findOne({ usernameLower: username.toLowerCase() });
  if (!owner) {
    owner = new User({ username, email: `${username}@system.local`, emailVerified: true });
    await owner.setPassword(crypto.randomBytes(24).toString('hex'));   // unguessable; log in via admin reset if ever needed
    await owner.save();
    console.log(`created system account ${username}`);
  }

  let created = 0, updated = 0;
  for (const [portName, title, description, fields] of SITES) {
    const existing = await Design.findOne({ type: 'standard', 'standard.portName': portName });
    if (existing) {
      existing.title = title;
      existing.description = description;
      existing.standard.fields = fields;
      await existing.save();
      updated++;
    } else {
      const work = new Design({
        title, description,
        type: 'standard',
        standard: { portName, fields },
        author: owner._id,
        categories: [{ id: 'abil', weight: 60 }, { id: 'docs', weight: 40 }],
        needTags: [],
        steps: [{ title: 'What this site is', body: description }],
      });
      work.root = work._id;
      work.syncUses();
      await work.save();
      created++;
    }
  }
  console.log(`${created} body site(s) created, ${updated} updated, owner: ${owner.username}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());

#!/usr/bin/env node
/* Stored files that nothing references any more.
 *
 *   node scripts/gc.js            show what would go
 *   node scripts/gc.js --delete   remove them
 *
 * The server does this on its own every few hours; this is for looking, or for
 * reclaiming space now. Files touched in the last hour are left alone: one may
 * belong to an upload still in flight.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Design = require('../models/Design');

async function main() {
  const dryRun = !process.argv.includes('--delete');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/robokyle');

  const r = await Design.sweepOrphanBlobs({ minAgeMinutes: 60, dryRun });

  console.log(`${r.kept} file(s) referenced and kept.`);
  console.log(`${r.removed} orphan(s), ${(r.bytes / 1e6).toFixed(1)} MB${dryRun ? ' (run with --delete to remove)' : ' removed'}.`);
  if (r.temp) console.log(`${r.temp} abandoned upload(s) in tmp/${dryRun ? '' : ' removed'}.`);
  if (r.missing.length) {
    console.log(`\n${r.missing.length} file(s) are referenced but missing from the store:`);
    for (const name of r.missing) console.log(`  ${name}`);
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());

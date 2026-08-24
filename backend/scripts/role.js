#!/usr/bin/env node
/* Promote or demote an account from the command line.
 *
 *   node scripts/role.js kyle            -> make kyle an admin
 *   node scripts/role.js kyle user       -> take it back
 *   node scripts/role.js --list          -> show every account and its role
 *
 * Accepts a username or an email. Admins are the only accounts that may upload
 * files while UPLOADS_ADMIN_ONLY is on.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/robokyle';
const ROLES = ['user', 'admin'];

async function main() {
  const [who, role = 'admin'] = process.argv.slice(2);

  if (!who || who === '--help' || who === '-h') {
    console.log('Usage: node scripts/role.js <username|email> [admin|user]');
    console.log('       node scripts/role.js --list');
    process.exitCode = who ? 0 : 1;
    return;
  }

  await mongoose.connect(MONGO_URI);

  if (who === '--list' || who === '-l') {
    const users = await User.find().sort({ role: 1, username: 1 });
    if (!users.length) return console.log('No accounts yet.');
    const pad = Math.max(...users.map(u => u.username.length));
    for (const u of users) console.log(`${u.role === 'admin' ? '*' : ' '} ${u.username.padEnd(pad)}  ${u.role}  ${u.email}`);
    console.log(`\n${users.filter(u => u.role === 'admin').length} admin(s) of ${users.length} account(s).`);
    return;
  }

  if (!ROLES.includes(role)) {
    throw new Error(`Role must be one of: ${ROLES.join(', ')}`);
  }

  const key = who.includes('@') ? { email: who.toLowerCase() } : { username: who };
  const user = await User.findOne(key);
  if (!user) throw new Error(`No account matches "${who}". Try --list.`);

  if (user.role === role) {
    console.log(`${user.username} is already ${role}. Nothing to do.`);
    return;
  }

  const before = user.role;
  user.role = role;
  await user.save();
  console.log(`${user.username}: ${before} -> ${role}`);
}

main()
  .catch(err => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());

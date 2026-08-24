const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { UNVERIFIED_TTL_HOURS } = require('../lib/limits');

// The link is worth exactly as long as the unverified account itself.
const VERIFY_TTL_HOURS = UNVERIFIED_TTL_HOURS;
const VERIFY_TTL_MS = VERIFY_TTL_HOURS * 3600 * 1000;

// bcrypt silently ignores anything past 72 bytes, so two different long
// passwords would hash the same. Refuse them instead of pretending.
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72;

const userSchema = new mongoose.Schema({
  username: {
    type: String, required: true, unique: true, trim: true,
    minlength: 3, maxlength: 32, match: /^[a-zA-Z0-9_\-]+$/,
  },
  // Names are compared case-insensitively: "Kyle" must not be able to sit
  // alongside "kyle" and be mistaken for them. This is the field that is
  // actually unique; `username` keeps whatever capitalisation was chosen.
  usernameLower: { type: String, required: true, unique: true, lowercase: true, index: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  // Google-only accounts never set a password, so this cannot be required outright.
  passwordHash: { type: String },
  // Google tells us the address is real; local sign-ups have to prove it.
  googleId: { type: String, index: { unique: true, sparse: true } },
  emailVerified: { type: Boolean, default: false },
  // Only the hash is stored, so a database leak cannot be used to verify accounts.
  verifyTokenHash: String,
  verifyTokenExpires: Date,
  verifySentAt: Date,
  bio: { type: String, trim: true, maxlength: 600, default: '' },
  /* Delta B: equipment the member owns, from the curated vocabulary. Private:
     never serialized to other viewers; works derive a buildable-by-you flag. */
  equipment: { type: [String], default: [] },
  /* Cached XP totals: { cats: {mech: n, ...}, workXp, socialXp, updatedAt }.
     A pure cache — lib/xp.js recomputes it from the works themselves. */
  xp: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  /* Granular capabilities on top of `role` — currently just 'mod'. Powers are
     expressed as capability checks in lib/permissions.js, never as role
     checks in routes, so governance evolves without schema churn. */
  roles: { type: [String], default: [] },
}, { timestamps: true });

userSchema.pre('validate', function (next) {
  if (this.username) this.usernameLower = this.username.toLowerCase();
  if (!this.passwordHash && !this.googleId) {
    const err = new Error('A password or a Google account is required');
    err.name = 'ValidationError';   // routes map this to a 400
    return next(err);
  }
  next();
});

userSchema.methods.setPassword = async function (password) {
  const err = this.constructor.checkPasswordRules(password);
  if (err) {
    const e = new Error(err);
    e.name = 'ValidationError';
    throw e;
  }
  this.passwordHash = await bcrypt.hash(String(password), 12);
};

/* Returns an error message, or null when the password is usable. */
userSchema.statics.checkPasswordRules = function (password) {
  if (typeof password !== 'string') return 'Password must be text';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} characters`;
  }
  return null;
};

/* Spends about as long as a real check would, so a wrong username and a wrong
   password take the same time to answer and neither can be told apart. */
const DUMMY_HASH = bcrypt.hashSync('robokyle-no-such-account', 12);
userSchema.statics.burnPasswordTime = async function () {
  await bcrypt.compare('x', DUMMY_HASH);
  return false;
};

/* One place that knows how a sign-in name is matched: either form, any case. */
userSchema.statics.findByLogin = function (identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return Promise.resolve(null);
  return this.findOne(id.includes('@') ? { email: id } : { usernameLower: id });
};

userSchema.methods.checkPassword = function (password) {
  if (!this.passwordHash) return Promise.resolve(false);  // Google-only account
  return bcrypt.compare(password, this.passwordHash);
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Returns the raw token to put in the email. Only its hash is kept here.
userSchema.methods.startEmailVerification = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.verifyTokenHash = hashToken(token);
  // A resend late in the window gets a token that dies with the account, not one
  // that outlives it and reads as valid after the row is gone.
  const accountDeadline = (this.createdAt ? this.createdAt.getTime() : Date.now()) + VERIFY_TTL_MS;
  this.verifyTokenExpires = new Date(Math.min(Date.now() + VERIFY_TTL_MS, accountDeadline));
  this.verifySentAt = new Date();
  return token;
};

userSchema.methods.clearEmailVerification = function () {
  this.emailVerified = true;
  this.verifyTokenHash = undefined;
  this.verifyTokenExpires = undefined;
};

userSchema.statics.findByVerifyToken = function (token) {
  if (!token || typeof token !== 'string') return null;
  return this.findOne({
    verifyTokenHash: hashToken(token),
    verifyTokenExpires: { $gt: new Date() },
  });
};

// Turns an email or display name into a free username: "kyle", then "kyle2", ...
userSchema.statics.availableUsername = async function (seed) {
  let base = String(seed || '').split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 28);
  if (base.length < 3) base = `user${base}`.slice(0, 28);
  for (let n = 0; n < 200; n++) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    if (!(await this.exists({ usernameLower: candidate.toLowerCase() }))) return candidate;
  }
  return `user${crypto.randomBytes(4).toString('hex')}`;
};

userSchema.methods.toPublic = function () {
  const { levelsOf, chipFor } = require('../lib/xp');
  return {
    levels: levelsOf(this).levels,
    totalLevel: levelsOf(this).totalLevel,
    chip: chipFor(this),
    id: this._id,
    username: this.username,
    bio: this.bio || '',
    role: this.role,
    roles: this.roles || [],
    emailVerified: this.emailVerified,
    hasPassword: !!this.passwordHash,
    google: !!this.googleId,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.VERIFY_TTL_HOURS = VERIFY_TTL_HOURS;

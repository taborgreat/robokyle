const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { UNVERIFIED_TTL_HOURS } = require('../lib/limits');

// The link is worth exactly as long as the unverified account itself.
const VERIFY_TTL_HOURS = UNVERIFIED_TTL_HOURS;
const VERIFY_TTL_MS = VERIFY_TTL_HOURS * 3600 * 1000;

const userSchema = new mongoose.Schema({
  username: {
    type: String, required: true, unique: true, trim: true,
    minlength: 3, maxlength: 32, match: /^[a-zA-Z0-9_\-]+$/,
  },
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
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
}, { timestamps: true });

userSchema.pre('validate', function (next) {
  if (!this.passwordHash && !this.googleId) {
    const err = new Error('A password or a Google account is required');
    err.name = 'ValidationError';   // routes map this to a 400
    return next(err);
  }
  next();
});

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 12);
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
    if (!(await this.exists({ username: candidate }))) return candidate;
  }
  return `user${crypto.randomBytes(4).toString('hex')}`;
};

userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    username: this.username,
    bio: this.bio || '',
    role: this.role,
    emailVerified: this.emailVerified,
    hasPassword: !!this.passwordHash,
    google: !!this.googleId,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.VERIFY_TTL_HOURS = VERIFY_TTL_HOURS;

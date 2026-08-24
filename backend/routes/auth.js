const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const mail = require('../lib/mail');
const { signToken, requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { purgeUnverified } = require('../lib/cleanup');

const router = express.Router();

/* Every field arrives from the network, so it is coerced to a string before it
   is used. Without this a body like {"username":{"$ne":null}} reaches Mongo as
   a query operator instead of a name. */
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Guessing a password and flooding sign-ups are the two things worth slowing.
const signInLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many sign-in attempts. Try again in a few minutes.' });
const signUpLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many accounts from here. Try again later.' });

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const RESEND_COOLDOWN_MS = 60 * 1000;

// POST /api/auth/register  { username, email, password }
router.post('/register', signUpLimit, async (req, res, next) => {
  try {
    const username = str(req.body && req.body.username);
    const email = str(req.body && req.body.email).toLowerCase();
    const password = (req.body || {}).password;

    if (!username || !email || typeof password !== 'string') {
      return res.status(400).json({ error: 'username, email and password are required' });
    }
    const badPassword = User.checkPasswordRules(password);
    if (badPassword) return res.status(400).json({ error: badPassword });

    // An abandoned sign-up must not hold a name for ever. If the clash is with
    // an unverified account that is already past its window, clear it out now
    // rather than waiting for the next sweep.
    const clash = await User.findOne({ $or: [{ usernameLower: username.toLowerCase() }, { email }] });
    if (clash) {
      await purgeUnverified();
      const stillThere = await User.findOne({ _id: clash._id });
      if (stillThere) return res.status(409).json(await takenResponse(stillThere, username, email));
    }

    const user = new User({ username, email });
    await user.setPassword(password);
    const token = user.startEmailVerification();
    await user.save();

    // Signed in right away, but unverified: they can look around, not post.
    const delivery = await mail.sendVerification(user, token);
    res.status(201).json({
      token: signToken(user),
      user: user.toPublic(),
      verification: { sent: delivery.sent, link: delivery.link },
    });
  } catch (err) {
    // Two people registering the same name at the same moment both pass the
    // check above; the unique index is what actually decides it.
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || '';
      return res.status(409).json(field === 'email'
        ? { error: 'That email already has an account. Log in instead.' }
        : { error: 'That username is taken', suggestion: await User.availableUsername(str(req.body.username)) });
    }
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

/* Says which half clashed, and offers a free name when it was the username. */
async function takenResponse(existing, username, email) {
  if (existing.email === email) {
    return { error: 'That email already has an account. Log in instead.' };
  }
  return { error: `The name "${username}" is taken`, suggestion: await User.availableUsername(username) };
}

// POST /api/auth/login  { username | email, password }
router.post('/login', signInLimit, async (req, res, next) => {
  try {
    const identifier = str(req.body && req.body.username) || str(req.body && req.body.email);
    const password = (req.body || {}).password;
    if (!identifier || typeof password !== 'string') {
      return res.status(400).json({ error: 'username/email and password are required' });
    }

    const user = await User.findByLogin(identifier);
    const ok = user ? await user.checkPassword(password) : await User.burnPasswordTime();
    if (!user || !ok) {
      // A Google-only account has no password to check, so say what to do next.
      if (user && user.googleId && !user.passwordHash) {
        return res.status(401).json({ error: 'This account uses Google sign-in' });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) { next(err); }
});

// POST /api/auth/google  { credential }  -- the ID token from Google Identity Services
router.post('/google', async (req, res, next) => {
  try {
    if (!googleClient) {
      return res.status(503).json({ error: 'Google sign-in is not configured on this server' });
    }
    const credential = (req.body || {}).credential;
    if (!credential) return res.status(400).json({ error: 'credential is required' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'That Google sign-in could not be verified' });
    }
    if (!payload || !payload.email || !payload.email_verified) {
      return res.status(401).json({ error: 'Google did not confirm an email address for that account' });
    }

    const email = payload.email.toLowerCase();
    let user = await User.findOne({ googleId: payload.sub });

    if (!user) {
      // Same address signing in through Google for the first time: link, don't duplicate.
      user = await User.findOne({ email });
      if (user) {
        user.googleId = payload.sub;
        user.emailVerified = true;
        user.clearEmailVerification();
      } else {
        user = new User({
          username: await User.availableUsername(payload.name || email),
          email,
          googleId: payload.sub,
          emailVerified: true,
        });
      }
      await user.save();
    }

    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That account already exists' });
    next(err);
  }
});

// POST /api/auth/verify  { token }
router.post('/verify', async (req, res, next) => {
  try {
    const token = (req.body || {}).token;
    const user = await User.findByVerifyToken(token);
    if (!user) {
      return res.status(400).json({ error: 'That link is invalid or has expired. Ask for a new one.' });
    }
    user.clearEmailVerification();
    await user.save();
    // A fresh token so the app can pick up the verified flag without a re-login.
    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) { next(err); }
});

// POST /api/auth/resend  -- new verification email for the signed-in account
router.post('/resend', requireAuth, async (req, res, next) => {
  try {
    if (req.user.emailVerified) return res.json({ alreadyVerified: true });
    const since = req.user.verifySentAt ? Date.now() - req.user.verifySentAt.getTime() : Infinity;
    if (since < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Just sent one. Give it a minute and check your spam folder.' });
    }
    const token = req.user.startEmailVerification();
    await req.user.save();
    const delivery = await mail.sendVerification(req.user, token);
    res.json({ sent: delivery.sent, link: delivery.link });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

module.exports = router;

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const mail = require('../lib/mail');

/* Posting requires a confirmed address. Verification is on whenever mail is
   configured, since requiring it without a way to send would lock everyone out.
   REQUIRE_EMAIL_VERIFICATION=true/false overrides either way. */
const VERIFY_FLAG = process.env.REQUIRE_EMAIL_VERIFICATION;
const VERIFY_REQUIRED = VERIFY_FLAG === 'true' ? true
  : VERIFY_FLAG === 'false' ? false
  : mail.enabled;

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

async function loadUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(payload.sub);
  } catch {
    return null;
  }
}

// Requires a valid token; 401 otherwise.
async function requireAuth(req, res, next) {
  const user = await loadUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  /* A suspension is partial on purpose: browsing and reading stay open,
     every action returns until the clock runs out. */
  if (req.method !== 'GET' && user.isSuspended && user.isSuspended()) {
    const until = user.suspendedUntil.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    return res.status(403).json({
      error: `Your account is suspended until ${until}` + (user.suspendedReason ? ` — ${user.suspendedReason}` : ''),
      code: 'SUSPENDED',
    });
  }
  req.user = user;
  next();
}

// Attaches req.user if a valid token is present, but never blocks.
async function optionalAuth(req, res, next) {
  req.user = await loadUser(req);
  next();
}

// Runs after requireAuth. Reading and downloading stay open to everyone.
function requireVerified(req, res, next) {
  if (!VERIFY_REQUIRED || req.user.emailVerified) return next();
  res.status(403).json({
    error: 'Confirm your email address before posting. Check your inbox for the link.',
    code: 'EMAIL_UNVERIFIED',
  });
}

module.exports = { signToken, requireAuth, optionalAuth, requireVerified, VERIFY_REQUIRED };

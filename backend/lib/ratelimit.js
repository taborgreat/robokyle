/* A small fixed-window limiter for the auth endpoints.
 *
 * Enough to blunt password guessing and sign-up floods from one address without
 * pulling in a dependency. State is per process and in memory, which is the
 * right size for a single server; if this ever runs on more than one, move it
 * to the database or a shared cache.
 */
const buckets = new Map();

/* `key` groups routes into one bucket ("talk-write") so posting across many
   threads cannot dodge the limit; without it each path limits on its own. */
function rateLimit({ windowMs, max, message = 'Too many attempts. Try again shortly.', key = null }) {
  return function (req, res, next) {
    const now = Date.now();
    const bucketKey = `${req.ip}:${key || req.baseUrl + req.path}`;
    const hit = buckets.get(bucketKey);

    if (!hit || now > hit.resetAt) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (hit.count >= max) {
      res.set('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    hit.count++;
    next();
  };
}

// Drop expired buckets now and then so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of buckets) if (now > hit.resetAt) buckets.delete(key);
}, 10 * 60 * 1000).unref();

module.exports = { rateLimit };

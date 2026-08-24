/* Windows that more than one module has to agree on. */

// Unverified sign-ups are deleted this long after they were created, and their
// verification link never outlives that, so a link is never valid for an account
// that is about to disappear.
const UNVERIFIED_TTL_HOURS = Number(process.env.UNVERIFIED_TTL_HOURS || 12);

// How often the purge runs while the server is up.
const PURGE_INTERVAL_MINUTES = Number(process.env.PURGE_INTERVAL_MINUTES || 30);

module.exports = { UNVERIFIED_TTL_HOURS, PURGE_INTERVAL_MINUTES };

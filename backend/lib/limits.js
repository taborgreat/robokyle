/* Windows that more than one module has to agree on. */

// Unverified sign-ups are deleted this long after they were created, and their
// verification link never outlives that, so a link is never valid for an account
// that is about to disappear.
const UNVERIFIED_TTL_HOURS = Number(process.env.UNVERIFIED_TTL_HOURS || 12);

// How often the purge runs while the server is up.
const PURGE_INTERVAL_MINUTES = Number(process.env.PURGE_INTERVAL_MINUTES || 30);

// Stored files with no row pointing at them are reclaimed on this cycle. The
// grace period is what makes it safe: a blob is only touched once it has sat
// untouched for longer than any request could take.
const BLOB_SWEEP_HOURS = Number(process.env.BLOB_SWEEP_HOURS || 6);
const BLOB_GRACE_MINUTES = Number(process.env.BLOB_GRACE_MINUTES || 60);

// Drafts nobody has touched in this long are deleted; the sweep then frees
// any files only they were holding. (Open decision: warning email near expiry.)
const DRAFT_EXPIRY_DAYS = Number(process.env.DRAFT_EXPIRY_DAYS || 180);

module.exports = { UNVERIFIED_TTL_HOURS, PURGE_INTERVAL_MINUTES, BLOB_SWEEP_HOURS, BLOB_GRACE_MINUTES, DRAFT_EXPIRY_DAYS };

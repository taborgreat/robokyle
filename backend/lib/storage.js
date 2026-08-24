/* Content-addressed file storage.
 *
 * A file is stored once under the hash of its bytes, at uploads/ab/abcdef…
 * Anything that wants that file just records the hash, so:
 *   - forking a work copies no bytes at all, only the metadata rows
 *   - a revision that changes one part stores only the part that changed
 *   - the same file uploaded twice, by anyone, occupies one blob
 *
 * The flip side is that a blob may have many referrers, so nothing is deleted
 * until the last reference to it is gone. `release` is the only thing that
 * unlinks, and it checks first.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Overridable so a test run can point at a scratch directory instead of the
// real store; unset in normal use.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '..', 'uploads');
const IS_HASH = /^[0-9a-f]{64}$/;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* Blobs are sharded by their first two characters: one flat directory of tens
   of thousands of files is slow to list and unpleasant to work in.

   The name IS the address, so it must be a content hash and nothing else:
   anything that reached a database row from the network could otherwise walk
   this join out of the store ("../../.env"). Every read goes through here, so
   this one check is the floor under all of them. */
function blobPath(storedName) {
  if (!IS_HASH.test(String(storedName))) {
    throw Object.assign(new Error('Invalid stored file name'), { status: 400 });
  }
  return path.join(UPLOAD_DIR, storedName.slice(0, 2), storedName);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/* Moves a just-written temp file into the store and returns its hash. If those
   exact bytes are already here, the temp copy is dropped and the existing blob
   is reused. */
async function ingest(tempPath) {
  const hash = await hashFile(tempPath);
  const dest = blobPath(hash);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    // Fails when the blob exists, which is the common case and not an error.
    await fs.promises.link(tempPath, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Store on a different filesystem: a hard link cannot span one.
      await fs.promises.copyFile(tempPath, dest);
    } else if (err.code !== 'EEXIST') {
      throw err;
    }
  }
  await fs.promises.unlink(tempPath).catch(() => {});
  return hash;
}

module.exports = { UPLOAD_DIR, IS_HASH, blobPath, ingest };

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const Design = require('./models/Design');
const { ALLOWED_EXT } = require('./lib/files');
const mail = require('./lib/mail');
const { purgeUnverified, purgeExpiredDrafts, archiveIdleTalk,
        refreshProducedStates, applyRipeDocRevisions, checkDeploymentLinks } = require('./lib/cleanup');
const { detectRings } = require('./lib/rings');
const xp = require('./lib/xp');
const { PURGE_INTERVAL_MINUTES, BLOB_SWEEP_HOURS, BLOB_GRACE_MINUTES } = require('./lib/limits');
const { VERIFY_REQUIRED } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const designRoutes = require('./routes/designs');
const userRoutes = require('./routes/users');
const draftRoutes = require('./routes/drafts');
const talkRoutes = require('./routes/talk');
const producedRoutes = require('./routes/produced');

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/robokyle';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();

/* ---------------- virtual Brunel hand ----------------
   The Open Bionics hand simulator (../virtualBrunel) mounted at /brunel: the
   viewer at /brunel/, its HTTP API underneath (POST /brunel/gesture/execute,
   GET /brunel/status/health, ...). Express strips the prefix, so the package
   sees the spec's own paths. It sits ahead of the JSON and CORS middleware on
   purpose: it reads request bodies itself and answers CORS the way the real
   device does. The package is ESM and serves `three` from its own
   node_modules, so it needs `npm install` in virtualBrunel/; if that is
   missing the mount answers 503 rather than taking the API down.          */
const BRUNEL_STORE = path.join(__dirname, '..', 'virtualBrunel', 'data', 'eeprom.json');
const brunel = import('../virtualBrunel/index.js')
  .then(({ createBrunelHand }) => createBrunelHand({ storePath: BRUNEL_STORE }))
  .catch(err => { console.error('[brunel] not mounted:', err.message); return null; });
app.use('/brunel', (req, res, next) => {
  // The viewer's URLs are page-relative, so it has to live at /brunel/ not /brunel.
  if (req.url === '/' && !req.originalUrl.startsWith('/brunel/')) return res.redirect(302, '/brunel/');
  brunel.then(hand => {
    if (!hand) return res.status(503).json({ status: 'error', error_code: 'UNAVAILABLE', message: 'Virtual hand not loaded; run npm install in virtualBrunel/.' });
    return hand.handle(req, res);
  }).catch(next);
});

app.use(cors({
  origin: CORS_ORIGINS.length ? CORS_ORIGINS : true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// What the React app needs before it can render the right forms and buttons.
app.get('/api/config', (req, res) => res.json({
  uploadsAdminOnly: process.env.UPLOADS_ADMIN_ONLY !== 'false',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  maxFiles: 20,
  allowedExtensions: [...ALLOWED_EXT].sort(),
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  emailVerificationRequired: VERIFY_REQUIRED,
  mailEnabled: mail.enabled,
  xp: {
    categories: xp.config.categories,
    declaration: xp.config.declaration,
    levelCap: xp.config.levelCurve.cap,
    needVocabulary: xp.config.needVocabulary,
    introBioMinChars: xp.config.intro.bioMinChars,
    disputeMinLevel: xp.config.accountability.disputeMinLevel,
    equipmentItems: xp.config.equipmentItems,
    materialItems: xp.config.materialItems,
    materialUnits: xp.config.materialUnits,
    softwareFacets: xp.config.softwareFacets,
  },
}));
app.use('/api/auth', authRoutes);
app.use('/api/designs', designRoutes);
app.use('/api/users', userRoutes);
app.use('/api/drafts', draftRoutes);
app.use('/api/talk', talkRoutes);
app.use('/api/designs/:designId/produced', producedRoutes);
app.use('/api/stats', require('./routes/stats'));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------------- the site itself ----------------
   Serves the built site next to the API, so one `node server.js` gives you the
   whole thing on one port: no dev server, no second origin, no CORS locally.
   Only the site's own files are exposed -- the four page shells and public/ --
   so nothing under backend/ or Factum/ is reachable through here.
   Set SERVE_SITE=false to run the API on its own (GitHub Pages serves the site
   in production).                                                            */
/* The server's own front door: what api.robokyle.org shows at /. A plain page
   linking the things that live here (the virtual hand, Factum when it lands).
   The GitHub Pages site is still reachable through /index.html and friends. */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'home', 'index.html')));

if (process.env.SERVE_SITE !== 'false') {
  const SITE_ROOT = path.join(__dirname, '..');
  const APP_SHELL = path.join(SITE_ROOT, 'app.html');
  // Client-side routes: these have no file of their own, the app reads the URL.
  const APP_ROUTES = ['/works', '/login', '/register', '/verify', '/user', '/creators', '/talk'];
  const PAGES = /^\/(?:|index\.html|about\.html|app\.html|404\.html)$/;

  const files = express.static(SITE_ROOT, { index: 'index.html', dotfiles: 'ignore' });
  app.use((req, res, next) => {
    if (PAGES.test(req.path) || req.path.startsWith('/public/')) return files(req, res, next);
    next();
  });

  app.get(APP_ROUTES.map(r => [r, `${r}/*`]).flat(), (req, res) => res.sendFile(APP_SHELL));

  // Anything else is a real 404, answered by the app shell so the page still
  // renders a site-shaped error rather than a bare Express message.
  app.use((req, res) => res.status(404).sendFile(APP_SHELL));
}

// Central error handler (multer errors, JSON parse errors, etc.)
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  // A deliberate 4xx is the caller's problem, answered and done; only real
  // server faults deserve a stack in the log.
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

mongoose.connect(MONGO_URI)
  .then(() => {
    // Sweep abandoned sign-ups now and then keep sweeping while we are up.
    // The same cycle keeps Produced states warm (the 48h window crosses on the
    // clock), applies community-ripe doc revisions, and re-pings deployments.
    const sweep = () => Promise.all([
      purgeUnverified(), purgeExpiredDrafts(), archiveIdleTalk(),
      refreshProducedStates(), applyRipeDocRevisions(), checkDeploymentLinks(),
    ]).catch(err => console.error('[cleanup]', err.message));
    sweep();
    setInterval(sweep, PURGE_INTERVAL_MINUTES * 60 * 1000).unref();

    // Reclaim stored files that no work or version references any more.
    const sweepBlobs = () => Design.sweepOrphanBlobs({ minAgeMinutes: BLOB_GRACE_MINUTES })
      .then(r => {
        if (r.removed || r.temp) console.log(`[blobs] reclaimed ${r.removed} file(s), ${(r.bytes / 1e6).toFixed(1)} MB, ${r.temp} temp`);
        if (r.missing.length) console.warn(`[blobs] ${r.missing.length} referenced file(s) missing from the store`);
      })
      .catch(err => console.error('[blobs]', err.message));
    sweepBlobs();
    setInterval(sweepBlobs, BLOB_SWEEP_HOURS * 3600 * 1000).unref();

    /* XP is a recompute over the works themselves; the incremental refreshes
       in the routes keep it fresh. The nightly pass self-heals anything they
       missed, then runs ring detection (§8.3) over the fresh graph. */
    const recomputeXp = () => xp.recomputeAll()
      .then(n => console.log(`[xp] recomputed ${n} account(s)`))
      .then(() => detectRings())
      .catch(err => console.error('[xp]', err.message));
    recomputeXp();
    setInterval(recomputeXp, 24 * 3600 * 1000).unref();
    app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

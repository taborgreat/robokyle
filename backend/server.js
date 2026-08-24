require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const Design = require('./models/Design');
const { ALLOWED_EXT } = require('./lib/files');
const mail = require('./lib/mail');
const { purgeUnverified } = require('./lib/cleanup');
const { PURGE_INTERVAL_MINUTES } = require('./lib/limits');
const { VERIFY_REQUIRED } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const designRoutes = require('./routes/designs');
const userRoutes = require('./routes/users');

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/robokyle';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
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
}));
app.use('/api/auth', authRoutes);
app.use('/api/designs', designRoutes);
app.use('/api/users', userRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler (multer errors, JSON parse errors, etc.)
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

mongoose.connect(MONGO_URI)
  .then(async () => {
    const patched = await Design.backfillFileKinds();
    if (patched) console.log(`Backfilled file kinds on ${patched} design(s)`);

    // Sweep abandoned sign-ups now and then keep sweeping while we are up.
    const sweep = () => purgeUnverified().catch(err => console.error('[cleanup]', err.message));
    sweep();
    setInterval(sweep, PURGE_INTERVAL_MINUTES * 60 * 1000).unref();
    app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

require('dotenv').config();

// Fail fast if required secrets are missing
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Set it in your .env or deployment config.');
  process.exit(1);
}

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Initialize database (creates tables on import)
console.log('Loading database...');
const db = require('./database');
console.log('Database loaded.');

// Auto-close feedback periods at end of their end_date (closes at midnight after end_date — i.e. 23:59 is last active minute)
const autoClosePeriods = () => {
  try {
    const expired = db.prepare(`
      SELECT fp.id, fp.name FROM feedback_periods fp
      WHERE fp.active_status = 1 AND fp.end_date IS NOT NULL
        AND date('now', 'localtime') > fp.end_date
    `).all();
    if (expired.length) {
      const close = db.prepare('UPDATE feedback_periods SET active_status = 0 WHERE id = ?');
      db.transaction(() => expired.forEach(p => {
        close.run(p.id);
        console.log(`[auto-close] Feedback period "${p.name}" (id=${p.id}) expired and closed`);
      }))();
    }
  } catch (err) { console.error('[auto-close] Error:', err.message); }
};
autoClosePeriods(); // run once at startup to catch any periods that expired while server was down
setInterval(autoClosePeriods, 60 * 1000); // check every minute

// Auto-close petitions whose deadline has passed. Notifies admin + head of the
// org with the final tally so the loop closes itself even if nobody is watching.
// Runs every 5 minutes — petitions don't need second-level precision and the
// notification fan-out is per-org.
const autoClosePetitions = () => {
  try {
    const expired = db.prepare(`
      SELECT id, org_id, title FROM council_posts
      WHERE type = 'petition' AND status = 'active'
        AND closes_at IS NOT NULL AND datetime('now') > closes_at
    `).all();
    if (!expired.length) return;

    const { createNotifications } = require('./utils/notifications');
    const closeStmt = db.prepare("UPDATE council_posts SET status = 'closed' WHERE id = ?");
    const tallyStmt = db.prepare(`
      SELECT vote, COUNT(*) AS n FROM petition_votes WHERE post_id = ? GROUP BY vote
    `);

    for (const p of expired) {
      closeStmt.run(p.id);
      const rows = tallyStmt.all(p.id);
      const counts = { agree: 0, disagree: 0, neutral: 0 };
      rows.forEach(r => { counts[r.vote] = r.n; });
      const total = counts.agree + counts.disagree + counts.neutral;
      const body = `Final tally: ${counts.agree} agree, ${counts.disagree} disagree, ${counts.neutral} neutral (${total} total)`;

      // Notify admin + head of the same org. createNotifications no-ops on
      // empty userIds so it's safe even if the org has neither role filled.
      const staff = db.prepare(
        "SELECT id FROM users WHERE org_id = ? AND role IN ('admin','head')"
      ).all(p.org_id).map(u => u.id);
      createNotifications({
        userIds: staff,
        orgId: p.org_id,
        type: 'petition_closed',
        title: `Petition closed: ${p.title}`,
        body,
        link: 'admin-comms-voice',
      });
      console.log(`[auto-close] Petition "${p.title}" (id=${p.id}) closed — ${body}`);
    }
  } catch (err) { console.error('[auto-close petitions] Error:', err.message); }
};
autoClosePetitions();
setInterval(autoClosePetitions, 5 * 60 * 1000); // every 5 minutes

// Schedule daily SQLite backups to the persistent volume. Opt-out by setting
// BACKUP_DISABLED=true (useful for local dev where backups are just noise).
if (process.env.BACKUP_DISABLED !== 'true') {
  const { scheduleBackups } = require('./utils/backup');
  scheduleBackups(db);
}


const authRoutes = require('./routes/auth');
const classroomRoutes = require('./routes/classrooms');
const reviewRoutes = require('./routes/reviews');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const supportRoutes = require('./routes/support');
const teacherRoutes = require('./routes/teachers');
const formsRoutes = require('./routes/forms');
const announcementsRoutes = require('./routes/announcements');
const notificationsRoutes = require('./routes/notifications');
const departmentsRoutes = require('./routes/departments');
const councilRoutes = require('./routes/council');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy when behind reverse proxy (Railway, Heroku, etc.)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://accounts.google.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
      connectSrc: ["'self'", "https://accounts.google.com"],
      frameSrc: ["https://accounts.google.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(cookieParser());

// Body parsers. The global JSON limit is intentionally tiny (10kb) to keep the
// attack surface small for normal API endpoints, but a few routes legitimately
// receive base64-encoded image / file uploads and need a larger limit. Mount
// the larger parser ONLY on those specific routes, BEFORE the global one,
// so it wins for matching paths and the global cap protects everything else.
const uploadJsonParser = express.json({ limit: '6mb' });
app.use('/api/auth/avatar', uploadJsonParser);
app.use('/api/admin/users/:id/avatar', uploadJsonParser);

// Council posts may carry a base64-encoded PDF (~1.33x its raw size). 12mb
// gives headroom over the 8mb hard cap in utils/attachments.js. Mounted only
// on the create/edit paths — voting and listing still use the global 10kb cap.
const councilUploadParser = express.json({ limit: '12mb' });
app.use('/api/council/posts', councilUploadParser);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please try again later.' },
  validate: { xForwardedForHeader: false }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/google', authLimiter);

// Maintenance mode — set MAINTENANCE_MODE=true in env to activate
if (process.env.MAINTENANCE_MODE === 'true') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'Server is under maintenance. Please try again shortly.' });
    }
    res.status(503).sendFile(path.join(__dirname, 'public', 'maintenance.html'));
  });
}

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/council', councilRoutes);

// Public runtime config for the frontend (Google Client ID, allowed domains).
// Safe to expose: the Client ID is public by design for browser OAuth flows.
app.get('/api/public-config', (_req, res) => {
  res.json({
    google_client_id: process.env.GOOGLE_CLIENT_ID || '',
    teacher_domain: 'uwcdilijan.am',
    student_domain: 'student.uwcdilijan.am',
    strict_domain: process.env.STRICT_EMAIL_DOMAIN === 'true'
  });
});

// Specific page routes (BEFORE static middleware)
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/manual-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manual-login.html'));
});

// Root - Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Avatars live on the persistent volume (AVATARS_DIR) so they survive redeploys.
// Mount this BEFORE the public/ static handler so it wins for /avatars/* even if
// a stale file exists under public/avatars/ from earlier local runs.
const { AVATARS_DIR, ensureDir: ensureAvatarsDir } = require('./utils/avatars');
ensureAvatarsDir();
app.use('/avatars', express.static(AVATARS_DIR, {
  maxAge: '7d',
  fallthrough: false,
}));

// Petition attachments live on the same persistent volume. Same reasoning as
// /avatars: mount BEFORE public/ static so the volume copy wins.
const { ATTACHMENTS_DIR, ensureDir: ensureAttachmentsDir } = require('./utils/attachments');
ensureAttachmentsDir();
app.use('/attachments', express.static(ATTACHMENTS_DIR, {
  maxAge: '7d',
  fallthrough: false,
}));

// Static files (AFTER specific routes)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (must be before 404 handler)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Oasis Server running on port ${PORT}\n`);
});

// Prevent process crash from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

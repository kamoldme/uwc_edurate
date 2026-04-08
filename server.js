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

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy when behind reverse proxy (Railway, Heroku, etc.)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
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
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/register-teacher', authLimiter);

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

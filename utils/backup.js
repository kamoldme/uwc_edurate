// SQLite backup utility.
//
// Uses better-sqlite3's built-in online backup API, which is safe to run while
// the server is live — it takes a consistent snapshot without blocking writers
// for more than brief moments. The snapshot file lives on the same persistent
// volume as the main DB (default: /data/backups in production, ./backups in
// local dev) so it survives redeploys the same way the DB does.
//
// Why not just copy oasis.db?
//   A naive `fs.copyFile` during a WAL checkpoint can produce a torn file.
//   better-sqlite3's `db.backup()` uses SQLite's online backup API and is the
//   right call for a live database.
//
// Rotation: keep the last BACKUP_KEEP files (default 14). Older ones are
// deleted so the volume doesn't fill up silently.

const fs = require('fs');
const path = require('path');

const BACKUPS_DIR =
  process.env.BACKUPS_DIR ||
  path.join(__dirname, '..', 'backups');

const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '14', 10);

function ensureDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

// Run a single backup. Returns a promise that resolves with the file path.
async function runBackup(db) {
  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'); // filesystem-safe
  const filename = `oasis-${stamp}.db`;
  const filePath = path.join(BACKUPS_DIR, filename);

  await db.backup(filePath);

  rotate();
  return filePath;
}

// Keep only the most recent BACKUP_KEEP files. Silent on errors — a failed
// rotate shouldn't take down the scheduler.
function rotate() {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('oasis-') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(BACKUPS_DIR, f),
        mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const toDelete = files.slice(BACKUP_KEEP);
    for (const f of toDelete) {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }
  } catch (err) {
    console.error('[backup] Rotate error:', err.message);
  }
}

// Schedule a backup every `intervalMs` ms and one at startup (after a short
// delay so we don't compete with app init).
function scheduleBackups(db, intervalMs = 24 * 60 * 60 * 1000) {
  const tick = async () => {
    try {
      const file = await runBackup(db);
      console.log(`[backup] Wrote ${path.basename(file)} (keeping last ${BACKUP_KEEP})`);
    } catch (err) {
      console.error('[backup] Failed:', err.message);
    }
  };
  setTimeout(tick, 30 * 1000);       // first run: 30s after boot
  setInterval(tick, intervalMs);     // then every intervalMs
}

module.exports = { BACKUPS_DIR, BACKUP_KEEP, runBackup, scheduleBackups, ensureDir };

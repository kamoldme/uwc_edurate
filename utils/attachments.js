// Petition attachment storage helper.
//
// PDFs live on the persistent volume (default: /data/attachments in production
// via Dockerfile, ./public/attachments in local dev). They are served at
// /attachments/<filename> by a static route mounted in server.js — that route
// reads from ATTACHMENTS_DIR, NOT from public/attachments, so files survive
// redeploys.
//
// Mirrors utils/avatars.js. Different file types want different validators
// (here: PDF only) so they're separate modules instead of one polymorphic
// helper that always lies about what it accepts.

const fs = require('fs');
const path = require('path');

const ATTACHMENTS_DIR =
  process.env.ATTACHMENTS_DIR ||
  path.join(__dirname, '..', 'public', 'attachments');

// Hard cap matches the plan: 8MB raw. The corresponding body parser in
// server.js is set to 12mb (base64 inflates ~1.33x), so anything that gets
// here without being rejected by Express is at most ~9MB.
const MAX_BYTES = 8 * 1024 * 1024;

function ensureDir() {
  if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }
}

// Save a base64 PDF data URL. Returns { url, displayName }.
// `originalName` is the filename the user uploaded (preserved for display only,
// never used as a filesystem path).
function saveAttachment(dataUrl, postId, originalName) {
  if (!dataUrl || !dataUrl.startsWith('data:application/pdf')) {
    throw new Error('Only PDF attachments are supported');
  }
  const matches = dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid attachment format');
  }
  const buffer = Buffer.from(matches[1], 'base64');
  if (buffer.length > MAX_BYTES) {
    throw new Error('Attachment must be smaller than 8MB');
  }

  ensureDir();
  // Filename is fully server-generated — never trust client input here.
  const safeName = `petition_${postId}_${Date.now()}.pdf`;
  fs.writeFileSync(path.join(ATTACHMENTS_DIR, safeName), buffer);

  // Trim original name in case the user uploaded something weird.
  const displayName = (originalName || 'attachment.pdf').slice(0, 200);
  return { url: `/attachments/${safeName}`, displayName };
}

// Best-effort delete. Silent no-op for malformed URLs or missing files —
// callers shouldn't have to care about cleanup edge cases.
function deleteAttachment(attachmentUrl) {
  if (!attachmentUrl || !attachmentUrl.startsWith('/attachments/')) return;
  const filename = path.basename(attachmentUrl); // strips path traversal
  const filePath = path.join(ATTACHMENTS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // A leftover file is harmless.
  }
}

module.exports = { ATTACHMENTS_DIR, MAX_BYTES, saveAttachment, deleteAttachment, ensureDir };

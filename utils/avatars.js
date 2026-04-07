// Avatar storage helper.
//
// Avatars live on the persistent volume (default: /data/avatars in production
// via Dockerfile, ./public/avatars in local dev). They are served at
// /avatars/<filename> by a static route mounted in server.js — that route
// reads from AVATARS_DIR, NOT from public/avatars, so files survive redeploys.
//
// Why a shared module:
//   1. /api/auth/avatar (self-serve, teachers + heads only)
//   2. /api/admin/users/:id/avatar (admin manages teacher / head avatars)
// Both endpoints need identical save/delete logic — keep it in one place.

const fs = require('fs');
const path = require('path');

const AVATARS_DIR =
  process.env.AVATARS_DIR ||
  path.join(__dirname, '..', 'public', 'avatars');

function ensureDir() {
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
}

// Save a base64 data URL avatar for a user. Returns the public URL path
// (e.g. /avatars/avatar_5_1700000000000.png) on success, throws on bad input.
function saveAvatarFile(dataUrl, userId) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    throw new Error('Invalid image data');
  }
  const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image format');
  }
  const ext = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Image must be smaller than 5MB');
  }

  ensureDir();
  const filename = `avatar_${userId}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(AVATARS_DIR, filename), buffer);
  return `/avatars/${filename}`;
}

// Delete an avatar file given its public URL (e.g. /avatars/foo.png).
// Silent no-op if the file doesn't exist or the URL is malformed — callers
// shouldn't have to care about cleanup edge cases.
function deleteAvatarFile(avatarUrl) {
  if (!avatarUrl || !avatarUrl.startsWith('/avatars/')) return;
  const filename = path.basename(avatarUrl); // strips any path traversal attempts
  const filePath = path.join(AVATARS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    // Best-effort cleanup. A leftover file is harmless.
  }
}

module.exports = { AVATARS_DIR, saveAvatarFile, deleteAvatarFile, ensureDir };

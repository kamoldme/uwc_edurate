const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../database');
const { generateToken, authenticate } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Domain policy: teachers use @uwcdilijan.am; students use @student.uwcdilijan.am.
// During the pilot we don't have access to Google Workspace yet, so domain
// enforcement is OFF by default — the UI shows a red warning instead. Once
// Workspace is provisioned, set STRICT_EMAIL_DOMAIN=true to hard-block
// non-school accounts server-side.
const TEACHER_DOMAIN = 'uwcdilijan.am';
const STUDENT_DOMAIN = 'student.uwcdilijan.am';
const STRICT_DOMAIN = process.env.STRICT_EMAIL_DOMAIN === 'true';

function emailDomain(email) {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  });
}

// POST /api/auth/google — unified Google Sign-In for login + registration.
// Body: { credential, intent: 'login'|'student'|'teacher' }
// - 'login': the Google account must already map to an existing user.
// - 'student': creates a student account in the default org (id=1).
// - 'teacher': creates a teacher account in the default org (id=1).
// No invite codes, no grade, no department — admin sets those from the admin UI.
router.post('/google', async (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ error: 'Google Sign-In is not configured on this server. Set GOOGLE_CLIENT_ID.' });
  }
  try {
    const { credential, intent, grade_or_position } = req.body || {};
    if (!credential || !intent) {
      return res.status(400).json({ error: 'Missing credential or intent' });
    }
    if (!['login', 'student', 'teacher'].includes(intent)) {
      return res.status(400).json({ error: 'Invalid intent' });
    }
    // Cohort labels are free-form text up to 60 chars (e.g. "Class of 2027").
    // Avoiding a hard whitelist so admins can roll new cohorts forward without
    // server changes; the registration form still presents a fixed dropdown.
    if (intent === 'student' && grade_or_position && (typeof grade_or_position !== 'string' || grade_or_position.length > 60)) {
      return res.status(400).json({ error: 'Invalid cohort / year.' });
    }

    // Verify the ID token with Google. This checks signature, audience, and expiry.
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ error: 'Could not verify Google token' });
    }
    if (!payload || !payload.email) {
      return res.status(401).json({ error: 'Google token missing email' });
    }
    if (!payload.email_verified) {
      return res.status(401).json({ error: 'Google email is not verified' });
    }

    const email = payload.email.toLowerCase();
    const domain = emailDomain(email);
    const fullName = (payload.name || email.split('@')[0]).slice(0, 120);

    // Domain policy — only enforced when STRICT_EMAIL_DOMAIN=true (post-pilot).
    // During the pilot we allow any Google account; the UI shows a red warning
    // that only school accounts should be used.
    if (STRICT_DOMAIN && domain !== TEACHER_DOMAIN && domain !== STUDENT_DOMAIN) {
      return res.status(403).json({ error: `Only ${TEACHER_DOMAIN} and ${STUDENT_DOMAIN} accounts are allowed.` });
    }

    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // Login path: the account must already exist. We don't auto-provision on /login
    // so admins stay in control of role assignments.
    if (intent === 'login') {
      if (!existing) {
        return res.status(404).json({ error: 'No account found for this email. Please register first.' });
      }
      if (existing.suspended) {
        return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
      }
      const token = generateToken(existing);
      setAuthCookie(res, token);
      logAuditEvent({
        userId: existing.id, userRole: existing.role, userName: existing.full_name,
        actionType: 'user_login',
        actionDescription: 'Logged in via Google',
        targetType: 'user', targetId: existing.id,
        ipAddress: req.ip
      });
      const { password: _p, ...safeUser } = existing;
      return res.json({ message: 'Login successful', user: safeUser, token });
    }

    // If a Google user tries to register but already has an account, just sign them in.
    if (existing) {
      if (existing.suspended) {
        return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
      }
      const token = generateToken(existing);
      setAuthCookie(res, token);
      const { password: _p, ...safeUser } = existing;
      return res.json({ message: 'Signed in with existing account', user: safeUser, token });
    }

    // Registration — in strict mode the email domain must match the chosen role.
    // In pilot mode (default) we trust the `intent` picked on the frontend
    // (student via /register, teacher via /join).
    if (STRICT_DOMAIN) {
      if (intent === 'student' && domain !== STUDENT_DOMAIN) {
        return res.status(403).json({ error: `Student accounts must use @${STUDENT_DOMAIN}.` });
      }
      if (intent === 'teacher' && domain !== TEACHER_DOMAIN) {
        return res.status(403).json({ error: `Teacher accounts must use @${TEACHER_DOMAIN}.` });
      }
    }

    // Google-provisioned users have no password. The `password` column is NOT NULL,
    // so we store an unguessable random bcrypt hash — nobody can log in with it.
    const randomSecret = crypto.randomBytes(48).toString('hex');
    const placeholderHash = await bcrypt.hash(randomSecret, 12);
    const sanitizedName = sanitizeInput(fullName);
    const avatarUrl = payload.picture || null;

    if (intent === 'student') {
      const result = db.prepare(`
        INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status, avatar_url)
        VALUES (?, ?, ?, 'student', ?, 1, 1, 1, ?)
      `).run(sanitizedName, email, placeholderHash, grade_or_position || null, avatarUrl);

      const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, org_id, verified_status, avatar_url, language, is_student_council FROM users WHERE id = ?').get(result.lastInsertRowid);
      const token = generateToken(user);
      setAuthCookie(res, token);
      logAuditEvent({
        userId: user.id, userRole: 'student', userName: sanitizedName,
        actionType: 'user_register',
        actionDescription: `Registered via Google: ${email}`,
        targetType: 'user', targetId: user.id,
        ipAddress: req.ip
      });
      return res.status(201).json({ message: 'Registration successful', user, token });
    }

    // intent === 'teacher' — join the default org. Admin assigns department later.
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, school_id, org_id, verified_status, avatar_url)
      VALUES (?, ?, ?, 'teacher', 1, 1, 1, ?)
    `).run(sanitizedName, email, placeholderHash, avatarUrl);
    const userId = result.lastInsertRowid;

    db.prepare(`INSERT INTO teachers (user_id, full_name, school_id, org_id, avatar_url) VALUES (?, ?, 1, 1, ?)`)
      .run(userId, sanitizedName, avatarUrl);

    const user = db.prepare('SELECT id, full_name, email, role, org_id, verified_status, avatar_url, language, is_student_council FROM users WHERE id = ?').get(userId);
    const token = generateToken(user);
    setAuthCookie(res, token);
    logAuditEvent({
      userId: user.id, userRole: 'teacher', userName: sanitizedName,
      actionType: 'teacher_self_register',
      actionDescription: `Teacher registered via Google: ${email}`,
      targetType: 'user', targetId: userId,
      orgId: 1, ipAddress: req.ip
    });
    return res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Google sign-in failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      logAuditEvent({
        userId: 0, userRole: 'unknown', userName: email.toLowerCase(),
        actionType: 'login_failed',
        actionDescription: `Failed login attempt: unknown email`,
        metadata: { email: email.toLowerCase(), reason: 'unknown_email' },
        ipAddress: req.ip
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!await bcrypt.compare(password, user.password)) {
      logAuditEvent({
        userId: user.id, userRole: user.role, userName: user.full_name,
        actionType: 'login_failed',
        actionDescription: `Failed login attempt: wrong password`,
        metadata: { email: email.toLowerCase(), reason: 'wrong_password' },
        ipAddress: req.ip
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.suspended) {
      logAuditEvent({
        userId: user.id, userRole: user.role, userName: user.full_name,
        actionType: 'login_failed',
        actionDescription: `Failed login attempt: account suspended`,
        metadata: { email: email.toLowerCase(), reason: 'suspended' },
        ipAddress: req.ip
      });
      return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
    }

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    logAuditEvent({
      userId: user.id, userRole: user.role, userName: user.full_name,
      actionType: 'user_login',
      actionDescription: `Logged in successfully`,
      targetType: 'user', targetId: user.id,
      ipAddress: req.ip
    });

    const { password: _, ...safeUser } = user;
    res.json({ message: 'Login successful', user: safeUser, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  let teacherInfo = null;
  if (req.user.role === 'teacher') {
    teacherInfo = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  }

  let orgName = req.user.org_name || null;
  if (!orgName && req.user.org_id) {
    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(req.user.org_id);
    orgName = org?.name;
  }

  res.json({
    user: { ...req.user, org_name: orgName },
    teacher: teacherInfo
  });
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(new_password) || !/[a-z]/.test(new_password) || !/[0-9]/.test(new_password)) {
      return res.status(400).json({ error: 'New password must contain uppercase, lowercase, and a number' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!await bcrypt.compare(current_password, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'password_change',
      actionDescription: 'Changed password',
      targetType: 'user', targetId: req.user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// PUT /api/auth/update-profile
router.put('/update-profile', authenticate, (req, res) => {
  try {
    const { full_name, grade_or_position, bio, subject, department } = req.body;

    if (full_name) {
      const sanitized = sanitizeInput(full_name);
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(sanitized, req.user.id);

      if (req.user.role === 'teacher') {
        db.prepare('UPDATE teachers SET full_name = ? WHERE user_id = ?').run(sanitized, req.user.id);
      }
    }

    if (grade_or_position !== undefined) {
      db.prepare('UPDATE users SET grade_or_position = ? WHERE id = ?').run(grade_or_position, req.user.id);
    }

    if (req.user.role !== 'teacher' && (full_name || grade_or_position !== undefined)) {
      logAuditEvent({
        userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
        actionType: 'profile_update',
        actionDescription: 'Updated own profile',
        targetType: 'user', targetId: req.user.id,
        metadata: { full_name, grade_or_position },
        ipAddress: req.ip
      });
    }

    if (req.user.role === 'teacher') {
      const updates = [];
      const params = [];

      if (bio !== undefined) {
        updates.push('bio = ?');
        params.push(sanitizeInput(bio));
      }
      if (subject !== undefined) {
        updates.push('subject = ?');
        params.push(subject);
      }
      if (department !== undefined) {
        updates.push('department = ?');
        params.push(department);
      }

      if (updates.length > 0) {
        params.push(req.user.id);
        db.prepare(`UPDATE teachers SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);

        logAuditEvent({
          userId: req.user.id,
          userRole: req.user.role,
          userName: req.user.full_name,
          actionType: 'profile_update',
          actionDescription: `Updated own profile (${updates.map(u => u.split(' =')[0]).join(', ')})`,
          targetType: 'teacher',
          metadata: { bio, subject, department },
          ipAddress: req.ip
        });
      }
    }

    const updated = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, org_id, verified_status, suspended, avatar_url FROM users WHERE id = ?').get(req.user.id);

    let teacherInfo = null;
    if (req.user.role === 'teacher') {
      teacherInfo = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
    }

    res.json({ message: 'Profile updated', user: updated, teacher: teacherInfo });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/auth/avatar
router.post('/avatar', authenticate, (req, res) => {
  try {
    const { avatar, filename } = req.body;
    const { saveAvatarFile, deleteAvatarFile } = require('../utils/avatars');

    if (req.user.role !== 'teacher' && req.user.role !== 'head') {
      return res.status(403).json({ error: 'Only teachers and school heads can upload avatars' });
    }

    let avatarUrl;
    try {
      avatarUrl = saveAvatarFile(avatar, req.user.id);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    if (req.user.avatar_url) {
      deleteAvatarFile(req.user.avatar_url);
    }

    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);

    if (req.user.role === 'teacher') {
      db.prepare('UPDATE teachers SET avatar_url = ? WHERE user_id = ?').run(avatarUrl, req.user.id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'avatar_upload',
      actionDescription: 'Updated profile photo',
      targetType: 'user',
      targetId: req.user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Avatar uploaded', avatar_url: avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// DELETE /api/auth/avatar
router.delete('/avatar', authenticate, (req, res) => {
  try {
    const { deleteAvatarFile } = require('../utils/avatars');

    if (!req.user.avatar_url) {
      return res.status(400).json({ error: 'No avatar to remove' });
    }

    deleteAvatarFile(req.user.avatar_url);

    db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.user.id);

    if (req.user.role === 'teacher') {
      db.prepare('UPDATE teachers SET avatar_url = NULL WHERE user_id = ?').run(req.user.id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'avatar_remove',
      actionDescription: 'Removed profile photo',
      targetType: 'user',
      targetId: req.user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Avatar removed' });
  } catch (err) {
    console.error('Avatar remove error:', err);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth');
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(decoded.id);
      if (user) {
        logAuditEvent({
          userId: user.id, userRole: user.role, userName: user.full_name,
          actionType: 'user_logout',
          actionDescription: 'Logged out',
          targetType: 'user', targetId: user.id,
          ipAddress: req.ip
        });
      }
    } catch (e) { /* token expired or invalid, skip logging */ }
  }
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// PUT /api/auth/language - save language preference
router.put('/language', authenticate, (req, res) => {
  try {
    const { language } = req.body;
    if (!['en', 'ru', 'uz'].includes(language)) {
      return res.status(400).json({ error: 'Invalid language' });
    }
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, req.user.id);
    res.json({ message: 'Language updated', language });
  } catch (err) {
    console.error('Language update error:', err);
    res.status(500).json({ error: 'Failed to update language' });
  }
});

module.exports = router;

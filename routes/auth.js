const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { generateToken, authenticate } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

// POST /api/auth/register - student self-registration (no email verification)
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, grade_or_position } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const sanitizedName = sanitizeInput(full_name);

    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status)
      VALUES (?, ?, ?, 'student', ?, 1, 1, 1)
    `).run(sanitizedName, email.toLowerCase(), hashedPassword, grade_or_position || null);

    const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, org_id, verified_status, avatar_url, language, is_student_council FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    logAuditEvent({
      userId: user.id,
      userRole: 'student',
      userName: sanitizedName,
      actionType: 'user_register',
      actionDescription: `Registered new account: ${email.toLowerCase()}`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/register-teacher - teacher self-registration via org invite code (no email verification)
router.post('/register-teacher', async (req, res) => {
  try {
    const { full_name, email, password, invite_code, department_id, department } = req.body;

    if (!full_name || !email || !password || !invite_code) {
      return res.status(400).json({ error: 'Name, email, password, and invite code are required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const org = db.prepare('SELECT * FROM organizations WHERE invite_code = ?').get(invite_code.trim().toUpperCase());
    if (!org) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const sanitizedName = sanitizeInput(full_name.trim());

    // Resolve department name from department_id if provided, or use free-text fallback
    const orgDepartments = db.prepare('SELECT id, name FROM departments WHERE org_id = ?').all(org.id);
    let departmentName = null;
    if (orgDepartments.length > 0) {
      if (!department_id) {
        return res.status(400).json({ error: 'Please select a department' });
      }
      const dept = orgDepartments.find(d => d.id === parseInt(department_id));
      if (!dept) {
        return res.status(400).json({ error: 'Invalid department selection' });
      }
      departmentName = dept.name;
    } else if (department) {
      departmentName = sanitizeInput(department.trim()) || null;
    }

    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, school_id, org_id, verified_status)
      VALUES (?, ?, ?, 'teacher', 1, ?, 1)
    `).run(sanitizedName, email.toLowerCase(), hashedPassword, org.id);

    const userId = result.lastInsertRowid;

    db.prepare(`INSERT INTO teachers (user_id, full_name, school_id, org_id, department) VALUES (?, ?, 1, ?, ?)`)
      .run(userId, sanitizedName, org.id, departmentName);

    const user = db.prepare('SELECT id, full_name, email, role, org_id, verified_status, avatar_url, language, is_student_council FROM users WHERE id = ?').get(userId);
    const token = generateToken(user);

    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });

    logAuditEvent({
      userId: user.id, userRole: 'teacher', userName: sanitizedName,
      actionType: 'teacher_self_register',
      actionDescription: `Teacher self-registered via invite code for org: ${org.name}`,
      targetType: 'organization', targetId: org.id,
      orgId: org.id, ipAddress: req.ip
    });

    res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error('Teacher registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/invite-info - get org info from invite code (for join page UI)
router.get('/invite-info', (req, res) => {
  try {
    const { invite_code } = req.query;
    if (!invite_code) {
      return res.status(400).json({ error: 'Invite code required' });
    }
    const org = db.prepare('SELECT id, name FROM organizations WHERE invite_code = ?').get(invite_code.trim().toUpperCase());
    if (!org) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    const departments = db.prepare('SELECT id, name FROM departments WHERE org_id = ? ORDER BY name').all(org.id);
    res.json({ org_id: org.id, org_name: org.name, departments });
  } catch (err) {
    console.error('Invite info error:', err.message);
    res.status(500).json({ error: 'Failed to fetch invite info' });
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

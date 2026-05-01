const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate, authorize, authorizeOrg, ROLE_HIERARCHY } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { logAuditEvent, getAuditLogs, getAuditStats } = require('../utils/audit');
const { createNotifications } = require('../utils/notifications');
const { CRITERIA_CONFIG, CRITERIA_COUNT, CRITERIA_COLS } = require('../utils/criteriaConfig');

const router = express.Router();

// Helper: build org filter clause for queries
function orgFilter(req, alias, paramsList) {
  if (req.orgId) {
    paramsList.push(req.orgId);
    return ` AND ${alias}.org_id = ?`;
  }
  return '';
}

// ============ USER MANAGEMENT ============

// GET /api/admin/users
router.get('/users', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { role, search } = req.query;
    const params = [];
    let query = 'SELECT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.school_id, u.org_id, u.verified_status, u.suspended, u.avatar_url, u.is_student_council, u.created_at FROM users u WHERE u.org_id = ?';
    params.push(req.orgId || 1);

    if (role) { query += ' AND u.role = ?'; params.push(role); }
    if (search) { query += ' AND (u.full_name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    query += ' ORDER BY u.created_at DESC';
    const users = db.prepare(query).all(...params);
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/admin/users - create user (any role)
router.post('/users', authenticate, authorize('admin'), authorizeOrg, async (req, res) => {
  try {
    const { full_name, email, password, role, grade_or_position, subject, department, experience_years, bio } = req.body;

    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required' });
    }

    const validRoles = ['student', 'teacher', 'head', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // org_admin cannot create another org_admin
    if (role === 'admin') {
      return res.status(403).json({ error: 'You cannot create users with this role' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    const userOrgId = req.orgId || 1;

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(sanitizeInput(full_name), email.toLowerCase(), hashedPassword, role, grade_or_position || null, userOrgId || 1, userOrgId);

    // If teacher, create teacher profile
    if (role === 'teacher') {
      db.prepare(`
        INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(result.lastInsertRowid, sanitizeInput(full_name), subject || null, department || null, experience_years || 0, bio || null, userOrgId || 1, userOrgId);
    }

    const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, org_id, verified_status, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'user_create',
      actionDescription: `Created ${role} account for ${full_name} (${email.toLowerCase()})`,
      targetType: 'user', targetId: result.lastInsertRowid,
      metadata: { email: email.toLowerCase(), role, org_id: userOrgId },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.status(201).json(user);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/admin/users/:id - edit user profile
router.put('/users/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cannot edit org_admin users
    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'You cannot edit users with this role' });
    }

    const { full_name, email, grade_or_position, role } = req.body;

    // Cannot assign org_admin role
    if (role === 'admin') {
      return res.status(403).json({ error: 'You cannot assign this role' });
    }

    // Check email uniqueness if changing
    if (email && email.toLowerCase() !== user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email.toLowerCase(), req.params.id);
      if (existing) return res.status(409).json({ error: 'Email already in use' });
    }

    db.prepare(`
      UPDATE users SET
        full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        grade_or_position = COALESCE(?, grade_or_position),
        role = COALESCE(?, role)
      WHERE id = ?
    `).run(
      full_name ? sanitizeInput(full_name) : null,
      email ? email.toLowerCase() : null,
      grade_or_position,
      role,
      req.params.id
    );

    // If teacher, update teacher profile too
    if (user.role === 'teacher' && full_name) {
      db.prepare('UPDATE teachers SET full_name = ? WHERE user_id = ?')
        .run(sanitizeInput(full_name), req.params.id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'user_edit',
      actionDescription: `Edited user profile for ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      metadata: { changes: req.body },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT id, full_name, email, role, grade_or_position, org_id, verified_status, suspended FROM users WHERE id = ?')
      .get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit user error:', err);
    res.status(500).json({ error: 'Failed to edit user' });
  }
});

// POST /api/admin/users/:id/reset-password - admin resets user password
router.post('/users/:id/reset-password', authenticate, authorize('admin'), authorizeOrg, async (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'You cannot reset password for users with this role' });
    }

    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'password_reset',
      actionDescription: `Reset password for ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /api/admin/users/:id - permanently delete a user
router.delete('/users/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cannot delete yourself
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'You cannot delete users with this role' });
    }

    const userName = user.full_name;
    const userEmail = user.email;
    const userRole = user.role;

    // Delete cascades via foreign keys: teachers, classrooms, reviews, classroom_members, support_messages
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'user_delete',
      actionDescription: `Permanently deleted ${userRole} account: ${userName} (${userEmail})`,
      targetType: 'user',
      targetId: parseInt(req.params.id),
      metadata: { deleted_email: userEmail, deleted_role: userRole, deleted_name: userName },
      ipAddress: req.ip,
      orgId: req.orgId || null
    });

    res.json({ message: 'User permanently deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// PUT /api/admin/users/:id/council — toggle Student Council membership.
// Only valid for students. Audit-logged. The flag unlocks the publish button
// in the Student Voice sub-view; nothing else changes for the user.
router.put('/users/:id/council', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { is_council } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (user.role !== 'student') {
      return res.status(400).json({ error: 'Only students can be council members' });
    }
    const flag = is_council ? 1 : 0;
    db.prepare('UPDATE users SET is_student_council = ? WHERE id = ?').run(flag, user.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: flag ? 'council_grant' : 'council_revoke',
      actionDescription: `${flag ? 'Granted' : 'Revoked'} Student Council membership for ${user.full_name}`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      orgId: req.orgId || null,
    });

    res.json({ ok: true, is_student_council: flag });
  } catch (err) {
    console.error('Council toggle error:', err);
    res.status(500).json({ error: 'Failed to update council membership' });
  }
});

// POST /api/admin/backup — trigger an on-demand SQLite backup. Useful for
// verifying the persistent volume works and for ad-hoc snapshots before a
// risky data change. The actual file rotation / scheduling is in utils/backup.
router.post('/backup', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { runBackup, BACKUPS_DIR, BACKUP_KEEP } = require('../utils/backup');
    const filePath = await runBackup(db);
    const fs = require('fs');
    const path = require('path');
    const files = fs.existsSync(BACKUPS_DIR)
      ? fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.db')).sort().reverse()
      : [];

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'db_backup',
      actionDescription: `Manually triggered DB backup: ${path.basename(filePath)}`,
      targetType: 'system',
      ipAddress: req.ip,
      orgId: req.orgId || null
    });

    res.json({
      message: 'Backup created',
      file: path.basename(filePath),
      dir: BACKUPS_DIR,
      keep: BACKUP_KEEP,
      total: files.length,
      recent: files.slice(0, 5),
    });
  } catch (err) {
    console.error('Manual backup error:', err);
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

// POST /api/admin/users/:id/avatar — admin uploads/replaces a user's avatar
// Only teacher / head avatars are manageable (students don't have avatars).
router.post('/users/:id/avatar', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { saveAvatarFile, deleteAvatarFile } = require('../utils/avatars');
    const { avatar } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (user.role !== 'teacher' && user.role !== 'head') {
      return res.status(400).json({ error: 'Avatars are only supported for teachers and school heads' });
    }

    let avatarUrl;
    try {
      avatarUrl = saveAvatarFile(avatar, user.id);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Clean up the previous file so the volume doesn't accumulate orphans.
    if (user.avatar_url) deleteAvatarFile(user.avatar_url);

    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, user.id);
    if (user.role === 'teacher') {
      db.prepare('UPDATE teachers SET avatar_url = ? WHERE user_id = ?').run(avatarUrl, user.id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'user_avatar_update',
      actionDescription: `Updated avatar for ${user.role}: ${user.full_name}`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      orgId: req.orgId || null
    });

    res.json({ avatarUrl });
  } catch (err) {
    console.error('Admin avatar upload error:', err);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// DELETE /api/admin/users/:id/avatar
router.delete('/users/:id/avatar', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { deleteAvatarFile } = require('../utils/avatars');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (!user.avatar_url) {
      return res.status(400).json({ error: 'User has no avatar to remove' });
    }

    deleteAvatarFile(user.avatar_url);
    db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(user.id);
    if (user.role === 'teacher') {
      db.prepare('UPDATE teachers SET avatar_url = NULL WHERE user_id = ?').run(user.id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'user_avatar_remove',
      actionDescription: `Removed avatar for ${user.role}: ${user.full_name}`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      orgId: req.orgId || null
    });

    res.json({ message: 'Avatar removed' });
  } catch (err) {
    console.error('Admin avatar delete error:', err);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

// PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.org_id !== req.orgId) {
      return res.status(403).json({ error: 'User is not in your organization' });
    }
    if (user.role === 'admin') {
      return res.status(403).json({ error: 'You cannot suspend users with this role' });
    }

    const newStatus = user.suspended ? 0 : 1;
    db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(newStatus, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: newStatus ? 'user_suspend' : 'user_unsuspend',
      actionDescription: `${newStatus ? 'Suspended' : 'Unsuspended'} user ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      metadata: { user_email: user.email, user_role: user.role },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: newStatus ? 'User suspended' : 'User unsuspended', suspended: newStatus });
  } catch (err) {
    console.error('Suspend user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ============ TERM MANAGEMENT ============

// GET /api/admin/terms
router.get('/terms', authenticate, authorize('admin', 'head', 'teacher'), authorizeOrg, (req, res) => {
  try {
    const params = [];
    let query = 'SELECT t.*, o.name as org_name FROM terms t LEFT JOIN organizations o ON t.org_id = o.id WHERE 1=1';

    query += ' AND t.org_id = ?';
    params.push(req.orgId || req.user.org_id || 1);

    query += ' ORDER BY t.start_date DESC';
    const terms = db.prepare(query).all(...params);

    const termsWithPeriods = terms.map(term => {
      const periods = db.prepare(`
        SELECT fp.*,
          COUNT(fpc.classroom_id) as classroom_count,
          GROUP_CONCAT(fpc.classroom_id) as classroom_ids_csv
        FROM feedback_periods fp
        LEFT JOIN feedback_period_classrooms fpc ON fpc.feedback_period_id = fp.id
        WHERE fp.term_id = ?
        GROUP BY fp.id ORDER BY fp.id
      `).all(term.id).map(r => ({
        ...r,
        classroom_ids: r.classroom_ids_csv ? r.classroom_ids_csv.split(',').map(Number) : [],
        classroom_ids_csv: undefined
      }));
      return { ...term, periods };
    });

    res.json(termsWithPeriods);
  } catch (err) {
    console.error('List terms error:', err);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// POST /api/admin/terms
router.post('/terms', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    if (start_date >= end_date) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    const termOrgId = req.orgId || null;
    if (!termOrgId && req.user.role === 'admin') {
      return res.status(400).json({ error: 'Organization context required' });
    }

    // Auto-generate name if not provided
    const termName = (name && name.trim()) || `Term ${new Date(start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;

    const result = db.prepare(
      'INSERT INTO terms (name, start_date, end_date, school_id, org_id) VALUES (?, ?, ?, ?, ?)'
    ).run(termName, start_date, end_date, termOrgId || 1, termOrgId);

    // Auto-create one default feedback period spanning the whole term
    const termId = result.lastInsertRowid;
    const newPeriodResult = db.prepare(
      'INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status) VALUES (?, ?, ?, ?, 0)'
    ).run(termId, 'Feedback Period', start_date, end_date);
    // Assign all current org classrooms as a snapshot (new classrooms added later won't auto-join)
    if (termOrgId) {
      const orgCls = db.prepare('SELECT id FROM classrooms WHERE org_id = ?').all(termOrgId);
      if (orgCls.length > 0) {
        const insFpc = db.prepare('INSERT OR IGNORE INTO feedback_period_classrooms (feedback_period_id, classroom_id) VALUES (?, ?)');
        db.transaction(() => orgCls.forEach(c => insFpc.run(newPeriodResult.lastInsertRowid, c.id)))();
      }
    }

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
    const periods = db.prepare('SELECT * FROM feedback_periods WHERE term_id = ?').all(termId);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'term_create',
      actionDescription: `Created term: ${termName} (${start_date} to ${end_date})`,
      targetType: 'term',
      targetId: termId,
      metadata: { name, start_date, end_date, org_id: termOrgId },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.status(201).json({ ...term, periods });
  } catch (err) {
    console.error('Create term error:', err);
    res.status(500).json({ error: 'Failed to create term' });
  }
});

// PUT /api/admin/terms/:id
router.put('/terms/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { name, start_date, end_date, active_status, feedback_visible } = req.body;
    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    // org_admin can only modify terms in their org
    if (req.user.role === 'admin' && term.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Term does not belong to your organization' });
    }

    // Validate date range if either date is being updated
    const effectiveTermStart = start_date || term.start_date;
    const effectiveTermEnd = end_date || term.end_date;
    if (effectiveTermStart && effectiveTermEnd && effectiveTermStart >= effectiveTermEnd) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    // If activating, deactivate others in same org
    if (active_status === 1) {
      db.prepare('UPDATE terms SET active_status = 0 WHERE org_id = ?').run(term.org_id);
    }

    db.prepare(`
      UPDATE terms SET
        name = COALESCE(?, name),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        active_status = COALESCE(?, active_status),
        feedback_visible = COALESCE(?, feedback_visible)
      WHERE id = ?
    `).run(name, start_date, end_date, active_status, feedback_visible, req.params.id);

    const updated = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);

    const changes = [];
    if (name) changes.push(`name to "${name}"`);
    if (start_date) changes.push(`start date to ${start_date}`);
    if (end_date) changes.push(`end date to ${end_date}`);
    if (active_status !== undefined) changes.push(active_status ? 'activated' : 'deactivated');
    if (feedback_visible !== undefined) changes.push(feedback_visible ? 'feedback visible' : 'feedback hidden');

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: active_status === 1 ? 'term_activate' : 'term_update',
      actionDescription: `Updated term "${term.name}": ${changes.join(', ')}`,
      targetType: 'term',
      targetId: term.id,
      metadata: { name, start_date, end_date, active_status, feedback_visible },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json(updated);
  } catch (err) {
    console.error('Update term error:', err);
    res.status(500).json({ error: 'Failed to update term' });
  }
});

// DELETE /api/admin/terms/:id
router.delete('/terms/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    if (req.user.role === 'admin' && term.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Term does not belong to your organization' });
    }

    if (term.active_status) {
      return res.status(400).json({ error: 'Cannot delete an active term. Deactivate it first.' });
    }

    db.prepare('DELETE FROM terms WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'term_delete',
      actionDescription: `Deleted term "${term.name}" and all associated data`,
      targetType: 'term',
      targetId: term.id,
      metadata: { term_name: term.name },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Term and all associated data deleted successfully' });
  } catch (err) {
    console.error('Delete term error:', err);
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

// ============ FEEDBACK PERIOD MANAGEMENT ============

// GET /api/admin/feedback-periods
router.get('/feedback-periods', authenticate, authorize('admin', 'teacher', 'head'), authorizeOrg, (req, res) => {
  try {
    const { term_id } = req.query;
    const params = [];
    let query = `
      SELECT fp.*, t.name as term_name,
        COUNT(fpc.classroom_id) as classroom_count,
        GROUP_CONCAT(fpc.classroom_id) as classroom_ids_csv
      FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      LEFT JOIN feedback_period_classrooms fpc ON fpc.feedback_period_id = fp.id
      WHERE 1=1
    `;

    if (term_id) {
      query += ' AND fp.term_id = ?';
      params.push(term_id);
    }

    if (req.orgId) {
      query += ' AND t.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.org_id) {
      query += ' AND t.org_id = ?';
      params.push(req.user.org_id);
    }

    query += ' GROUP BY fp.id ORDER BY fp.term_id, fp.id';

    const rows = db.prepare(query).all(...params);
    const periods = rows.map(r => ({
      ...r,
      classroom_ids: r.classroom_ids_csv ? r.classroom_ids_csv.split(',').map(Number) : [],
      classroom_ids_csv: undefined
    }));
    res.json(periods);
  } catch (err) {
    console.error('List periods error:', err);
    res.status(500).json({ error: 'Failed to fetch feedback periods' });
  }
});

// POST /api/admin/feedback-periods
router.post('/feedback-periods', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { term_id, name, start_date, end_date, classroom_ids, teacher_private: tp } = req.body;
    if (!term_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'term_id, start_date, and end_date are required' });
    }
    if (!Array.isArray(classroom_ids) || classroom_ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one classroom' });
    }

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(term_id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    if (req.user.role === 'admin' && term.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Term does not belong to your organization' });
    }

    if (start_date >= end_date) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    if (term.start_date && start_date < term.start_date) {
      return res.status(400).json({ error: `Period start date cannot be before term start date (${term.start_date})` });
    }
    if (term.end_date && end_date > term.end_date) {
      return res.status(400).json({ error: `Period end date cannot be after term end date (${term.end_date})` });
    }

    // Check: no classroom already in another active period for this org
    const clP = classroom_ids.map(() => '?').join(',');
    const conflict = db.prepare(`
      SELECT fpc.classroom_id, fp.name as period_name
      FROM feedback_period_classrooms fpc
      JOIN feedback_periods fp ON fp.id = fpc.feedback_period_id
      JOIN terms t ON fp.term_id = t.id
      WHERE fp.active_status = 1 AND t.org_id = ?
        AND fpc.classroom_id IN (${clP})
      LIMIT 1
    `).get(term.org_id, ...classroom_ids);
    if (conflict) {
      return res.status(400).json({ error: `Classroom is already in active period "${conflict.period_name}". Close that period first.` });
    }

    const existingCount = db.prepare('SELECT COUNT(*) as c FROM feedback_periods WHERE term_id = ?').get(term_id).c;
    const periodName = (name && name.trim()) || `Period ${existingCount + 1}`;

    const periodId = db.transaction(() => {
      const r = db.prepare(
        'INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status, teacher_private) VALUES (?, ?, ?, ?, 0, ?)'
      ).run(term_id, periodName, start_date, end_date, tp !== undefined ? (tp ? 1 : 0) : 1);
      const pid = r.lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO feedback_period_classrooms (feedback_period_id, classroom_id) VALUES (?, ?)');
      classroom_ids.forEach(cid => ins.run(pid, cid));
      return pid;
    })();

    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(periodId);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'period_create',
      actionDescription: `Created feedback period: ${periodName} for term "${term.name}" (${classroom_ids.length} classrooms)`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: { term_id, name, start_date, end_date, classroom_ids },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.status(201).json({ ...period, classroom_ids });
  } catch (err) {
    console.error('Create period error:', err);
    res.status(500).json({ error: 'Failed to create feedback period' });
  }
});

// PUT /api/admin/feedback-periods/:id
router.put('/feedback-periods/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { active_status, name, start_date, end_date, classroom_ids, teacher_private } = req.body;
    const period = db.prepare(`
      SELECT fp.*, t.org_id FROM feedback_periods fp JOIN terms t ON fp.term_id = t.id WHERE fp.id = ?
    `).get(req.params.id);
    if (!period) return res.status(404).json({ error: 'Feedback period not found' });

    if (req.user.role === 'admin' && period.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Period does not belong to your organization' });
    }

    const effectiveStart = start_date || period.start_date;
    const effectiveEnd = end_date || period.end_date;
    if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    // Resolve the classroom list this period will cover after update
    const targetIds = Array.isArray(classroom_ids)
      ? classroom_ids
      : db.prepare('SELECT classroom_id FROM feedback_period_classrooms WHERE feedback_period_id = ?')
          .all(req.params.id).map(r => r.classroom_id);

    // Per-classroom mutual exclusion: when activating, ensure no covered classroom is in another active period
    if (active_status === 1 && targetIds.length > 0) {
      const clP = targetIds.map(() => '?').join(',');
      const conflict = db.prepare(`
        SELECT fpc.classroom_id, fp.name as period_name
        FROM feedback_period_classrooms fpc
        JOIN feedback_periods fp ON fp.id = fpc.feedback_period_id
        JOIN terms t ON fp.term_id = t.id
        WHERE fp.active_status = 1 AND fp.id != ? AND t.org_id = ?
          AND fpc.classroom_id IN (${clP})
        LIMIT 1
      `).get(req.params.id, period.org_id, ...targetIds);
      if (conflict) {
        return res.status(400).json({
          error: `A classroom in this period is already in active period "${conflict.period_name}". Close that period first.`
        });
      }
    }

    db.transaction(() => {
      // Update classroom assignments if provided
      if (Array.isArray(classroom_ids)) {
        db.prepare('DELETE FROM feedback_period_classrooms WHERE feedback_period_id = ?').run(req.params.id);
        const ins = db.prepare('INSERT OR IGNORE INTO feedback_period_classrooms (feedback_period_id, classroom_id) VALUES (?, ?)');
        classroom_ids.forEach(cid => ins.run(req.params.id, cid));
      }
      db.prepare(`
        UPDATE feedback_periods SET
          name = COALESCE(?, name),
          active_status = COALESCE(?, active_status),
          start_date = COALESCE(?, start_date),
          end_date = COALESCE(?, end_date),
          teacher_private = COALESCE(?, teacher_private)
        WHERE id = ?
      `).run(name || null, active_status ?? null, start_date || null, end_date || null, teacher_private ?? null, req.params.id);
    })();

    const updated = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: active_status === 1 ? 'period_activate' : 'period_update',
      actionDescription: `${active_status === 1 ? 'Opened' : 'Updated'} feedback period: ${period.name}`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: { active_status, name, start_date, end_date, classroom_ids, teacher_private },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    // Notify only students enrolled in the covered classrooms
    if (active_status === 1 && targetIds.length > 0) {
      const clP = targetIds.map(() => '?').join(',');
      const members = db.prepare(`
        SELECT DISTINCT cm.student_id AS user_id
        FROM classroom_members cm
        WHERE cm.classroom_id IN (${clP})
      `).all(...targetIds);
      const userIds = members.map(m => m.user_id).filter(id => id !== req.user.id);
      const periodName = name || period.name;
      if (userIds.length > 0) {
        createNotifications({
          userIds,
          orgId: period.org_id,
          type: 'period_open',
          title: `Feedback period "${periodName}" is now open`,
          body: 'You can now submit teacher reviews for your enrolled classrooms.',
          link: 'student-review'
        });
      }
    }

    res.json(updated);
  } catch (err) {
    console.error('Update period error:', err);
    res.status(500).json({ error: 'Failed to update feedback period' });
  }
});

// DELETE /api/admin/feedback-periods/:id
router.delete('/feedback-periods/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const period = db.prepare(`
      SELECT fp.*, t.org_id, t.name as term_name FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id WHERE fp.id = ?
    `).get(req.params.id);
    if (!period) return res.status(404).json({ error: 'Feedback period not found' });

    if (req.user.role === 'admin' && period.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Period does not belong to your organization' });
    }

    const reviewCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE feedback_period_id = ?').get(req.params.id).count;
    if (reviewCount > 0) {
      return res.status(400).json({ error: `Cannot delete: ${reviewCount} review(s) exist for this period` });
    }

    db.prepare('DELETE FROM feedback_periods WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'period_delete',
      actionDescription: `Deleted feedback period: ${period.name} from term "${period.term_name}"`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: {},
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete period error:', err);
    res.status(500).json({ error: 'Failed to delete feedback period' });
  }
});

// ============ REVIEW MODERATION ============

// Helper to build review query with org scoping
function reviewQuery(statusFilter, req) {
  const params = [];
  let where = '';

  if (statusFilter) {
    where = `WHERE r.flagged_status = '${statusFilter}'`;
  }

  // Org scoping
  if (req.orgId) {
    where += (where ? ' AND' : 'WHERE') + ' r.org_id = ?';
    params.push(req.orgId);
  }

  return {
    sql: `
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        c.grade_level, fp.name as period_name, t.name as term_name,
        u.full_name as student_name, u.email as student_email, u.grade_or_position as student_grade
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN users u ON r.student_id = u.id
      ${where}
      ORDER BY r.created_at ${statusFilter ? 'ASC' : 'DESC'}
    `,
    params
  };
}

// GET /api/admin/reviews/pending
router.get('/reviews/pending', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { sql, params } = reviewQuery('pending', req);
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('Pending reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch pending reviews' });
  }
});

// GET /api/admin/reviews/flagged
router.get('/reviews/flagged', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { sql, params } = reviewQuery('flagged', req);
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('Flagged reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch flagged reviews' });
  }
});

// GET /api/admin/reviews/all
router.get('/reviews/all', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { sql, params } = reviewQuery(null, req);
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('All reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Helper for review ownership check
function checkReviewOrg(reviewId, req) {
  const review = db.prepare(`
    SELECT r.*, r.org_id as review_org_id, te.full_name as teacher_name, u.full_name as student_name
    FROM reviews r
    JOIN teachers te ON r.teacher_id = te.id
    JOIN users u ON r.student_id = u.id
    WHERE r.id = ?
  `).get(reviewId);

  if (review && req.user.role === 'admin' && review.review_org_id !== req.orgId) {
    return { error: true, review };
  }
  return { error: false, review };
}

// PUT /api/admin/reviews/:id/approve
router.put('/reviews/:id/approve', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { error, review } = checkReviewOrg(req.params.id, req);
    if (error) return res.status(403).json({ error: 'Review does not belong to your organization' });

    db.prepare("UPDATE reviews SET flagged_status = 'approved', approved_status = 1 WHERE id = ?")
      .run(req.params.id);

    if (review) {
      logAuditEvent({
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.full_name,
        actionType: 'review_approve',
        actionDescription: `Approved review from ${review.student_name} for ${review.teacher_name}`,
        targetType: 'review',
        targetId: review.id,
        metadata: { teacher_id: review.teacher_id, student_id: review.student_id, rating: review.overall_rating },
        ipAddress: req.ip,
        orgId: req.orgId
      });

      // Notify the student whose review was approved
      createNotifications({
        userIds: [review.student_id],
        orgId: review.review_org_id,
        type: 'review_approved',
        title: 'Your review has been approved',
        body: `Your feedback for ${review.teacher_name} is now visible.`,
        link: 'student-my-reviews'
      });
    }

    res.json({ message: 'Review approved' });
  } catch (err) {
    console.error('Approve review error:', err);
    res.status(500).json({ error: 'Failed to approve review' });
  }
});

// PUT /api/admin/reviews/:id/reject
router.put('/reviews/:id/reject', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { error, review } = checkReviewOrg(req.params.id, req);
    if (error) return res.status(403).json({ error: 'Review does not belong to your organization' });

    db.prepare("UPDATE reviews SET flagged_status = 'rejected', approved_status = 0 WHERE id = ?")
      .run(req.params.id);

    if (review) {
      logAuditEvent({
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.full_name,
        actionType: 'review_reject',
        actionDescription: `Rejected review from ${review.student_name} for ${review.teacher_name}`,
        targetType: 'review',
        targetId: review.id,
        metadata: { teacher_id: review.teacher_id, student_id: review.student_id, rating: review.overall_rating },
        ipAddress: req.ip,
        orgId: req.orgId
      });
    }

    res.json({ message: 'Review rejected' });
  } catch (err) {
    console.error('Reject review error:', err);
    res.status(500).json({ error: 'Failed to reject review' });
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { error, review } = checkReviewOrg(req.params.id, req);
    if (error) return res.status(403).json({ error: 'Review does not belong to your organization' });

    db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);

    if (review) {
      logAuditEvent({
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.full_name,
        actionType: 'review_delete',
        actionDescription: `Permanently deleted review from ${review.student_name} for ${review.teacher_name}`,
        targetType: 'review',
        targetId: review.id,
        metadata: { teacher_id: review.teacher_id, student_id: review.student_id, rating: review.overall_rating },
        ipAddress: req.ip,
        orgId: req.orgId
      });
    }

    res.json({ message: 'Review permanently removed' });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// POST /api/admin/reviews/bulk-approve - bulk approve pending reviews
router.post('/reviews/bulk-approve', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { review_ids } = req.body;
    if (!review_ids || !Array.isArray(review_ids) || review_ids.length === 0) {
      return res.status(400).json({ error: 'review_ids array is required' });
    }

    // Org scoping: only approve reviews in the admin's org
    let ids = review_ids;
    if (req.user.role === 'admin' && req.orgId) {
      const orgReviews = db.prepare(
        `SELECT id FROM reviews WHERE id IN (${review_ids.map(() => '?').join(',')}) AND org_id = ?`
      ).all(...review_ids, req.orgId);
      ids = orgReviews.map(r => r.id);
    }

    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`
        UPDATE reviews
        SET flagged_status = 'approved', approved_status = 1
        WHERE id IN (${placeholders})
      `).run(...ids);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'review_bulk_approve',
      actionDescription: `Bulk approved ${ids.length} reviews`,
      targetType: 'review',
      metadata: { count: ids.length, review_ids: ids },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: `Approved ${ids.length} reviews`, count: ids.length });
  } catch (err) {
    console.error('Bulk approve error:', err);
    res.status(500).json({ error: 'Failed to bulk approve reviews' });
  }
});

// ============ CLASSROOM MANAGEMENT ============

// GET /api/admin/classrooms - list all classrooms
router.get('/classrooms', authenticate, authorize('admin', 'head'), authorizeOrg, (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (req.orgId) {
      where += ' AND c.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.org_id) {
      where += ' AND c.org_id = ?';
      params.push(req.user.org_id);
    }

    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        o.name as org_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      LEFT JOIN organizations o ON c.org_id = o.id
      ${where}
      ORDER BY c.created_at DESC
    `).all(...params);

    res.json(classrooms);
  } catch (err) {
    console.error('List classrooms error:', err);
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

// PUT /api/admin/classrooms/:id - edit classroom
router.put('/classrooms/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const { subject, grade_level, teacher_id, term_id, active_status } = req.body;

    if (subject !== undefined && !subject?.trim()) {
      return res.status(400).json({ error: 'Subject cannot be empty' });
    }
    if (grade_level !== undefined && !grade_level?.trim()) {
      return res.status(400).json({ error: 'Grade level cannot be empty' });
    }

    db.prepare(`
      UPDATE classrooms SET
        subject = COALESCE(?, subject),
        grade_level = COALESCE(?, grade_level),
        teacher_id = COALESCE(?, teacher_id),
        term_id = COALESCE(?, term_id),
        active_status = COALESCE(?, active_status)
      WHERE id = ?
    `).run(subject, grade_level, teacher_id, term_id, active_status, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_edit',
      actionDescription: `Edited classroom ${classroom.subject} (${classroom.grade_level})`,
      targetType: 'classroom',
      targetId: classroom.id,
      metadata: { changes: req.body },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit classroom error:', err);
    res.status(500).json({ error: 'Failed to edit classroom' });
  }
});

// DELETE /api/admin/classrooms/:id - delete classroom
router.delete('/classrooms/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    db.prepare('DELETE FROM classrooms WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_delete',
      actionDescription: `Deleted classroom ${classroom.subject} (${classroom.grade_level})`,
      targetType: 'classroom',
      targetId: classroom.id,
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Classroom deleted successfully' });
  } catch (err) {
    console.error('Delete classroom error:', err);
    res.status(500).json({ error: 'Failed to delete classroom' });
  }
});

// POST /api/admin/classrooms/:id/add-student - add student to classroom
router.post('/classrooms/:id/add-student', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });

    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(student_id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const existing = db.prepare('SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?')
      .get(req.params.id, student_id);
    if (existing) return res.status(409).json({ error: 'Student already in classroom' });

    db.prepare('INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)')
      .run(req.params.id, student_id);

    // Auto-associate student with the classroom's org
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_add_student',
      actionDescription: `Added ${student.full_name} to classroom ${classroom.subject}`,
      targetType: 'classroom',
      targetId: classroom.id,
      metadata: { student_id, student_name: student.full_name },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Student added to classroom' });
  } catch (err) {
    console.error('Add student error:', err);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// DELETE /api/admin/classrooms/:id/remove-student/:student_id - remove student
router.delete('/classrooms/:id/remove-student/:student_id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (classroom && req.user.role === 'admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const result = db.prepare('DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?')
      .run(req.params.id, req.params.student_id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Student not in classroom' });
    }

    const student = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.params.student_id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_remove_student',
      actionDescription: `Removed ${student?.full_name} from classroom ${classroom?.subject}`,
      targetType: 'classroom',
      targetId: parseInt(req.params.id),
      metadata: { student_id: req.params.student_id },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Student removed from classroom' });
  } catch (err) {
    console.error('Remove student error:', err);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

// ============ STUDENT SUBMISSION TRACKING ============

// GET /api/admin/submission-tracking
router.get('/submission-tracking', authenticate, authorize('admin', 'head'), authorizeOrg, (req, res) => {
  try {
    const { classroom_id, feedback_period_id } = req.query;

    if (!classroom_id || !feedback_period_id) {
      return res.status(400).json({ error: 'classroom_id and feedback_period_id are required' });
    }

    // Org ownership check
    const classroom = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE c.id = ?
    `).get(classroom_id);

    if (classroom && req.user.role === 'admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const students = db.prepare(`
      SELECT u.id, u.full_name, u.email, u.grade_or_position, cm.joined_at
      FROM classroom_members cm
      JOIN users u ON cm.student_id = u.id
      WHERE cm.classroom_id = ?
      ORDER BY u.full_name
    `).all(classroom_id);

    const studentsWithStatus = students.map(student => {
      const review = db.prepare(`
        SELECT id, overall_rating, flagged_status, created_at
        FROM reviews
        WHERE student_id = ? AND classroom_id = ? AND feedback_period_id = ?
      `).get(student.id, classroom_id, feedback_period_id);

      return {
        ...student,
        submitted: review !== undefined,
        review_id: review?.id,
        overall_rating: review?.overall_rating,
        flagged_status: review?.flagged_status,
        submitted_at: review?.created_at
      };
    });

    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(feedback_period_id);

    const submitted = studentsWithStatus.filter(s => s.submitted).length;
    const total = studentsWithStatus.length;

    res.json({
      classroom,
      period,
      students: studentsWithStatus,
      summary: {
        total_students: total,
        submitted: submitted,
        not_submitted: total - submitted,
        completion_rate: total > 0 ? Math.round((submitted / total) * 100) : 100
      }
    });
  } catch (err) {
    console.error('Submission tracking error:', err);
    res.status(500).json({ error: 'Failed to fetch submission tracking' });
  }
});

// GET /api/admin/submission-overview
router.get('/submission-overview', authenticate, authorize('admin', 'head'), authorizeOrg, (req, res) => {
  try {
    const { feedback_period_id } = req.query;

    if (!feedback_period_id) {
      return res.status(400).json({ error: 'feedback_period_id is required' });
    }

    const params = [feedback_period_id];
    let where = 'WHERE c.active_status = 1';

    if (req.orgId) {
      where += ' AND c.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.org_id) {
      where += ' AND c.org_id = ?';
      params.push(req.user.org_id);
    }

    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as total_students,
        (SELECT COUNT(DISTINCT student_id) FROM reviews WHERE classroom_id = c.id AND feedback_period_id = ?) as submitted_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      ${where}
      ORDER BY c.subject, c.grade_level
    `).all(...params);

    const classroomsWithRates = classrooms.map(c => ({
      ...c,
      not_submitted: c.total_students - c.submitted_count,
      completion_rate: c.total_students > 0 ? Math.round((c.submitted_count / c.total_students) * 100) : 100
    }));

    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(feedback_period_id);

    const totalStudents = classrooms.reduce((sum, c) => sum + c.total_students, 0);
    const totalSubmitted = classrooms.reduce((sum, c) => sum + c.submitted_count, 0);

    res.json({
      period,
      classrooms: classroomsWithRates,
      summary: {
        total_classrooms: classrooms.length,
        total_students: totalStudents,
        total_submitted: totalSubmitted,
        total_not_submitted: totalStudents - totalSubmitted,
        overall_completion_rate: totalStudents > 0 ? Math.round((totalSubmitted / totalStudents) * 100) : 100
      }
    });
  } catch (err) {
    console.error('Submission overview error:', err);
    res.status(500).json({ error: 'Failed to fetch submission overview' });
  }
});

// ============ TEACHER FEEDBACK VIEWING ============

// GET /api/admin/teacher/:id/feedback
router.get('/teacher/:id/feedback', authenticate, authorize('admin', 'head'), authorizeOrg, (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    // Org check
    if (['admin', 'head'].includes(req.user.role) && teacher.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Teacher does not belong to your organization' });
    }

    const { term_id, period_id, classroom_id } = req.query;

    const adminCritCols = CRITERIA_COLS.map(c => `r.${c}`).join(', ');
    // Heads now see all approved reviews; teacher_private gate removed pre-pilot.
    const adminVisFilter = '';
    let query = `
      SELECT r.id, r.overall_rating, ${adminCritCols},
        r.feedback_text, r.tags, r.created_at, r.flagged_status, r.approved_status,
        c.subject as classroom_subject, c.grade_level,
        fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.teacher_id = ? AND r.approved_status = 1 ${adminVisFilter}
    `;
    const params = [req.params.id];

    if (term_id) { query += ' AND r.term_id = ?'; params.push(term_id); }
    if (period_id) { query += ' AND r.feedback_period_id = ?'; params.push(period_id); }
    if (classroom_id) { query += ' AND r.classroom_id = ?'; params.push(classroom_id); }

    query += ' ORDER BY r.created_at DESC';

    const reviews = db.prepare(query).all(...params);

    const { getTeacherScores, getRatingDistribution } = require('../utils/scoring');
    const fbVisRole = req.user.role === 'head' ? 'head' : undefined;
    const scores = getTeacherScores(teacher.id, {
      termId: term_id ? parseInt(term_id) : undefined,
      feedbackPeriodId: period_id ? parseInt(period_id) : undefined,
      classroomId: classroom_id ? parseInt(classroom_id) : undefined,
      visibilityRole: fbVisRole
    });

    const distribution = getRatingDistribution(teacher.id, {
      termId: term_id ? parseInt(term_id) : undefined,
      feedbackPeriodId: period_id ? parseInt(period_id) : undefined,
      classroomId: classroom_id ? parseInt(classroom_id) : undefined,
      visibilityRole: fbVisRole
    });

    res.json({ teacher, reviews, scores, distribution });
  } catch (err) {
    console.error('Teacher feedback error:', err);
    res.status(500).json({ error: 'Failed to fetch teacher feedback' });
  }
});

// GET /api/admin/teachers
router.get('/teachers', authenticate, authorize('admin', 'head'), authorizeOrg, (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (req.orgId) {
      where += ' AND org_id = ?';
      params.push(req.orgId);
    } else if (req.user.org_id) {
      where += ' AND org_id = ?';
      params.push(req.user.org_id);
    }

    const teachers = db.prepare(`SELECT * FROM teachers ${where} ORDER BY full_name`).all(...params);
    const { getTeacherScores } = require('../utils/scoring');

    const teachersWithStats = teachers.map(t => ({
      ...t,
      scores: getTeacherScores(t.id)
    }));

    res.json(teachersWithStats);
  } catch (err) {
    console.error('List teachers error:', err);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// PUT /api/admin/teachers/:id
router.put('/teachers/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    if (req.user.role === 'admin' && teacher.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Teacher does not belong to your organization' });
    }

    const { full_name, subject, department, experience_years, bio } = req.body;

    db.prepare(`
      UPDATE teachers SET
        full_name = COALESCE(?, full_name),
        subject = COALESCE(?, subject),
        department = COALESCE(?, department),
        experience_years = COALESCE(?, experience_years),
        bio = COALESCE(?, bio)
      WHERE id = ?
    `).run(
      full_name ? sanitizeInput(full_name) : null,
      subject, department, experience_years, bio, req.params.id
    );

    if (full_name && teacher.user_id) {
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?')
        .run(sanitizeInput(full_name), teacher.user_id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'teacher_edit',
      actionDescription: `Edited teacher profile for ${teacher.full_name}`,
      targetType: 'teacher',
      targetId: teacher.id,
      metadata: { changes: req.body },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit teacher error:', err);
    res.status(500).json({ error: 'Failed to edit teacher' });
  }
});

// ============ AUDIT LOGS ============

// GET /api/admin/audit-logs
router.get('/audit-logs', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { user_id, action_type, target_type, target_id, start_date, end_date, limit, offset } = req.query;

    const logs = getAuditLogs({
      userId: user_id ? parseInt(user_id) : undefined,
      actionType: action_type,
      targetType: target_type,
      targetId: target_id ? parseInt(target_id) : undefined,
      startDate: start_date,
      endDate: end_date,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
      orgId: req.orgId
    });

    res.json(logs);
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/admin/audit-stats
router.get('/audit-stats', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const stats = getAuditStats({
      startDate: start_date,
      endDate: end_date,
      orgId: req.orgId
    });

    res.json(stats);
  } catch (err) {
    console.error('Audit stats error:', err);
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

// ============ STATISTICS ============

// GET /api/admin/stats
router.get('/stats', authenticate, authorize('admin', 'head'), authorizeOrg, (req, res) => {
  try {
    let orgWhere = '';
    let orgWhereReviews = '';
    const params = [];
    const reviewParams = [];

    orgWhere = ' AND org_id = ?';
    orgWhereReviews = ' AND org_id = ?';

    const orgVal = req.orgId || req.user.org_id || 1;

    const buildParams = () => orgVal ? [orgVal] : [];

    const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE 1=1${orgWhere}`).get(...buildParams()).count;
    const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student'${orgWhere}`).get(...buildParams()).count;
    const totalTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'${orgWhere}`).get(...buildParams()).count;
    const totalClassrooms = db.prepare(`SELECT COUNT(*) as count FROM classrooms WHERE 1=1${orgWhere ? ' AND org_id = ?' : ''}`).get(...buildParams()).count;
    const totalReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE 1=1${orgWhereReviews}`).get(...buildParams()).count;
    const pendingReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE flagged_status = 'pending'${orgWhereReviews}`).get(...buildParams()).count;
    const flaggedReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE flagged_status = 'flagged'${orgWhereReviews}`).get(...buildParams()).count;
    const approvedReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE approved_status = 1${orgWhereReviews}`).get(...buildParams()).count;

    const avgRating = db.prepare(
      `SELECT ROUND(AVG(overall_rating), 2) as avg FROM reviews WHERE approved_status = 1${orgWhereReviews}`
    ).get(...buildParams()).avg;

    const ratingDist = db.prepare(
      `SELECT overall_rating as rating, COUNT(*) as count FROM reviews WHERE approved_status = 1${orgWhereReviews} GROUP BY overall_rating ORDER BY overall_rating`
    ).all(...buildParams());
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingDist.forEach(r => { ratingDistribution[r.rating] = r.count; });

    const totalAdmins = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin'${orgWhere}`).get(...buildParams()).count;
    const totalSchoolHeads = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'head'${orgWhere}`).get(...buildParams()).count;

    res.json({
      total_users: totalUsers,
      total_students: totalStudents,
      total_teachers: totalTeachers,
      total_admins: totalAdmins,
      total_school_heads: totalSchoolHeads,
      total_classrooms: totalClassrooms,
      total_reviews: totalReviews,
      pending_reviews: pendingReviews,
      flagged_reviews: flaggedReviews,
      approved_reviews: approvedReviews,
      average_rating: avgRating,
      rating_distribution: ratingDistribution
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// GET /api/admin/org-period-trend — per-feedback-period avg ratings for an org
router.get('/org-period-trend', authenticate, authorize('admin'), (req, res) => {
  try {
    const orgId = req.user.org_id || 1;

    const trendAvgCols = CRITERIA_CONFIG.map(c => `ROUND(AVG(NULLIF(r.${c.db_col},0)), 2) as avg_${c.slug}`).join(',\n        ');
    const trendSumExpr = CRITERIA_CONFIG.map(c => `AVG(NULLIF(r.${c.db_col},0))`).join(' + ');
    const periods = db.prepare(`
      SELECT
        fp.id, fp.name as period_name, t.id as term_id, t.name as term_name,
        fp.teacher_private,
        COUNT(r.id) as review_count,
        ROUND((${trendSumExpr}) / ${CRITERIA_COUNT}, 2) as avg_overall,
        ${trendAvgCols}
      FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      LEFT JOIN reviews r ON r.feedback_period_id = fp.id
        AND r.approved_status = 1 AND r.org_id = ?
      WHERE t.org_id = ?
      GROUP BY fp.id
      ORDER BY t.start_date ASC, fp.id ASC
    `).all(orgId, orgId);

    res.json(periods);
  } catch (err) {
    console.error('Org period trend error:', err);
    res.status(500).json({ error: 'Failed to fetch period trend' });
  }
});

// ============ SUPPORT MESSAGES MANAGEMENT ============

// GET /api/admin/support/messages
router.get('/support/messages', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const { status, user_id, category, limit, offset } = req.query;

    let query = 'SELECT sm.*, o.name as org_name FROM support_messages sm LEFT JOIN organizations o ON sm.org_id = o.id WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as count FROM support_messages sm WHERE 1=1';
    const params = [];
    const countParams = [];

    const orgId = req.orgId || req.user.org_id || 1;
    query += ' AND sm.org_id = ?';
    countQuery += ' AND sm.org_id = ?';
    params.push(orgId);
    countParams.push(orgId);

    if (status) {
      query += ' AND sm.status = ?';
      countQuery += ' AND sm.status = ?';
      params.push(status);
      countParams.push(status);
    }

    if (user_id) {
      query += ' AND sm.user_id = ?';
      countQuery += ' AND sm.user_id = ?';
      params.push(parseInt(user_id));
      countParams.push(parseInt(user_id));
    }

    if (category) {
      query += ' AND sm.category = ?';
      countQuery += ' AND sm.category = ?';
      params.push(category);
      countParams.push(category);
    }

    query += ' ORDER BY sm.created_at DESC';

    if (limit) { query += ' LIMIT ?'; params.push(parseInt(limit)); }
    if (offset) { query += ' OFFSET ?'; params.push(parseInt(offset)); }

    const messages = db.prepare(query).all(...params);
    const totalCount = db.prepare(countQuery).get(...countParams).count;

    res.json({ messages, total: totalCount });
  } catch (err) {
    console.error('List support messages error:', err);
    res.status(500).json({ error: 'Failed to fetch support messages' });
  }
});

// PUT /api/admin/support/messages/:id
router.put('/support/messages/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Support message not found' });

    const { status, admin_notes } = req.body;

    if (status && !['new', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updates = [];
    const params = [];

    if (status) { updates.push('status = ?'); params.push(status); }
    if (admin_notes !== undefined) { updates.push('admin_notes = ?'); params.push(admin_notes ? sanitizeInput(admin_notes) : null); }
    if (status === 'resolved') { updates.push('resolved_at = CURRENT_TIMESTAMP'); updates.push('resolved_by = ?'); params.push(req.user.id); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE support_messages SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'support_message_update',
      actionDescription: `Updated support message #${req.params.id} to status: ${status || 'updated'}`,
      targetType: 'support_message',
      targetId: parseInt(req.params.id),
      metadata: { status, admin_notes },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(req.params.id);

    // Notify the submitter when their message is resolved
    if (status === 'resolved' && message.user_id) {
      createNotifications({
        userIds: [message.user_id],
        orgId: message.org_id || null,
        type: 'support_resolved',
        title: 'Your support request has been resolved',
        body: message.subject,
        link: 'help'
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update support message error:', err);
    res.status(500).json({ error: 'Failed to update support message' });
  }
});

// DELETE /api/admin/support/messages/:id
router.delete('/support/messages/:id', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Support message not found' });

    db.prepare('DELETE FROM support_messages WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'support_message_delete',
      actionDescription: `Deleted support message #${req.params.id} from ${message.user_name}`,
      targetType: 'support_message',
      targetId: parseInt(req.params.id),
      metadata: { subject: message.subject, category: message.category },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Support message deleted successfully' });
  } catch (err) {
    console.error('Delete support message error:', err);
    res.status(500).json({ error: 'Failed to delete support message' });
  }
});

// GET /api/admin/support/stats
router.get('/support/stats', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  try {
    let orgFilter = '';
    const params = [];

    const orgIdForSupport = req.orgId || req.user.org_id || 1;
    orgFilter = ' AND org_id = ?';
    params.push(orgIdForSupport);

    const totalMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE 1=1${orgFilter}`).get(...params).count;
    const newMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE status = 'new'${orgFilter}`).get(...params).count;
    const inProgressMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE status = 'in_progress'${orgFilter}`).get(...params).count;
    const resolvedMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE status = 'resolved'${orgFilter}`).get(...params).count;

    const categoryBreakdown = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM support_messages WHERE 1=1${orgFilter}
      GROUP BY category
    `).all(...params);

    res.json({
      total: totalMessages,
      new: newMessages,
      in_progress: inProgressMessages,
      resolved: resolvedMessages,
      by_category: categoryBreakdown
    });
  } catch (err) {
    console.error('Support stats error:', err);
    res.status(500).json({ error: 'Failed to fetch support statistics' });
  }
});

// PUT /api/admin/org - rename the organization
router.put('/org', authenticate, authorize('admin'), authorizeOrg, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Organization name is required' });
  const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(req.orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(name.trim(), req.orgId);
  logAuditEvent({
    userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
    actionType: 'org_rename', actionDescription: `Renamed organization to: ${name.trim()}`,
    targetType: 'organization', targetId: req.orgId, ipAddress: req.ip, orgId: req.orgId
  });
  res.json({ message: 'Organization renamed', name: name.trim() });
});

// GET /api/admin/invite-code - get org's teacher invite code
router.get('/invite-code', authenticate, authorize('admin'), (req, res) => {
  const orgId = req.user.org_id || 1;
  const org = db.prepare('SELECT id, name, invite_code FROM organizations WHERE id = ?').get(orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ invite_code: org.invite_code, org_name: org.name });
});

// POST /api/admin/regenerate-invite-code - regenerate org's teacher invite code
router.post('/regenerate-invite-code', authenticate, authorize('admin'), (req, res) => {
  const orgId = req.user.org_id || 1;

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function genCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  let code;
  do { code = genCode(); } while (db.prepare('SELECT id FROM organizations WHERE invite_code = ?').get(code));

  db.prepare('UPDATE organizations SET invite_code = ? WHERE id = ?').run(code, orgId);

  logAuditEvent({
    userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
    actionType: 'invite_code_regenerate',
    actionDescription: 'Regenerated teacher invite code',
    targetType: 'organization', targetId: orgId,
    orgId: orgId, ipAddress: req.ip
  });

  res.json({ invite_code: code });
});

module.exports = router;

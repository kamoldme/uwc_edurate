const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

function generateJoinCode() {
  // Generate 8-digit numeric code
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

// GET /api/classrooms - list classrooms based on role
router.get('/', authenticate, (req, res) => {
  try {
    const { role, id: userId } = req.user;

    let classrooms;
    if (role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(userId);
      if (!teacher) return res.json([]);
      classrooms = db.prepare(`
        SELECT c.*, t.name as term_name,
          (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
        FROM classrooms c
        LEFT JOIN terms t ON c.term_id = t.id
        WHERE c.teacher_id = ?
        ORDER BY c.created_at DESC
      `).all(teacher.id);
    } else if (role === 'student') {
      classrooms = db.prepare(`
        SELECT c.*, t.name as term_name, te.full_name as teacher_name, te.subject as teacher_subject,
          te.avatar_url as teacher_avatar_url, cm.joined_at
        FROM classroom_members cm
        JOIN classrooms c ON cm.classroom_id = c.id
        LEFT JOIN terms t ON c.term_id = t.id
        JOIN teachers te ON c.teacher_id = te.id
        WHERE cm.student_id = ?
        ORDER BY cm.joined_at DESC
      `).all(userId);
    } else {
      // admin or school_head see all
      classrooms = db.prepare(`
        SELECT c.*, t.name as term_name, te.full_name as teacher_name,
          te.avatar_url as teacher_avatar_url,
          (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
        FROM classrooms c
        LEFT JOIN terms t ON c.term_id = t.id
        JOIN teachers te ON c.teacher_id = te.id
        ORDER BY c.created_at DESC
      `).all();
    }

    res.json(classrooms);
  } catch (err) {
    console.error('List classrooms error:', err);
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

// POST /api/classrooms - create classroom (teacher/admin)
router.post('/', authenticate, authorize('teacher', 'admin'), (req, res) => {
  try {
    const { subject, grade_level, term_id, kind } = req.body;

    if (!subject || !grade_level) {
      return res.status(400).json({ error: 'Subject and grade level are required' });
    }

    const classroomKind = kind === 'mentor' ? 'mentor' : 'academic';

    let teacherId;
    let orgId;

    if (req.user.role === 'teacher') {
      const teacher = db.prepare('SELECT id, org_id, is_mentor FROM teachers WHERE user_id = ?').get(req.user.id);
      if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });
      if (classroomKind === 'mentor' && !teacher.is_mentor) {
        return res.status(403).json({ error: 'You do not have mentor capability. Ask an admin to grant it.' });
      }
      teacherId = teacher.id;
      orgId = teacher.org_id;
    } else {
      teacherId = req.body.teacher_id;
      if (!teacherId) return res.status(400).json({ error: 'teacher_id is required for admin' });
      const teacher = db.prepare('SELECT org_id, is_mentor FROM teachers WHERE id = ?').get(teacherId);
      orgId = teacher?.org_id;
      if (classroomKind === 'mentor' && !teacher?.is_mentor) {
        return res.status(400).json({ error: 'Selected teacher does not have mentor capability.' });
      }
    }

    // term_id is optional — classrooms persist across terms
    const resolvedTermId = term_id || null;

    const join_code = generateJoinCode();

    const result = db.prepare(`
      INSERT INTO classrooms (teacher_id, subject, grade_level, term_id, join_code, org_id, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(teacherId, subject, grade_level, resolvedTermId, join_code, orgId, classroomKind);

    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(result.lastInsertRowid);

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_create',
      actionDescription: `Created classroom: ${subject} (${grade_level})`,
      targetType: 'classroom',
      targetId: result.lastInsertRowid,
      metadata: { subject, grade_level, term_id, teacher_id: teacherId },
      ipAddress: req.ip
    });

    res.status(201).json(classroom);
  } catch (err) {
    console.error('Create classroom error:', err);
    res.status(500).json({ error: 'Failed to create classroom' });
  }
});

// GET /api/classrooms/:id - classroom detail
router.get('/:id', authenticate, (req, res) => {
  try {
    const classroom = db.prepare(`
      SELECT c.*, t.name as term_name, te.full_name as teacher_name, te.subject as teacher_subject,
        te.avatar_url as teacher_avatar_url
      FROM classrooms c
      LEFT JOIN terms t ON c.term_id = t.id
      JOIN teachers te ON c.teacher_id = te.id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    const members = db.prepare(`
      SELECT cm.id, cm.joined_at, u.full_name, u.email, u.grade_or_position
      FROM classroom_members cm
      JOIN users u ON cm.student_id = u.id
      WHERE cm.classroom_id = ?
      ORDER BY cm.joined_at
    `).all(req.params.id);

    // Students only see member count, not details
    if (req.user.role === 'student') {
      res.json({ ...classroom, member_count: members.length });
    } else {
      res.json({ ...classroom, members });
    }
  } catch (err) {
    console.error('Get classroom error:', err);
    res.status(500).json({ error: 'Failed to fetch classroom' });
  }
});

// POST /api/classrooms/join - student joins via code
router.post('/join', authenticate, authorize('student'), (req, res) => {
  try {
    const { join_code } = req.body;
    if (!join_code) return res.status(400).json({ error: 'Join code is required' });

    // Strip formatting (dashes, spaces) — accept XXXX-XXXX or XXXXXXXX
    const cleanCode = String(join_code).replace(/\D/g, '');

    const classroom = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, te.avatar_url as teacher_avatar_url
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      WHERE c.join_code = ? AND c.active_status = 1
    `).get(cleanCode);

    if (!classroom) return res.status(404).json({ error: 'Invalid or inactive join code' });

    // Check if already a member
    const existing = db.prepare(
      'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
    ).get(classroom.id, req.user.id);

    if (existing) return res.status(409).json({ error: 'You are already in this classroom' });

    db.prepare(
      'INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)'
    ).run(classroom.id, req.user.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'classroom_join',
      actionDescription: `Joined classroom: ${classroom.subject} with ${classroom.teacher_name}`,
      targetType: 'classroom', targetId: classroom.id,
      metadata: { teacher_id: classroom.teacher_id, join_code },
      ipAddress: req.ip
    });

    res.status(201).json({ message: `Joined ${classroom.subject} with ${classroom.teacher_name}`, classroom });
  } catch (err) {
    console.error('Join classroom error:', err);
    res.status(500).json({ error: 'Failed to join classroom' });
  }
});

// PATCH /api/classrooms/:id - edit classroom (teacher owns it, or admin)
router.patch('/:id', authenticate, authorize('teacher', 'admin'), (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
      if (!teacher || classroom.teacher_id !== teacher.id) {
        return res.status(403).json({ error: 'Not your classroom' });
      }
    }

    const subject = req.body.subject?.trim() || classroom.subject;
    const grade_level = req.body.grade_level?.trim() || classroom.grade_level;
    const active_status = req.body.active_status !== undefined ? req.body.active_status : classroom.active_status;

    db.prepare('UPDATE classrooms SET subject = ?, grade_level = ?, active_status = ? WHERE id = ?')
      .run(subject, grade_level, active_status, req.params.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'classroom_edit',
      actionDescription: `Edited classroom: ${subject} (${grade_level})`,
      targetType: 'classroom', targetId: parseInt(req.params.id),
      ipAddress: req.ip
    });

    res.json({ message: 'Classroom updated', subject, grade_level });
  } catch (err) {
    console.error('Edit classroom error:', err);
    res.status(500).json({ error: 'Failed to update classroom' });
  }
});

// DELETE /api/classrooms/:id - delete classroom (teacher owns it, or admin)
router.delete('/:id', authenticate, authorize('teacher', 'admin'), (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
      if (!teacher || classroom.teacher_id !== teacher.id) {
        return res.status(403).json({ error: 'Not your classroom' });
      }
    }

    db.prepare('DELETE FROM classrooms WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'classroom_delete',
      actionDescription: `Deleted classroom: ${classroom.subject} (${classroom.grade_level})`,
      targetType: 'classroom', targetId: parseInt(req.params.id),
      ipAddress: req.ip
    });

    res.json({ message: 'Classroom deleted' });
  } catch (err) {
    console.error('Delete classroom error:', err);
    res.status(500).json({ error: 'Failed to delete classroom' });
  }
});

// POST /api/classrooms/:id/regenerate-code - teacher regenerates join code
router.post('/:id/regenerate-code', authenticate, authorize('teacher', 'admin'), (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
      if (!teacher || classroom.teacher_id !== teacher.id) {
        return res.status(403).json({ error: 'Not your classroom' });
      }
    }

    const newCode = generateJoinCode();
    db.prepare('UPDATE classrooms SET join_code = ? WHERE id = ?').run(newCode, req.params.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'join_code_regenerate',
      actionDescription: `Regenerated join code for classroom: ${classroom.subject}`,
      targetType: 'classroom', targetId: parseInt(req.params.id),
      ipAddress: req.ip
    });

    res.json({ join_code: newCode });
  } catch (err) {
    console.error('Regenerate code error:', err);
    res.status(500).json({ error: 'Failed to regenerate code' });
  }
});

// DELETE /api/classrooms/:id/leave - student leaves classroom
router.delete('/:id/leave', authenticate, authorize('student'), (req, res) => {
  try {
    const result = db.prepare(
      'DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
    ).run(req.params.id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'You are not a member of this classroom' });
    }

    const classroom = db.prepare('SELECT subject FROM classrooms WHERE id = ?').get(req.params.id);
    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'classroom_leave',
      actionDescription: `Left classroom: ${classroom?.subject || 'Unknown'}`,
      targetType: 'classroom', targetId: parseInt(req.params.id),
      ipAddress: req.ip
    });

    res.json({ message: 'Left classroom successfully' });
  } catch (err) {
    console.error('Leave classroom error:', err);
    res.status(500).json({ error: 'Failed to leave classroom' });
  }
});

// GET /api/classrooms/:id/members - get members
router.get('/:id/members', authenticate, authorize('teacher', 'admin', 'head', 'student'), (req, res) => {
  try {
    // Students can only view members of classrooms they are enrolled in
    if (req.user.role === 'student') {
      const enrolled = db.prepare(
        'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
      ).get(req.params.id, req.user.id);
      if (!enrolled) return res.status(403).json({ error: 'You are not a member of this classroom' });
    }

    const members = db.prepare(`
      SELECT cm.id, cm.joined_at, u.id as student_id, u.full_name, u.email, u.grade_or_position
      FROM classroom_members cm
      JOIN users u ON cm.student_id = u.id
      WHERE cm.classroom_id = ?
      ORDER BY u.full_name
    `).all(req.params.id);

    res.json(members);
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// DELETE /api/classrooms/:id/members/:studentId - remove student from classroom (teacher/admin)
router.delete('/:id/members/:studentId', authenticate, authorize('teacher', 'admin'), (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
      if (!teacher || classroom.teacher_id !== teacher.id) {
        return res.status(403).json({ error: 'Not your classroom' });
      }
    }

    const result = db.prepare(
      'DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
    ).run(req.params.id, req.params.studentId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Student is not a member of this classroom' });
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'member_remove',
      actionDescription: `Removed student ${req.params.studentId} from classroom ${classroom.subject}`,
      targetType: 'classroom_member',
      targetId: req.params.id,
      metadata: { classroom_id: req.params.id, student_id: req.params.studentId },
      ipAddress: req.ip
    });

    res.json({ message: 'Student removed from classroom' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

module.exports = router;

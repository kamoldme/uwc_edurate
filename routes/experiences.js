// Experience Map — student-authored reflections tied to UWC values.
//
// Privacy model (revised 2026-05): reflections are PRIVATE to the student.
// Head of school and admins see ONLY aggregate counts — total reflections,
// per-value tallies, per-category tallies, monthly engagement, and per-
// student counts (no titles, no reflection text, no values per-student).
// The /head/student/:id endpoint and the consent flow were removed when
// the visibility model flipped. The consent table is left in place so
// existing rows aren't lost; nothing reads from it any more.
const express = require('express');
const db = require('../database');
const { authenticate, authorize, authorizeOrg } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

// Source of truth for categories + UWC values. Frontend reads /experiences/config.
const CATEGORIES = [
  'CAS',
  'Explore Armenia / Project Week',
  'Exeat Weekends',
  'Regional Evenings',
  'Academic Subjects',
  'Residential Life / Toon Time',
  'LOTs',
  'Monday Briefings',
  'Leadership & Student Voice',
  'Global Issues Forum (GIFs)',
];

const VALUES = [
  'Intercultural understanding',
  'Celebration of difference',
  'Personal responsibility and integrity',
  'Mutual responsibility and respect',
  'Compassion and service',
  'Respect for the environment',
  'A sense of idealism',
  'Personal challenge',
  'Action and personal example',
];

const MIN_REFLECTION = 50;
const MAX_REFLECTION = 4000;
const MAX_TITLE = 120;
const MAX_CATEGORY = 60;

function validatePayload(body) {
  const errors = [];
  const title = String(body.title || '').trim();
  const category = String(body.category || '').trim();
  const date = String(body.experience_date || body.date || '').trim();
  const reflection = String(body.reflection || '').trim();
  const valuesRaw = body.values;

  if (!title) errors.push('Title is required.');
  if (title.length > MAX_TITLE) errors.push(`Title must be at most ${MAX_TITLE} characters.`);
  if (!category) errors.push('Choose a category.');
  if (category.length > MAX_CATEGORY) errors.push(`Category must be at most ${MAX_CATEGORY} characters.`);
  if (!date || isNaN(Date.parse(date))) errors.push('Pick a valid date.');
  if (date) {
    const d = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const earliest = new Date('2010-01-01');
    if (d > today) errors.push('Experience date cannot be in the future.');
    if (d < earliest) errors.push('Experience date is unrealistically old.');
  }
  if (reflection.length < MIN_REFLECTION) errors.push(`Reflection must be at least ${MIN_REFLECTION} characters.`);
  if (reflection.length > MAX_REFLECTION) errors.push(`Reflection must be at most ${MAX_REFLECTION} characters.`);

  let values;
  if (!Array.isArray(valuesRaw)) {
    errors.push('Values must be a list.');
    values = [];
  } else {
    values = [...new Set(valuesRaw.map(v => String(v).trim()).filter(Boolean))];
    if (values.length < 1) errors.push('Pick at least one UWC value.');
    if (values.length > 3) errors.push('You can select up to 3 values for each experience.');
    const invalid = values.filter(v => !VALUES.includes(v));
    if (invalid.length) errors.push(`Unknown values: ${invalid.join(', ')}`);
  }

  return { errors, clean: { title, category, date, reflection, values } };
}

function rowToDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    student_id: row.student_id,
    student_name: row.student_name || null,
    title: row.title,
    category: row.category,
    date: row.experience_date,
    values: JSON.parse(row.values_json || '[]'),
    reflection: row.reflection,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// GET /api/experiences/config — categories + values for the form
router.get('/config', authenticate, (req, res) => {
  res.json({
    categories: CATEGORIES,
    values: VALUES,
    limits: { min_reflection: MIN_REFLECTION, max_reflection: MAX_REFLECTION, max_title: MAX_TITLE, max_values: 3 },
  });
});

// GET /api/experiences/mine — student's own experiences
router.get('/mine', authenticate, authorize('student'), (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM experiences WHERE student_id = ?
    ORDER BY experience_date DESC, created_at DESC
  `).all(req.user.id);
  res.json(rows.map(rowToDTO));
});

// POST /api/experiences — create
router.post('/', authenticate, authorize('student'), authorizeOrg, (req, res) => {
  const { errors, clean } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const result = db.prepare(`
    INSERT INTO experiences (student_id, org_id, school_id, title, category, experience_date, values_json, reflection, consented_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    req.user.id,
    req.orgId,
    req.user.school_id || 1,
    clean.title,
    clean.category,
    clean.date,
    JSON.stringify(clean.values),
    clean.reflection
  );

  logAuditEvent({
    userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
    actionType: 'experience_create',
    actionDescription: `Added experience "${clean.title}" (${clean.category})`,
    targetType: 'experience', targetId: result.lastInsertRowid,
    metadata: { category: clean.category, values: clean.values },
    ipAddress: req.ip, orgId: req.orgId,
  });

  const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(rowToDTO(row));
});

// PATCH /api/experiences/:id — owner only
router.patch('/:id', authenticate, authorize('student'), authorizeOrg, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.student_id !== req.user.id) return res.status(403).json({ error: 'Not your experience' });

  const { errors, clean } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  // experience_date is immutable after creation. The client-side form hides
  // the field; the server enforces it by always reusing the existing row's
  // date, ignoring whatever the client submits.
  db.prepare(`
    UPDATE experiences
    SET title = ?, category = ?, values_json = ?, reflection = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(clean.title, clean.category, JSON.stringify(clean.values), clean.reflection, id);

  logAuditEvent({
    userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
    actionType: 'experience_update',
    actionDescription: `Edited experience "${clean.title}"`,
    targetType: 'experience', targetId: id,
    metadata: { category: clean.category, values: clean.values },
    ipAddress: req.ip, orgId: req.orgId,
  });

  const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id);
  res.json(rowToDTO(row));
});

// DELETE /api/experiences/:id — owner only
router.delete('/:id', authenticate, authorize('student'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM experiences WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.student_id !== req.user.id) return res.status(403).json({ error: 'Not your experience' });

  db.prepare('DELETE FROM experiences WHERE id = ?').run(id);

  logAuditEvent({
    userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
    actionType: 'experience_delete',
    actionDescription: `Deleted experience "${existing.title}"`,
    targetType: 'experience', targetId: id,
    ipAddress: req.ip, orgId: req.user.org_id || 1,
  });

  res.json({ ok: true });
});

// ============ HEAD VIEW — aggregates only (private model) ============
// No reflection text, no values-per-student, no individual content. Just
// counts of how many reflections were submitted, broken down by value /
// category / month, plus a per-student count for engagement tracking.

// GET /api/experiences/head/overview — aggregate counts across all reflections.
// No time scoping: students reflect whenever they want, the head just sees
// the rolling total. Returns headline stats (total, top value, top category)
// plus the by-value/by-category breakdowns and the per-student count table.
router.get('/head/overview', authenticate, authorize('head', 'admin'), authorizeOrg, (req, res) => {
  const baseFilter = 'WHERE e.org_id = ?';
  const baseArgs = [req.orgId];

  const totals = db.prepare(`
    SELECT COUNT(*) as total_experiences
    FROM experiences e ${baseFilter}
  `).get(...baseArgs);

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM experiences e ${baseFilter}
    GROUP BY category ORDER BY count DESC
  `).all(...baseArgs);

  const allRows = db.prepare(`SELECT values_json FROM experiences e ${baseFilter}`).all(...baseArgs);
  const valueCounts = Object.fromEntries(VALUES.map(v => [v, 0]));
  allRows.forEach(r => {
    try {
      JSON.parse(r.values_json || '[]').forEach(v => {
        if (valueCounts[v] !== undefined) valueCounts[v]++;
      });
    } catch (_) {}
  });
  const byValue = VALUES.map(v => ({ value: v, count: valueCounts[v] }))
    .sort((a, b) => b.count - a.count);

  const perStudentRows = db.prepare(`
    SELECT u.id as student_id, u.full_name as student_name, u.grade_or_position as grade
    FROM users u
    WHERE u.role = 'student' AND COALESCE(u.org_id, 1) = ?
    ORDER BY u.full_name ASC
  `).all(req.orgId);

  const studentCountsRows = db.prepare(`
    SELECT student_id, COUNT(id) as count, MAX(experience_date) as last_date
    FROM experiences e ${baseFilter}
    GROUP BY student_id
  `).all(...baseArgs);
  const countsMap = Object.fromEntries(studentCountsRows.map(r => [r.student_id, r]));

  const perStudent = perStudentRows.map(s => ({
    student_id: s.student_id,
    student_name: s.student_name,
    grade: s.grade,
    count: countsMap[s.student_id]?.count || 0,
    last_date: countsMap[s.student_id]?.last_date || null,
  })).sort((a, b) => b.count - a.count || a.student_name.localeCompare(b.student_name));

  res.json({
    totals: { total_experiences: totals.total_experiences },
    by_category: byCategory,
    by_value: byValue,
    students: perStudent,
  });
});

// GET /api/experiences/head/student/:id — heads can read any student's
// reflections by name. The persistent banner on the student-side view
// tells students about this visibility upfront.
router.get('/head/student/:id', authenticate, authorize('head', 'admin'), authorizeOrg, (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const student = db.prepare(`
      SELECT id, full_name, email, grade_or_position FROM users
      WHERE id = ? AND role = 'student' AND COALESCE(org_id, 1) = ?
    `).get(studentId, req.orgId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const rows = db.prepare(`
      SELECT * FROM experiences WHERE student_id = ?
      ORDER BY experience_date DESC, created_at DESC
    `).all(studentId);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'experience_view_head',
      actionDescription: `Viewed Experience Map of ${student.full_name}`,
      targetType: 'user', targetId: studentId,
      metadata: { count: rows.length },
      ipAddress: req.ip, orgId: req.orgId,
    });

    res.json({ student, experiences: rows.map(rowToDTO) });
  } catch (err) {
    console.error('Head student experiences error:', err);
    res.status(500).json({ error: 'Failed to load experiences' });
  }
});

// GET /api/experiences/mentor/student/:id — a mentor can ONLY read the
// reflections of a student who is in one of their mentor groups. Cross-mentor
// reads are blocked at the DB layer (membership check), not just in the UI.
router.get('/mentor/student/:id', authenticate, authorize('teacher'), authorizeOrg, (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const teacher = db.prepare('SELECT id, is_mentor FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher || !teacher.is_mentor) {
      return res.status(403).json({ error: 'You do not have mentor capability.' });
    }

    // Membership check: student must be in at least one of this mentor's
    // mentor classrooms. Otherwise this is a cross-mentor read attempt.
    const linked = db.prepare(`
      SELECT 1 FROM classroom_members cm
      JOIN classrooms c ON c.id = cm.classroom_id
      WHERE cm.student_id = ? AND c.teacher_id = ? AND c.kind = 'mentor'
      LIMIT 1
    `).get(studentId, teacher.id);
    if (!linked) {
      return res.status(403).json({ error: 'This student is not one of your mentees.' });
    }

    const student = db.prepare(`
      SELECT id, full_name, email, grade_or_position FROM users WHERE id = ? AND role = 'student'
    `).get(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const rows = db.prepare(`
      SELECT * FROM experiences WHERE student_id = ?
      ORDER BY experience_date DESC, created_at DESC
    `).all(studentId);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'experience_view_mentor',
      actionDescription: `Viewed Experience Map of mentee ${student.full_name}`,
      targetType: 'user', targetId: studentId,
      metadata: { count: rows.length },
      ipAddress: req.ip, orgId: req.orgId,
    });

    res.json({ student, experiences: rows.map(rowToDTO) });
  } catch (err) {
    console.error('Mentor student experiences error:', err);
    res.status(500).json({ error: 'Failed to load experiences' });
  }
});

// GET /api/experiences/mentor/mentees — list of mentees this mentor can drill
// into (one row per student, with reflection count).
router.get('/mentor/mentees', authenticate, authorize('teacher'), authorizeOrg, (req, res) => {
  try {
    const teacher = db.prepare('SELECT id, is_mentor FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher || !teacher.is_mentor) {
      return res.status(403).json({ error: 'You do not have mentor capability.' });
    }

    const rows = db.prepare(`
      SELECT u.id as student_id, u.full_name as student_name, u.grade_or_position as grade,
        c.id as group_id, c.subject as group_name,
        (SELECT COUNT(*) FROM experiences e WHERE e.student_id = u.id) as reflection_count,
        (SELECT MAX(experience_date) FROM experiences e WHERE e.student_id = u.id) as last_date
      FROM classroom_members cm
      JOIN classrooms c ON c.id = cm.classroom_id
      JOIN users u ON u.id = cm.student_id
      WHERE c.teacher_id = ? AND c.kind = 'mentor' AND u.role = 'student'
      ORDER BY u.full_name ASC
    `).all(teacher.id);

    res.json({ mentees: rows });
  } catch (err) {
    console.error('Mentor mentees error:', err);
    res.status(500).json({ error: 'Failed to load mentees' });
  }
});

module.exports = router;

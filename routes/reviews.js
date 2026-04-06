const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { moderateText, sanitizeInput } = require('../utils/moderation');
const { logAuditEvent } = require('../utils/audit');
const { CRITERIA_CONFIG, CRITERIA_COUNT, CRITERIA_COLS } = require('../utils/criteriaConfig');

const router = express.Router();

const VALID_TAGS = [
  'Clear explanations', 'Engaging lessons', 'Fair grading', 'Supportive',
  'Well-prepared', 'Good examples', 'Encourages participation', 'Respectful',
  'Needs clearer explanations', 'Too fast-paced', 'Too slow-paced',
  'More examples needed', 'More interactive', 'Better organization',
  'More feedback needed', 'Challenging but good'
];

// GET /api/reviews/tags - available feedback tags
router.get('/tags', authenticate, (req, res) => {
  res.json(VALID_TAGS);
});

// GET /api/reviews/eligible-teachers - teachers student can review
router.get('/eligible-teachers', authenticate, authorize('student'), (req, res) => {
  try {
    // Find classrooms the student is in that have an active feedback period assigned to them
    const activeClassrooms = db.prepare(`
      SELECT DISTINCT
        c.id as classroom_id,
        fp.id as period_id,
        fp.name as period_name,
        fp.start_date,
        fp.end_date
      FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      JOIN feedback_period_classrooms fpc ON fpc.classroom_id = c.id
      JOIN feedback_periods fp ON fp.id = fpc.feedback_period_id
      JOIN terms t ON fp.term_id = t.id
      WHERE cm.student_id = ?
        AND fp.active_status = 1
        AND t.active_status = 1
        AND c.active_status = 1
    `).all(req.user.id);

    // Check if student has any classrooms at all (for "enroll first" UI message)
    const classroomCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM classroom_members WHERE student_id = ?'
    ).get(req.user.id).cnt;

    if (activeClassrooms.length === 0) {
      return res.json({ period: null, teachers: [], has_classrooms: classroomCount > 0 });
    }

    const activeClassroomIds = [...new Set(activeClassrooms.map(r => r.classroom_id))];
    const clP = activeClassroomIds.map(() => '?').join(',');
    const primaryPeriod = activeClassrooms[0];

    // Get teachers from classrooms that have active periods, with already-reviewed status
    const teachers = db.prepare(`
      SELECT DISTINCT
        te.id as teacher_id,
        te.full_name as teacher_name,
        te.subject,
        te.department,
        te.avatar_url,
        c.id as classroom_id,
        c.subject as classroom_subject,
        c.grade_level,
        fpc_a.period_id,
        CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as already_reviewed,
        r.id as review_id,
        r.flagged_status
      FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      JOIN teachers te ON c.teacher_id = te.id
      JOIN (
        SELECT fpc2.classroom_id, fpc2.feedback_period_id as period_id
        FROM feedback_period_classrooms fpc2
        JOIN feedback_periods fp2 ON fp2.id = fpc2.feedback_period_id
        WHERE fp2.active_status = 1
      ) fpc_a ON fpc_a.classroom_id = c.id
      LEFT JOIN reviews r ON r.teacher_id = te.id
        AND r.student_id = cm.student_id
        AND r.feedback_period_id = fpc_a.period_id
        AND r.flagged_status != 'rejected'
      WHERE cm.student_id = ?
        AND c.id IN (${clP})
        AND c.active_status = 1
      ORDER BY te.full_name
    `).all(req.user.id, ...activeClassroomIds);

    res.json({
      period: {
        id: primaryPeriod.period_id,
        name: primaryPeriod.period_name,
        start_date: primaryPeriod.start_date,
        end_date: primaryPeriod.end_date
      },
      teachers,
      has_classrooms: true
    });
  } catch (err) {
    console.error('Eligible teachers error:', err);
    res.status(500).json({ error: 'Failed to fetch eligible teachers' });
  }
});

// POST /api/reviews - submit a review
router.post('/', authenticate, authorize('student'), (req, res) => {
  try {
    const { teacher_id, classroom_id, feedback_text, tags } = req.body;

    // Validate required fields
    if (!teacher_id || !classroom_id) {
      return res.status(400).json({ error: 'Teacher and classroom are required' });
    }

    // Extract and validate all criteria ratings dynamically
    const ratings = {};
    for (const crit of CRITERIA_CONFIG) {
      const r = req.body[crit.db_col];
      if (!r || r < 1 || r > 5) {
        return res.status(400).json({ error: 'All ratings must be between 1 and 5' });
      }
      ratings[crit.db_col] = r;
    }

    // Auto-calculate overall rating as average of all criteria
    const ratingValues = CRITERIA_COLS.map(col => ratings[col]);
    const overall_rating = Math.round(ratingValues.reduce((s, v) => s + v, 0) / CRITERIA_COUNT);

    // Verify student is in the classroom
    const membership = db.prepare(
      'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
    ).get(classroom_id, req.user.id);
    if (!membership) {
      return res.status(403).json({ error: 'You are not enrolled in this classroom' });
    }

    // Verify classroom belongs to teacher
    const classroom = db.prepare(
      'SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?'
    ).get(classroom_id, teacher_id);
    if (!classroom) {
      return res.status(400).json({ error: 'Invalid classroom-teacher combination' });
    }

    // Validate: this specific classroom has an active feedback period assigned to it
    const activePeriod = db.prepare(`
      SELECT fp.* FROM feedback_period_classrooms fpc
      JOIN feedback_periods fp ON fp.id = fpc.feedback_period_id
      JOIN terms t ON fp.term_id = t.id
      WHERE fpc.classroom_id = ?
        AND fp.active_status = 1
        AND t.active_status = 1
      ORDER BY fp.id ASC
      LIMIT 1
    `).get(classroom_id);
    if (!activePeriod) {
      return res.status(400).json({ error: 'No active feedback period for this classroom' });
    }

    // Validate tags
    let validatedTags = [];
    if (tags && Array.isArray(tags)) {
      validatedTags = tags.filter(t => VALID_TAGS.includes(t));
    }

    // Sanitize and moderate feedback text
    const sanitized = sanitizeInput(feedback_text || '');
    const moderation = moderateText(feedback_text || '');

    let flaggedStatus = 'pending';
    if (moderation.shouldAutoReject || moderation.flagged) {
      flaggedStatus = 'flagged';
    }

    // Use the classroom's org_id for the review
    const reviewOrgId = classroom.org_id;

    // Wrap duplicate-check + INSERT in a transaction to prevent race conditions
    const insertReview = db.transaction(() => {
      // Re-check for duplicate inside transaction (TOCTOU protection)
      const dup = db.prepare(
        "SELECT id FROM reviews WHERE teacher_id = ? AND student_id = ? AND feedback_period_id = ? AND flagged_status != 'rejected'"
      ).get(teacher_id, req.user.id, activePeriod.id);
      if (dup) return null;

      const colList = CRITERIA_COLS.join(', ');
      const placeholders = CRITERIA_COLS.map(() => '?').join(', ');
      return db.prepare(`
        INSERT INTO reviews (
          teacher_id, classroom_id, student_id, school_id, org_id, term_id, feedback_period_id,
          overall_rating, ${colList},
          feedback_text, tags, flagged_status, approved_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${placeholders}, ?, ?, ?, 0)
      `).run(
        teacher_id, classroom_id, req.user.id, reviewOrgId || 1, reviewOrgId, activePeriod.term_id, activePeriod.id,
        overall_rating, ...ratingValues,
        sanitized, JSON.stringify(validatedTags), flaggedStatus
      );
    });

    const result = insertReview();
    if (!result) {
      return res.status(409).json({ error: 'You already submitted a review for this teacher in this period' });
    }

    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);

    // Log audit event
    const teacher = db.prepare('SELECT full_name FROM teachers WHERE id = ?').get(teacher_id);
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'review_submit',
      actionDescription: `Submitted review for ${teacher?.full_name || 'teacher'} (Rating: ${overall_rating}/5)`,
      targetType: 'review',
      targetId: result.lastInsertRowid,
      metadata: {
        teacher_id,
        classroom_id,
        overall_rating,
        flagged: moderation.flagged
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      message: 'Review submitted successfully. It will be visible after admin approval.',
      review,
      moderation_note: moderation.flagged ? 'Your review has been flagged for admin review.' : null
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Duplicate review not allowed' });
    }
    console.error('Submit review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// GET /api/reviews/my-reviews - student's own reviews
router.get('/my-reviews', authenticate, authorize('student'), (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);

    res.json(reviews);
  } catch (err) {
    console.error('My reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// PUT /api/reviews/:id - edit review (only during active period)
router.put('/:id', authenticate, authorize('student'), (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ? AND student_id = ?')
      .get(req.params.id, req.user.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });

    // Cannot edit an approved review
    if (review.approved_status === 1) {
      return res.status(400).json({ error: 'This review has already been approved and cannot be edited.' });
    }

    // Check if feedback period is still active
    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ? AND active_status = 1')
      .get(review.feedback_period_id);
    if (!period) return res.status(400).json({ error: 'Feedback period is closed. Cannot edit.' });

    const { feedback_text, tags } = req.body;

    // Validate any provided ratings
    for (const crit of CRITERIA_CONFIG) {
      const r = req.body[crit.db_col];
      if (r !== undefined && (r < 1 || r > 5)) {
        return res.status(400).json({ error: 'Ratings must be between 1 and 5' });
      }
    }

    // Get final rating values (use new if provided, otherwise keep existing)
    const finalRatings = {};
    for (const crit of CRITERIA_CONFIG) {
      finalRatings[crit.db_col] = req.body[crit.db_col] !== undefined ? req.body[crit.db_col] : review[crit.db_col];
    }

    // Auto-calculate overall rating as average of all criteria
    const finalValues = CRITERIA_COLS.map(col => finalRatings[col] || 0);
    const overall_rating = Math.round(finalValues.reduce((s, v) => s + v, 0) / CRITERIA_COUNT);

    const sanitized = feedback_text !== undefined ? sanitizeInput(feedback_text) : review.feedback_text;
    const moderation = feedback_text !== undefined ? moderateText(feedback_text) : { flagged: false };

    let validatedTags = JSON.parse(review.tags || '[]');
    if (tags && Array.isArray(tags)) {
      validatedTags = tags.filter(t => VALID_TAGS.includes(t));
    }

    const setClauses = CRITERIA_COLS.map(col => `${col} = COALESCE(?, ${col})`).join(',\n        ');
    const setValues = CRITERIA_COLS.map(col => req.body[col] ?? null);

    db.prepare(`
      UPDATE reviews SET
        overall_rating = ?,
        ${setClauses},
        feedback_text = ?,
        tags = ?,
        flagged_status = ?,
        approved_status = 0
      WHERE id = ?
    `).run(
      overall_rating, ...setValues,
      sanitized, JSON.stringify(validatedTags),
      moderation.flagged ? 'flagged' : 'pending',
      req.params.id
    );

    const teacher = db.prepare('SELECT full_name FROM teachers WHERE id = ?').get(review.teacher_id);
    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'review_edit',
      actionDescription: `Edited review for ${teacher?.full_name || 'teacher'}`,
      targetType: 'review', targetId: parseInt(req.params.id),
      metadata: { teacher_id: review.teacher_id },
      ipAddress: req.ip
    });

    const updated = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    res.json({ message: 'Review updated. Awaiting re-approval.', review: updated });
  } catch (err) {
    console.error('Edit review error:', err);
    res.status(500).json({ error: 'Failed to edit review' });
  }
});

// POST /api/reviews/:id/flag - flag a review
router.post('/:id/flag', authenticate, authorize('teacher', 'head', 'admin'), (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });

    db.prepare("UPDATE reviews SET flagged_status = 'flagged' WHERE id = ?").run(req.params.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'review_flag',
      actionDescription: `Flagged review #${req.params.id}`,
      targetType: 'review', targetId: parseInt(req.params.id),
      ipAddress: req.ip
    });

    res.json({ message: 'Review flagged for admin review' });
  } catch (err) {
    console.error('Flag review error:', err);
    res.status(500).json({ error: 'Failed to flag review' });
  }
});

module.exports = router;

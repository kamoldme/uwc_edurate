const express = require('express');
const db = require('../database');
const { authenticate, authorize, authorizeOrg } = require('../middleware/auth');
const { getTeacherScores, getRatingDistribution, getTeacherTrend, getDepartmentAverage, getClassroomCompletionRate } = require('../utils/scoring');
const { logAuditEvent } = require('../utils/audit');
const { CRITERIA_CONFIG, CRITERIA_COUNT, CRITERIA_COLS } = require('../utils/criteriaConfig');

const router = express.Router();

// GET /api/dashboard/student
router.get('/student', authenticate, authorize('student'), (req, res) => {
  try {
    const classrooms = db.prepare(`
      SELECT c.*, te.id as teacher_id, te.full_name as teacher_name, te.subject as teacher_subject,
        te.avatar_url as teacher_avatar_url, t.name as term_name
      FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE cm.student_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);

    // Find an active feedback period covering any of the student's classrooms
    const activePeriod = db.prepare(`
      SELECT fp.id, fp.name, t.name as term_name, fp.start_date, fp.end_date
      FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      JOIN feedback_period_classrooms fpc ON fpc.classroom_id = c.id
      JOIN feedback_periods fp ON fp.id = fpc.feedback_period_id
      JOIN terms t ON fp.term_id = t.id
      WHERE cm.student_id = ?
        AND fp.active_status = 1
        AND t.active_status = 1
        AND c.active_status = 1
      ORDER BY fp.id ASC LIMIT 1
    `).get(req.user.id);

    // Still derive studentOrgId for activeTerm query below
    const studentOrgRow = db.prepare(`
      SELECT DISTINCT c.org_id FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      WHERE cm.student_id = ? AND c.org_id IS NOT NULL
      LIMIT 1
    `).get(req.user.id);
    const studentOrgId = studentOrgRow?.org_id ?? req.user.org_id;

    const myReviews = db.prepare(`
      SELECT r.id, r.teacher_id, r.classroom_id, r.overall_rating, r.flagged_status, r.approved_status,
        te.full_name as teacher_name, c.subject as classroom_subject, fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);

    const activeTerm = studentOrgId
      ? db.prepare('SELECT * FROM terms WHERE active_status = 1 AND org_id = ? LIMIT 1').get(studentOrgId)
      : null;

    res.json({
      classrooms,
      active_period: activePeriod,
      active_term: activeTerm,
      my_reviews: myReviews,
      review_count: myReviews.length
    });
  } catch (err) {
    console.error('Student dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/teacher
router.get('/teacher', authenticate, authorize('teacher'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher profile not found' });

    const classrooms = db.prepare(`
      SELECT c.*, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE c.teacher_id = ?
      ORDER BY c.created_at DESC
    `).all(teacher.id);

    const activeTerm = db.prepare('SELECT * FROM terms WHERE active_status = 1 AND org_id = ? LIMIT 1').get(teacher.org_id);
    const activePeriod = activeTerm ? db.prepare(`
      SELECT fp.* FROM feedback_periods fp
      WHERE fp.active_status = 1 AND fp.term_id = ?
      ORDER BY fp.id ASC LIMIT 1
    `).get(activeTerm.id) : null;
    const allTerms = db.prepare('SELECT id, name FROM terms WHERE org_id = ? ORDER BY start_date DESC').all(teacher.org_id);

    // Overall scores
    const overallScores = getTeacherScores(teacher.id);

    // Per-term scores
    let termScores = null;
    let trend = null;
    if (activeTerm) {
      termScores = getTeacherScores(teacher.id, { termId: activeTerm.id });
      trend = getTeacherTrend(teacher.id, activeTerm.id);
    }

    // Distribution
    const distribution = getRatingDistribution(teacher.id);

    // Department comparison (within same org)
    const deptAvg = teacher.department ? getDepartmentAverage(teacher.department, activeTerm?.id, teacher.org_id) : null;

    // Approved reviews only — teachers must not see pending/flagged moderation status
    const critCols = CRITERIA_COLS.map(c => `r.${c}`).join(', ');
    const recentReviews = db.prepare(`
      SELECT r.overall_rating, ${critCols},
        r.feedback_text, r.tags, r.approved_status,
        r.created_at,
        fp.name as period_name, t.name as term_name, c.subject as classroom_subject,
        c.grade_level
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all(teacher.id);

    // Completion rates per classroom for active period
    let completionRates = [];
    if (activePeriod) {
      completionRates = classrooms.map(c => ({
        classroom_id: c.id,
        subject: c.subject,
        grade_level: c.grade_level,
        ...getClassroomCompletionRate(c.id, activePeriod.id)
      }));
    }

    // Pending review count (for teacher awareness)
    const pendingCount = db.prepare(
      "SELECT COUNT(*) as count FROM reviews WHERE teacher_id = ? AND approved_status = 0 AND flagged_status = 'pending'"
    ).get(teacher.id).count;

    const totalReviewCount = db.prepare(
      'SELECT COUNT(*) as count FROM reviews WHERE teacher_id = ?'
    ).get(teacher.id).count;

    res.json({
      teacher,
      classrooms,
      active_term: activeTerm,
      active_period: activePeriod,
      all_terms: allTerms,
      overall_scores: overallScores,
      term_scores: termScores,
      trend,
      distribution,
      department_average: deptAvg,
      recent_reviews: recentReviews,
      completion_rates: completionRates,
      pending_review_count: pendingCount,
      total_review_count: totalReviewCount
    });
  } catch (err) {
    console.error('Teacher dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/teacher/reviews - paginated approved reviews for teacher
router.get('/teacher/reviews', authenticate, authorize('teacher'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE teacher_id = ? AND approved_status = 1').get(teacher.id).count;

    const critCols2 = CRITERIA_COLS.map(c => `r.${c}`).join(', ');
    const reviews = db.prepare(`
      SELECT r.overall_rating, ${critCols2},
        r.feedback_text, r.tags, r.approved_status, r.created_at,
        fp.name as period_name, t.name as term_name, c.subject as classroom_subject, c.grade_level
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(teacher.id, limit, offset);

    res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Teacher reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// GET /api/dashboard/school-head
router.get('/school-head', authenticate, authorize('head', 'admin'), authorizeOrg, (req, res) => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization context required' });
    }

    const activeTerm = db.prepare(`SELECT * FROM terms WHERE active_status = 1 ${orgId ? 'AND org_id = ?' : ''} LIMIT 1`).get(...(orgId ? [orgId] : []));

    const teachers = db.prepare(`SELECT * FROM teachers WHERE ${orgId ? 'org_id = ?' : '1=1'}`).all(...(orgId ? [orgId] : []));

    // ── Bulk queries instead of N × 3 queries ──────────────────────────────
    const termFilter = activeTerm ? 'AND r.term_id = ?' : '';
    const orgFilter2 = orgId ? 'AND r.org_id = ?' : '';
    const bulkParams = [...(activeTerm ? [activeTerm.id] : []), ...(orgId ? [orgId] : [])];

    // Dynamic SQL fragments from criteria config
    const innerAvgCols = CRITERIA_CONFIG.map(c => `AVG(r.${c.db_col}) as avg_${c.slug}`).join(', ');
    const outerAvgCols = CRITERIA_CONFIG.map(c => `ROUND(AVG(avg_${c.slug}), 2) as avg_${c.slug}`).join(', ');
    const sumExpr = CRITERIA_CONFIG.map(c => `AVG(avg_${c.slug})`).join(' + ');

    // Heads now see all approved reviews. The teacher_private gate was over-
    // engineering — pilot heads need to course-correct during active periods,
    // not wait for them to close. Column stays so the toggle can come back.
    const visFilter = '';

    // 1 query: all teacher aggregate scores (classroom-weighted)
    const scoresData = db.prepare(`
      SELECT teacher_id,
        SUM(review_count) as review_count,
        ${outerAvgCols},
        ROUND((${sumExpr}) / ${CRITERIA_COUNT}, 2) as avg_overall,
        ROUND((${sumExpr}) / ${CRITERIA_COUNT}, 2) as final_score
      FROM (
        SELECT r.teacher_id, r.classroom_id,
          COUNT(*) as review_count,
          ${innerAvgCols}
        FROM reviews r
        WHERE r.approved_status = 1 ${termFilter} ${orgFilter2} ${visFilter}
        GROUP BY r.teacher_id, r.classroom_id
      )
      GROUP BY teacher_id
    `).all(...bulkParams);

    // 1 query: rating distributions
    const distData = db.prepare(`
      SELECT r.teacher_id, r.overall_rating as rating, COUNT(*) as count
      FROM reviews r WHERE r.approved_status = 1 ${termFilter} ${orgFilter2} ${visFilter}
      GROUP BY r.teacher_id, r.overall_rating
    `).all(...bulkParams);

    // 1 query: monthly scores for trend — classroom-weighted, grouped by calendar month
    const classroomScoreExpr = CRITERIA_CONFIG.map(c => `AVG(r.${c.db_col})`).join(' + ');
    const monthVisFilter = '';
    let monthData = [];
    if (activeTerm) {
      monthData = db.prepare(`
        SELECT month, MIN(month_start) as month_start, teacher_id,
          SUM(review_count) as review_count,
          COUNT(DISTINCT classroom_id) as classroom_count,
          ROUND(AVG(classroom_score), 2) as score
        FROM (
          SELECT strftime('%Y-%m', fp.start_date) as month,
            fp.start_date as month_start,
            r.teacher_id, r.classroom_id,
            COUNT(r.id) as review_count,
            ROUND((${classroomScoreExpr}) / ${CRITERIA_COUNT}, 2) as classroom_score
          FROM feedback_periods fp
          JOIN reviews r ON r.feedback_period_id = fp.id AND r.approved_status = 1 ${orgFilter2}
          WHERE fp.term_id = ? ${monthVisFilter}
          GROUP BY month, r.teacher_id, r.classroom_id
        )
        GROUP BY month, teacher_id
        ORDER BY month ASC
      `).all(...(orgId ? [orgId] : []), activeTerm.id);
    }

    // Build lookup maps
    const scoreMap = {};
    scoresData.forEach(s => { scoreMap[s.teacher_id] = s; });

    const distMap = {};
    distData.forEach(d => {
      if (!distMap[d.teacher_id]) distMap[d.teacher_id] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      distMap[d.teacher_id][d.rating] = d.count;
    });

    // Build ordered month list (deduped, chronological)
    const seenMonths = new Set();
    const orderedMonths = [];
    monthData.forEach(m => {
      if (!seenMonths.has(m.month)) {
        seenMonths.add(m.month);
        orderedMonths.push({ month: m.month, month_start: m.month_start });
      }
    });

    const teacherMonthMap = {};
    monthData.forEach(m => {
      if (!m.teacher_id) return;
      if (!teacherMonthMap[m.teacher_id]) teacherMonthMap[m.teacher_id] = {};
      teacherMonthMap[m.teacher_id][m.month] = { score: m.score, review_count: m.review_count, classroom_count: m.classroom_count };
    });

    const teacherPerformance = teachers.map(t => {
      const defaultScores = { review_count: 0, avg_overall: null, final_score: null };
      CRITERIA_CONFIG.forEach(c => { defaultScores[`avg_${c.slug}`] = null; });
      const scores = scoreMap[t.id] || defaultScores;
      const distribution = distMap[t.id] || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      let trend = null;
      if (activeTerm) {
        const months = orderedMonths.map(m => ({
          month: m.month,
          month_start: m.month_start,
          score: teacherMonthMap[t.id]?.[m.month]?.score ?? null,
          review_count: teacherMonthMap[t.id]?.[m.month]?.review_count ?? 0,
          classroom_count: teacherMonthMap[t.id]?.[m.month]?.classroom_count ?? 0
        }));

        // Option C: only label trend if same classrooms overlap between first and last month
        const validMonths = months.filter(m => m.score !== null);
        let trendDir = null;
        if (validMonths.length >= 2) {
          const firstClassrooms = new Set(
            db.prepare(`SELECT DISTINCT r.classroom_id FROM reviews r JOIN feedback_periods fp ON r.feedback_period_id = fp.id WHERE r.teacher_id = ? AND fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ? AND r.approved_status = 1`)
              .all(t.id, activeTerm.id, validMonths[0].month).map(r => r.classroom_id)
          );
          const lastClassroomIds = db.prepare(`SELECT DISTINCT r.classroom_id FROM reviews r JOIN feedback_periods fp ON r.feedback_period_id = fp.id WHERE r.teacher_id = ? AND fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ? AND r.approved_status = 1`)
            .all(t.id, activeTerm.id, validMonths[validMonths.length - 1].month).map(r => r.classroom_id);
          const hasOverlap = lastClassroomIds.some(id => firstClassrooms.has(id));
          if (hasOverlap) {
            const diff = validMonths[validMonths.length - 1].score - validMonths[0].score;
            if (diff > 0.3) trendDir = 'improving';
            else if (diff < -0.3) trendDir = 'declining';
            else trendDir = 'stable';
          }
        }
        trend = { months, trend: trendDir };
      }

      return { ...t, scores, distribution, trend };
    });

    // Department-level aggregation (from already-fetched scores)
    const departments = {};
    teachers.forEach(t => {
      if (!t.department) return;
      if (!departments[t.department]) departments[t.department] = { teachers: [], avg_score: 0 };
      departments[t.department].teachers.push(t.id);
    });
    for (const [dept, data] of Object.entries(departments)) {
      const deptScores = scoresData.filter(s => {
        const teacher = teachers.find(t => t.id === s.teacher_id);
        return teacher?.department === dept;
      });
      data.avg_score = deptScores.length > 0
        ? Math.round((deptScores.reduce((sum, s) => sum + (s.avg_overall || 0), 0) / deptScores.length) * 100) / 100
        : 0;
    }

    // All classrooms with stats (scoped to org)
    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      ${orgId ? 'WHERE c.org_id = ?' : ''}
      ORDER BY c.created_at DESC
    `).all(...(orgId ? [orgId] : []));

    const terms = db.prepare(`SELECT * FROM terms WHERE ${orgId ? 'org_id = ?' : '1=1'} ORDER BY start_date DESC`).all(...(orgId ? [orgId] : []));

    res.json({
      active_term: activeTerm,
      teachers: teacherPerformance,
      departments,
      classrooms,
      terms
    });
  } catch (err) {
    console.error('School head dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/school-head/teacher/:id - detailed teacher view
router.get('/school-head/teacher/:id', authenticate, authorize('head', 'admin'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    // Org check
    if (req.user.org_id !== teacher.org_id) {
      return res.status(403).json({ error: 'Teacher does not belong to your organization' });
    }

    const terms = db.prepare(`SELECT * FROM terms WHERE ${teacher.org_id ? 'org_id = ?' : '1=1'} ORDER BY start_date DESC`).all(...(teacher.org_id ? [teacher.org_id] : []));
    const activeTerm = teacher.org_id
      ? db.prepare('SELECT * FROM terms WHERE active_status = 1 AND org_id = ? LIMIT 1').get(teacher.org_id)
      : db.prepare('SELECT * FROM terms WHERE active_status = 1 LIMIT 1').get();

    const classrooms = db.prepare(`
      SELECT c.*, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE c.teacher_id = ?
    `).all(teacher.id);

    const visRole = req.user.role === 'head' ? 'head' : undefined;
    const scores = {};
    const trends = {};
    terms.forEach(term => {
      scores[term.id] = getTeacherScores(teacher.id, { termId: term.id, visibilityRole: visRole });
      trends[term.id] = getTeacherTrend(teacher.id, term.id, visRole);
    });

    const detailCritCols = CRITERIA_COLS.map(c => `r.${c}`).join(', ');
    const detailVisFilter = '';
    const reviews = db.prepare(`
      SELECT r.overall_rating, ${detailCritCols},
        r.feedback_text, r.tags,
        r.created_at, fp.name as period_name, t.name as term_name, c.subject as classroom_subject
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ? AND r.approved_status = 1 ${detailVisFilter}
      ORDER BY r.created_at DESC
    `).all(teacher.id);

    res.json({ teacher, classrooms, terms, scores, trends, reviews });
  } catch (err) {
    console.error('Teacher detail error:', err);
    res.status(500).json({ error: 'Failed to load teacher details' });
  }
});

// GET /api/dashboard/departments/:name - detail analytics for one department
router.get('/departments/:name', authenticate, authorize('head', 'admin'), authorizeOrg, (req, res) => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'Organization context required' });
    }

    const deptName = decodeURIComponent(req.params.name);

    // Teachers in this department
    const teachers = db.prepare(
      `SELECT * FROM teachers WHERE department = ? ${orgId ? 'AND org_id = ?' : ''}`
    ).all(...(orgId ? [deptName, orgId] : [deptName]));

    if (teachers.length === 0) {
      return res.json({ dept_name: deptName, teachers: [], trend: [], org_averages: null });
    }

    const teacherIds = teachers.map(t => t.id);
    const placeholders = teacherIds.map(() => '?').join(',');

    // Per-teacher criterion scores — classroom-weighted (dynamic)
    const deptInnerAvg = CRITERIA_CONFIG.map(c => `AVG(r.${c.db_col}) as avg_${c.slug}`).join(', ');
    const deptOuterAvg = CRITERIA_CONFIG.map(c => `ROUND(AVG(avg_${c.slug}), 2) as avg_${c.slug}`).join(', ');
    const deptSumExpr = CRITERIA_CONFIG.map(c => `AVG(avg_${c.slug})`).join(' + ');
    const deptVisFilter = '';

    const scoresData = db.prepare(`
      SELECT teacher_id,
        SUM(review_count) as review_count,
        ${deptOuterAvg},
        ROUND((${deptSumExpr}) / ${CRITERIA_COUNT}, 2) as avg_overall
      FROM (
        SELECT r.teacher_id, r.classroom_id,
          COUNT(*) as review_count,
          ${deptInnerAvg}
        FROM reviews r
        WHERE r.approved_status = 1 AND r.teacher_id IN (${placeholders}) ${orgId ? 'AND r.org_id = ?' : ''} ${deptVisFilter}
        GROUP BY r.teacher_id, r.classroom_id
      )
      GROUP BY teacher_id
    `).all(...teacherIds, ...(orgId ? [orgId] : []));

    const scoreMap = {};
    scoresData.forEach(s => { scoreMap[s.teacher_id] = s; });

    const teachersWithScores = teachers.map(t => ({
      id: t.id,
      full_name: t.full_name,
      subject: t.subject,
      avatar_url: t.avatar_url,
      ...(scoreMap[t.id] || Object.assign(
        { review_count: 0, avg_overall: null },
        ...CRITERIA_CONFIG.map(c => ({ [`avg_${c.slug}`]: null }))
      ))
    }));

    // Trend: dept avg score by calendar month — classroom-weighted, all terms
    const deptClassroomScore = CRITERIA_CONFIG.map(c => `AVG(r.${c.db_col})`).join(' + ');
    const deptTrendVis = '';
    const trend = db.prepare(`
      SELECT month, MIN(month_start) as month_start, term_name, term_id,
        SUM(review_count) as review_count,
        ROUND(AVG(classroom_score), 2) as avg_score
      FROM (
        SELECT strftime('%Y-%m', fp.start_date) as month,
          fp.start_date as month_start,
          t.name as term_name, t.id as term_id,
          r.classroom_id,
          COUNT(r.id) as review_count,
          ROUND((${deptClassroomScore}) / ${CRITERIA_COUNT}, 2) as classroom_score
        FROM feedback_periods fp
        JOIN terms t ON fp.term_id = t.id
        JOIN reviews r ON r.feedback_period_id = fp.id AND r.approved_status = 1
          AND r.teacher_id IN (${placeholders})
        WHERE ${orgId ? 't.org_id = ? AND' : ''} 1=1 ${deptTrendVis}
        GROUP BY month, r.classroom_id
      )
      GROUP BY month ORDER BY month ASC
    `).all(...teacherIds, ...(orgId ? [orgId] : []));

    // Org-wide averages for radar chart comparison
    const orgAvgCols = CRITERIA_CONFIG.map(c => `ROUND(AVG(r.${c.db_col}), 2) as avg_${c.slug}`).join(', ');
    const orgAvg = db.prepare(`
      SELECT ${orgAvgCols}
      FROM reviews r
      WHERE r.approved_status = 1 ${orgId ? 'AND r.org_id = ?' : ''} ${deptVisFilter}
    `).get(...(orgId ? [orgId] : []));

    res.json({
      dept_name: deptName,
      teachers: teachersWithScores,
      trend,
      org_averages: orgAvg
    });
  } catch (err) {
    console.error('Department analytics error:', err);
    res.status(500).json({ error: 'Failed to load department analytics' });
  }
});

module.exports = router;

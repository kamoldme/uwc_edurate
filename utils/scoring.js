const db = require('../database');
const { CRITERIA_CONFIG, CRITERIA_COUNT, CRITERIA_COLS } = require('./criteriaConfig');

// Dynamic SQL fragments derived from criteria config
const innerAvgCols = CRITERIA_CONFIG.map(c => `AVG(r.${c.db_col}) as avg_${c.slug}`).join(',\n        ');
const outerAvgCols = CRITERIA_CONFIG.map(c => `ROUND(AVG(avg_${c.slug}), 2) as avg_${c.slug}`).join(',\n      ');
const sumExpr = CRITERIA_CONFIG.map(c => `AVG(avg_${c.slug})`).join(' + ');
const classroomScoreExpr = CRITERIA_CONFIG.map(c => `AVG(r.${c.db_col})`).join(' + ');

function calculateFinalScore(review) {
  const sum = CRITERIA_CONFIG.reduce((s, c) => s + (review[c.db_col] || 0), 0);
  return sum / CRITERIA_COUNT;
}

// Classroom-weighted: average each classroom's scores first, then average those.
// Prevents classrooms with more students from dominating the result.
// visibilityRole: when 'head', filters out reviews from teacher-private periods.
function getTeacherScores(teacherId, options = {}) {
  const { classroomId, feedbackPeriodId, termId, visibilityRole } = options;

  let where = 'WHERE r.teacher_id = ? AND r.approved_status = 1';
  const params = [teacherId];

  if (classroomId) {
    where += ' AND r.classroom_id = ?';
    params.push(classroomId);
  }
  if (feedbackPeriodId) {
    where += ' AND r.feedback_period_id = ?';
    params.push(feedbackPeriodId);
  }
  if (termId) {
    where += ' AND r.term_id = ?';
    params.push(termId);
  }
  if (visibilityRole === 'head') {
    where += ' AND EXISTS (SELECT 1 FROM feedback_periods fp WHERE fp.id = r.feedback_period_id AND fp.teacher_private = 0)';
  }

  const result = db.prepare(`
    SELECT
      COALESCE(SUM(review_count), 0) as review_count,
      ${outerAvgCols},
      ROUND((${sumExpr}) / ${CRITERIA_COUNT}, 2) as avg_overall,
      ROUND((${sumExpr}) / ${CRITERIA_COUNT}, 2) as final_score
    FROM (
      SELECT
        r.classroom_id,
        COUNT(*) as review_count,
        ${innerAvgCols}
      FROM reviews r
      ${where}
      GROUP BY r.classroom_id
    )
  `).get(...params);

  return result;
}

function getRatingDistribution(teacherId, options = {}) {
  const { classroomId, feedbackPeriodId, termId, visibilityRole } = options;

  let where = 'WHERE r.teacher_id = ? AND r.approved_status = 1';
  const params = [teacherId];

  if (classroomId) { where += ' AND r.classroom_id = ?'; params.push(classroomId); }
  if (feedbackPeriodId) { where += ' AND r.feedback_period_id = ?'; params.push(feedbackPeriodId); }
  if (termId) { where += ' AND r.term_id = ?'; params.push(termId); }
  if (visibilityRole === 'head') {
    where += ' AND EXISTS (SELECT 1 FROM feedback_periods fp WHERE fp.id = r.feedback_period_id AND fp.teacher_private = 0)';
  }

  const distribution = db.prepare(`
    SELECT overall_rating as rating, COUNT(*) as count
    FROM reviews r
    ${where}
    GROUP BY overall_rating
    ORDER BY overall_rating
  `).all(...params);

  const result = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribution.forEach(d => { result[d.rating] = d.count; });
  return result;
}

function getTeacherTrend(teacherId, termId, visibilityRole) {
  let visFilter = '';
  if (visibilityRole === 'head') {
    visFilter = ' AND fp.teacher_private = 0';
  }

  const monthRows = db.prepare(`
    SELECT strftime('%Y-%m', fp.start_date) as month,
      MIN(fp.start_date) as month_start,
      COUNT(DISTINCT r.classroom_id) as classroom_count,
      COUNT(r.id) as review_count
    FROM feedback_periods fp
    JOIN reviews r ON r.feedback_period_id = fp.id
      AND r.teacher_id = ? AND r.approved_status = 1
    WHERE fp.term_id = ?${visFilter}
    GROUP BY month
    ORDER BY month ASC
  `).all(teacherId, termId);

  const months = monthRows.map(m => {
    const cwScore = db.prepare(`
      SELECT ROUND(AVG(classroom_score), 2) as score
      FROM (
        SELECT r.classroom_id,
          ROUND((${classroomScoreExpr}) / ${CRITERIA_COUNT}, 2) as classroom_score
        FROM feedback_periods fp
        JOIN reviews r ON r.feedback_period_id = fp.id
          AND r.teacher_id = ? AND r.approved_status = 1
        WHERE fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ?${visFilter}
        GROUP BY r.classroom_id
      )
    `).get(teacherId, termId, m.month);

    return {
      month: m.month,
      month_start: m.month_start,
      score: cwScore?.score ?? null,
      review_count: m.review_count,
      classroom_count: m.classroom_count
    };
  });

  const classrooms = db.prepare(`
    SELECT DISTINCT r.classroom_id, c.subject, c.grade_level
    FROM reviews r
    JOIN classrooms c ON r.classroom_id = c.id
    WHERE r.teacher_id = ? AND r.term_id = ? AND r.approved_status = 1
  `).all(teacherId, termId);

  const classroomTrends = classrooms.map(cls => {
    const classroomMonths = db.prepare(`
      SELECT strftime('%Y-%m', fp.start_date) as month,
        MIN(fp.start_date) as month_start,
        ROUND((${classroomScoreExpr}) / ${CRITERIA_COUNT}, 2) as score,
        COUNT(r.id) as review_count
      FROM feedback_periods fp
      JOIN reviews r ON r.feedback_period_id = fp.id
        AND r.teacher_id = ? AND r.classroom_id = ? AND r.approved_status = 1
      WHERE fp.term_id = ?${visFilter}
      GROUP BY month
      ORDER BY month ASC
    `).all(teacherId, cls.classroom_id, termId);

    return {
      classroom_id: cls.classroom_id,
      subject: cls.subject,
      grade_level: cls.grade_level,
      months: classroomMonths
    };
  });

  let trend = null;
  const validMonths = months.filter(m => m.score !== null);
  if (validMonths.length >= 2) {
    const firstMonth = validMonths[0].month;
    const lastMonth = validMonths[validMonths.length - 1].month;

    const firstClassrooms = new Set(
      db.prepare(`
        SELECT DISTINCT r.classroom_id FROM reviews r
        JOIN feedback_periods fp ON r.feedback_period_id = fp.id
        WHERE r.teacher_id = ? AND fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ? AND r.approved_status = 1
      `).all(teacherId, termId, firstMonth).map(r => r.classroom_id)
    );
    const lastClassroomIds = db.prepare(`
      SELECT DISTINCT r.classroom_id FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      WHERE r.teacher_id = ? AND fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ? AND r.approved_status = 1
    `).all(teacherId, termId, lastMonth).map(r => r.classroom_id);

    const hasOverlap = lastClassroomIds.some(id => firstClassrooms.has(id));
    if (hasOverlap) {
      const diff = validMonths[validMonths.length - 1].score - validMonths[0].score;
      if (diff > 0.3) trend = 'improving';
      else if (diff < -0.3) trend = 'declining';
      else trend = 'stable';
    }
  }

  return { classroom_trends: classroomTrends, months, trend };
}

function getDepartmentAverage(department, termId, orgId, visibilityRole) {
  let where = 't.department = ? AND r.approved_status = 1';
  const params = [department];

  if (termId) {
    where += ' AND r.term_id = ?';
    params.push(termId);
  }

  if (orgId) {
    where += ' AND t.org_id = ?';
    params.push(orgId);
  }

  if (visibilityRole === 'head') {
    where += ' AND EXISTS (SELECT 1 FROM feedback_periods fp WHERE fp.id = r.feedback_period_id AND fp.teacher_private = 0)';
  }

  const result = db.prepare(`
    SELECT ROUND(AVG(classroom_score), 2) as avg_score
    FROM (
      SELECT ROUND((${classroomScoreExpr}) / ${CRITERIA_COUNT}, 2) as classroom_score
      FROM reviews r
      JOIN teachers t ON r.teacher_id = t.id
      WHERE ${where}
      GROUP BY r.classroom_id
    )
  `).get(...params);

  return result?.avg_score || 0;
}

function getClassroomCompletionRate(classroomId, feedbackPeriodId) {
  const totalStudents = db.prepare(
    'SELECT COUNT(*) as count FROM classroom_members WHERE classroom_id = ?'
  ).get(classroomId).count;

  const submittedStudents = db.prepare(
    'SELECT COUNT(DISTINCT student_id) as count FROM reviews WHERE classroom_id = ? AND feedback_period_id = ?'
  ).get(classroomId, feedbackPeriodId).count;

  return {
    total: totalStudents,
    submitted: submittedStudents,
    rate: totalStudents > 0 ? Math.round((submittedStudents / totalStudents) * 100) : 100
  };
}

module.exports = {
  calculateFinalScore,
  getTeacherScores,
  getRatingDistribution,
  getTeacherTrend,
  getDepartmentAverage,
  getClassroomCompletionRate
};

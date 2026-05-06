const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '24h';

const ROLE_HIERARCHY = {
  'admin': 4,
  'head': 3,
  'teacher': 2,
  'student': 1
};

const VALID_ROLES = Object.keys(ROLE_HIERARCHY);

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, org_id: user.org_id || 1 },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`
      SELECT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.school_id, u.org_id,
             u.verified_status, u.suspended, u.avatar_url, u.language, u.is_student_council,
             u.created_at, o.name as org_name,
             COALESCE(t.is_mentor, 0) AS is_mentor
      FROM users u
      LEFT JOIN organizations o ON u.org_id = o.id
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE u.id = ?
    `).get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (user.suspended) {
      return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function authorizeOrg(req, res, next) {
  // All users are in the single org (id=1)
  req.orgId = req.user.org_id || 1;
  return next();
}

module.exports = { generateToken, authenticate, authorize, authorizeOrg, JWT_SECRET, ROLE_HIERARCHY, VALID_ROLES };

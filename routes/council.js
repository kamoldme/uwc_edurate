// Student Council — petitions and announcements published by students who hold
// the `is_student_council` flag. See utils/criteriaConfig.js style: this whole
// router exists so the council UX is its own contained surface, not glued onto
// the staff /announcements feed.
//
// Key invariants enforced here (the plan calls these "landmines"):
//   - Anonymous voting:  /results returns only counts, never user IDs.
//   - Author edit window: 15 minutes after publish, then locked. Admin/head bypass.
//   - Spam limits:        ≤3 active petitions per org, ≤1 announcement per author/day.
//   - PDF size:           validated in utils/attachments.js (8MB raw cap).
//   - Soft delete:        takedown sets status='removed', preserving the row + audit.

const express = require('express');
const db = require('../database');
const { authenticate, authorize, authorizeOrg } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');
const { createNotifications } = require('../utils/notifications');
const { saveAttachment, deleteAttachment } = require('../utils/attachments');

const router = express.Router();

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ACTIVE_PETITIONS_PER_ORG = 3;

// Resolve a user's effective org id. Students often register without one and
// derive their org from classroom memberships. The council feed is org-scoped,
// so we need this for every read/write that touches council_posts.
function resolveOrgId(user) {
  if (user.org_id) return user.org_id;
  if (user.role !== 'student') return null;
  const ids = db.prepare(
    'SELECT classroom_id FROM classroom_members WHERE student_id = ?'
  ).all(user.id).map(r => r.classroom_id);
  if (!ids.length) return null;
  const ph = ids.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT org_id FROM classrooms WHERE id IN (${ph}) AND org_id IS NOT NULL LIMIT 1`
  ).get(...ids);
  return row?.org_id || null;
}

// Council member gate: must be a student AND have the flag set.
function requireCouncilMember(req, res, next) {
  if (req.user.role !== 'student' || !req.user.is_student_council) {
    return res.status(403).json({ error: 'Only Student Council members can publish posts' });
  }
  next();
}

// ─── GET /api/council/posts ──────────────────────────────────────────────────
// All authenticated users in the org see the same feed. Hidden ('removed')
// posts still come back with their status so admin/head can see what was taken
// down; the UI renders them as a stub.
router.get('/posts', authenticate, (req, res) => {
  try {
    const orgId = resolveOrgId(req.user);
    if (!orgId) return res.json([]); // user with no org sees empty feed

    const posts = db.prepare(`
      SELECT
        cp.*,
        u.is_student_council AS author_is_council
      FROM council_posts cp
      LEFT JOIN users u ON u.id = cp.creator_id
      WHERE cp.org_id = ?
      ORDER BY cp.published_at DESC
      LIMIT 200
    `).all(orgId);

    res.json(posts);
  } catch (err) {
    console.error('List council posts error:', err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// ─── POST /api/council/posts ─────────────────────────────────────────────────
// Council-only. Enforces spam caps. Saves PDF to persistent volume if present.
router.post('/posts', authenticate, requireCouncilMember, authorizeOrg, (req, res) => {
  try {
    const { type, title, body, attachment, attachment_name, closes_at } = req.body;

    if (!['announcement', 'petition'].includes(type)) {
      return res.status(400).json({ error: 'Invalid post type' });
    }
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Title and body are required' });
    }
    if (type === 'petition') {
      if (!closes_at) return res.status(400).json({ error: 'Petition needs a deadline' });
      if (new Date(closes_at).getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Deadline must be in the future' });
      }
    }

    const orgId = resolveOrgId(req.user);
    if (!orgId) return res.status(400).json({ error: 'Council member is not linked to an org' });

    // Spam cap: 3 active petitions per org.
    if (type === 'petition') {
      const active = db.prepare(
        "SELECT COUNT(*) AS n FROM council_posts WHERE org_id = ? AND type = 'petition' AND status = 'active'"
      ).get(orgId).n;
      if (active >= MAX_ACTIVE_PETITIONS_PER_ORG) {
        return res.status(400).json({
          error: `Org has reached the limit of ${MAX_ACTIVE_PETITIONS_PER_ORG} active petitions. Wait for one to close first.`
        });
      }
    }

    // Spam cap: 1 announcement per council member per 24h.
    if (type === 'announcement') {
      const recent = db.prepare(`
        SELECT COUNT(*) AS n FROM council_posts
        WHERE creator_id = ? AND type = 'announcement'
          AND datetime(published_at) > datetime('now', '-1 day')
      `).get(req.user.id).n;
      if (recent >= 1) {
        return res.status(400).json({ error: 'You can only publish one announcement per day.' });
      }
    }

    // Insert first so we have an id for the attachment filename.
    const result = db.prepare(`
      INSERT INTO council_posts (org_id, creator_id, creator_name, type, title, body, closes_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      orgId,
      req.user.id,
      req.user.full_name,
      type,
      title.trim(),
      body,
      type === 'petition' ? closes_at : null
    );
    const postId = result.lastInsertRowid;

    // Optional PDF attachment (petitions only — no point on announcements for v1).
    if (type === 'petition' && attachment) {
      try {
        const { url, displayName } = saveAttachment(attachment, postId, attachment_name);
        db.prepare('UPDATE council_posts SET attachment_url = ?, attachment_name = ? WHERE id = ?')
          .run(url, displayName, postId);
      } catch (e) {
        // Roll back the post if attachment was provided but failed to save.
        db.prepare('DELETE FROM council_posts WHERE id = ?').run(postId);
        return res.status(400).json({ error: e.message });
      }
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: `council_${type}_create`,
      actionDescription: `Published ${type}: "${title.trim()}"`,
      targetType: 'council_post',
      targetId: postId,
      metadata: { type, has_attachment: !!attachment, closes_at },
      ipAddress: req.ip,
      orgId,
    });

    // Notify everyone in the org (minus the author) so the feed gets eyeballs.
    const audience = db.prepare(
      "SELECT id FROM users WHERE org_id = ? AND id != ?"
    ).all(orgId, req.user.id).map(u => u.id);
    createNotifications({
      userIds: audience,
      orgId,
      type: type === 'petition' ? 'petition_published' : 'announcement',
      title: type === 'petition' ? `New petition: ${title.trim()}` : title.trim(),
      body: body.length > 100 ? body.slice(0, 97) + '…' : body,
      link: `${req.user.role}-comms-voice`,
    });

    const created = db.prepare('SELECT * FROM council_posts WHERE id = ?').get(postId);
    res.status(201).json(created);
  } catch (err) {
    console.error('Create council post error:', err);
    res.status(500).json({ error: 'Failed to publish post' });
  }
});

// ─── PUT /api/council/posts/:id ──────────────────────────────────────────────
// Author can edit within 15 min of publish. Admin/head can edit anytime
// (typically used to fix a typo or amend after takedown). Body changes after
// votes are cast are an integrity risk — that's exactly why the window exists.
router.put('/posts/:id', authenticate, (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM council_posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const isAuthor = post.creator_id === req.user.id;
    const isStaff = req.user.role === 'admin' || req.user.role === 'head';
    if (!isAuthor && !isStaff) {
      return res.status(403).json({ error: 'Not authorized to edit this post' });
    }
    if (isAuthor && !isStaff) {
      const elapsed = Date.now() - new Date(post.published_at + 'Z').getTime();
      if (elapsed > EDIT_WINDOW_MS) {
        return res.status(403).json({ error: 'Edit window has closed (15 minutes after publish)' });
      }
    }

    const { title, body, closes_at } = req.body;
    db.prepare(`
      UPDATE council_posts
      SET title = COALESCE(?, title),
          body  = COALESCE(?, body),
          closes_at = CASE WHEN type = 'petition' THEN COALESCE(?, closes_at) ELSE closes_at END
      WHERE id = ?
    `).run(title?.trim() || null, body || null, closes_at || null, post.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'council_post_edit',
      actionDescription: `Edited council post: "${post.title}"`,
      targetType: 'council_post',
      targetId: post.id,
      ipAddress: req.ip,
      orgId: post.org_id,
    });

    res.json(db.prepare('SELECT * FROM council_posts WHERE id = ?').get(post.id));
  } catch (err) {
    console.error('Edit council post error:', err);
    res.status(500).json({ error: 'Failed to edit post' });
  }
});

// ─── DELETE /api/council/posts/:id ──────────────────────────────────────────
// Soft delete — flips status to 'removed' so the row stays for audit. Admin
// and head can take down anything; authors can take down their own posts as
// long as they're still inside the edit window (cancel-while-fresh).
router.delete('/posts/:id', authenticate, (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM council_posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const isAuthor = post.creator_id === req.user.id;
    const isStaff = req.user.role === 'admin' || req.user.role === 'head';
    if (!isAuthor && !isStaff) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (isAuthor && !isStaff) {
      const elapsed = Date.now() - new Date(post.published_at + 'Z').getTime();
      if (elapsed > EDIT_WINDOW_MS) {
        return res.status(403).json({ error: 'Edit window has closed. Ask an admin to take this down.' });
      }
    }

    db.prepare("UPDATE council_posts SET status = 'removed' WHERE id = ?").run(post.id);

    // Best-effort: clean up the attachment file. The DB row stays.
    if (post.attachment_url) deleteAttachment(post.attachment_url);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'council_post_takedown',
      actionDescription: `${isStaff ? 'Took down' : 'Withdrew'} council post: "${post.title}"`,
      targetType: 'council_post',
      targetId: post.id,
      ipAddress: req.ip,
      orgId: post.org_id,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete council post error:', err);
    res.status(500).json({ error: 'Failed to take down post' });
  }
});

// ─── POST /api/council/posts/:id/vote ───────────────────────────────────────
// Students only. Upserts on (post_id, user_id). Rejects if petition is closed.
// The DB *does* know who voted what (for abuse investigations) but the API
// never returns that — see /results below.
router.post('/posts/:id/vote', authenticate, authorize('student'), (req, res) => {
  try {
    const { vote } = req.body;
    if (!['agree', 'disagree', 'neutral'].includes(vote)) {
      return res.status(400).json({ error: 'Invalid vote' });
    }
    const post = db.prepare('SELECT * FROM council_posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Petition not found' });
    if (post.type !== 'petition') return res.status(400).json({ error: 'This post is not a petition' });
    if (post.status !== 'active') return res.status(400).json({ error: 'This petition is closed' });

    // Same-org check: don't let a student from another org vote.
    const orgId = resolveOrgId(req.user);
    if (orgId && post.org_id && orgId !== post.org_id) {
      return res.status(403).json({ error: 'Not part of this organization' });
    }

    db.prepare(`
      INSERT INTO petition_votes (post_id, user_id, vote)
      VALUES (?, ?, ?)
      ON CONFLICT(post_id, user_id) DO UPDATE
        SET vote = excluded.vote, created_at = CURRENT_TIMESTAMP
    `).run(post.id, req.user.id, vote);

    res.json({ ok: true, vote });
  } catch (err) {
    console.error('Vote error:', err);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// ─── GET /api/council/posts/:id/results ─────────────────────────────────────
// Counts only. Never names. Never user IDs. Anti-bandwagon: students who
// haven't voted yet (and aren't staff/council) get 'pending: true' instead of
// the tally, so the UI can hide it. Staff and council always see counts.
router.get('/posts/:id/results', authenticate, (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM council_posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Petition not found' });
    if (post.type !== 'petition') return res.status(400).json({ error: 'Not a petition' });

    const rows = db.prepare(
      'SELECT vote, COUNT(*) AS n FROM petition_votes WHERE post_id = ? GROUP BY vote'
    ).all(post.id);
    const counts = { agree: 0, disagree: 0, neutral: 0 };
    rows.forEach(r => { counts[r.vote] = r.n; });
    const total = counts.agree + counts.disagree + counts.neutral;

    const isStaffOrCouncil =
      req.user.role === 'admin' ||
      req.user.role === 'head' ||
      req.user.role === 'teacher' ||
      req.user.is_student_council;

    if (post.status === 'closed' || isStaffOrCouncil) {
      return res.json({ ...counts, total, status: post.status });
    }

    // Student who isn't on council: gate behind their own vote.
    const own = db.prepare(
      'SELECT vote FROM petition_votes WHERE post_id = ? AND user_id = ?'
    ).get(post.id, req.user.id);

    if (!own) {
      return res.json({ pending: true, status: post.status });
    }
    res.json({ ...counts, total, status: post.status });
  } catch (err) {
    console.error('Results error:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// ─── GET /api/council/posts/:id/my-vote ─────────────────────────────────────
// Returns the calling student's own vote on this petition, or null. Used by
// the UI to show "Your vote" highlight without exposing other students' votes.
router.get('/posts/:id/my-vote', authenticate, (req, res) => {
  try {
    const row = db.prepare(
      'SELECT vote FROM petition_votes WHERE post_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);
    res.json({ vote: row?.vote || null });
  } catch (err) {
    console.error('My-vote error:', err);
    res.status(500).json({ error: 'Failed to fetch your vote' });
  }
});

module.exports = router;

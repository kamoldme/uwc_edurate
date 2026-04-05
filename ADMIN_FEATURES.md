# Oasis Admin Features Guide

## 🎯 New Features Summary

This document describes all the new administrative features added to make Oasis production-ready for real school deployment.

---

## 1️⃣ **User & Teacher Profile Management**

### Admin Can Edit Any User Profile

**Endpoint**: `PUT /api/admin/users/:id`

**Editable Fields**:
- Full name
- Email (with uniqueness validation)
- Grade/Position
- Role (student, teacher, school_head, admin)

**UI Location**: Admin → Users → Click "Edit" button

**Use Cases**:
- Fix typos in user names
- Update student grade level
- Correct email addresses
- Change user roles

---

### Admin Can Edit Teacher Profiles

**Endpoint**: `PUT /api/admin/teachers/:id`

**Editable Fields**:
- Full name (syncs with user table)
- Subject
- Department
- Years of Experience
- Bio

**UI Location**: Admin → Teachers → Click "Edit" button

**Use Cases**:
- Update teacher subject if they change departments
- Fix incorrect department assignments
- Update experience years
- Add/edit bio information

---

### Admin Password Reset

**Endpoint**: `POST /api/admin/users/:id/reset-password`

**UI Location**: Admin → Users → Click "Reset PW" button

**Requirements**:
- Minimum 8 characters
- Admin enters new password via prompt
- Confirmation required

**Use Cases**:
- User forgot password
- Security incident requiring password reset
- New user needs initial password set

---

## 2️⃣ **Classroom Management**

### List All Classrooms

**Endpoint**: `GET /api/admin/classrooms`

**Shows**:
- Subject, grade level
- Teacher name
- Term
- Student count
- Join code
- Active status

---

### Edit Classroom

**Endpoint**: `PUT /api/admin/classrooms/:id`

**Editable Fields**:
- Subject
- Grade level
- Teacher (reassign to different teacher)
- Term
- Active status

**Use Cases**:
- Teacher created classroom with wrong subject
- Reassign classroom to different teacher
- Deactivate old classrooms

---

### Delete Classroom

**Endpoint**: `DELETE /api/admin/classrooms/:id`

**Warning**: Cascades to classroom_members (students are removed)

**Use Cases**:
- Remove duplicate classrooms
- Clean up test classrooms
- Remove cancelled classes

---

### Add Student to Classroom

**Endpoint**: `POST /api/admin/classrooms/:id/add-student`

**Parameters**: `{ student_id: number }`

**Use Cases**:
- Student missed join code deadline
- Manual enrollment needed
- Transfer student between sections

---

### Remove Student from Classroom

**Endpoint**: `DELETE /api/admin/classrooms/:id/remove-student/:student_id`

**Use Cases**:
- Student dropped the class
- Student enrolled in wrong section
- Duplicate enrollment

---

## 3️⃣ **Review Moderation Enhancements**

### Bulk Approve Reviews

**Endpoint**: `POST /api/admin/reviews/bulk-approve`

**Parameters**: `{ review_ids: [1, 2, 3, ...] }`

**UI Location**: Admin → Moderate → "✓ Approve All (X)" button

**Use Cases**:
- **NEW SCHOOL SETUP**: Approve all initial reviews at once
- Trust established patterns
- Speed up moderation after confirming reviews are appropriate

**Benefits**:
- Saves hours during initial deployment
- One-click approval of 50+ reviews
- Perfect for end-of-term review waves

---

## 4️⃣ **Teacher Review Visibility (CRITICAL FIX)**

### Problem Solved

**Before**: Teachers couldn't see reviews until admin approved them
**After**: Teachers see ALL reviews immediately with status indicators

### Backend Changes

**File**: `routes/dashboard.js:94-106`

```javascript
// Teachers now receive ALL reviews (approved + pending)
const recentReviews = db.prepare(`
  SELECT r.*, r.flagged_status, r.approved_status, ...
  FROM reviews r
  WHERE r.teacher_id = ?
  ORDER BY r.created_at DESC
`).all(teacher.id);
```

### Frontend UI

**File**: `public/js/app.js:782-901`

**Visual Indicators**:
- ⏳ Yellow badge: "Pending Approval"
- ✅ No badge: Approved
- 🚩 Red badge: "Flagged"
- ❌ Gray badge: "Rejected"

**Warning Banner**:
```
⏳ 5 Reviews Pending Approval
These reviews are visible to you but awaiting admin approval
before being included in your official scores.
```

**Visual Styling**:
- Pending reviews: 70% opacity + yellow left border
- Separated count: "(12 approved, 5 pending)"

**Important**: Only **approved** reviews count toward official scores/averages!

---

## 5️⃣ **Comprehensive Audit Logging**

All new admin actions are fully audited:

| Action | Event Type | Logged Data |
|--------|-----------|-------------|
| Edit User | `user_edit` | Changed fields, user ID, timestamp |
| Reset Password | `password_reset` | User ID, admin who reset, IP address |
| Edit Teacher | `teacher_edit` | Changed fields, teacher ID |
| Edit Classroom | `classroom_edit` | Old/new values, classroom ID |
| Delete Classroom | `classroom_delete` | Deleted classroom details |
| Add Student | `classroom_add_student` | Student, classroom, timestamp |
| Remove Student | `classroom_remove_student` | Student, classroom, reason |
| Bulk Approve | `review_bulk_approve` | Review IDs, count |

**View Logs**: Admin → Audit Logs

**Filter By**:
- User ID
- Action type
- Date range
- Target type/ID

---

## 6️⃣ **Practical Workflows for New Schools**

### Scenario 1: Initial Setup (New School)

1. **Admin creates term**: "Fall 2024"
2. **Admin creates teachers**: Bulk or individual
3. **Teachers create classrooms**: Using their accounts
4. **Students join**: Via join codes
5. **Feedback period opens**: Admin activates
6. **Students submit reviews**: All reviews visible to teachers immediately
7. **Admin reviews moderation queue**: Click "Approve All (50)" for clean reviews
8. **Teachers see final scores**: Scores update automatically

**Time Saved**: Bulk approval saves ~10 seconds per review = **8+ minutes for 50 reviews**

---

### Scenario 2: Teacher Made a Mistake

**Problem**: Teacher created "Matematics" instead of "Mathematics"

**Solution**:
1. Admin → Classrooms
2. Find classroom
3. Edit subject to "Mathematics"
4. ✅ Fixed in 10 seconds

**Before This Feature**: Teacher would have to:
- Delete classroom (lose all student memberships)
- Recreate classroom (new join code)
- Have all students rejoin
- ⏱️ 20+ minutes wasted

---

### Scenario 3: Student Can't Access Review

**Problem**: Student says "I submitted a review but my teacher doesn't see it"

**Old Behavior**: Teacher couldn't see pending reviews → confusion

**New Behavior**:
1. Teacher logs in
2. Sees review with "⏳ Pending Approval" badge
3. Can tell student: "I see it! Just waiting for admin approval"
4. ✅ Clear communication

---

### Scenario 4: User Forgot Password

**Problem**: Teacher/student forgot password

**Solution**:
1. Admin → Users
2. Click "Reset PW" for that user
3. Enter new password (min 8 chars)
4. Give password to user
5. ✅ Done in 30 seconds

**Logged**: Admin action, timestamp, IP address

---

## 🔐 Security & Data Integrity

### Email Uniqueness
- Changing user email checks for conflicts
- Returns 409 error if email already in use

### Cascading Updates
- Updating teacher name updates both `teachers` and `users` tables
- Ensures data consistency

### Audit Trail
- Every admin action logged with:
  - Who did it (admin user ID + name)
  - What changed (before/after values in metadata)
  - When (timestamp)
  - Where from (IP address)

### Authorization
- All endpoints require admin role
- Some endpoints allow school_head (read-only operations)
- JWT token validation on every request

---

## 📊 Quick Reference: API Endpoints

### User Management
```
GET    /api/admin/users
POST   /api/admin/users
PUT    /api/admin/users/:id
POST   /api/admin/users/:id/reset-password
PUT    /api/admin/users/:id/suspend
```

### Teacher Management
```
GET    /api/admin/teachers
PUT    /api/admin/teachers/:id
GET    /api/admin/teacher/:id/feedback
```

### Classroom Management
```
GET    /api/admin/classrooms
PUT    /api/admin/classrooms/:id
DELETE /api/admin/classrooms/:id
POST   /api/admin/classrooms/:id/add-student
DELETE /api/admin/classrooms/:id/remove-student/:student_id
```

### Review Moderation
```
GET    /api/admin/reviews/pending
GET    /api/admin/reviews/flagged
GET    /api/admin/reviews/all
PUT    /api/admin/reviews/:id/approve
PUT    /api/admin/reviews/:id/reject
DELETE /api/admin/reviews/:id
POST   /api/admin/reviews/bulk-approve      ← NEW!
```

### Audit Logs
```
GET    /api/admin/audit-logs
GET    /api/admin/audit-stats
```

---

## 🎓 Training Guide for School Admins

### Daily Tasks

1. **Check pending reviews**: Admin → Moderate
   - Quick scan for inappropriate content
   - Click "Approve All" if everything looks good
   - Individual approve/reject for questionable ones

2. **Handle support requests**:
   - Password resets: Users → Reset PW
   - Student can't join: Classrooms → Add Student
   - Wrong info: Edit user/teacher/classroom

3. **Monitor audit logs**: Audit Logs → Recent actions

### Weekly Tasks

1. **Review statistics**: Admin → Dashboard
2. **Check completion rates**: Submissions → Overview
3. **Review flagged content**: Moderate → Flagged tab

### Term Setup Tasks

1. **Create new term**: Terms → Create Term
2. **Activate term**: Terms → Activate
3. **Create feedback periods**: Auto-created (Beginning, Mid, End)
4. **Open period when ready**: Periods → Toggle Active

---

## 🐛 Troubleshooting

### "Teacher can't see review"

**Check**:
1. Is review pending? (Should show with ⏳ badge)
2. Has admin approved it? (Check Moderate tab)
3. Is teacher looking at correct period/term?

**Solution**: Teacher should now see ALL reviews regardless of status

---

### "Can't change teacher's subject"

**Check**:
1. Are you logged in as admin?
2. Using the correct teacher ID?

**Solution**: Admin → Teachers → Edit → Update subject → Save

---

### "Student joined wrong classroom"

**Solution**:
1. Admin → Classrooms
2. Find wrong classroom → Actions → View Members
3. Remove student from wrong classroom
4. Find correct classroom → Add Student

---

## 📈 Impact Metrics

**Time Savings**:
- Bulk approve: **10 sec/review → 1 click** for 50+ reviews
- Fix classroom errors: **20 min → 10 sec**
- Password resets: **Email workflows → 30 sec**
- Student transfers: **Multiple steps → 2 clicks**

**Improved Communication**:
- Teachers see feedback immediately (no confusion)
- Clear status indicators (pending vs approved)
- Better student experience (instant visibility)

**Better Control**:
- Edit anything that's wrong
- Comprehensive audit trail
- No data locked after creation

---

## 🚀 Future Enhancement Ideas

Consider adding:
- CSV bulk user import
- Email notifications for review approvals
- Automatic approval rules (e.g., auto-approve 4-5 star reviews)
- Dashboard showing admin workload
- Student enrollment management UI
- Classroom cloning (copy structure to new term)

---

## 📞 Support

For questions about these features, check:
1. This documentation
2. Audit logs (to see what happened)
3. Browser console (F12) for errors
4. Server logs for backend issues

---

**Last Updated**: February 2026
**Oasis Version**: 1.1.0
**Features Added**: User/Teacher Editing, Classroom Management, Bulk Approve, Teacher Review Visibility

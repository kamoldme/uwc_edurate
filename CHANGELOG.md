# Changelog - Oasis v1.1.0

## What's New (February 2026)

### 1. ✅ Teacher Bio Editing
**Teachers can now update their own profiles**

**Backend** (`routes/auth.js`):
- Enhanced `/api/auth/update-profile` endpoint to accept `bio`, `subject`, `department`
- Automatic teacher table synchronization
- Audit logging for profile updates

**Frontend** (`public/js/app.js`):
- Added bio textarea to Account Details for teachers
- Subject and department fields
- Real-time profile updates

**Usage**: Login as teacher → Account Details → Edit bio/subject/department → Save

---

### 2. ✅ Admin Classroom Management
**Complete CRUD operations for classrooms**

**Backend** (`routes/admin.js`):
- `GET /api/admin/classrooms` - List all classrooms
- `PUT /api/admin/classrooms/:id` - Edit classroom (subject, grade, teacher, term, status)
- `DELETE /api/admin/classrooms/:id` - Delete classroom
- `POST /api/admin/classrooms/:id/add-student` - Manually add students
- `DELETE /api/admin/classrooms/:id/remove-student/:id` - Remove students

**Frontend** (`public/js/app.js`):
- Classroom management UI with Create/Edit/Delete buttons
- Teacher and term dropdown selectors
- Student enrollment management
- Confirmation dialogs for destructive actions

**Backend** (`routes/classrooms.js`):
- Audit logging for classroom creation

**Usage**: Admin → Classrooms → Create/Edit/Delete classrooms

---

### 3. ✅ Comprehensive Audit Logging
**Every action is now logged**

**New Audit Events**:
- `classroom_create` - When classroom is created
- `classroom_edit` - Classroom updates
- `classroom_delete` - Classroom deletion
- `classroom_add_student` - Student added to classroom
- `classroom_remove_student` - Student removed from classroom
- `term_create` - New term created
- `term_update` - Term modified
- `term_activate` - Term activated
- `period_activate` - Feedback period opened
- `period_update` - Period settings changed
- `profile_update` - User/teacher profile updated
- `review_submit` - Student submits review
- `review_approve` - Admin approves review
- `review_reject` - Admin rejects review
- `review_delete` - Admin deletes review
- `review_bulk_approve` - Bulk approval action
- `user_edit` - Admin edits user
- `user_suspend` - Admin suspends user
- `password_reset` - Admin resets password
- `teacher_edit` - Admin edits teacher profile

**Each Log Includes**:
- User ID, role, and name
- Action type and description
- Target entity type and ID
- Metadata (what changed)
- IP address
- Timestamp

**Files Modified**:
- `routes/admin.js` - Term, period, classroom, review actions
- `routes/classrooms.js` - Classroom creation
- `routes/auth.js` - Profile updates
- `utils/audit.js` - Already existed, no changes needed

**Usage**: Admin → Audit Logs → Filter by user/action/date

---

### 4. ✅ Support Contact System
**All users can now contact support**

**Frontend** (`public/js/app.js`):
- Support button added to sidebar (below Account Details)
- Support modal with category selection
- Subject and message fields
- Auto-includes user info (name, email, role)

**Categories**:
- Technical Issue / Bug
- Account & Login
- General Question
- Feature Request
- Other

**Note**: Currently logs to console. Can be easily connected to email API or ticketing system.

**Usage**: Any user → Sidebar → Support → Fill form → Send

---

### 5. ✅ GitHub Ready
**Project prepared for version control**

**Files Created**:
- `.gitignore` - Excludes node_modules, databases, env files
- `README.md` - Comprehensive project documentation
- `GITHUB_SETUP.md` - Step-by-step GitHub push instructions
- `CHANGELOG.md` - This file

**Git History**:
```
commit 98be502 - Add GitHub setup instructions
commit 7463eef - Add README and improve .gitignore
commit 6952b8b - Initial commit: Oasis School Feedback Platform
```

**Next Steps**: Follow [GITHUB_SETUP.md](GITHUB_SETUP.md) to push to GitHub

---

## Technical Improvements

### Database
- All audit events properly logged
- Indexes optimized for frequent queries

### Security
- Input sanitization on all user inputs
- Audit trail for compliance
- IP address logging for security

### User Experience
- Clear status indicators for reviews (Pending, Approved, Rejected)
- Immediate feedback visibility for teachers
- Bulk operations for admin efficiency
- Support system for user help

---

## Files Modified

### Backend
1. `routes/admin.js` (+150 lines)
   - Classroom management endpoints
   - Audit logging for terms and periods
   - Classroom student management

2. `routes/auth.js` (+40 lines)
   - Teacher bio/subject/department updating
   - Audit logging for profile updates

3. `routes/classrooms.js` (+15 lines)
   - Audit logging for classroom creation

### Frontend
1. `public/js/app.js` (+200 lines)
   - Teacher bio editing UI
   - Classroom management UI (create/edit/delete)
   - Support modal
   - Support button in sidebar

### Documentation
1. `README.md` (NEW) - 288 lines
2. `GITHUB_SETUP.md` (NEW) - 114 lines
3. `CHANGELOG.md` (NEW) - This file
4. `.gitignore` (NEW) - 44 lines
5. `ADMIN_FEATURES.md` (EXISTING) - Updated for new features

---

## Breaking Changes

None. All changes are backwards compatible.

---

## Migration Guide

No database migrations needed. Existing data is fully compatible.

---

## Known Issues

None reported.

---

## Future Enhancements (Suggestions)

1. **Email Integration**:
   - Connect support form to email service
   - Send notifications for review approvals
   - Password reset via email

2. **Advanced Analytics**:
   - Trend predictions
   - Sentiment analysis on feedback text
   - Custom date range filters

3. **Bulk Operations**:
   - CSV import for users
   - Bulk student enrollment
   - Classroom cloning

4. **Mobile App**:
   - React Native or Flutter app
   - Push notifications
   - Offline support

5. **Real-time Features**:
   - WebSocket for live updates
   - Real-time notification system
   - Live admin dashboard

---

## Upgrade Instructions

Since this is version 1.1.0, existing installations can upgrade by:

1. Pull latest code: `git pull origin main`
2. Install any new dependencies: `npm install`
3. Restart server: `npm start`

No database changes required.

---

## Credits

**Developed by**: Your Name
**AI Assistance**: Claude Sonnet 4.5
**Version**: 1.1.0
**Release Date**: February 2026

---

## Support

- In-app: Use the Support button
- GitHub: Open an issue
- Email: support@yourdomain.com

---

**Enjoy Oasis v1.1.0! 🎓✨**

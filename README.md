# Oasis - School Feedback Platform

A comprehensive web-based feedback system for schools where students can anonymously rate and review their teachers. Features include multi-dimensional ratings, admin moderation, analytics dashboards, and comprehensive audit logging.

## 🌟 Features

### For Students
- **Anonymous Reviews**: Submit feedback for teachers while maintaining anonymity
- **Multi-Dimensional Ratings**: Rate teachers on 5 categories (Clarity, Engagement, Fairness, Supportiveness, Overall)
- **Tagged Feedback**: Select from predefined tags to categorize reviews
- **Edit Reviews**: Modify submitted reviews during active feedback periods
- **Track Progress**: View submission status for all enrolled classrooms

### For Teachers
- **Comprehensive Dashboard**: View all reviews (approved + pending) with clear status indicators
- **Performance Analytics**: Track scores, trends, and improvement over time
- **Subject-Based Insights**: See ratings broken down by classroom/subject
- **Department Comparison**: Compare performance against department averages
- **Bio Editing**: Update profile, subject, and bio information
- **Review Visibility**: Immediately see pending reviews (before admin approval)

### For Admins
- **User Management**: Create, edit, suspend users and reset passwords
- **Teacher Management**: Edit teacher profiles (subject, department, experience, bio)
- **Classroom Management**: Create, edit, delete classrooms and manage student enrollments
- **Review Moderation**: Approve, reject, or delete reviews with bulk operations
- **Audit Logging**: Comprehensive tracking of ALL system actions with timestamps and IP addresses
- **Submission Tracking**: Monitor which students have/haven't submitted reviews
- **Statistics Dashboard**: System-wide analytics and participation rates

### For School Heads
- **Teacher Rankings**: View all teachers ranked by performance
- **Department Analytics**: Compare department averages and trends
- **Completion Rates**: Monitor review submission rates across all classrooms
- **Teacher Details**: Access detailed feedback for any teacher

## 🔐 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcrypt with salt rounds for secure password storage
- **Content Moderation**: Automatic flagging of inappropriate content
- **Rate Limiting**: Protection against brute force attacks
- **Content Security Policy**: Helmet.js integration for XSS protection
- **Input Sanitization**: All user inputs sanitized to prevent injection attacks
- **Audit Trail**: Every administrative action logged with full context

## 🚀 Tech Stack

**Backend:**
- Node.js + Express
- SQLite with better-sqlite3 (fast, embedded database)
- JWT for authentication
- bcryptjs for password hashing
- Helmet.js for security headers
- Rate limiting with express-rate-limit

**Frontend:**
- Vanilla JavaScript (SPA architecture)
- Chart.js for data visualization
- CSS Grid & Flexbox for responsive layout
- No framework dependencies

**Database Schema:**
- Users, Teachers, Classrooms
- Terms, Feedback Periods
- Reviews with multi-dimensional ratings
- Audit logs for compliance
- Classroom memberships

## 📦 Installation

### Prerequisites
- Node.js 14+ and npm

### Setup

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/oasis.git
cd oasis
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Access the application:
```
http://localhost:3000
```

## 🧪 Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@uwc.edu | Admin1234 |
| Head | head@uwc.edu | Head1234 |
| Teacher | teacher@uwc.edu | Teacher1234 |
| Student | student@uwc.edu | Student1234 |

## 📖 Usage Guide

### Admin Workflow

1. **User Management**: Navigate to "Users" tab
   - Create new users (students, teachers, admins)
   - Edit user profiles (name, email, grade, role)
   - Reset passwords for users
   - Suspend/unsuspend accounts

2. **Term Setup**:
   - Create academic term (e.g., "Fall 2024")
   - Three feedback periods auto-created (Beginning, Mid-Term, End)
   - Activate term when ready
   - Open specific feedback periods for student submissions

3. **Classroom Management**:
   - Create classrooms with subject, grade, teacher assignment
   - Edit classroom details or reassign teachers
   - Add/remove students manually
   - View join codes for student self-enrollment

4. **Review Moderation**:
   - Check "Moderate" tab for pending reviews
   - Bulk approve all clean reviews with one click
   - Individual approve/reject for questionable content
   - View "Flagged" tab for auto-flagged inappropriate content

5. **Audit Logs**:
   - View all system actions with timestamps
   - Filter by user, action type, date range
   - Track compliance and troubleshoot issues

### Teacher Workflow

1. **Create Classrooms**: Create classes for each subject/period you teach
2. **Share Join Codes**: Distribute unique codes to students
3. **View Feedback**: Check "Feedback" tab to see all reviews (including pending)
4. **Track Analytics**: Monitor scores, trends, and improvement areas
5. **Update Profile**: Edit bio, subject, and department in "Account Details"
6. **Respond**: Post responses to student feedback per classroom

### Student Workflow

1. **Join Classrooms**: Use join codes from teachers
2. **Submit Reviews**: During open feedback periods, rate your teachers
3. **Edit Reviews**: Modify reviews while the feedback period is active
4. **Track Progress**: See which teachers you've reviewed in dashboard

## 🔄 Audit Logging

Every significant action is logged including:
- User creation, editing, suspension
- Password resets
- Review submissions, approvals, rejections
- Classroom creation, editing, deletion
- Term and period management
- Student enrollment changes
- Profile updates (including teacher bio changes)

Each log entry includes:
- User who performed the action
- Action type and description
- Target entity (user, review, classroom, etc.)
- Metadata (what changed)
- IP address
- Timestamp

## 📊 Database Schema

### Core Tables
- `users` - All system users (students, teachers, admins, school heads)
- `teachers` - Extended teacher profiles (subject, department, bio, experience)
- `classrooms` - Course sections with teacher assignments
- `classroom_members` - Student enrollments
- `reviews` - Student feedback submissions
- `terms` - Academic terms
- `feedback_periods` - Review collection windows
- `teacher_responses` - Teacher responses to feedback
- `audit_logs` - System action history

### Key Features
- Composite indexes on frequently queried fields
- Foreign key constraints for data integrity
- Cascading deletes where appropriate
- UNIQUE constraints to prevent duplicates

## 🛡️ Security Best Practices

1. **Change Default Passwords**: Update all test account passwords in production
2. **Environment Variables**: Store sensitive config in `.env` file (not tracked in git)
3. **HTTPS**: Deploy behind HTTPS proxy (nginx, Apache)
4. **Database Backups**: Regular backups of `oasis.db` file
5. **Audit Log Monitoring**: Regularly review audit logs for suspicious activity
6. **Rate Limiting**: Configured to prevent abuse (100 requests/15min per IP)

## 📝 API Documentation

### Authentication
```
POST /api/auth/register - Register new user
POST /api/auth/login - Login and receive JWT token
GET /api/auth/me - Get current user info
PUT /api/auth/update-profile - Update user profile
PUT /api/auth/change-password - Change password
POST /api/auth/logout - Logout (clear cookie)
```

### Reviews
```
GET /api/reviews/tags - Get available feedback tags
GET /api/reviews/eligible-teachers - Teachers student can review
POST /api/reviews - Submit a review
GET /api/reviews/my-reviews - Student's own reviews
PUT /api/reviews/:id - Edit review
POST /api/reviews/:id/flag - Flag a review
```

### Admin
```
GET /api/admin/users - List all users
POST /api/admin/users - Create user
PUT /api/admin/users/:id - Edit user
POST /api/admin/users/:id/reset-password - Reset password
PUT /api/admin/users/:id/suspend - Suspend/unsuspend user

PUT /api/admin/teachers/:id - Edit teacher profile

GET /api/admin/classrooms - List all classrooms
PUT /api/admin/classrooms/:id - Edit classroom
DELETE /api/admin/classrooms/:id - Delete classroom
POST /api/admin/classrooms/:id/add-student - Add student
DELETE /api/admin/classrooms/:id/remove-student/:id - Remove student

GET /api/admin/reviews/pending - Pending reviews
GET /api/admin/reviews/flagged - Flagged reviews
PUT /api/admin/reviews/:id/approve - Approve review
PUT /api/admin/reviews/:id/reject - Reject review
POST /api/admin/reviews/bulk-approve - Bulk approve reviews

GET /api/admin/audit-logs - Get audit logs
GET /api/admin/audit-stats - Get audit statistics
```

See [ADMIN_FEATURES.md](ADMIN_FEATURES.md) for comprehensive admin documentation.

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with guidance from Claude Sonnet 4.5
- Chart.js for beautiful data visualization
- better-sqlite3 for fast, reliable database

## 📧 Support

For questions or issues, use the in-app Support button (below Account Details in sidebar) or open a GitHub issue.

---

**Version**: 1.1.0
**Last Updated**: February 2026
**Status**: Production Ready

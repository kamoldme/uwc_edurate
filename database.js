const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'oasis.db');
const db = new Database(DB_PATH);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'head', 'admin')),
    grade_or_position TEXT,
    school_id INTEGER DEFAULT 1,
    verified_status INTEGER DEFAULT 1,
    suspended INTEGER DEFAULT 0,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    subject TEXT,
    department TEXT,
    experience_years INTEGER DEFAULT 0,
    bio TEXT,
    avatar_url TEXT,
    school_id INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    school_id INTEGER DEFAULT 1,
    active_status INTEGER DEFAULT 1,
    feedback_visible INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feedback_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_date DATE,
    end_date DATE,
    active_status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS classrooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    grade_level TEXT NOT NULL,
    term_id INTEGER NOT NULL,
    join_code TEXT UNIQUE NOT NULL,
    active_status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS classroom_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classroom_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(classroom_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    classroom_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    school_id INTEGER DEFAULT 1,
    term_id INTEGER NOT NULL,
    feedback_period_id INTEGER NOT NULL,
    overall_rating INTEGER NOT NULL CHECK(overall_rating BETWEEN 1 AND 5),
    clarity_rating INTEGER NOT NULL CHECK(clarity_rating BETWEEN 1 AND 5),
    engagement_rating INTEGER NOT NULL CHECK(engagement_rating BETWEEN 1 AND 5),
    fairness_rating INTEGER NOT NULL CHECK(fairness_rating BETWEEN 1 AND 5),
    supportiveness_rating INTEGER NOT NULL CHECK(supportiveness_rating BETWEEN 1 AND 5),
    feedback_text TEXT,
    tags TEXT DEFAULT '[]',
    flagged_status TEXT DEFAULT 'pending' CHECK(flagged_status IN ('pending', 'flagged', 'approved', 'rejected')),
    approved_status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE,
    FOREIGN KEY (feedback_period_id) REFERENCES feedback_periods(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, student_id, feedback_period_id)
  );

  CREATE TABLE IF NOT EXISTS teacher_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    classroom_id INTEGER NOT NULL,
    feedback_period_id INTEGER NOT NULL,
    response_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (feedback_period_id) REFERENCES feedback_periods(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, classroom_id, feedback_period_id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_classrooms_join_code ON classrooms(join_code);
  CREATE INDEX IF NOT EXISTS idx_classroom_members_student ON classroom_members(student_id);
  CREATE INDEX IF NOT EXISTS idx_classroom_members_classroom ON classroom_members(classroom_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_teacher ON reviews(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_student ON reviews(student_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_period ON reviews(feedback_period_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_classroom ON reviews(classroom_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(flagged_status);
  CREATE INDEX IF NOT EXISTS idx_feedback_periods_term ON feedback_periods(term_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_role TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_description TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    metadata TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action_type);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_role TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('technical', 'account', 'question', 'feature', 'other')),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by INTEGER,
    admin_notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_support_messages_user ON support_messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_support_messages_status ON support_messages(status);
  CREATE INDEX IF NOT EXISTS idx_support_messages_created ON support_messages(created_at);

  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    subscription_status TEXT DEFAULT 'active' CHECK(subscription_status IN ('active', 'suspended', 'trial')),
    max_teachers INTEGER DEFAULT 100,
    max_students INTEGER DEFAULT 2000,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
`);

// Migration: Add feedback_visible column to terms table if it doesn't exist
try {
  const columns = db.prepare("PRAGMA table_info(terms)").all();
  const hasFeedbackVisible = columns.some(col => col.name === 'feedback_visible');

  if (!hasFeedbackVisible) {
    db.exec('ALTER TABLE terms ADD COLUMN feedback_visible INTEGER DEFAULT 1');
    console.log('✅ Migration: Added feedback_visible column to terms table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add avatar_url column to users table if it doesn't exist
try {
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasUserAvatar = userColumns.some(col => col.name === 'avatar_url');

  if (!hasUserAvatar) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
    console.log('✅ Migration: Added avatar_url column to users table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add avatar_url column to teachers table if it doesn't exist
try {
  const teacherColumns = db.prepare("PRAGMA table_info(teachers)").all();
  const hasTeacherAvatar = teacherColumns.some(col => col.name === 'avatar_url');

  if (!hasTeacherAvatar) {
    db.exec('ALTER TABLE teachers ADD COLUMN avatar_url TEXT');
    console.log('✅ Migration: Added avatar_url column to teachers table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add preparation_rating column to reviews table if it doesn't exist
try {
  const reviewColumns = db.prepare("PRAGMA table_info(reviews)").all();
  const hasPreparation = reviewColumns.some(col => col.name === 'preparation_rating');

  if (!hasPreparation) {
    db.exec('ALTER TABLE reviews ADD COLUMN preparation_rating INTEGER CHECK(preparation_rating BETWEEN 1 AND 5)');
    console.log('✅ Migration: Added preparation_rating column to reviews table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add workload_rating column to reviews table if it doesn't exist
try {
  const reviewColumns = db.prepare("PRAGMA table_info(reviews)").all();
  const hasWorkload = reviewColumns.some(col => col.name === 'workload_rating');

  if (!hasWorkload) {
    db.exec('ALTER TABLE reviews ADD COLUMN workload_rating INTEGER CHECK(workload_rating BETWEEN 1 AND 5)');
    console.log('✅ Migration: Added workload_rating column to reviews table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add language column to users table if it doesn't exist
try {
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (!userCols.some(col => col.name === 'language')) {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en'");
    console.log('✅ Migration: Added language column to users table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Multi-tenancy - Add org_id columns and migrate roles
try {
  const userCols2 = db.prepare("PRAGMA table_info(users)").all();
  const hasOrgId = userCols2.some(col => col.name === 'org_id');

  if (!hasOrgId) {
    // Step 1: Seed default organization
    const orgExists = db.prepare("SELECT COUNT(*) as count FROM organizations").get();
    if (orgExists.count === 0) {
      db.prepare("INSERT INTO organizations (id, name, slug, contact_email) VALUES (1, 'Default School', 'default-school', 'admin@oasis.uwcdilijan.am')").run();
      console.log('✅ Migration: Created default organization');
    }

    // Step 2: Recreate users table with new role CHECK and org_id column
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'head', 'admin')),
        grade_or_position TEXT,
        school_id INTEGER DEFAULT 1,
        org_id INTEGER REFERENCES organizations(id),
        verified_status INTEGER DEFAULT 1,
        suspended INTEGER DEFAULT 0,
        avatar_url TEXT,
        language TEXT DEFAULT 'en',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users_new (id, full_name, email, password, role, grade_or_position, school_id, org_id, verified_status, suspended, avatar_url, language, created_at)
        SELECT id, full_name, email, password,
          CASE WHEN role IN ('admin', 'super_admin') THEN 'admin' ELSE role END,
          grade_or_position, school_id,
          school_id,
          verified_status, suspended, avatar_url, language, created_at
        FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: Recreated users table with new roles and org_id');

    // Step 3: Add org_id to teachers
    db.exec('ALTER TABLE teachers ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE teachers SET org_id = school_id');
    db.exec('CREATE INDEX IF NOT EXISTS idx_teachers_org ON teachers(org_id)');
    console.log('✅ Migration: Added org_id to teachers table');

    // Step 4: Add org_id to terms
    db.exec('ALTER TABLE terms ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE terms SET org_id = school_id');
    db.exec('CREATE INDEX IF NOT EXISTS idx_terms_org ON terms(org_id)');
    console.log('✅ Migration: Added org_id to terms table');

    // Step 5: Add org_id to classrooms
    db.exec('ALTER TABLE classrooms ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE classrooms SET org_id = (SELECT t.org_id FROM teachers t WHERE t.id = classrooms.teacher_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_classrooms_org ON classrooms(org_id)');
    console.log('✅ Migration: Added org_id to classrooms table');

    // Step 6: Add org_id to reviews
    db.exec('ALTER TABLE reviews ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE reviews SET org_id = school_id');
    db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_org ON reviews(org_id)');
    console.log('✅ Migration: Added org_id to reviews table');

    // Step 7: Add org_id to audit_logs
    db.exec('ALTER TABLE audit_logs ADD COLUMN org_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(org_id)');
    console.log('✅ Migration: Added org_id to audit_logs table');

    // Step 8: Add org_id to support_messages
    db.exec('ALTER TABLE support_messages ADD COLUMN org_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_support_messages_org ON support_messages(org_id)');
    console.log('✅ Migration: Added org_id to support_messages table');

  }
} catch (err) {
  console.error('Migration error (multi-tenancy):', err.message);
}

// Migration: Make classrooms.term_id nullable — classrooms persist across terms
try {
  const classroomCols = db.prepare("PRAGMA table_info(classrooms)").all();
  const termIdCol = classroomCols.find(c => c.name === 'term_id');

  if (termIdCol && termIdCol.notnull === 1) {
    console.log('🔄 Migration: Making classrooms.term_id nullable...');
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE classrooms_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        grade_level TEXT NOT NULL,
        term_id INTEGER,
        join_code TEXT UNIQUE NOT NULL,
        active_status INTEGER DEFAULT 1,
        org_id INTEGER REFERENCES organizations(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
      );

      INSERT INTO classrooms_new (id, teacher_id, subject, grade_level, term_id, join_code, active_status, org_id, created_at)
        SELECT id, teacher_id, subject, grade_level, term_id, join_code, active_status, org_id, created_at
        FROM classrooms;

      DROP TABLE classrooms;
      ALTER TABLE classrooms_new RENAME TO classrooms;

      CREATE INDEX IF NOT EXISTS idx_classrooms_teacher  ON classrooms(teacher_id);
      CREATE INDEX IF NOT EXISTS idx_classrooms_join_code ON classrooms(join_code);
      CREATE INDEX IF NOT EXISTS idx_classrooms_org       ON classrooms(org_id);

      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: classrooms.term_id is now nullable — classrooms persist across terms');
  }
} catch (err) {
  db.pragma('foreign_keys = ON');
  console.error('Migration error (classrooms term_id nullable):', err.message);
}

// Migration: Remove CHECK constraint from feedback_periods.name to allow custom names
try {
  const fpCols = db.prepare("PRAGMA table_info(feedback_periods)").all();
  const nameCol = fpCols.find(c => c.name === 'name');

  // Check if the table still has the old CHECK constraint
  // We detect this by trying to insert an invalid value and catching the error
  const hasConstraint = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='feedback_periods'")
    .get().sql.includes("CHECK(name IN ('1st Half', '2nd Half'))");

  if (hasConstraint) {
    console.log('🔄 Migration: Removing feedback period name constraint...');

    // Create new table without CHECK constraint
    db.exec(`
      CREATE TABLE feedback_periods_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        start_date DATE,
        end_date DATE,
        active_status INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
      );
    `);

    // Copy existing data
    db.exec(`
      INSERT INTO feedback_periods_new (id, term_id, name, start_date, end_date, active_status, created_at)
      SELECT id, term_id, name, start_date, end_date, active_status, created_at
      FROM feedback_periods;
    `);

    // Drop old table and rename new one
    db.exec(`DROP TABLE feedback_periods;`);
    db.exec(`ALTER TABLE feedback_periods_new RENAME TO feedback_periods;`);

    console.log('✅ Migration: Removed feedback period name constraint - now accepts any name');
  }
} catch (err) {
  console.error('Migration error (feedback_periods name constraint):', err.message);
}

// Migration: Rename legacy "1st Half" / "2nd Half" feedback period names
try {
  db.prepare("UPDATE feedback_periods SET name = 'Feedback Period' WHERE name IN ('1st Half', '2nd Half')").run();
} catch (err) { /* ignore */ }

// Migration: Rebuild audit_logs to remove ALL foreign key constraints.
// Audit logs are historical records and must never fail due to FK violations.
try {
  const auditDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();
  if (auditDef && auditDef.sql.toUpperCase().includes('FOREIGN KEY')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE audit_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_role TEXT NOT NULL,
        user_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_description TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        metadata TEXT,
        ip_address TEXT,
        org_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO audit_logs_new
        (id, user_id, user_role, user_name, action_type, action_description,
         target_type, target_id, metadata, ip_address, org_id, created_at)
      SELECT
        id, user_id, user_role, user_name, action_type, action_description,
        target_type, target_id, metadata, ip_address, org_id, created_at
      FROM audit_logs;
      DROP TABLE audit_logs;
      ALTER TABLE audit_logs_new RENAME TO audit_logs;
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user    ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs(action_type);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target  ON audit_logs(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org     ON audit_logs(org_id);
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: audit_logs foreign key constraint removed');
  }
} catch (err) {
  db.pragma('foreign_keys = ON');
  console.error('Migration error (audit_logs fk removal):', err.message);
}

// Migration: Add invite_code to organizations for teacher self-registration
// Note: SQLite does not support UNIQUE in ALTER TABLE ADD COLUMN — use separate index instead
try {
  const orgCols = db.pragma('table_info(organizations)').map(c => c.name);
  if (!orgCols.includes('invite_code')) {
    db.exec('ALTER TABLE organizations ADD COLUMN invite_code TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_invite_code ON organizations(invite_code)');
    console.log('✅ Migration: Added invite_code column to organizations');
  }

  // Generate codes for any org still missing one (handles first-run and any existing NULLs)
  const _invChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function _genInviteCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += _invChars[Math.floor(Math.random() * _invChars.length)];
    return code;
  }
  const orgsWithoutCode = db.prepare('SELECT id FROM organizations WHERE invite_code IS NULL').all();
  for (const org of orgsWithoutCode) {
    let code;
    do { code = _genInviteCode(); } while (db.prepare('SELECT id FROM organizations WHERE invite_code = ?').get(code));
    db.prepare('UPDATE organizations SET invite_code = ? WHERE id = ?').run(code, org.id);
  }
  if (orgsWithoutCode.length > 0) {
    console.log(`✅ Migration: Generated invite codes for ${orgsWithoutCode.length} organization(s)`);
  }
} catch (err) {
  console.error('Migration error (org invite_code):', err.message);
}

// Migration: Add custom questionnaire forms tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'closed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_forms_teacher ON forms(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_forms_classroom ON forms(classroom_id);
    CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);

    CREATE TABLE IF NOT EXISTS form_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL CHECK(question_type IN ('text', 'multiple_choice', 'yes_no')),
      options TEXT,
      required INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_form_questions_form ON form_questions(form_id);

    CREATE TABLE IF NOT EXISTS form_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(form_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_form_responses_form ON form_responses(form_id);
    CREATE INDEX IF NOT EXISTS idx_form_responses_student ON form_responses(student_id);

    CREATE TABLE IF NOT EXISTS form_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id INTEGER NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES form_questions(id) ON DELETE CASCADE,
      answer_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_form_answers_response ON form_answers(response_id);
    CREATE INDEX IF NOT EXISTS idx_form_answers_question ON form_answers(question_id);
  `);
} catch (err) {
  console.error('Migration error (forms tables):', err.message);
}

// Migration: extend forms for admin multi-classroom support
try {
  const hasCreatorRole = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('forms') WHERE name='creator_role'").get();
  if (!hasCreatorRole.c) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE forms_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
        classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
        creator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        creator_role TEXT NOT NULL DEFAULT 'teacher',
        org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'closed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO forms_v2 (id, teacher_id, classroom_id, creator_role, title, description, status, created_at)
        SELECT id, teacher_id, classroom_id, 'teacher', title, description, status, created_at FROM forms;
      DROP TABLE forms;
      ALTER TABLE forms_v2 RENAME TO forms;
      CREATE INDEX IF NOT EXISTS idx_forms_teacher ON forms(teacher_id);
      CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);
      CREATE INDEX IF NOT EXISTS idx_forms_org ON forms(org_id);
      CREATE INDEX IF NOT EXISTS idx_forms_creator ON forms(creator_user_id);
    `);
    // Backfill creator_user_id and org_id from the linked teacher records
    db.prepare(`
      UPDATE forms SET
        creator_user_id = (SELECT user_id FROM teachers WHERE id = forms.teacher_id),
        org_id = (SELECT org_id FROM teachers WHERE id = forms.teacher_id)
      WHERE teacher_id IS NOT NULL
    `).run();
    db.pragma('foreign_keys = ON');
  }

  // form_classrooms junction table (form → many classrooms)
  db.exec(`
    CREATE TABLE IF NOT EXISTS form_classrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      UNIQUE(form_id, classroom_id)
    );
    CREATE INDEX IF NOT EXISTS idx_form_classrooms_form ON form_classrooms(form_id);
    CREATE INDEX IF NOT EXISTS idx_form_classrooms_classroom ON form_classrooms(classroom_id);
  `);

  // Backfill existing teacher forms into form_classrooms
  db.prepare(`
    INSERT OR IGNORE INTO form_classrooms (form_id, classroom_id)
    SELECT id, classroom_id FROM forms WHERE classroom_id IS NOT NULL AND teacher_id IS NOT NULL
  `).run();
} catch (err) {
  console.error('Migration error (forms multi-classroom):', err.message);
}

// Add deadline column to forms
try {
  const hasDeadline = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('forms') WHERE name='deadline'").get();
  if (!hasDeadline.c) {
    db.exec('ALTER TABLE forms ADD COLUMN deadline DATETIME');
  }
} catch (err) {
  console.error('Migration error (forms deadline):', err.message);
}

// Announcements feature
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      creator_role TEXT NOT NULL,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'org',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS announcement_classrooms (
      announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
      PRIMARY KEY (announcement_id, classroom_id)
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_org ON announcements(org_id);
    CREATE INDEX IF NOT EXISTS idx_announcements_creator ON announcements(creator_id);
    CREATE INDEX IF NOT EXISTS idx_announcement_classrooms_classroom ON announcement_classrooms(classroom_id);
  `);
} catch (err) {
  console.error('Migration error (announcements):', err.message);
}

// Migration: in-app notifications (initial create)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS in_app_notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id     INTEGER REFERENCES organizations(id)  ON DELETE CASCADE,
      type       TEXT NOT NULL CHECK(type IN (
                   'announcement', 'form_active',
                   'period_open', 'review_approved')),
      title      TEXT NOT NULL,
      body       TEXT,
      link       TEXT,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user    ON in_app_notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_notif_org     ON in_app_notifications(org_id);
    CREATE INDEX IF NOT EXISTS idx_notif_created ON in_app_notifications(created_at);
  `);
} catch (err) {
  console.error('Migration error (notifications):', err.message);
}

// Migration: extend notification types to include support events
try {
  const notifCols = db.prepare("PRAGMA table_info(in_app_notifications)").all();
  const hasTable = notifCols.length > 0;
  if (hasTable) {
    // Check if the CHECK constraint already includes support types by attempting a dry-run insert
    // Easiest reliable check: recreate only if 'support_new' not in allowed types
    // We detect by trying a temporary insert and rolling back
    let needsMigration = false;
    try {
      db.prepare("INSERT INTO in_app_notifications (user_id, type, title) VALUES (0, 'support_new', 'test')").run();
      db.prepare("DELETE FROM in_app_notifications WHERE user_id = 0 AND type = 'support_new'").run();
    } catch (e) {
      needsMigration = true;
    }
    if (needsMigration) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE in_app_notifications_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          org_id     INTEGER REFERENCES organizations(id)  ON DELETE CASCADE,
          type       TEXT NOT NULL CHECK(type IN (
                       'announcement', 'form_active', 'period_open',
                       'review_approved', 'support_new', 'support_resolved')),
          title      TEXT NOT NULL,
          body       TEXT,
          link       TEXT,
          read       INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO in_app_notifications_new SELECT * FROM in_app_notifications;
        DROP TABLE in_app_notifications;
        ALTER TABLE in_app_notifications_new RENAME TO in_app_notifications;
        CREATE INDEX IF NOT EXISTS idx_notif_user    ON in_app_notifications(user_id, read);
        CREATE INDEX IF NOT EXISTS idx_notif_org     ON in_app_notifications(org_id);
        CREATE INDEX IF NOT EXISTS idx_notif_created ON in_app_notifications(created_at);
        COMMIT;
      `);
      db.pragma('foreign_keys = ON');
      console.log('✅ Migration: extended notification types with support_new, support_resolved');
    }
  }
} catch (err) {
  console.error('Migration error (extend notification types):', err.message);
}

// Migration: departments table
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);
  `);
} catch (err) {
  console.error('Migration error (departments):', err.message);
}

// Migration: classrooms get their own department (Approach A, Phase 1).
// Phase 1 is ADDITIVE ONLY — schema changes + backfill, zero behavior change.
// teacher.department stays put as the UI default for new classrooms; analytics
// queries continue to use it until Phase 2 lands. Fully idempotent: safe to
// re-run on every boot. If anything fails partway, the next boot picks up.
try {
  const classroomCols = db.prepare("PRAGMA table_info(classrooms)").all();
  const hasDeptCol = classroomCols.some(c => c.name === 'department_id');

  if (!hasDeptCol) {
    console.log('🔄 Migration: adding classrooms.department_id...');
    db.exec(`ALTER TABLE classrooms ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_classrooms_department ON classrooms(department_id)`);
    console.log('✅ Migration: added classrooms.department_id');
  }

  // Run the backfill in a transaction so it's all-or-nothing per boot.
  // INSERT OR IGNORE on UNIQUE(org_id, name) gives us idempotency for free.
  db.transaction(() => {
    // Step 1: materialize departments from existing free-text teacher.department
    const matResult = db.prepare(`
      INSERT OR IGNORE INTO departments (name, org_id)
      SELECT DISTINCT TRIM(department) as name, org_id
      FROM teachers
      WHERE department IS NOT NULL AND TRIM(department) != '' AND org_id IS NOT NULL
    `).run();
    if (matResult.changes > 0) {
      console.log(`✅ Migration: materialized ${matResult.changes} department(s) from teacher.department`);
    }

    // Step 2: backfill classrooms.department_id from each teacher's department.
    // Only touches classrooms with NULL department_id whose teacher has a
    // department string — NEVER overwrites an explicitly-set value.
    const backfillResult = db.prepare(`
      UPDATE classrooms
      SET department_id = (
        SELECT d.id
        FROM departments d
        JOIN teachers te ON te.org_id = d.org_id AND TRIM(te.department) = d.name
        WHERE te.id = classrooms.teacher_id
        LIMIT 1
      )
      WHERE department_id IS NULL
        AND EXISTS (
          SELECT 1 FROM teachers te2
          WHERE te2.id = classrooms.teacher_id
            AND te2.department IS NOT NULL
            AND TRIM(te2.department) != ''
        )
    `).run();
    if (backfillResult.changes > 0) {
      console.log(`✅ Migration: backfilled department_id on ${backfillResult.changes} classroom(s)`);
    }
  })();

  // Step 3: verification — read-only counts for the deploy log.
  const totalClassrooms = db.prepare('SELECT COUNT(*) as n FROM classrooms').get().n;
  const classroomsWithDept = db.prepare('SELECT COUNT(*) as n FROM classrooms WHERE department_id IS NOT NULL').get().n;
  const orphanCount = db.prepare(`
    SELECT COUNT(*) as n
    FROM classrooms c
    JOIN teachers te ON te.id = c.teacher_id
    WHERE c.department_id IS NULL
      AND te.department IS NOT NULL AND TRIM(te.department) != ''
  `).get().n;
  console.log(`📊 Classrooms: ${classroomsWithDept}/${totalClassrooms} have department_id (the rest were created without a teacher department, OK)`);
  if (orphanCount > 0) {
    console.warn(`⚠️ ${orphanCount} classroom(s) couldn't be backfilled — teacher had a department string that didn't match any departments row. Investigate.`);
  }
} catch (err) {
  console.error('Migration error (classroom department_id):', err.message);
}

// Migration: feedback_period_classrooms — classroom-scoped feedback periods
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback_period_classrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_period_id INTEGER NOT NULL
        REFERENCES feedback_periods(id) ON DELETE CASCADE,
      classroom_id INTEGER NOT NULL
        REFERENCES classrooms(id) ON DELETE CASCADE,
      UNIQUE(feedback_period_id, classroom_id)
    );
    CREATE INDEX IF NOT EXISTS idx_fpc_period ON feedback_period_classrooms(feedback_period_id);
    CREATE INDEX IF NOT EXISTS idx_fpc_classroom ON feedback_period_classrooms(classroom_id);
  `);
} catch (err) { console.error('Migration error (feedback_period_classrooms):', err.message); }

// Backfill: assign all org classrooms to existing feedback_periods that have no assignments yet
try {
  const unassigned = db.prepare(`
    SELECT fp.id as period_id, t.org_id
    FROM feedback_periods fp
    JOIN terms t ON fp.term_id = t.id
    WHERE NOT EXISTS (
      SELECT 1 FROM feedback_period_classrooms WHERE feedback_period_id = fp.id
    )
  `).all();
  if (unassigned.length > 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO feedback_period_classrooms (feedback_period_id, classroom_id) VALUES (?, ?)');
    db.transaction(() => {
      for (const row of unassigned) {
        if (!row.org_id) continue;
        const cls = db.prepare('SELECT id FROM classrooms WHERE org_id = ?').all(row.org_id);
        for (const c of cls) ins.run(row.period_id, c.id);
      }
    })();
    console.log(`✅ Migration: backfilled feedback_period_classrooms for ${unassigned.length} period(s)`);
  }
} catch (err) { console.error('Migration error (backfill feedback_period_classrooms):', err.message); }

// Migration: Rename old roles to new simplified names
// org_admin -> admin, super_admin -> admin, school_head -> head
try {
  const oldRoleUser = db.prepare(
    "SELECT id FROM users WHERE role IN ('org_admin', 'super_admin', 'school_head') LIMIT 1"
  ).get();

  if (oldRoleUser) {
    console.log('🔄 Migration: Renaming old roles (org_admin/super_admin→admin, school_head→head)...');
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE users_roles_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'head', 'admin')),
        grade_or_position TEXT,
        school_id INTEGER DEFAULT 1,
        org_id INTEGER REFERENCES organizations(id),
        verified_status INTEGER DEFAULT 1,
        suspended INTEGER DEFAULT 0,
        avatar_url TEXT,
        language TEXT DEFAULT 'en',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users_roles_new
        (id, full_name, email, password, role, grade_or_position, school_id, org_id, verified_status, suspended, avatar_url, language, created_at)
      SELECT
        id, full_name, email, password,
        CASE
          WHEN role IN ('org_admin', 'super_admin', 'admin') THEN 'admin'
          WHEN role = 'school_head' THEN 'head'
          ELSE role
        END,
        grade_or_position, school_id, org_id, verified_status, suspended, avatar_url, language, created_at
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_roles_new RENAME TO users;

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_org   ON users(org_id);

      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: Roles renamed successfully');
  }
} catch (err) {
  db.pragma('foreign_keys = ON');
  console.error('Migration error (role rename):', err.message);
}

// Seed the single organization if it doesn't exist
try {
  const orgCount = db.prepare('SELECT COUNT(*) as count FROM organizations').get();
  if (orgCount.count === 0) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let inviteCode = '';
    for (let i = 0; i < 8; i++) inviteCode += chars[Math.floor(Math.random() * chars.length)];
    db.prepare("INSERT INTO organizations (id, name, slug, invite_code) VALUES (1, 'UWC', 'uwc', ?)").run(inviteCode);
    console.log('✅ Seeded organization: UWC');
  }
} catch (err) {
  console.error('Org seeding error:', err.message);
}

// Migration: Add 13 new criteria columns to reviews table
try {
  const { CRITERIA_CONFIG } = require('./utils/criteriaConfig');
  const revCols = db.prepare("PRAGMA table_info(reviews)").all().map(c => c.name);
  for (const crit of CRITERIA_CONFIG) {
    if (!revCols.includes(crit.db_col)) {
      db.exec(`ALTER TABLE reviews ADD COLUMN ${crit.db_col} INTEGER CHECK(${crit.db_col} BETWEEN 1 AND 5)`);
      console.log(`✅ Migration: Added ${crit.db_col} to reviews`);
    }
  }
} catch (err) {
  console.error('Migration error (new criteria cols):', err.message);
}

// Migration: Add teacher_private to feedback_periods for progressive visibility
try {
  const fpCols = db.prepare("PRAGMA table_info(feedback_periods)").all().map(c => c.name);
  if (!fpCols.includes('teacher_private')) {
    db.exec('ALTER TABLE feedback_periods ADD COLUMN teacher_private INTEGER DEFAULT 1');
    // Backfill: existing closed periods should be visible to heads/admins
    db.prepare("UPDATE feedback_periods SET teacher_private = 0 WHERE active_status = 0").run();
    console.log('✅ Migration: Added teacher_private to feedback_periods');
  }
} catch (err) {
  console.error('Migration error (teacher_private):', err.message);
}

// Migration: Add is_student_council flag to users (Student Council feature)
try {
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('is_student_council')) {
    db.exec('ALTER TABLE users ADD COLUMN is_student_council INTEGER DEFAULT 0');
    console.log('✅ Migration: Added is_student_council to users');
  }
} catch (err) {
  console.error('Migration error (is_student_council):', err.message);
}

// Migration: council_posts (announcements + petitions published by Student Council)
// creator_id uses ON DELETE SET NULL so a graduating council member doesn't wipe
// out posts the school cared about. creator_name is denormalized for that case.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS council_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      creator_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('announcement', 'petition')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      attachment_url TEXT,
      attachment_name TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed', 'removed')),
      closes_at DATETIME,
      published_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_council_posts_org ON council_posts(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_council_posts_published ON council_posts(published_at DESC);
  `);
} catch (err) {
  console.error('Migration error (council_posts):', err.message);
}

// Migration: petition_votes — anonymous-aggregate ballot. (post_id, user_id) is
// UNIQUE so a student can change their vote, but each student counts at most once.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS petition_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES council_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vote TEXT NOT NULL CHECK(vote IN ('agree', 'disagree', 'neutral')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_petition_votes_post ON petition_votes(post_id);
  `);
} catch (err) {
  console.error('Migration error (petition_votes):', err.message);
}

// Migration: experiences — student-authored reflections on UWC experiences.
// Visible to the head of school and admins by name (Model B, students consent
// at first visit). Owned by the student, edit/delete is owner-only. Deleted
// experiences are hard-deleted (no soft-delete column) so a student can
// genuinely retract a reflection.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id INTEGER,
      school_id INTEGER DEFAULT 1,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      experience_date DATE NOT NULL,
      values_json TEXT NOT NULL DEFAULT '[]',
      reflection TEXT NOT NULL,
      consented_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_experiences_student ON experiences(student_id);
    CREATE INDEX IF NOT EXISTS idx_experiences_org ON experiences(org_id);
    CREATE INDEX IF NOT EXISTS idx_experiences_date ON experiences(experience_date DESC);

    CREATE TABLE IF NOT EXISTS experience_consents (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      consented_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      version TEXT NOT NULL DEFAULT 'v1'
    );
  `);
} catch (err) {
  console.error('Migration error (experiences):', err.message);
}

// Migration: extend in_app_notifications.type CHECK to include petition events.
// SQLite can't ALTER a CHECK constraint — must rebuild the table. Detection
// works by try-inserting a row with the new type and seeing if SQLite throws.
// (Same pattern as the support_new / support_resolved extension above.)
try {
  let needsMigration = false;
  try {
    db.prepare("INSERT INTO in_app_notifications (user_id, type, title) VALUES (0, 'petition_published', 'test')").run();
    db.prepare("DELETE FROM in_app_notifications WHERE user_id = 0 AND type = 'petition_published'").run();
  } catch (e) {
    needsMigration = true;
  }
  if (needsMigration) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE in_app_notifications_v3 (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_id     INTEGER REFERENCES organizations(id)  ON DELETE CASCADE,
        type       TEXT NOT NULL CHECK(type IN (
                     'announcement', 'form_active', 'period_open',
                     'review_approved', 'support_new', 'support_resolved',
                     'petition_published', 'petition_closed')),
        title      TEXT NOT NULL,
        body       TEXT,
        link       TEXT,
        read       INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO in_app_notifications_v3 SELECT * FROM in_app_notifications;
      DROP TABLE in_app_notifications;
      ALTER TABLE in_app_notifications_v3 RENAME TO in_app_notifications;
      CREATE INDEX IF NOT EXISTS idx_notif_user    ON in_app_notifications(user_id, read);
      CREATE INDEX IF NOT EXISTS idx_notif_org     ON in_app_notifications(org_id);
      CREATE INDEX IF NOT EXISTS idx_notif_created ON in_app_notifications(created_at);
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: extended notification types with petition_published, petition_closed');
  }
} catch (err) {
  console.error('Migration error (extend notification types for petitions):', err.message);
}

// Migration: make legacy 4-criteria columns nullable on reviews.
// The original schema had clarity/engagement/fairness/supportiveness as NOT NULL.
// After the 13-criteria switch the INSERT no longer fills them, which blew up
// every review submission with a NOT NULL constraint error. SQLite can't ALTER
// a column's nullability, so we rebuild the table when we detect the old shape.
try {
  const cols = db.prepare("PRAGMA table_info(reviews)").all();
  const legacyCols = ['clarity_rating', 'engagement_rating', 'fairness_rating', 'supportiveness_rating'];
  const needsMigration = cols.some(c => legacyCols.includes(c.name) && c.notnull === 1);

  if (needsMigration) {
    console.log('🔄 Migration: making legacy review criteria columns nullable...');
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE reviews_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          teacher_id INTEGER NOT NULL,
          classroom_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          school_id INTEGER DEFAULT 1,
          org_id INTEGER,
          term_id INTEGER NOT NULL,
          feedback_period_id INTEGER NOT NULL,
          overall_rating INTEGER NOT NULL CHECK(overall_rating BETWEEN 1 AND 5),
          clarity_rating INTEGER CHECK(clarity_rating IS NULL OR clarity_rating BETWEEN 1 AND 5),
          engagement_rating INTEGER CHECK(engagement_rating IS NULL OR engagement_rating BETWEEN 1 AND 5),
          fairness_rating INTEGER CHECK(fairness_rating IS NULL OR fairness_rating BETWEEN 1 AND 5),
          supportiveness_rating INTEGER CHECK(supportiveness_rating IS NULL OR supportiveness_rating BETWEEN 1 AND 5),
          preparation_rating INTEGER,
          workload_rating INTEGER,
          atmosphere_rating INTEGER,
          lesson_focus_rating INTEGER,
          interaction_rating INTEGER,
          agency_rating INTEGER,
          rigour_rating INTEGER,
          practical_app_rating INTEGER,
          real_life_app_rating INTEGER,
          preparedness_rating INTEGER,
          feedback_qual_rating INTEGER,
          subject_knowledge_rating INTEGER,
          approachability_rating INTEGER,
          varied_methods_rating INTEGER,
          engaging_content_rating INTEGER,
          feedback_text TEXT,
          tags TEXT DEFAULT '[]',
          flagged_status TEXT DEFAULT 'pending' CHECK(flagged_status IN ('pending', 'flagged', 'approved', 'rejected')),
          approved_status INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
          FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
          FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE,
          FOREIGN KEY (feedback_period_id) REFERENCES feedback_periods(id) ON DELETE CASCADE,
          UNIQUE(teacher_id, student_id, feedback_period_id)
        );
      `);

      // Copy intersecting columns. Any column present in the old reviews table
      // that also exists in reviews_new carries over; anything exclusive to the
      // new shape stays NULL for historical rows.
      const existingColNames = cols.map(c => c.name);
      const newColNames = db.prepare("PRAGMA table_info(reviews_new)").all().map(c => c.name);
      const shared = existingColNames.filter(n => newColNames.includes(n));
      const colList = shared.join(', ');
      db.exec(`INSERT INTO reviews_new (${colList}) SELECT ${colList} FROM reviews;`);
      db.exec(`DROP TABLE reviews;`);
      db.exec(`ALTER TABLE reviews_new RENAME TO reviews;`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_teacher ON reviews(teacher_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_student ON reviews(student_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_period ON reviews(feedback_period_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_classroom ON reviews(classroom_id);`);
    })();
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: review criteria columns are now nullable');
  }
} catch (err) {
  console.error('Migration error (reviews nullable criteria):', err.message);
}

// Seed the default admin only. Teacher / head / student accounts are created
// through the admin UI on each deploy as needed — no need to seed them every
// boot. The admin seed remains so a fresh DB is recoverable without DB access.
try {
  const exists = db.prepare("SELECT id FROM users WHERE email = 'admin@uwc.edu'").get();
  if (!exists) {
    const hashed = bcrypt.hashSync('Admin1234', 12);
    db.prepare(`
      INSERT INTO users (full_name, email, password, role, school_id, org_id, verified_status)
      VALUES ('UWC Admin', 'admin@uwc.edu', ?, 'admin', 1, 1, 1)
    `).run(hashed);
    console.log('✅ Seeded admin: admin@uwc.edu / Admin1234');
  }
} catch (err) {
  console.error('Admin seed error:', err.message);
}

module.exports = db;

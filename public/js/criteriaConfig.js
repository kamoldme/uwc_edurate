// Criteria configuration — shared source of truth (browser version)
window.CRITERIA_CONFIG = [
  { slug: 'atmosphere',        db_col: 'atmosphere_rating',        label_key: 'criteria.atmosphere',        desc_key: 'criteria.atmosphere_desc',        hint_key: 'criteria.atmosphere_hint',        info_key: 'Atmosphere' },
  { slug: 'lesson_focus',      db_col: 'lesson_focus_rating',      label_key: 'criteria.lesson_focus',      desc_key: 'criteria.lesson_focus_desc',      hint_key: 'criteria.lesson_focus_hint',      info_key: 'Lesson Focus' },
  { slug: 'interaction',       db_col: 'interaction_rating',       label_key: 'criteria.interaction',       desc_key: 'criteria.interaction_desc',       hint_key: 'criteria.interaction_hint',       info_key: 'Interaction' },
  { slug: 'agency',            db_col: 'agency_rating',            label_key: 'criteria.agency',            desc_key: 'criteria.agency_desc',            hint_key: 'criteria.agency_hint',            info_key: 'Agency' },
  { slug: 'rigour',            db_col: 'rigour_rating',            label_key: 'criteria.rigour',            desc_key: 'criteria.rigour_desc',            hint_key: 'criteria.rigour_hint',            info_key: 'Rigour' },
  { slug: 'practical_app',     db_col: 'practical_app_rating',     label_key: 'criteria.practical_app',     desc_key: 'criteria.practical_app_desc',     hint_key: 'criteria.practical_app_hint',     info_key: 'Practical Application' },
  { slug: 'real_life_app',     db_col: 'real_life_app_rating',     label_key: 'criteria.real_life_app',     desc_key: 'criteria.real_life_app_desc',     hint_key: 'criteria.real_life_hint',         info_key: 'Real Life Application' },
  { slug: 'preparedness',      db_col: 'preparedness_rating',      label_key: 'criteria.preparedness',      desc_key: 'criteria.preparedness_desc',      hint_key: 'criteria.preparedness_hint',      info_key: 'Preparedness' },
  { slug: 'feedback_qual',     db_col: 'feedback_qual_rating',     label_key: 'criteria.feedback_qual',     desc_key: 'criteria.feedback_qual_desc',     hint_key: 'criteria.feedback_qual_hint',     info_key: 'Feedback Quality' },
  { slug: 'subject_knowledge', db_col: 'subject_knowledge_rating', label_key: 'criteria.subject_knowledge', desc_key: 'criteria.subject_knowledge_desc', hint_key: 'criteria.subject_knowledge_hint', info_key: 'Subject Knowledge' },
  { slug: 'approachability',   db_col: 'approachability_rating',   label_key: 'criteria.approachability',   desc_key: 'criteria.approachability_desc',   hint_key: 'criteria.approachability_hint',   info_key: 'Approachability' },
  { slug: 'varied_methods',    db_col: 'varied_methods_rating',    label_key: 'criteria.varied_methods',    desc_key: 'criteria.varied_methods_desc',    hint_key: 'criteria.varied_methods_hint',    info_key: 'Varied Methods' },
  { slug: 'engaging_content',  db_col: 'engaging_content_rating',  label_key: 'criteria.engaging_content',  desc_key: 'criteria.engaging_content_desc',  hint_key: 'criteria.engaging_content_hint',  info_key: 'Engaging Content' },
];

window.CRITERIA_COUNT = window.CRITERIA_CONFIG.length;
window.CRITERIA_COLS = window.CRITERIA_CONFIG.map(c => c.db_col);

// Mentor review criteria — labels + descriptions blessed by Kassie. The
// `desc` powers the inline info button (same pattern as CRITERIA_CONFIG via
// criteriaInfoIcon). Schema column names (mentor_c{n}_rating) stay stable
// so existing ratings continue to align with the new labels.
window.MENTOR_CRITERIA_CONFIG = [
  {
    slug: 'mentor_c1',
    db_col: 'mentor_c1_rating',
    label: 'Approachability',
    info_key: 'Mentor Approachability',
    desc: 'My mentor is easy to talk to about anything, including hard topics. They make themselves available when I ask.',
    hint: '',
  },
  {
    slug: 'mentor_c2',
    db_col: 'mentor_c2_rating',
    label: 'Accountability',
    info_key: 'Mentor Accountability',
    desc: 'My mentor holds me accountable for my goals, progress, and attendance.',
    hint: '',
  },
  {
    slug: 'mentor_c3',
    db_col: 'mentor_c3_rating',
    label: 'Academic Support',
    info_key: 'Mentor Academic Support',
    desc: 'My mentor helps me navigate aspects of my DP journey when I need it, including CAS.',
    hint: '',
  },
  {
    slug: 'mentor_c4',
    db_col: 'mentor_c4_rating',
    label: 'UWC Experience',
    info_key: 'Mentor UWC Experience',
    desc: "My mentor is interested in how I'm developing as a UWC student and encourages me to grow.",
    hint: '',
  },
  {
    slug: 'mentor_c5',
    db_col: 'mentor_c5_rating',
    label: 'Familiarity',
    info_key: 'Mentor Familiarity',
    desc: 'My mentor knows me. I feel they care about me.',
    hint: '',
  },
];
window.MENTOR_CRITERIA_COLS = window.MENTOR_CRITERIA_CONFIG.map(c => c.db_col);
window.MENTOR_CRITERIA_COUNT = window.MENTOR_CRITERIA_CONFIG.length;

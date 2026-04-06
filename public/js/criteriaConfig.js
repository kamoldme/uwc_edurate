// Criteria configuration — shared source of truth (browser version)
window.CRITERIA_CONFIG = [
  { slug: 'atmosphere',        db_col: 'atmosphere_rating',        label_key: 'criteria.atmosphere',        desc_key: 'criteria.atmosphere_desc',        info_key: 'Atmosphere' },
  { slug: 'lesson_focus',      db_col: 'lesson_focus_rating',      label_key: 'criteria.lesson_focus',      desc_key: 'criteria.lesson_focus_desc',      info_key: 'Lesson Focus' },
  { slug: 'interaction',       db_col: 'interaction_rating',       label_key: 'criteria.interaction',       desc_key: 'criteria.interaction_desc',       info_key: 'Interaction' },
  { slug: 'agency',            db_col: 'agency_rating',            label_key: 'criteria.agency',            desc_key: 'criteria.agency_desc',            info_key: 'Agency' },
  { slug: 'rigour',            db_col: 'rigour_rating',            label_key: 'criteria.rigour',            desc_key: 'criteria.rigour_desc',            info_key: 'Rigour' },
  { slug: 'practical_app',     db_col: 'practical_app_rating',     label_key: 'criteria.practical_app',     desc_key: 'criteria.practical_app_desc',     info_key: 'Practical Application' },
  { slug: 'real_life_app',     db_col: 'real_life_app_rating',     label_key: 'criteria.real_life_app',     desc_key: 'criteria.real_life_app_desc',     info_key: 'Real Life Application' },
  { slug: 'preparedness',      db_col: 'preparedness_rating',      label_key: 'criteria.preparedness',      desc_key: 'criteria.preparedness_desc',      info_key: 'Preparedness' },
  { slug: 'feedback_qual',     db_col: 'feedback_qual_rating',     label_key: 'criteria.feedback_qual',     desc_key: 'criteria.feedback_qual_desc',     info_key: 'Feedback Quality' },
  { slug: 'subject_knowledge', db_col: 'subject_knowledge_rating', label_key: 'criteria.subject_knowledge', desc_key: 'criteria.subject_knowledge_desc', info_key: 'Subject Knowledge' },
  { slug: 'approachability',   db_col: 'approachability_rating',   label_key: 'criteria.approachability',   desc_key: 'criteria.approachability_desc',   info_key: 'Approachability' },
  { slug: 'varied_methods',    db_col: 'varied_methods_rating',    label_key: 'criteria.varied_methods',    desc_key: 'criteria.varied_methods_desc',    info_key: 'Varied Methods' },
  { slug: 'engaging_content',  db_col: 'engaging_content_rating',  label_key: 'criteria.engaging_content',  desc_key: 'criteria.engaging_content_desc',  info_key: 'Engaging Content' },
];

window.CRITERIA_COUNT = window.CRITERIA_CONFIG.length;
window.CRITERIA_COLS = window.CRITERIA_CONFIG.map(c => c.db_col);

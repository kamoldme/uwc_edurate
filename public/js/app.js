// ============ API HELPER ============
const API = {
  token: localStorage.getItem('oasis_token'),
  async request(path, options = {}) {
    const res = await fetch('/api' + path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token,
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body }); },
  put(path, body) { return this.request(path, { method: 'PUT', body }); },
  patch(path, body) { return this.request(path, { method: 'PATCH', body }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); }
};

// ============ STATE ============
let currentUser = null;
let teacherInfo = null;
let currentView = '';
let chartInstances = {};
let userOrgs = []; // List of organizations user belongs to

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await I18n.init();
    const data = await API.get('/auth/me');
    currentUser = data.user;
    teacherInfo = data.teacher;
    userOrgs = data.organizations || [];
    // Sync language from server if different
    if (data.user.language && data.user.language !== I18n.getLocale()) {
      await I18n.setLocale(data.user.language);
    }
    setupUI();
    startNotifPolling();
    setTimeout(checkCommsBadge, 500);
    const hashView = window.location.hash.slice(1);
    const validViews = ['student-home','student-classrooms','student-review','student-my-reviews','student-experiences','student-comms','student-forms','student-announcements','teacher-home','teacher-classrooms','teacher-feedback','teacher-mentor-feedback','teacher-analytics','teacher-comms','teacher-forms','teacher-announcements','head-home','head-teachers','head-mentors','head-classrooms','head-analytics','head-experiences','head-comms','head-forms','head-announcements','admin-home','admin-users','admin-terms','admin-classrooms','admin-teachers','admin-submissions','admin-moderate','admin-flagged','admin-support','admin-audit','admin-comms','admin-forms','admin-announcements','admin-departments','account','help'];
    navigateTo(hashView && validViews.includes(hashView) ? hashView : getDefaultView());
  } catch {
    logout();
  }
});

function getDefaultView() {
  const r = currentUser.role;
  if (r === 'student') return 'student-home';
  if (r === 'teacher') return 'teacher-home';
  if (r === 'head') return 'head-home';
  if (r === 'admin') return 'admin-home';
  return 'student-home';
}

// ============ UI SETUP ============
function setupUI() {
  const u = currentUser;
  document.getElementById('roleBadge').textContent = u.role.replace('_', ' ');
  document.getElementById('userName').textContent = u.full_name;
  document.getElementById('userEmail').textContent = u.email;

  const avatar = document.getElementById('userAvatar');
  avatar.textContent = u.full_name.split(' ').map(n => n[0]).join('');

  // Notification bell (all roles)
  const bellHTML = `
    <div class="notif-bell-wrap">
      <button id="notifBellBtn" onclick="toggleNotifPanel(event)" title="Notifications"
        style="position:relative;background:none;border:1px solid #e2e8f0;border-radius:8px;padding:7px 9px;cursor:pointer;display:flex;align-items:center;color:#64748b">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span id="notifBadge" style="display:none;position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border-radius:999px;font-size:0.65rem;font-weight:700;min-width:18px;height:18px;line-height:18px;text-align:center;padding:0 4px"></span>
      </button>
      <div id="notifPanel" class="notif-panel">
        <div class="notif-panel-header">
          <h4>Notifications</h4>
          <button onclick="markAllNotifsRead()">Mark all read</button>
        </div>
        <div id="notifList"><div class="notif-empty">Loading…</div></div>
      </div>
    </div>`;

  const topBarActions = document.getElementById('topBarActions');
  if (u.org_name) {
    const isAdmin = u.role === 'admin';
    const houseSvg = `<svg class="org-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    const editSvg = `<button type="button" class="org-badge-edit" onclick="event.stopPropagation(); renameOrg()" aria-label="Rename organization"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
    const orgBadge = `<div class="org-badge${isAdmin ? ' is-admin' : ''}"${isAdmin ? ' data-admin="1"' : ''} onclick="handleOrgBadgeClick(this, event)" title="${isAdmin ? 'Click to rename organization' : u.org_name}">
      ${houseSvg}
      <span class="org-badge-name" id="topBarOrgName">${u.org_name}</span>
      ${isAdmin ? editSvg : ''}
    </div>`;
    topBarActions.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">${bellHTML}${orgBadge}</div>`;
  } else {
    topBarActions.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">${bellHTML}</div>`;
  }

  buildNavigation();
}

// ============ NOTIFICATIONS ============

let _notifPollTimer = null;

function startNotifPolling() {
  loadNotifBadge();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(loadNotifBadge, 30000);
}

async function loadNotifBadge() {
  try {
    const { count } = await API.get('/notifications/unread-count');
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = count > 0 ? 'block' : 'none';
  } catch (e) { /* silent */ }
}

function toggleNotifPanel(e) {
  e.stopPropagation();
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    panel.classList.add('open');
    renderNotifList();
  }
}

async function renderNotifList() {
  const list = document.getElementById('notifList');
  if (!list) return;
  try {
    const notifs = await API.get('/notifications');
    if (notifs.length === 0) {
      list.innerHTML = '<div class="notif-empty">You\'re all caught up!</div>';
      return;
    }
    list.innerHTML = notifs.map(n => {
      const timeAgo = formatNotifTime(n.created_at);
      return `<div class="notif-item ${n.read ? '' : 'unread'}" onclick="handleNotifClick(${n.id}, '${n.link || ''}')">
        ${!n.read ? '<div class="notif-dot"></div>' : '<div style="width:8px;flex-shrink:0"></div>'}
        <div class="notif-item-body">
          <div class="notif-title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="notif-preview">${escapeHtml(n.body)}</div>` : ''}
          <div class="notif-time">${timeAgo}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="notif-empty">Failed to load notifications.</div>';
  }
}

async function handleNotifClick(id, link) {
  document.getElementById('notifPanel')?.classList.remove('open');
  try { await API.patch(`/notifications/${id}/read`, {}); } catch (e) { /* silent */ }
  invalidateCache('/notifications');
  loadNotifBadge();
  if (link) navigateTo(link);
}

async function markAllNotifsRead() {
  try {
    await API.patch('/notifications/read-all', {});
    invalidateCache('/notifications');
    loadNotifBadge();
    const list = document.getElementById('notifList');
    if (list) list.querySelectorAll('.notif-item.unread').forEach(el => {
      el.classList.remove('unread');
      el.querySelector('.notif-dot')?.replaceWith(Object.assign(document.createElement('div'), { style: 'width:8px;flex-shrink:0' }));
    });
  } catch (e) { /* silent */ }
}

function formatNotifTime(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr + 'Z').getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Close panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  if (panel && panel.classList.contains('open') && !panel.closest('.notif-bell-wrap')?.contains(e.target)) {
    panel.classList.remove('open');
  }
});

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  classroom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>',
  department: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg>',
  chatBubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
};

function buildNavigation() {
  const nav = document.getElementById('sidebarNav');
  const role = currentUser.role;
  let items = [];

  if (role === 'student') {
    items = [
      { id: 'student-home', label: t('nav.dashboard'), icon: 'home' },
      { id: 'student-classrooms', label: t('nav.my_classrooms'), icon: 'classroom' },
      { id: 'student-review', label: t('nav.write_review'), icon: 'review' },
      { id: 'student-my-reviews', label: t('nav.my_reviews'), icon: 'chart' },
      { id: 'student-experiences', label: 'UWC Experience Map', icon: 'review' },
      { id: 'student-comms', label: 'Communication', icon: 'chatBubble' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  } else if (role === 'teacher') {
    const isMentor = !!currentUser?.is_mentor;
    items = [
      { id: 'teacher-home', label: t('nav.dashboard'), icon: 'home' },
      { id: 'teacher-classrooms', label: t('nav.my_classrooms'), icon: 'classroom' },
      { id: 'teacher-feedback', label: t('nav.feedback'), icon: 'review' },
      ...(isMentor ? [{ id: 'teacher-mentor-feedback', label: 'Mentor feedback', icon: 'review' }] : []),
      { id: 'teacher-analytics', label: t('nav.analytics'), icon: 'chart' },
      { id: 'teacher-comms', label: 'Communication', icon: 'chatBubble' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  } else if (role === 'head') {
    items = [
      { id: 'head-home', label: t('nav.dashboard'), icon: 'home' },
      { id: 'head-teachers', label: t('nav.teachers'), icon: 'users' },
      { id: 'head-classrooms', label: t('nav.classrooms'), icon: 'classroom' },
      { id: 'head-analytics', label: t('nav.analytics'), icon: 'chart' },
      { id: 'head-experiences', label: 'UWC Experience Map', icon: 'review' },
      { id: 'admin-departments', label: 'Departments', icon: 'department' },
      { id: 'head-comms', label: 'Communication', icon: 'chatBubble' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  } else if (role === 'admin') {
    items = [
      { id: 'admin-home', label: t('nav.dashboard'), icon: 'home' },
      { id: 'admin-users', label: t('nav.users'), icon: 'users' },
      { id: 'admin-terms', label: t('nav.terms_periods'), icon: 'calendar' },
      { id: 'admin-classrooms', label: t('nav.classrooms'), icon: 'classroom' },
      { id: 'admin-teachers', label: t('nav.teacher_feedback'), icon: 'review' },
      { id: 'admin-submissions', label: t('nav.submission_tracking'), icon: 'check' },
      { id: 'admin-moderate', label: t('nav.moderate_reviews'), icon: 'shield' },
      { id: 'admin-comms', label: 'Communication', icon: 'chatBubble' },
      { id: 'admin-departments', label: 'Departments', icon: 'department' },
      { id: 'admin-support', label: t('nav.support_messages'), icon: 'settings' },
      { id: 'admin-audit', label: t('nav.audit_logs'), icon: 'list' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  }

  nav.innerHTML = '<div class="nav-section"><div class="nav-section-title">' + t('nav.main_menu') + '</div>' +
    items.map(it => `
      <button class="nav-item" data-view="${it.id}" onclick="navigateTo('${it.id}')">
        ${ICONS[it.icon]}
        ${it.label}
        ${it.id.endsWith('-comms') ? `<span id="commsBadge" class="badge" style="display:none"></span>` : ''}
      </button>
    `).join('') + '</div>' +
    '<div class="nav-section"><div class="nav-section-title">' + t('nav.account_section') + '</div>' +
    `<button class="nav-item" data-view="account" onclick="navigateTo('account')">
      ${ICONS.settings}
      ${t('nav.account_details')}
    </button></div>`;
}

// ============ NAVIGATION ============
function navigateTo(view) {
  currentView = view;
  window.location.hash = view;
  destroyCharts();
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    const navId = el.dataset.view;
    // Highlight Communication parent when on sub-views (-forms or -announcements)
    const isCommsChild = navId.endsWith('-comms') && (view === navId.replace('-comms', '-forms') || view === navId.replace('-comms', '-announcements'));
    el.classList.toggle('active', navId === view || isCommsChild);
  });

  // Close mobile sidebar on navigation
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');

  const content = document.getElementById('contentArea');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const titles = {
    'student-home': t('title.student_dashboard'),
    'student-classrooms': t('title.my_classrooms'),
    'student-review': t('title.write_review'),
    'student-my-reviews': t('title.my_reviews'),
    'student-experiences': 'UWC Experience Map',
    'head-experiences': 'UWC Experience Map',
    'teacher-home': t('title.teacher_dashboard'),
    'teacher-classrooms': t('title.my_classrooms'),
    'teacher-feedback': t('title.student_feedback'),
    'teacher-mentor-feedback': 'Mentor feedback',
    'teacher-analytics': t('title.analytics'),
    'head-home': t('title.school_overview'),
    'head-teachers': t('title.teacher_performance'),
    'head-classrooms': t('title.all_classrooms'),
    'head-analytics': t('title.analytics'),
    'admin-home': t('title.admin_dashboard'),
    'student-comms': 'Communication',
    'student-forms': t('nav.forms'),
    'student-announcements': t('nav.announcements'),
    'teacher-comms': 'Communication',
    'teacher-forms': t('nav.forms'),
    'teacher-announcements': t('nav.announcements'),
    'head-comms': 'Communication',
    'head-forms': t('nav.forms'),
    'head-announcements': t('nav.announcements'),
    'admin-comms': 'Communication',
    'admin-forms': t('nav.forms'),
    'admin-announcements': t('nav.announcements'),
    'admin-users': t('title.user_management'),
    'admin-terms': t('title.terms_periods'),
    'admin-classrooms': t('title.classroom_management'),
    'admin-teachers': t('title.teacher_feedback'),
    'admin-submissions': t('title.submission_tracking'),
    'admin-moderate': t('title.review_moderation'),
    'admin-flagged': t('title.flagged_reviews'),
    'admin-support': t('title.support_messages'),
    'admin-audit': t('title.audit_logs'),
    'account': t('title.account_details'),
    'help': 'Help & Support',
    'admin-departments': 'Departments'
  };
  document.getElementById('pageTitle').textContent = titles[view] || t('common.dashboard');

  const viewFunctions = {
    'student-home': renderStudentHome,
    'student-classrooms': renderStudentClassrooms,
    'student-review': renderStudentReview,
    'student-my-reviews': renderStudentMyReviews,
    'student-experiences': renderStudentExperiences,
    'head-experiences': renderHeadExperiences,
    'student-comms': renderStudentComms,
    'student-forms': renderStudentForms,
    'student-announcements': renderStudentAnnouncements,
    'teacher-home': renderTeacherHome,
    'teacher-classrooms': renderTeacherClassrooms,
    'teacher-feedback': renderTeacherFeedback,
    'teacher-mentor-feedback': renderTeacherMentorFeedback,
    'teacher-analytics': renderTeacherAnalytics,
    'teacher-comms': renderTeacherComms,
    'teacher-forms': renderTeacherForms,
    'teacher-announcements': renderTeacherAnnouncements,
    'head-home': renderHeadHome,
    'head-teachers': renderHeadTeachers,
    'head-classrooms': renderHeadClassrooms,
    'head-analytics': renderHeadAnalytics,
    'admin-home': renderAdminHome,
    'admin-users': renderAdminUsers,
    'admin-terms': renderAdminTerms,
    'admin-classrooms': renderAdminClassrooms,
    'admin-teachers': renderAdminTeachers,
    'admin-submissions': renderAdminSubmissions,
    'admin-moderate': renderAdminModerate,
    'admin-flagged': renderAdminFlagged,
    'admin-support': renderAdminSupport,
    'admin-audit': renderAdminAudit,
    'admin-comms': renderAdminComms,
    'admin-forms': renderAdminForms,
    'admin-announcements': renderAdminAnnouncements,
    'head-comms': renderHeadComms,
    'head-forms': renderHeadForms,
    'head-announcements': renderHeadAnnouncements,
    'account': renderAccount,
    'help': renderHelp,
    'admin-departments': renderAdminDepartments
  };

  if (viewFunctions[view]) {
    viewFunctions[view]().catch(err => {
      content.innerHTML = `<div class="empty-state"><h3>${t('common.error_loading')}</h3><p>${err.message}</p></div>`;
    });
  }
}

// ============ TAG TRANSLATION ============
const TAG_I18N_MAP = {
  'Clear explanations': 'tag.clear_explanations',
  'Engaging lessons': 'tag.engaging_lessons',
  'Fair grading': 'tag.fair_grading',
  'Supportive': 'tag.supportive',
  'Well-prepared': 'tag.well_prepared',
  'Good examples': 'tag.good_examples',
  'Encourages participation': 'tag.encourages_participation',
  'Respectful': 'tag.respectful',
  'Needs clearer explanations': 'tag.needs_clearer_explanations',
  'Too fast-paced': 'tag.too_fast_paced',
  'Too slow-paced': 'tag.too_slow_paced',
  'More examples needed': 'tag.more_examples_needed',
  'More interactive': 'tag.more_interactive',
  'Better organization': 'tag.better_organization',
  'More feedback needed': 'tag.more_feedback_needed',
  'Challenging but good': 'tag.challenging_but_good'
};
function translateTag(tag) {
  const key = TAG_I18N_MAP[tag];
  return key ? t(key) : tag;
}

// ============ API CACHE ============
// Simple in-memory cache to avoid re-fetching the same data on every sidebar click.
// Mutations (submit review, approve, etc.) call invalidateCache() to bust stale entries.
const _apiCache = {};
const CACHE_TTL = {
  short: 30 * 1000,   // 30s — dashboard data, reviews
  medium: 60 * 1000,  // 60s — classrooms, users, forms lists
  long: 5 * 60 * 1000 // 5min — tags, organizations (rarely change)
};

async function cachedGet(url, ttl = CACHE_TTL.short) {
  const now = Date.now();
  const entry = _apiCache[url];
  if (entry && now - entry.ts < ttl) return entry.data;
  const data = await API.get(url);
  _apiCache[url] = { data, ts: now };
  return data;
}

function invalidateCache(...patterns) {
  if (patterns.length === 0) {
    Object.keys(_apiCache).forEach(k => delete _apiCache[k]);
  } else {
    Object.keys(_apiCache).forEach(k => {
      if (patterns.some(p => k.includes(p))) delete _apiCache[k];
    });
  }
}

// ============ UTILITIES ============
function starsHTML(rating, size = 'normal') {
  if (rating === null || rating === undefined) return '<span style="color:var(--gray-400)">-</span>';
  const numRating = parseFloat(rating);
  if (isNaN(numRating) || numRating <= 0) return '<span style="color:var(--gray-400)">-</span>';
  const sizeClass = size === 'large' ? 'stars-large' : size === 'small' ? 'stars-small' : '';
  const starSize = size === 'large' ? 'font-size:1.4rem' : size === 'small' ? 'font-size:0.85rem' : 'font-size:1.1rem';
  const fullStars = Math.floor(numRating);
  const fractional = numRating - fullStars;
  const showPartial = fractional >= 0.05;
  const filledCount = fullStars + (showPartial ? 1 : 0);
  const emptyStars = 5 - filledCount;

  let html = `<div class="stars ${sizeClass}" style="display:inline-flex;align-items:center;gap:1px;${starSize}">`;
  for (let i = 0; i < fullStars; i++) {
    html += '<span style="color:#fbbf24">\u2605</span>';
  }
  if (showPartial) {
    const pct = (fractional * 100).toFixed(0);
    html += `<span style="position:relative;display:inline-block"><span style="color:#e5e7eb">\u2605</span><span style="position:absolute;left:0;top:0;overflow:hidden;width:${pct}%;color:#fbbf24">\u2605</span></span>`;
  }
  for (let i = 0; i < emptyStars; i++) {
    html += '<span style="color:#e5e7eb">\u2605</span>';
  }
  html += '</div>';
  return html;
}

function ratingText(val) {
  return (val !== null && val !== undefined) ? `${val}/5` : '-';
}

// Compute the true average of the 13 per-criterion ratings on a review.
// We don't trust server `overall_rating` — that column is rounded to an
// integer at insert time; for display we want the original float (e.g. 4.62).
// All rating helpers are kind-aware: a review row carries `review_kind`
// ('teacher' | 'mentor'). Mentor reviews use the 5 mentor criteria
// (mentor_c{1..5}_rating), teacher reviews use the 13 academic criteria.
// Returning the right criteria set here means every surface that renders
// reviews (moderation queue, audit, admin teacher modal, my reviews,
// student profile, head feedback view) automatically does the right thing
// without per-call branching.
function reviewCriteriaList(r) {
  const isMentor = r && r.review_kind === 'mentor';
  if (isMentor) {
    return (window.MENTOR_CRITERIA_CONFIG || []).map(c => ({
      db_col: c.db_col,
      label: c.label,
      info_key: c.info_key,
    }));
  }
  return CRITERIA_CONFIG.map(c => ({
    db_col: c.db_col,
    label: t(c.label_key),
    info_key: c.info_key,
  }));
}

function criteriaAverage(r) {
  const cols = reviewCriteriaList(r).map(c => c.db_col);
  const vals = cols.map(col => r[col]).filter(v => v !== null && v !== undefined && v > 0);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function fmtRatingFloat(v) {
  return (v === null || v === undefined) ? '-' : `${v.toFixed(2)}/5.00`;
}

function ratingGridHTML(r) {
  const list = reviewCriteriaList(r);
  return `<div class="rating-grid-responsive">
    ${list.map(c => {
      const v = r[c.db_col]; const val = v || 0;
      return `<div class="rating-grid-item">
        <span class="rating-grid-label">${escapeHtml(c.label)}${c.info_key ? criteriaInfoIcon(c.info_key) : ''}</span>
        <span class="rating-grid-value" style="color:${scoreColor(val)};display:inline-flex;align-items:center;gap:8px">
          ${v ? `<span>${v}/5</span>${starsHTML(v, 'small')}` : '<span style="color:var(--gray-400)">-</span>'}
        </span>
      </div>`;
    }).join('')}
  </div>`;
}

// Moderation/flagged rating grid: single column, overall = float average,
// per-criterion rows reuse the same .rating-grid-item layout. Kind-aware.
function moderationRatingGridHTML(r) {
  const avg = criteriaAverage(r);
  const list = reviewCriteriaList(r);
  return `<div class="feedback-rating-grid">
    <div class="rating-grid-item rating-grid-overall">
      <span class="rating-grid-label">${t('review.overall')}</span>
      <span class="rating-grid-value" style="color:${scoreColor(avg || 0)}">${fmtRatingFloat(avg)}</span>
    </div>
    ${list.map(c => {
      const v = r[c.db_col]; const val = v || 0;
      return `<div class="rating-grid-item">
        <span class="rating-grid-label">${escapeHtml(c.label)}${c.info_key ? criteriaInfoIcon(c.info_key) : ''}</span>
        <span class="rating-grid-value" style="color:${scoreColor(val)}">${v ? v + '/5' : '-'}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function badgeHTML(status) {
  const map = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected', flagged: 'badge-flagged' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${t('common.' + status) || status}</span>`;
}

function trendArrow(trend) {
  if (trend === 'improving') return '<span class="trend-arrow trend-up">&#9650;</span>';
  if (trend === 'declining') return '<span class="trend-arrow trend-down">&#9660;</span>';
  return '<span class="trend-arrow trend-stable">&#9654;</span>';
}

function rankBadge(index) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return String(index + 1);
}

window.setHeatmapColWidth = function (px) {
  const scroll = document.querySelector('.heatmap-scroll');
  if (scroll) scroll.style.setProperty('--heatmap-col-w', px + 'px');
  const label = document.getElementById('heatmapColWidthLabel');
  if (label) label.textContent = px + 'px';
};

function escAttr(str) {
  return String(str || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function formatJoinCode(code) {
  const c = String(code || '').replace(/\D/g, '');
  return c.length >= 8 ? c.slice(0, 4) + '-' + c.slice(4, 8) : c;
}

function toast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

// Mobile sidebar control. Locks body scroll when open so the underlying
// content doesn't scroll behind the drawer (a common iOS Safari annoyance).
// Also wires ESC + nav-item-click + window-resize to auto-close.
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('active');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('active');
  document.body.classList.remove('sidebar-open');
}

// Auto-close sidebar when a nav item is tapped (mobile only). Uses event
// delegation so dynamically rendered nav items still get the behavior.
document.addEventListener('click', (e) => {
  if (window.innerWidth > 768) return;
  const navItem = e.target.closest('#sidebarNav .nav-item');
  if (navItem) closeSidebar();
});

// ESC closes the sidebar before falling through to anything else.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('sidebar')?.classList.contains('open')) {
    closeSidebar();
  }
});

// If user resizes from mobile → desktop while drawer is open, clean up state
// so body scroll lock and backdrop don't linger on the desktop layout.
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeSidebar();
});

window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;

function confirmDialog(message, confirmText = t('common.confirm'), cancelText = t('common.cancel')) {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <h2>${t('common.confirm_action')}</h2>
      </div>
      <div class="modal-body">
        <p style="font-size:1.1rem;margin-bottom:24px">${message}</p>
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="window.confirmDialogResolve(false);closeModal()">${cancelText}</button>
          <button class="btn btn-primary" onclick="window.confirmDialogResolve(true);closeModal()">${confirmText}</button>
        </div>
      </div>
    `);
    window.confirmDialogResolve = resolve;
  });
}

function confirmWithText(message, requiredText, warningMessage = '') {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <h2 style="color:#ef4444">${t('dialog.dangerous_action')}</h2>
      </div>
      <div class="modal-body">
        <p style="font-size:1.1rem;margin-bottom:16px">${message}</p>
        ${warningMessage ? `<div style="background:#fef2f2;border:1px solid #ef4444;border-radius:8px;padding:16px;margin-bottom:20px">
          <p style="color:#991b1b;font-weight:600;margin:0">${warningMessage}</p>
        </div>` : ''}
        <div style="margin-bottom:20px">
          <p style="font-size:0.95rem;margin-bottom:8px;color:var(--gray-600)">${t('dialog.type_to_confirm', {text: requiredText}).replace(`"${requiredText}"`, `<strong style="color:#ef4444">"${requiredText}"</strong>`)}</p>
          <input type="text" id="confirmTextInput" class="form-control" placeholder="${requiredText}" autocomplete="off">
        </div>
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="window.confirmTextResolve(false);closeModal()">${t('common.cancel')}</button>
          <button class="btn btn-danger" id="confirmTextBtn" disabled onclick="if(document.getElementById('confirmTextInput').value === '${requiredText}'){window.confirmTextResolve(true);closeModal();}">${t('common.confirm')}</button>
        </div>
      </div>
    `);
    window.confirmTextResolve = resolve;
    setTimeout(() => {
      const input = document.getElementById('confirmTextInput');
      const btn = document.getElementById('confirmTextBtn');
      if (input && btn) {
        input.focus();
        input.addEventListener('input', (e) => {
          btn.disabled = e.target.value !== requiredText;
        });
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && e.target.value === requiredText) {
            window.confirmTextResolve(true);
            closeModal();
          }
        });
      }
    }, 100);
  });
}

function getCriteriaInfo() {
  // Merge teacher + mentor criteria so the info popup resolves keys from
  // either set. Mentor criteria carry their `desc` inline (no i18n yet).
  const teacherEntries = CRITERIA_CONFIG.map(c => ({
    name: t(c.label_key),
    key: c.info_key,
    desc: t(c.desc_key),
  }));
  const mentorEntries = (window.MENTOR_CRITERIA_CONFIG || []).map(c => ({
    name: c.label,
    key: c.info_key,
    desc: c.desc || '',
  }));
  return [...teacherEntries, ...mentorEntries];
}

function criteriaInfoIcon(name) {
  return `<span class="criteria-info-btn" onclick="showCriteriaInfo('${name}')" style="cursor:pointer;color:var(--primary);font-size:0.75rem;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--primary);font-weight:700;font-style:normal;line-height:1;transition:all 0.15s;flex-shrink:0;margin-left:4px">i</span>`;
}

function showCriteriaInfo(name) {
  const localizedInfo = getCriteriaInfo();
  const info = localizedInfo.find(c => c.key === name);
  if (!info) return;

  // Remove any existing popup
  const existing = document.getElementById('criteriaInfoPopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'criteriaInfoPopup';
  popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);animation:fadeIn 0.15s ease';
  popup.onclick = (e) => { if (e.target === popup) popup.remove(); };
  popup.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:24px;max-width:400px;width:90%;box-shadow:0 20px 40px rgba(0,0,0,0.2);animation:scaleIn 0.15s ease">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0;font-size:1.1rem;color:var(--primary)">${info.name}</h3>
        <button onclick="document.getElementById('criteriaInfoPopup').remove()" style="background:none;border:none;font-size:1.4rem;color:var(--gray-400);cursor:pointer;padding:0;line-height:1">&times;</button>
      </div>
      <p style="margin:0;color:var(--gray-700);font-size:0.92rem;line-height:1.65">${info.desc}</p>
    </div>
  `;
  document.body.appendChild(popup);
}

function avatarHTML(user, size = 'normal', clickable = false) {
  const sizeMap = { small: '32px', normal: '48px', large: '72px' };
  const fontSize = { small: '0.72rem', normal: '0.96rem', large: '1.2rem' };
  const dimension = sizeMap[size] || sizeMap.normal;
  const fontSz = fontSize[size] || fontSize.normal;

  const initials = user.full_name ? user.full_name.split(' ').map(n => n[0]).join('') : '?';
  // Only admins and school heads can view teacher profiles
  const canViewProfile = currentUser && (currentUser.role === 'admin' || currentUser.role === 'head');
  const clickHandler = clickable && user.teacher_id && canViewProfile ? `onclick="viewTeacherProfile(${user.teacher_id})" style="cursor:pointer"` : '';

  return `<div ${clickHandler} style="width:${dimension};height:${dimension};background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${fontSz};font-weight:700;flex-shrink:0">${initials}</div>`;
}

function destroyCharts() {
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};
}

function scoreColor(score) {
  if (score >= 4) return 'var(--success)';
  if (score >= 3) return 'var(--warning)';
  return 'var(--danger)';
}

// Format a score to always show 2 decimal places (e.g. 4 → "4.00", 3.5 → "3.50").
// When there's no value yet, return a neutral gray placeholder so the surrounding
// scoreColor() red doesn't bleed onto a "no data" label.
function fmtScore(val) {
  if (val === null || val === undefined) return '<span class="score-empty">N/A</span>';
  return Number(val).toFixed(2);
}

function logout() {
  stopInactivityTimer();
  localStorage.removeItem('oasis_token');
  localStorage.removeItem('oasis_user');
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
}

// ============ INACTIVITY AUTO-LOGOUT ============
const INACTIVITY_MS = 20 * 60 * 1000;  // 20 minutes
const WARN_BEFORE_MS = 60 * 1000;       // warn 1 minute before

let _inactivityTimer = null;
let _warningTimer = null;
let _warningVisible = false;

function startInactivityTimer() {
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  events.forEach(e => document.addEventListener(e, resetInactivityTimer, { passive: true }));
  resetInactivityTimer();
}

function stopInactivityTimer() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_warningTimer);
  _dismissWarning();
}

function resetInactivityTimer() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_warningTimer);
  if (_warningVisible) _dismissWarning();

  _warningTimer = setTimeout(_showWarning, INACTIVITY_MS - WARN_BEFORE_MS);
  _inactivityTimer = setTimeout(() => {
    _dismissWarning();
    logout();
  }, INACTIVITY_MS);
}

function _showWarning() {
  _warningVisible = true;
  const overlay = document.createElement('div');
  overlay.id = 'inactivityWarning';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:32px;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
      <div style="font-size:2.2rem;margin-bottom:12px">⏱</div>
      <h3 style="margin:0 0 8px;font-size:1.15rem;color:#0f172a">${t('inactivity.title')}</h3>
      <p style="margin:0 0 24px;color:#64748b;font-size:0.92rem">${t('inactivity.message', {seconds: '<strong id="inactivityCountdown">60</strong>'})}</p>
      <button onclick="resetInactivityTimer()" style="background:#059669;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:0.95rem;font-weight:600;cursor:pointer;width:100%">${t('inactivity.stay')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let secs = Math.round(WARN_BEFORE_MS / 1000);
  overlay._interval = setInterval(() => {
    secs--;
    const el = document.getElementById('inactivityCountdown');
    if (el) el.textContent = secs;
    if (secs <= 0) clearInterval(overlay._interval);
  }, 1000);
}

function _dismissWarning() {
  _warningVisible = false;
  const overlay = document.getElementById('inactivityWarning');
  if (overlay) {
    clearInterval(overlay._interval);
    overlay.remove();
  }
}

// ============ STUDENT VIEWS ============
async function renderStudentHome() {
  const data = await cachedGet('/dashboard/student');
  const el = document.getElementById('contentArea');

  const periodInfo = data.active_period
    ? `<div class="stat-card" style="border-left:4px solid var(--success)">
         <div class="stat-label">${t('student.active_feedback_period')}</div>
         <div class="stat-value" style="font-size:1.4rem">${data.active_period.name}</div>
         <div class="stat-change" style="color:var(--success)">${data.active_term?.name || ''}</div>
       </div>`
    : data.classrooms.length === 0
      ? `<div class="stat-card" style="border-left:4px solid var(--gray-300)">
           <div class="stat-label">${t('student.feedback_period')}</div>
           <div class="stat-value" style="font-size:1rem;color:var(--gray-500)">Join a classroom to know your feedback period</div>
         </div>`
      : `<div class="stat-card" style="border-left:4px solid var(--gray-400)">
           <div class="stat-label">${t('student.feedback_period')}</div>
           <div class="stat-value" style="font-size:1.4rem">${t('student.feedback_closed')}</div>
           <div class="stat-change stable">${t('student.no_active_period')}</div>
         </div>`;

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card">
        <div class="stat-label">${t('student.my_classrooms')}</div>
        <div class="stat-value">${data.classrooms.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('student.reviews_submitted')}</div>
        <div class="stat-value">${data.review_count}</div>
      </div>
      ${periodInfo}
      <div class="stat-card">
        <div class="stat-label">${t('student.teachers_to_review')}</div>
        <div class="stat-value" id="eligibleCount">...</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><h3>${t('student.my_classrooms')}</h3></div>
        <div class="card-body" id="studentClassroomList">
          ${data.classrooms.length === 0
            ? `<div class="empty-state"><h3>${t('student.no_classrooms')}</h3><p>${t('student.join_classroom_hint')}</p></div>`
            : data.classrooms.map(c => `
              <div class="classroom-card" id="cls-${c.id}" style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
                ${avatarHTML({ full_name: c.teacher_name, avatar_url: c.teacher_avatar_url, teacher_id: c.teacher_id }, 'small', true)}
                <div style="flex:1">
                  <div class="class-subject" style="margin:0">${c.subject}</div>
                  <div class="class-meta" style="margin:0${currentUser && (currentUser.role === 'admin' || currentUser.role === 'head') ? ';cursor:pointer' : ''}" ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'head') ? `onclick="viewTeacherProfile(${c.teacher_id})"` : ''}>${c.teacher_name}</div>
                  <div class="class-meta" style="margin:0">${c.grade_level}</div>
                </div>
                <span id="reviewed-${c.id}" style="display:none;font-size:0.78rem;color:var(--success);font-weight:600;white-space:nowrap">${t('review.reviewed_badge')}</span>
              </div>
            `).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('student.recent_reviews')}</h3></div>
        <div class="card-body">
          ${data.my_reviews.length === 0
            ? `<div class="empty-state"><h3>${t('student.no_reviews')}</h3><p>${t('student.submit_feedback_hint')}</p></div>`
            : data.my_reviews.slice(0, 5).map(r => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
                <div>
                  <strong>${r.teacher_name}</strong>
                  <div style="font-size:0.8rem;color:var(--gray-500)">${r.classroom_subject} &middot; ${r.term_name} &middot; ${r.period_name}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${starsHTML(r.overall_rating)}
                  ${r.approved_status === 1 ? `<span style="font-size:0.75rem;color:var(--success);font-weight:600;background:#dcfce7;padding:2px 7px;border-radius:10px">${t('review.approved_badge')}</span>` : badgeHTML(r.flagged_status)}
                </div>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;

  // Fetch eligible count and mark reviewed classrooms
  try {
    const eligible = await cachedGet('/reviews/eligible-teachers');
    const remaining = eligible.teachers.filter(t => !t.already_reviewed).length;
    document.getElementById('eligibleCount').textContent = remaining;
    // Mark classrooms where student already submitted a review this period
    eligible.teachers.forEach(t => {
      if (t.already_reviewed) {
        const badge = document.getElementById(`reviewed-${t.classroom_id}`);
        if (badge) badge.style.display = 'inline';
      }
    });
  } catch { document.getElementById('eligibleCount').textContent = '0'; }
}

async function renderStudentClassrooms() {
  const classrooms = await cachedGet('/classrooms', CACHE_TTL.medium);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <p style="color:var(--gray-500)">${t('student.join_classrooms_hint')}</p>
      <button class="btn btn-primary" onclick="showJoinClassroom()">${t('student.join_classroom')}</button>
    </div>
    <div class="grid grid-3">
      ${classrooms.length === 0
        ? `<div class="empty-state" style="grid-column:1/-1"><h3>${t('student.no_classrooms')}</h3><p>${t('student.no_classrooms_hint')}</p></div>`
        : classrooms.map(c => `
          <div class="classroom-card">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              ${avatarHTML({ full_name: c.teacher_name, avatar_url: c.teacher_avatar_url, teacher_id: c.teacher_id }, 'normal', true)}
              <div style="flex:1">
                <div class="class-subject" style="margin:0">${c.subject}</div>
                <div class="class-meta" style="margin:0">${c.teacher_name} &middot; ${c.grade_level}</div>
              </div>
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;gap:8px">
              <button class="btn btn-sm btn-outline" onclick="showClassroomMembers(${c.id}, '${c.subject.replace(/'/g, "\\'")}')">Members</button>
              <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)" onclick="leaveClassroom(${c.id}, '${c.subject}')">${t('student.leave')}</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
}

function showJoinClassroom() {
  openModal(`
    <div class="modal-header"><h3>${t('student.join_modal_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('student.join_code_label')}</label>
        <input type="text" class="form-control" id="joinCodeInput" placeholder="XXXX-XXXX" maxlength="9" style="font-family:monospace;font-size:1.2rem;letter-spacing:3px;text-align:center" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,8);this.value=this.value.length>4?this.value.slice(0,4)+'-'+this.value.slice(4):this.value">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="joinClassroom()">${t('student.join_btn')}</button>
    </div>
  `);
  setTimeout(() => document.getElementById('joinCodeInput')?.focus(), 100);
}

async function joinClassroom() {
  const code = document.getElementById('joinCodeInput').value.trim();
  if (!code) return toast(t('student.enter_join_code'), 'error');
  try {
    const data = await API.post('/classrooms/join', { join_code: code });
    toast(data.message);
    invalidateCache('/dashboard/student', '/classrooms', '/reviews/eligible-teachers');
    closeModal();
    navigateTo('student-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function showClassroomMembers(classroomId, subject) {
  openModal(`
    <div class="modal-header">
      <h3>${subject} — Members</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body" id="membersModalBody">
      <p style="color:var(--gray-500);text-align:center">Loading…</p>
    </div>
  `);
  try {
    const members = await API.get(`/classrooms/${classroomId}/members`);
    const body = document.getElementById('membersModalBody');
    if (!body) return;
    if (members.length === 0) {
      body.innerHTML = `<p style="color:var(--gray-500);text-align:center">No members yet.</p>`;
      return;
    }
    body.innerHTML = `
      <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:12px">${members.length} student${members.length !== 1 ? 's' : ''} enrolled</p>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto">
        ${members.map(m => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--gray-50);border-radius:8px">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:600;flex-shrink:0">
              ${m.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style="font-size:0.875rem;font-weight:500;color:var(--gray-800)">${escapeHtml(m.full_name)}</div>
              ${m.grade_or_position ? `<div style="font-size:0.78rem;color:var(--gray-500)">${escapeHtml(m.grade_or_position)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch (err) {
    const body = document.getElementById('membersModalBody');
    if (body) body.innerHTML = `<p style="color:var(--danger);text-align:center">${err.message}</p>`;
  }
}

async function leaveClassroom(id, name) {
  const confirmed = await confirmDialog(t('student.leave_confirm', {name}), t('student.leave'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/classrooms/${id}/leave`);
    toast(t('student.left_classroom'));
    invalidateCache('/dashboard/student', '/classrooms', '/reviews/eligible-teachers');
    navigateTo('student-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function renderStudentReview() {
  const el = document.getElementById('contentArea');
  try {
    const data = await cachedGet('/reviews/eligible-teachers');
    const tags = await cachedGet('/reviews/tags', CACHE_TTL.long);

    if (!data.period) {
      const msg = data.has_classrooms
        ? t('student.no_active_period_desc')
        : 'You are not enrolled in any classrooms yet. Join a classroom first to see your feedback period.';
      el.innerHTML = `<div class="empty-state"><h3>${t('student.no_active_period_title')}</h3><p>${msg}</p></div>`;
      return;
    }

    const eligible = data.teachers.filter(t => !t.already_reviewed);
    const reviewed = data.teachers.filter(t => t.already_reviewed);

    el.innerHTML = `
      <div class="card" style="margin-bottom:24px;border-left:4px solid var(--success)">
        <div class="card-body" style="display:flex;align-items:center;gap:12px">
          <div style="flex:0 0 80%;display:flex;flex-direction:column;gap:4px;min-width:0">
            <div><strong>${t('student.active_period_label')}</strong> ${data.period.name}</div>
            <div style="color:var(--gray-500);font-size:0.85rem">${t('student.anonymous_hint')}</div>
          </div>
          <div style="flex:0 0 20%;display:flex;justify-content:flex-end">
            <span class="badge badge-active">${t('status.open')}</span>
          </div>
        </div>
      </div>

      ${eligible.length === 0 && reviewed.length > 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('student.all_done_title')}</h3><p>${t('student.all_done_desc')}</p></div></div></div>`
        : eligible.length === 0
          ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('student.no_teachers_title')}</h3><p>${t('student.no_teachers_desc')}</p></div></div></div>`
          : ''}

      ${eligible.map(teacher => {
        const isMentor = (teacher.classroom_kind || 'academic') === 'mentor';
        const activeCriteria = isMentor
          ? MENTOR_CRITERIA_CONFIG.map(c => ({ db_col: c.db_col, label: c.label, hint: c.hint, info_key: c.info_key }))
          : CRITERIA_CONFIG.map(c => ({ db_col: c.db_col, label: t(c.label_key), hint: t(c.hint_key), info_key: c.info_key }));
        return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header" style="display:flex;align-items:center;gap:12px">
            ${avatarHTML({ full_name: teacher.teacher_name, avatar_url: teacher.avatar_url, teacher_id: teacher.teacher_id }, 'normal', true)}
            <div style="flex:1">
              <h3 style="margin:0">${teacher.teacher_name}${isMentor ? ' <span style="font-size:0.7rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:0.02em;margin-left:6px;vertical-align:middle">MENTOR</span>' : ''}</h3>
              <span style="color:var(--gray-500);font-size:0.85rem">${teacher.classroom_subject} &middot; ${teacher.grade_level}</span>
            </div>
          </div>
          <div class="card-body">
            <form onsubmit="submitReview(event, ${teacher.teacher_id}, ${teacher.classroom_id})" data-teacher-id="${teacher.teacher_id}" data-classroom-id="${teacher.classroom_id}" data-classroom-kind="${isMentor ? 'mentor' : 'academic'}">
              <div class="grid grid-2" style="margin-bottom:20px">
                ${activeCriteria.map(c => `
                  <div class="form-group" style="margin-bottom:12px">
                    <label style="display:flex;align-items:center;gap:6px">${c.label}${c.info_key ? ' ' + criteriaInfoIcon(c.info_key) : ''}</label>
                    ${c.hint ? `<div style="color:var(--gray-500);font-size:0.75rem;margin-top:-2px;margin-bottom:4px">${c.hint}</div>` : ''}
                    <div class="star-rating-input" data-name="${c.db_col}" data-form="review-${teacher.classroom_id}">
                      ${[1,2,3,4,5].map(i => `<button type="button" class="star-btn" data-value="${i}" onclick="setRating(this)">\u2606</button>`).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
              <div class="form-group" style="margin-bottom:24px;padding:20px;background:linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);border-radius:12px;border:2px solid #bae6fd">
                <label style="font-size:1.1rem;font-weight:600;margin-bottom:12px;display:block;color:#0c4a6e">${t('student.overall_rating_label')}</label>
                <div style="display:flex;align-items:center;gap:16px">
                  <div id="overall-stars-${teacher.classroom_id}" class="fractional-stars" style="font-size:2.5rem;display:flex;gap:4px"></div>
                  <div id="overall-value-${teacher.classroom_id}" style="font-size:2rem;font-weight:700;color:#0369a1;min-width:60px">-</div>
                </div>
                <div style="margin-top:8px;color:#0369a1;font-size:0.85rem;font-style:italic">${t('student.rate_all_criteria')}</div>
              </div>
              ${isMentor ? '' : `
                <div class="form-group">
                  <label>${t('student.feedback_tags_label')}</label>
                  <div class="tag-container" id="tags-${teacher.classroom_id}">
                    ${tags.map(tag => `<div class="tag" onclick="this.classList.toggle('selected')" data-tag="${tag}">${translateTag(tag)}</div>`).join('')}
                  </div>
                </div>
              `}
              <div class="form-group">
                <label>${t('student.written_feedback_label')}</label>
                <textarea class="form-control" name="feedback_text" placeholder="${t('student.written_feedback_placeholder')}" rows="3"></textarea>
              </div>
              <button type="submit" class="btn btn-primary">${t('student.submit_review')}</button>
            </form>
          </div>
        </div>
      `;
      }).join('')}

      ${reviewed.length > 0 ? `
        <div class="card" style="margin-top:24px">
          <div class="card-header"><h3>${t('review.already_reviewed_section', {count: reviewed.length})}</h3></div>
          <div class="card-body">
            ${reviewed.map(teacher => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100);gap:12px">
                <div style="display:flex;align-items:center;gap:12px;flex:1">
                  ${avatarHTML({ full_name: teacher.teacher_name, avatar_url: teacher.avatar_url, teacher_id: teacher.teacher_id }, 'small', true)}
                  <span>${teacher.teacher_name} - ${teacher.classroom_subject}</span>
                </div>
                <span class="badge badge-approved">${t('common.submitted')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

function renderFractionalStars(containerId, rating) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const fullStars = Math.floor(rating);
  const fractional = rating - fullStars;
  const emptyStars = 5 - Math.ceil(rating);

  let html = '';

  // Full stars
  for (let i = 0; i < fullStars; i++) {
    html += '<span style="color:#fbbf24">★</span>';
  }

  // Fractional star
  if (fractional > 0) {
    const percentage = (fractional * 100).toFixed(0);
    html += `<span style="position:relative;display:inline-block">
      <span style="color:#e5e7eb">★</span>
      <span style="position:absolute;left:0;top:0;overflow:hidden;width:${percentage}%;color:#fbbf24">★</span>
    </span>`;
  }

  // Empty stars
  for (let i = 0; i < emptyStars; i++) {
    html += '<span style="color:#e5e7eb">★</span>';
  }

  container.innerHTML = html;
}

function updateOverallRating(form) {
  // IDs are scoped to classroom_id, not teacher_id, so a teacher who has
  // both an academic classroom and a mentor group renders two cards with
  // distinct DOM ids — getElementById lookups stay correct.
  const classroomId = form.dataset.classroomId || form.dataset.teacherId;
  if (!classroomId) return;

  const isMentor = form.dataset.classroomKind === 'mentor';
  const cols = isMentor ? MENTOR_CRITERIA_COLS : CRITERIA_COLS;
  const count = cols.length;
  const ratings = cols.map(col => parseInt(form.querySelector(`[data-name="${col}"]`)?.dataset.value || 0));
  const allRated = ratings.every(r => r > 0);

  if (allRated) {
    const overall = ratings.reduce((s, v) => s + v, 0) / count;
    renderFractionalStars(`overall-stars-${classroomId}`, overall);

    const valueEl = document.getElementById(`overall-value-${classroomId}`);
    if (valueEl) {
      valueEl.textContent = overall.toFixed(2);
      valueEl.style.color = overall >= 4 ? '#059669' : overall >= 3 ? '#0369a1' : overall >= 2 ? '#d97706' : '#dc2626';
    }
  } else {
    const starsEl = document.getElementById(`overall-stars-${classroomId}`);
    const valueEl = document.getElementById(`overall-value-${classroomId}`);
    if (starsEl) starsEl.innerHTML = '<span style="color:#e5e7eb">★★★★★</span>';
    if (valueEl) {
      valueEl.textContent = '-';
      valueEl.style.color = '#0369a1';
    }
  }
}

function setRating(btn) {
  const container = btn.parentElement;
  const value = parseInt(btn.dataset.value);
  container.dataset.value = value;
  container.querySelectorAll('.star-btn').forEach((b, i) => {
    b.textContent = i < value ? '\u2605' : '\u2606';
    b.classList.toggle('active', i < value);
  });

  // Update overall rating display
  const form = btn.closest('form');
  if (form) {
    updateOverallRating(form);
  }
}

async function submitReview(e, teacherId, classroomId) {
  e.preventDefault();
  const form = e.target;
  const isMentor = form.dataset.classroomKind === 'mentor';
  const cols = isMentor ? MENTOR_CRITERIA_COLS : CRITERIA_COLS;
  const count = cols.length;
  const getRating = (name) => {
    const el = form.closest('.card-body').querySelector(`[data-name="${name}"]`);
    return parseInt(el?.dataset.value || 0);
  };

  const ratingValues = {};
  for (const col of cols) {
    ratingValues[col] = getRating(col);
  }
  const allValues = Object.values(ratingValues);
  if (allValues.some(v => !v)) {
    return toast(t('student.rate_all_categories'), 'error');
  }

  const overall = Math.round(allValues.reduce((s, v) => s + v, 0) / count);

  // Tags are only used on academic reviews; the mentor form doesn't render
  // them. Look up by classroom_id so two cards for the same teacher don't
  // collide on getElementById.
  let selectedTags = [];
  if (!isMentor) {
    const tagsContainer = document.getElementById(`tags-${classroomId}`);
    if (tagsContainer) {
      selectedTags = [...tagsContainer.querySelectorAll('.tag.selected')].map(el => el.dataset.tag);
    }
  }
  const feedbackText = form.querySelector('[name="feedback_text"]').value;

  try {
    await API.post('/reviews', {
      teacher_id: teacherId,
      classroom_id: classroomId,
      overall_rating: overall,
      ...ratingValues,
      feedback_text: feedbackText,
      tags: selectedTags
    });
    toast(t('student.review_submitted'));
    invalidateCache('/dashboard/student', '/reviews/eligible-teachers', '/reviews/my-reviews');
    navigateTo('student-review');
  } catch (err) { toast(err.message, 'error'); }
}

async function renderStudentMyReviews() {
  const reviews = await cachedGet('/reviews/my-reviews', CACHE_TTL.short);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>${t('student.my_reviews_count', {count: reviews.length})}</h3></div>
      <div class="card-body">
        ${reviews.length === 0
          ? `<div class="empty-state"><h3>${t('student.no_reviews')}</h3><p>${t('student.submit_during_active')}</p></div>`
          : reviews.map(r => {
            const avg = criteriaAverage(r);
            const colorVal = avg !== null ? avg : (r.overall_rating || 0);
            return `
            <div class="review-card">
              <div class="review-header">
                <div>
                  <strong>${r.teacher_name}</strong>
                  <span style="color:var(--gray-500);font-size:0.85rem"> &middot; ${r.classroom_subject} &middot; ${r.term_name} &middot; ${r.period_name}</span>
                  <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
                    <span style="font-size:1.3rem;font-weight:700;color:${scoreColor(colorVal)}">${fmtRatingFloat(avg)}</span>
                    ${starsHTML(avg !== null ? avg : 0, 'large')}
                  </div>
                </div>
                <div class="review-meta">
                  ${r.approved_status === 1 ? `<span class="badge" style="background:#16a34a;color:#fff">${t('review.approved_badge')}</span>` : badgeHTML(r.flagged_status)}
                  <time class="review-meta-date">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</time>
                  ${r.approved_status !== 1 ? `<button class="btn btn-sm btn-outline review-meta-action" onclick="editMyReview(${r.id})">${t('common.edit')}</button>` : `<span class="review-meta-locked">${t('review.cannot_edit')}</span>`}
                </div>
              </div>
              <details class="criteria-collapse">
                <summary>
                  <span>${t('student.criteria_breakdown')}</span>
                  <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </summary>
                ${ratingGridHTML(r)}
              </details>
              ${r.feedback_text ? `<div class="review-text">${r.feedback_text}</div>` : ''}
              ${JSON.parse(r.tags || '[]').length > 0 ? `
                <div class="review-tags">
                  ${JSON.parse(r.tags).map(tag => `<span class="tag">${translateTag(tag)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `;
          }).join('')}
      </div>
    </div>
  `;
}

async function editMyReview(reviewId) {
  const reviews = await API.get('/reviews/my-reviews').catch(() => []);
  const review = reviews.find(r => r.id === reviewId);
  if (!review) return toast(t('review.not_found'), 'error');
  if (review.approved_status === 1) return toast(t('review.cannot_edit_approved'), 'error');

  const isMentor = review.review_kind === 'mentor';
  const list = isMentor
    ? MENTOR_CRITERIA_CONFIG.map(c => ({ slug: c.slug, db_col: c.db_col, label: c.label, info_key: c.info_key }))
    : CRITERIA_CONFIG.map(c => ({ slug: c.slug, db_col: c.db_col, label: t(c.label_key), info_key: c.info_key }));

  const tags = isMentor ? [] : await cachedGet('/reviews/tags', CACHE_TTL.long).catch(() => []);
  const currentTags = JSON.parse(review.tags || '[]');

  openModal(`
    <div class="modal-header"><h3>${t('review.edit_title', {teacher: review.teacher_name})}${isMentor ? ' <span style="font-size:0.7rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:6px;vertical-align:middle">MENTOR</span>' : ''}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:16px">${escapeHtml(review.classroom_subject)} &middot; ${escapeHtml(review.period_name)}</p>
      <input type="hidden" id="edit_review_kind" value="${isMentor ? 'mentor' : 'teacher'}">
      ${list.map(c => `
        <div class="form-group">
          <label>${escapeHtml(c.label)}${c.info_key ? ' ' + criteriaInfoIcon(c.info_key) : ''}</label>
          <select class="form-control" id="edit_${c.slug}">
            ${[1,2,3,4,5].map(v => `<option value="${v}" ${review[c.db_col] == v ? 'selected' : ''}>${v} - ${[t('rating.very_poor'),t('rating.poor'),t('rating.average'),t('rating.good'),t('rating.excellent')][v-1]}</option>`).join('')}
          </select>
        </div>
      `).join('')}
      <div class="form-group">
        <label>${t('review.written_feedback_label')} <span style="color:var(--gray-400);font-weight:400">${t('forms.optional')}</span></label>
        <textarea class="form-control" id="edit_feedback" rows="3" placeholder="${t('review.share_thoughts')}">${escapeHtml(review.feedback_text || '')}</textarea>
      </div>
      ${isMentor ? '' : `
        <div class="form-group">
          <label>${t('review.tags_label')}</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${tags.map(tag => `<label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" value="${escAttr(tag)}" ${currentTags.includes(tag) ? 'checked' : ''}> ${translateTag(tag)}</label>`).join('')}
          </div>
        </div>
      `}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="submitReviewEdit(${reviewId})">${t('common.save_changes')}</button>
    </div>
  `);
}

async function submitReviewEdit(reviewId) {
  const isMentor = document.getElementById('edit_review_kind')?.value === 'mentor';
  const list = isMentor ? MENTOR_CRITERIA_CONFIG : CRITERIA_CONFIG;
  const body = {
    feedback_text: document.getElementById('edit_feedback').value,
    tags: isMentor ? [] : [...document.querySelectorAll('#modal input[type=checkbox]:checked')].map(cb => cb.value),
  };
  list.forEach(c => {
    body[c.db_col] = parseInt(document.getElementById(`edit_${c.slug}`).value);
  });
  try {
    await API.put(`/reviews/${reviewId}`, body);
    toast(t('review.updated'));
    invalidateCache('/reviews/my-reviews');
    closeModal();
    renderStudentMyReviews();
  } catch (err) { toast(err.message, 'error'); }
}

async function viewTeacherProfile(teacherId) {
  try {
    const data = await API.get(`/teachers/${teacherId}/profile`);
    const teacher = data.teacher;
    const scores = data.scores;

    openModal(`
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:16px">
          ${avatarHTML({ full_name: teacher.full_name, avatar_url: teacher.avatar_url }, 'large')}
          <div>
            <h2 style="margin:0">${teacher.full_name}</h2>
            <p style="margin:4px 0 0;color:var(--gray-500)">${teacher.subject || ''} ${teacher.department ? '&middot; ' + teacher.department : ''}</p>
          </div>
        </div>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        ${teacher.bio ? `
          <div style="margin-bottom:24px;padding:16px;background:var(--gray-50);border-radius:8px">
            <h4 style="margin:0 0 8px">${t('profile.about')}</h4>
            <p style="margin:0;color:var(--gray-700)">${teacher.bio}</p>
          </div>
        ` : ''}

        ${teacher.experience_years ? `
          <div style="margin-bottom:20px">
            <strong>${t('profile.experience')}</strong> ${t('profile.experience_years', {years: teacher.experience_years})}
          </div>
        ` : ''}

        ${data.reviews.length > 0 ? `
          <div style="margin-bottom:24px">
            <h3>${t('profile.overall_performance')}</h3>
            <div class="grid grid-2" style="gap:16px;margin-top:12px">
              <div class="stat-card">
                <div class="stat-label">${t('profile.overall_rating')}</div>
                <div class="stat-value" style="display:flex;align-items:center;gap:8px">
                  ${starsHTML(scores.avg_overall || 0, 'large')}
                  <span style="font-size:1.5rem;font-weight:700">${fmtScore(scores.avg_overall)}</span>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-label">${t('profile.total_reviews')}</div>
                <div class="stat-value">${data.reviews.length}</div>
              </div>
            </div>

            <div style="margin-top:20px">
              <h4>${t('profile.category_ratings')}</h4>
              ${CRITERIA_CONFIG.map(c => {
                return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
                  <span style="font-weight:500;display:flex;align-items:center;gap:4px">${t(c.label_key)}${criteriaInfoIcon(c.info_key)}</span>
                  <div style="display:flex;align-items:center;gap:8px">
                    ${starsHTML(scores[`avg_${c.slug}`] || 0)}
                    <span style="font-weight:600">${fmtScore(scores[`avg_${c.slug}`])}</span>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>

          <div>
            <h3>${t('profile.recent_feedback')}</h3>
            <div style="max-height:300px;overflow-y:auto">
              ${data.reviews.slice(0, 10).map(r => `
                <div style="padding:12px;margin-bottom:12px;background:var(--gray-50);border-radius:8px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    ${starsHTML(r.overall_rating)}
                    <span style="font-size:0.85rem;color:var(--gray-500)">${r.term_name ? r.term_name + ' &middot; ' : ''}${r.period_name ? r.period_name + ' &middot; ' : ''}${new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  ${r.feedback_text ? `<p style="margin:0;color:var(--gray-700)">${r.feedback_text}</p>` : `<p style="margin:0;color:var(--gray-400);font-style:italic">${t('profile.no_written_feedback')}</p>`}
                  ${r.tags && r.tags !== '[]' ? `
                    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
                      ${JSON.parse(r.tags).map(tag => `<span class="badge badge-pending">${translateTag(tag)}</span>`).join('')}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="empty-state">
            <h3>${t('profile.no_reviews_title')}</h3>
            <p>${t('profile.no_reviews_desc')}</p>
          </div>
        `}
      </div>
    `);
  } catch (err) {
    toast(t('profile.load_failed') + err.message, 'error');
  }
}

// ============ COMMUNICATION LANDING PAGES ============
async function renderCommsUnified(role) {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const isStudent = role === 'student';
    // Fetch council posts in parallel with the existing announcements/forms.
    // Council endpoint is best-effort: a 404/500 here should not break Communication.
    const [announcements, forms, councilPosts] = await Promise.all([
      cachedGet('/announcements', CACHE_TTL.medium).catch(() => []),
      isStudent
        ? API.get('/forms/student/available').catch(() => [])
        : cachedGet('/forms', CACHE_TTL.medium).catch(() => []),
      API.get('/council/posts').catch(() => [])
    ]);

    // Build unified items list
    const items = [];
    announcements.forEach(a => items.push({ type: 'announcement', date: a.created_at, data: a }));
    forms.forEach(f => items.push({ type: 'form', date: f.created_at || f.updated_at || '2000-01-01', data: f }));
    councilPosts.forEach(p => items.push({ type: 'council', date: p.published_at, data: p }));
    items.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Action buttons. Council members get the publish button regardless of role.
    const isCouncil = currentUser && currentUser.is_student_council && currentUser.role === 'student';
    const actionBtns = `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${isCouncil ? `<button class="btn btn-primary btn-sm" onclick="openCouncilPublishChooser()">${t('council.new_post')}</button>` : ''}
        ${!isStudent ? `<button class="btn btn-primary btn-sm" onclick="navigateTo('${role}-announcements')">+ Announcement</button>` : ''}
        ${!isStudent ? `<button class="btn btn-outline btn-sm" onclick="navigateTo('${role}-forms')">Manage Forms</button>` : ''}
      </div>
    `;

    const formCardHTML = (f) => {
      if (isStudent) {
        return `
          <div class="card" style="margin-bottom:16px;border-left:4px solid ${f.already_submitted ? 'var(--gray-300)' : 'var(--primary)'}">
            <div class="card-body" style="display:flex;align-items:center;gap:16px">
              <div style="font-size:1.5rem;flex-shrink:0">📋</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  <h3 style="margin:0;font-size:1rem">${escapeHtml(f.title)}</h3>
                  <span style="font-size:0.7rem;background:var(--primary);color:#fff;padding:1px 8px;border-radius:10px">Form</span>
                </div>
                <div style="font-size:0.82rem;color:var(--gray-500)">${f.classroom_subject || ''} ${f.grade_level ? '&middot; ' + f.grade_level : ''} ${f.teacher_name ? '&middot; ' + f.teacher_name : ''}</div>
                ${f.description ? `<p style="font-size:0.85rem;color:var(--gray-600);margin:4px 0 0">${f.description}</p>` : ''}
              </div>
              <div style="text-align:center;flex-shrink:0">
                ${f.already_submitted
                  ? `<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:12px;font-size:0.82rem;font-weight:600">${t('forms.submitted')}</span>`
                  : `<button class="btn btn-primary btn-sm" onclick="openStudentForm(${f.id})">${t('forms.fill_out')}</button>`}
              </div>
            </div>
          </div>`;
      } else {
        const statusMap = { draft: ['#6b7280', t('forms.status_draft')], active: ['#16a34a', t('forms.status_active')], closed: ['#9ca3af', t('forms.status_closed')] };
        const [color, label] = statusMap[f.status] || ['#6b7280', f.status];
        return `
          <div class="card" style="margin-bottom:16px;border-left:4px solid ${color}">
            <div class="card-body" style="display:flex;align-items:center;gap:16px">
              <div style="font-size:1.5rem;flex-shrink:0">📋</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  <h3 style="margin:0;font-size:1rem">${escapeHtml(f.title)}</h3>
                  <span style="font-size:0.7rem;background:${color};color:#fff;padding:1px 8px;border-radius:10px">${label}</span>
                </div>
                <div style="font-size:0.82rem;color:var(--gray-500)">${f.response_count || 0} responses &middot; ${f.question_count || 0} questions</div>
              </div>
              <button class="btn btn-outline btn-sm" onclick="navigateTo('${role}-forms')">Manage</button>
            </div>
          </div>`;
      }
    };

    el.innerHTML = `
      <div class="comms-header-row" style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 20px">
        <h2 style="margin:0">Communication</h2>
        ${actionBtns}
      </div>
      ${items.length === 0
        ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>Nothing here yet</h3><p>Announcements and forms will appear here.</p></div></div></div>'
        : items.map(item => {
            if (item.type === 'announcement') return announcementCardHTML(item.data, !isStudent, isStudent);
            if (item.type === 'council') return councilPostCardHTML(item.data);
            return formCardHTML(item.data);
          }).join('')}
    `;

    // Council posts mounted asynchronously: load each petition's results so the
    // tally bar can render. Do it after innerHTML so the DOM nodes exist.
    items.filter(i => i.type === 'council' && i.data.type === 'petition' && i.data.status !== 'removed')
         .forEach(i => loadPetitionResults(i.data.id));

    // Mark comms as seen (for badge clearing)
    const total = items.length;
    localStorage.setItem(`comms_seen_${role}`, total.toString());
    updateCommsBadge(role);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

async function renderStudentComms() { renderCommsUnified('student'); }
async function renderTeacherComms() { renderCommsUnified('teacher'); }
async function renderHeadComms() { renderCommsUnified('head'); }
async function renderAdminComms() { renderCommsUnified('admin'); }

function updateCommsBadge(role) {
  const badge = document.getElementById('commsBadge');
  if (!badge) return;
  const seen = parseInt(localStorage.getItem(`comms_seen_${role}`) || '0');
  const total = parseInt(badge.dataset.total || '0');
  const unseen = Math.max(0, total - seen);
  if (unseen > 0) {
    badge.textContent = unseen > 99 ? '99+' : unseen;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

async function checkCommsBadge() {
  if (!currentUser) return;
  const role = currentUser.role;
  const isStudent = role === 'student';
  try {
    const [announcements, forms, councilPosts] = await Promise.all([
      cachedGet('/announcements', CACHE_TTL.medium).catch(() => []),
      isStudent
        ? API.get('/forms/student/available').catch(() => [])
        : cachedGet('/forms', CACHE_TTL.medium).catch(() => []),
      API.get('/council/posts').catch(() => [])
    ]);
    const total = announcements.length + forms.length + councilPosts.length;
    const badge = document.getElementById('commsBadge');
    if (badge) {
      badge.dataset.total = total;
      updateCommsBadge(role);
    }
  } catch { /* silent */ }
}

// ============ STUDENT ANNOUNCEMENTS & FORMS ============
async function renderStudentForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading')}</p></div>`;
  try {
    const forms = await API.get('/forms/student/available').catch(() => []);

    const formsHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('student-comms')">${t('common.back')}</button>
      </div>
      <h2 style="margin-bottom:16px">${t('forms.title_count', {count: forms.length})}</h2>
      ${forms.length === 0 ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>' + t('forms.no_forms') + '</h3><p>' + t('forms.no_forms_msg') + '</p></div></div></div>' : `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${forms.map(f => `
            <div class="card" style="border-left:4px solid ${f.already_submitted ? 'var(--gray-300)' : 'var(--primary)'}">
              <div class="card-body" style="display:flex;align-items:center;gap:16px">
                <div style="flex:1">
                  <h3 style="margin:0 0 4px">${f.title}</h3>
                  <div style="font-size:0.82rem;color:var(--gray-500);margin-bottom:${f.description ? '6px' : '0'}">
                    ${f.classroom_subject} &middot; ${f.grade_level} &middot; ${f.teacher_name}
                  </div>
                  ${f.description ? `<p style="font-size:0.85rem;color:var(--gray-600);margin:0">${f.description}</p>` : ''}
                </div>
                <div style="text-align:center;flex-shrink:0">
                  <div style="font-size:0.75rem;color:var(--gray-400);margin-bottom:6px">${t('forms.question_count', {count: f.question_count, s: f.question_count !== 1 ? 's' : ''})}</div>
                  ${f.already_submitted
                    ? `<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:12px;font-size:0.82rem;font-weight:600">${t('forms.submitted')}</span>`
                    : `<button class="btn btn-primary btn-sm" onclick="openStudentForm(${f.id})">${t('forms.fill_out')}</button>`}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}`;

    el.innerHTML = formsHTML;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

async function openStudentForm(formId) {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading')}</p></div>`;
  try {
    const form = await API.get(`/forms/${formId}`);

    const clearBtn = (qId, type) =>
      `<button type="button" onclick="clearFormAnswer(${qId},'${type}')" style="font-size:0.75rem;color:var(--gray-400);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;line-height:1" title="${t('forms.clear')}">${t('forms.clear')}</button>`;

    const renderQuestion = (q, idx) => {
      if (q.question_type === 'text') {
        return `
          <div class="form-group" style="margin-bottom:20px">
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
              <label style="font-weight:600">${idx + 1}. ${q.question_text} ${q.required ? '<span style="color:#ef4444">*</span>' : ''}</label>
              ${!q.required ? clearBtn(q.id, 'text') : ''}
            </div>
            <textarea class="form-control" id="qa_${q.id}" rows="3" placeholder="${t('forms.answer_placeholder')}"></textarea>
          </div>`;
      }
      if (q.question_type === 'yes_no') {
        return `
          <div class="form-group" style="margin-bottom:20px">
            <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">
              <label style="font-weight:600">${idx + 1}. ${q.question_text} ${q.required ? '<span style="color:#ef4444">*</span>' : ''}</label>
              ${!q.required ? clearBtn(q.id, 'radio') : ''}
            </div>
            <div style="display:flex;gap:12px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 16px;border:2px solid var(--gray-200);border-radius:8px;font-weight:500;transition:all 0.15s">
                <input type="radio" name="qa_${q.id}" value="Yes" style="width:16px;height:16px"> ${t('common.yes')}
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 16px;border:2px solid var(--gray-200);border-radius:8px;font-weight:500;transition:all 0.15s">
                <input type="radio" name="qa_${q.id}" value="No" style="width:16px;height:16px"> ${t('common.no')}
              </label>
            </div>
          </div>`;
      }
      // multiple_choice
      return `
        <div class="form-group" style="margin-bottom:20px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">
            <label style="font-weight:600">${idx + 1}. ${q.question_text} ${q.required ? '<span style="color:#ef4444">*</span>' : ''}</label>
            ${!q.required ? clearBtn(q.id, 'radio') : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${(q.options || []).map(opt => `
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;border:2px solid var(--gray-200);border-radius:8px;font-weight:500;transition:all 0.15s">
                <input type="radio" name="qa_${q.id}" value="${opt.replace(/"/g,'&quot;')}" style="width:16px;height:16px"> ${opt}
              </label>
            `).join('')}
          </div>
        </div>`;
    };

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('student-forms')">${t('common.back')}</button>
        <div>
          <h2 style="margin:0">${form.title}</h2>
          <span style="font-size:0.82rem;color:var(--gray-500)">${form.classroom_subject} &middot; ${form.grade_level}</span>
        </div>
      </div>
      <div class="card">
        <div class="card-body">
          ${form.description ? `<p style="color:var(--gray-600);margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--gray-100)">${form.description}</p>` : ''}
          <div id="studentFormQuestions">
            ${form.questions.map((q, idx) => renderQuestion(q, idx)).join('')}
          </div>
          <div style="padding-top:16px;border-top:1px solid var(--gray-100);display:flex;gap:12px;justify-content:flex-end">
            <button class="btn btn-outline" onclick="navigateTo('student-forms')">${t('common.cancel')}</button>
            <button class="btn btn-primary" onclick="submitStudentForm(${formId})">${t('forms.submit_anonymous')}</button>
          </div>
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

function clearFormAnswer(qId, type) {
  if (type === 'text') {
    const el = document.getElementById(`qa_${qId}`);
    if (el) el.value = '';
  } else {
    document.querySelectorAll(`input[name="qa_${qId}"]`).forEach(r => r.checked = false);
  }
}

async function submitStudentForm(formId) {
  try {
    const form = await API.get(`/forms/${formId}`);
    const answers = [];
    let missingRequired = false;

    for (const q of form.questions) {
      let answer_text = '';
      if (q.question_type === 'text') {
        answer_text = document.getElementById(`qa_${q.id}`)?.value?.trim() || '';
      } else {
        const selected = document.querySelector(`input[name="qa_${q.id}"]:checked`);
        answer_text = selected ? selected.value : '';
      }
      if (q.required && !answer_text) {
        missingRequired = true;
        break;
      }
      answers.push({ question_id: q.id, answer_text });
    }

    if (missingRequired) return toast(t('forms.required_error'), 'error');

    const confirmed = await confirmDialog(t('forms.confirm_submit'), t('common.submit'), t('common.cancel'));
    if (!confirmed) return;

    await API.post(`/forms/${formId}/submit`, { answers });
    toast(t('forms.submitted_msg'));
    navigateTo('student-forms');
  } catch (err) { toast(err.message, 'error'); }
}

// ============ TEACHER VIEWS ============
async function renderTeacherHome() {
  const data = await cachedGet('/dashboard/teacher');
  const el = document.getElementById('contentArea');
  const s = data.overall_scores;

  el.innerHTML = `
    ${data.pending_review_count > 0 ? `
      <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:10px 16px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span style="font-size:0.9rem;color:#854d0e">${t('teacher.pending_banner', {count: data.pending_review_count, s: data.pending_review_count !== 1 ? 's' : ''})}</span>
        <span style="font-size:0.8rem;color:#a16207">${t('teacher.total_submitted', {total: data.total_review_count})}</span>
      </div>
    ` : ''}
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card">
        <div class="stat-label">${t('teacher.overall_rating')}</div>
        <div class="stat-value" style="color:${s.review_count > 0 ? scoreColor(s.avg_overall || 0) : 'var(--gray-400)'}">${s.review_count > 0 ? fmtScore(s.avg_overall) : '0.00'}</div>
        <div class="stat-change">${t('teacher.total_reviews', {count: s.review_count})}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('teacher.classrooms')}</div>
        <div class="stat-value">${data.classrooms.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('teacher.active_period')}</div>
        <div class="stat-value" style="font-size:1.3rem">${data.active_period?.name || t('teacher.none')}</div>
        ${data.active_term ? `<div class="stat-change">${data.active_term.name}</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('teacher.trend')}</div>
        <div class="stat-value" style="font-size:${data.trend ? '2rem' : '1.2rem'};color:${data.trend ? '' : 'var(--gray-400)'}">${data.trend ? trendArrow(data.trend.trend) : '—'}</div>
        <div class="stat-change ${data.trend?.trend === 'improving' ? 'up' : data.trend?.trend === 'declining' ? 'down' : 'stable'}">${data.trend?.trend || t('teacher.no_data')}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:28px">
      <div class="card">
        <div class="card-header"><h3>${t('teacher.rating_breakdown')}</h3></div>
        <div class="card-body">
          ${CRITERIA_CONFIG.map(c => {
            return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span style="font-weight:500;display:flex;align-items:center;gap:4px">${t(c.label_key)}${criteriaInfoIcon(c.info_key)}</span>
              <div style="display:flex;align-items:center;gap:8px">
                ${starsHTML(s[`avg_${c.slug}`] || 0)}
                <span style="font-weight:600;color:${s.review_count > 0 ? scoreColor(s[`avg_${c.slug}`] || 0) : 'var(--gray-400)'}">${s.review_count > 0 ? fmtScore(s[`avg_${c.slug}`]) : '0.00'}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('teacher.rating_distribution')}</h3></div>
        <div class="card-body">
          <canvas id="distChart"></canvas>
        </div>
      </div>
    </div>

    ${data.completion_rates.length > 0 ? `
      <div class="card" style="margin-bottom:28px">
        <div class="card-header"><h3>${t('teacher.feedback_completion')}</h3></div>
        <div class="card-body">
          ${data.completion_rates.map(c => `
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <span style="font-weight:500">${c.subject} (${c.grade_level})</span>
                <span style="font-weight:600;color:${c.rate >= 70 ? 'var(--success)' : c.rate >= 40 ? 'var(--warning)' : 'var(--danger)'}">${c.submitted}/${c.total} (${c.rate}%)</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${c.rate >= 70 ? 'green' : c.rate >= 40 ? 'yellow' : 'red'}" style="width:${c.rate}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${data.department_average ? `
      <div class="card" style="margin-bottom:28px">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${t('teacher.dept_average', {dept: data.teacher.department})}</strong>
            <p style="font-size:0.85rem;color:var(--gray-500)">${t('teacher.dept_anonymous')}</p>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.5rem;font-weight:700">${fmtScore(data.department_average)}</div>
            <div style="font-size:0.85rem;color:${(s.avg_overall||0) >= data.department_average ? 'var(--success)' : 'var(--warning)'}">
              ${t('teacher.your_score', {score: fmtScore(s.avg_overall)})}
              ${(s.avg_overall||0) >= data.department_average ? t('teacher.above_avg') : t('teacher.below_avg')}
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Distribution chart
  if (data.distribution) {
    const ctx = document.getElementById('distChart');
    if (ctx) {
      chartInstances.dist = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: [t('chart.1_star'), t('chart.2_stars'), t('chart.3_stars'), t('chart.4_stars'), t('chart.5_stars')],
          datasets: [{
            data: [data.distribution[1], data.distribution[2], data.distribution[3], data.distribution[4], data.distribution[5]],
            backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }
  }
}

async function renderTeacherClassrooms() {
  const isMentor = !!currentUser?.is_mentor;
  const [data, menteesRes] = await Promise.all([
    cachedGet('/dashboard/teacher'),
    isMentor ? API.get('/experiences/mentor/mentees').catch(() => ({ mentees: [] })) : Promise.resolve({ mentees: [] }),
  ]);
  window._teacherTerms = data.all_terms || [];
  window._teacherActiveTerm = data.active_term || null;
  const el = document.getElementById('contentArea');
  const allClassrooms = data.classrooms || [];
  const mentees = menteesRes.mentees || [];

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <p style="color:var(--gray-500)">${t('teacher.manage_classrooms')}</p>
      <button class="btn btn-primary" onclick="showCreateClassroomTeacher()">${t('teacher.create_classroom')}</button>
    </div>
    ${(() => {
      const active = allClassrooms.filter(c => c.active_status !== 0);
      const archived = allClassrooms.filter(c => c.active_status === 0);
      if (data.classrooms.length === 0) return `<div class="empty-state" style="margin-top:40px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--gray-300);margin-bottom:12px"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <h3 style="color:var(--gray-500);margin-bottom:6px">${t('teacher.no_classrooms_title')}</h3>
          <p style="color:var(--gray-400);font-size:0.875rem">${t('teacher.create_first_classroom')}</p>
        </div>`;
      const renderCard = (c, isArchived) => {
        const isMentorGroup = (c.kind || 'academic') === 'mentor';
        return `
        <div class="classroom-card" style="${isArchived ? 'opacity:0.65;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <div>
              <div class="class-subject">${c.subject}${isMentorGroup ? ' <span style="font-size:0.65rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:0.04em;margin-left:6px;vertical-align:middle">MENTOR</span>' : ''}</div>
              <div class="class-meta">${c.grade_level} &middot; ${c.student_count} ${isMentorGroup ? 'mentees' : t('common.students').toLowerCase()}</div>
            </div>
            ${isArchived ? `<span style="font-size:0.75rem;background:var(--gray-200);color:var(--gray-600);padding:2px 8px;border-radius:10px;font-weight:500">${t('teacher.archived')}</span>` : ''}
          </div>
          <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">${t('teacher.join_code')}</div>
              <span class="join-code">${formatJoinCode(c.join_code)}</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${!isArchived ? `<button class="btn btn-sm btn-outline" onclick="regenerateCode(${c.id})">${t('teacher.new_code')}</button>` : ''}
              ${!isArchived ? `<button class="btn btn-sm btn-outline" onclick="editClassroomTeacher(${c.id}, '${c.subject.replace(/'/g, "\\'")}', '${c.grade_level.replace(/'/g, "\\'")}')"> ${t('common.edit')}</button>` : ''}
              ${!isArchived
                ? `<button class="btn btn-sm btn-outline" style="color:var(--gray-500)" onclick="archiveClassroomTeacher(${c.id}, '${c.subject.replace(/'/g, "\\'")}')"> ${t('teacher.archive')}</button>`
                : `<button class="btn btn-sm btn-outline" onclick="unarchiveClassroomTeacher(${c.id})">${t('teacher.unarchive')}</button>`}
              <button class="btn btn-sm btn-danger" onclick="deleteClassroomTeacher(${c.id}, '${c.subject.replace(/'/g, "\\'")}')"> ${t('common.delete')}</button>
              <button class="btn btn-sm btn-primary" onclick="viewClassroomMembers(${c.id}, '${c.subject}')">${t('teacher.members')}</button>
            </div>
          </div>
        </div>`;
      };
      const academicActive = active.filter(c => (c.kind || 'academic') !== 'mentor');
      const mentorActive = active.filter(c => (c.kind || 'academic') === 'mentor');
      const academicArchived = archived.filter(c => (c.kind || 'academic') !== 'mentor');
      const mentorArchived = archived.filter(c => (c.kind || 'academic') === 'mentor');
      return `
        ${academicActive.length > 0
          ? `<h3 style="font-size:1rem;margin:0 0 12px;color:var(--gray-700)">My classrooms</h3>
             <div class="grid grid-2">${academicActive.map(c => renderCard(c, false)).join('')}</div>`
          : ''}
        ${academicArchived.length > 0 ? `
          <div style="margin-top:24px">
            <h3 style="color:var(--gray-500);font-size:0.95rem;margin-bottom:12px">${t('teacher.archived')} classrooms (${academicArchived.length})</h3>
            <div class="grid grid-2">${academicArchived.map(c => renderCard(c, true)).join('')}</div>
          </div>` : ''}
        ${mentorActive.length > 0 || mentorArchived.length > 0 ? `
          <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--gray-200)">
            <h3 style="font-size:1rem;margin:0 0 12px;color:var(--gray-700)">Mentor group</h3>
            ${mentorActive.length > 0 ? `<div class="grid grid-2">${mentorActive.map(c => renderCard(c, false)).join('')}</div>` : ''}
            ${mentorArchived.length > 0 ? `
              <div style="margin-top:24px">
                <h4 style="color:var(--gray-500);font-size:0.9rem;margin-bottom:12px">${t('teacher.archived')} mentor group${mentorArchived.length !== 1 ? 's' : ''} (${mentorArchived.length})</h4>
                <div class="grid grid-2">${mentorArchived.map(c => renderCard(c, true)).join('')}</div>
              </div>` : ''}
          </div>` : ''}
      `;
    })()}
    ${isMentor && mentees.length > 0 ? `
      <div class="card" style="margin-top:32px">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <h3>My mentees</h3>
            <p style="color:var(--gray-500);font-size:0.82rem;margin:4px 0 0">Read your mentees' UWC Experience Map reflections.</p>
          </div>
          <span style="font-size:0.78rem;color:var(--gray-500)">${mentees.length} mentee${mentees.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Group</th>
                <th>Cohort</th>
                <th style="text-align:right">Reflections</th>
                <th>Last reflection</th>
                <th style="text-align:right">${t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              ${mentees.map(m => `
                <tr>
                  <td><strong>${escapeHtml(m.student_name)}</strong></td>
                  <td>${escapeHtml(m.group_name)}</td>
                  <td>${m.grade ? escapeHtml(m.grade) : '<span style="color:var(--gray-400)">N/A</span>'}</td>
                  <td style="text-align:right;font-weight:600">${m.reflection_count}</td>
                  <td>${m.last_date ? formatExpDate(m.last_date) : '<span style="color:var(--gray-400)">N/A</span>'}</td>
                  <td style="text-align:right">
                    <button class="btn btn-sm ${m.reflection_count > 0 ? 'btn-primary' : 'btn-outline'}" ${m.reflection_count === 0 ? 'disabled' : ''} onclick="viewMenteeExperiences(${m.student_id})">View map</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;
}

async function showCreateClassroomTeacher() {
  const isMentor = !!currentUser?.is_mentor;
  // One mentor group per mentor — once created, hide the toggle.
  let alreadyHasMentorGroup = false;
  if (isMentor) {
    try {
      const data = await cachedGet('/dashboard/teacher');
      alreadyHasMentorGroup = (data.classrooms || []).some(c => (c.kind || 'academic') === 'mentor');
    } catch (_) {}
  }
  const showMentorToggle = isMentor && !alreadyHasMentorGroup;
  openModal(`
    <div class="modal-header"><h3>${t('teacher.create_classroom_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${showMentorToggle ? `
        <div class="form-group" style="background:#f8fafc;border:1px solid var(--gray-100);border-radius:10px;padding:12px 14px">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin:0">
            <input type="checkbox" id="newClassroomIsMentor" onchange="onCreateClassroomKindToggle(this.checked)">
            <span><strong>This is a mentor group</strong>
              <span style="display:block;font-weight:400;font-size:0.78rem;color:var(--gray-500);margin-top:2px">Mentees join with the code, feedback uses mentor criteria. One per mentor.</span>
            </span>
          </label>
        </div>
      ` : ''}
      <div class="form-group" id="newSubjectWrap">
        <label>${t('common.subject')}</label>
        <input type="text" class="form-control" id="newSubject" placeholder="${t('teacher.subject_placeholder')}">
      </div>
      <div class="form-group">
        <label id="newGradeLabel">Cohort</label>
        <input type="text" class="form-control" id="newGradeLevel" placeholder="e.g. Class of 2027">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createClassroomTeacher()">${t('common.create')}</button>
    </div>
  `);
}

window.onCreateClassroomKindToggle = function (isMentorGroup) {
  const subjectWrap = document.getElementById('newSubjectWrap');
  const gradeLabel = document.getElementById('newGradeLabel');
  if (subjectWrap) subjectWrap.style.display = isMentorGroup ? 'none' : '';
  if (gradeLabel) gradeLabel.textContent = isMentorGroup ? 'Mentor group name / cohort' : 'Cohort';
  const gradeInput = document.getElementById('newGradeLevel');
  if (gradeInput) gradeInput.placeholder = isMentorGroup ? 'e.g. Mentor Group A · Class of 2027' : 'e.g. Class of 2027';
};

async function createClassroomTeacher() {
  const isMentorGroup = !!document.getElementById('newClassroomIsMentor')?.checked;
  const grade_level = document.getElementById('newGradeLevel').value.trim();
  // For mentor groups the cohort line is the only label; subject is fixed to
  // 'Mentor Group' so existing dashboard/aggregate queries still have a value.
  const subject = isMentorGroup
    ? 'Mentor Group'
    : (document.getElementById('newSubject').value.trim());
  if (!subject || !grade_level) return toast(t('teacher.fill_all_fields'), 'error');
  try {
    const data = await API.post('/classrooms', {
      subject,
      grade_level,
      kind: isMentorGroup ? 'mentor' : 'academic',
    });
    toast(t('teacher.classroom_created', {code: formatJoinCode(data.join_code)}));
    invalidateCache('/dashboard/teacher', '/classrooms', '/forms');
    closeModal();
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

// ============ TEACHER: MENTOR GROUPS ============
// Mentor groups are classrooms with kind='mentor'. UI mirrors the regular
// classrooms page but every action (create/list) carries the mentor kind so
// reviews submitted against these classrooms get routed to the mentor review
// criteria, not the academic ones.

async function archiveClassroomTeacher(id, subject) {
  const confirmed = await confirmDialog(t('teacher.archive_confirm', {name: subject}), t('teacher.archive'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.patch(`/classrooms/${id}`, { active_status: 0 });
    toast(t('teacher.archived_msg'));
    invalidateCache('/dashboard/teacher', '/classrooms');
    renderTeacherClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

async function unarchiveClassroomTeacher(id) {
  try {
    await API.patch(`/classrooms/${id}`, { active_status: 1 });
    toast(t('teacher.reactivated_msg'));
    invalidateCache('/dashboard/teacher', '/classrooms');
    renderTeacherClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

function editClassroomTeacher(id, subject, gradeLevel) {
  openModal(`
    <div class="modal-header"><h3>${t('teacher.edit_classroom')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('common.subject')}</label>
        <input type="text" class="form-control" id="editSubject" value="${subject}">
      </div>
      <div class="form-group">
        <label>${t('common.grade')}</label>
        <input type="text" class="form-control" id="editGradeLevel" value="${gradeLevel}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="saveClassroomTeacher(${id})">${t('common.save_short')}</button>
    </div>
  `);
}

async function saveClassroomTeacher(id) {
  const subject = document.getElementById('editSubject').value.trim();
  const grade_level = document.getElementById('editGradeLevel').value.trim();
  if (!subject || !grade_level) return toast(t('teacher.fill_all_fields'), 'error');
  try {
    await API.patch(`/classrooms/${id}`, { subject, grade_level });
    toast(t('teacher.classroom_updated'));
    closeModal();
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteClassroomTeacher(id, subject) {
  const confirmed = await confirmDialog(t('teacher.delete_classroom_confirm', {name: subject}), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/classrooms/${id}`);
    toast(t('teacher.classroom_deleted'));
    invalidateCache('/dashboard/teacher', '/classrooms', '/forms');
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function regenerateCode(classroomId) {
  const confirmed = await confirmDialog(t('teacher.regenerate_confirm'), t('teacher.generate'), 'Cancel');
  if (!confirmed) return;
  try {
    const data = await API.post(`/classrooms/${classroomId}/regenerate-code`);
    toast(t('teacher.new_join_code', {code: formatJoinCode(data.join_code)}));
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function viewClassroomMembers(classroomId, subject) {
  try {
    const members = await API.get(`/classrooms/${classroomId}/members`);
    openModal(`
      <div class="modal-header"><h3>${t('teacher.students_title', {subject})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        ${members.length === 0
          ? `<p style="color:var(--gray-500);text-align:center">${t('teacher.no_students_enrolled')}</p>`
          : `<table><thead><tr><th>${t('common.name')}</th><th>${t('common.grade')}</th><th>${t('teacher.joined')}</th></tr></thead><tbody>
              ${members.map(m => `<tr><td>${m.full_name}</td><td>${m.grade_or_position || '-'}</td><td>${new Date(m.joined_at).toLocaleDateString()}</td></tr>`).join('')}
            </tbody></table>`}
      </div>
    `);
  } catch (err) { toast(err.message, 'error'); }
}

async function renderTeacherFeedback() {
  const data = await cachedGet('/dashboard/teacher');
  const el = document.getElementById('contentArea');

  // Filter to academic-only — mentor reviews live on the dedicated
  // teacher-mentor-feedback view since they use a different criteria set.
  const academicReviews = (data.recent_reviews || []).filter(r => (r.review_kind || 'teacher') !== 'mentor');
  const approvedReviews = academicReviews.filter(r => r.approved_status === 1);
  const pendingReviews = academicReviews.filter(r => r.approved_status === 0);
  window._teacherCompletionRates = data.completion_rates || [];

  // Group APPROVED reviews by subject/classroom for averages
  const bySubject = {};
  approvedReviews.forEach(r => {
    const key = `${r.classroom_subject} (${r.grade_level})`;
    if (!bySubject[key]) {
      bySubject[key] = { reviews: [], subject: r.classroom_subject, grade: r.grade_level };
    }
    bySubject[key].reviews.push(r);
  });

  // Calculate averages for each subject (ONLY approved reviews)
  Object.keys(bySubject).forEach(key => {
    const reviews = bySubject[key].reviews;
    bySubject[key].count = reviews.length;
    bySubject[key].avg_overall = (reviews.reduce((sum, r) => sum + r.overall_rating, 0) / reviews.length).toFixed(2);
    CRITERIA_CONFIG.forEach(c => {
      bySubject[key][`avg_${c.slug}`] = (reviews.reduce((sum, r) => sum + (r[c.db_col] || 0), 0) / reviews.length).toFixed(2);
    });
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
      <button class="btn btn-outline" onclick="exportMyPDF()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        ${t('admin.export_pdf')}
      </button>
    </div>
    <div class="grid grid-2" style="margin-bottom:28px">
      <!-- Summary by Subject -->
      <div class="card">
        <div class="card-header"><h3>${t('teacher.avg_ratings_by_subject')}</h3></div>
        <div class="card-body">
          ${Object.keys(bySubject).length === 0
            ? `<div class="empty-state"><p>${t('teacher.no_reviews_yet')}</p></div>`
            : Object.keys(bySubject).map(key => {
              const s = bySubject[key];
              return `
                <div style="padding:16px;border:1px solid var(--gray-200);border-radius:var(--radius-md);margin-bottom:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                    <div>
                      <div style="font-weight:600;font-size:1.05rem">${s.subject}</div>
                      <div style="color:var(--gray-500);font-size:0.85rem">${s.grade} &middot; ${s.count} review${s.count !== 1 ? 's' : ''}</div>
                    </div>
                    ${starsHTML(parseFloat(s.avg_overall))}
                  </div>
                  <div class="feedback-rating-grid">
                    ${CRITERIA_CONFIG.map(c => `<div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t(c.label_key)}${criteriaInfoIcon(c.info_key)}</span><span style="font-weight:600;color:${scoreColor(s[`avg_${c.slug}`])};display:flex;align-items:center;gap:8px">${s[`avg_${c.slug}`]} ${starsHTML(parseFloat(s[`avg_${c.slug}`]))}</span></div>`).join('')}
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>

      <!-- Overall Summary -->
      <div class="card">
        <div class="card-header"><h3>${t('teacher.overall_performance')}</h3></div>
        <div class="card-body">
          <div style="text-align:center;padding:20px 0">
            <div style="font-size:3rem;font-weight:700;color:${data.overall_scores.review_count > 0 ? scoreColor(data.overall_scores.avg_overall || 0) : 'var(--gray-300)'};margin-bottom:16px">
              ${data.overall_scores.review_count > 0 ? fmtScore(data.overall_scores.avg_overall) : '0.00'}
            </div>
            ${starsHTML(data.overall_scores.avg_overall || 0, 'large')}
            <div style="color:var(--gray-500);margin-top:16px;font-size:1rem">${t('teacher.total_reviews', {count: data.overall_scores.review_count})}</div>
            ${data.overall_scores.review_count === 0 ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--gray-400)">${t('teacher.scores_pending')}</div>` : ''}
          </div>
          <div style="margin-top:24px">
            ${CRITERIA_CONFIG.map((c, i) => {
              const key = `avg_${c.slug}`;
              const val = data.overall_scores[key] || 0;
              const hasReviews = data.overall_scores.review_count > 0;
              const border = i < CRITERIA_COUNT - 1 ? 'border-bottom:1px solid var(--gray-100)' : '';
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;${border}">
                <span style="display:flex;align-items:center;gap:4px">${t(c.label_key)}${criteriaInfoIcon(c.info_key)}</span>
                <span style="font-weight:600;color:${hasReviews ? scoreColor(val) : 'var(--gray-300)'}">
                  ${hasReviews ? fmtScore(data.overall_scores[key]) : '0.00'} ${starsHTML(hasReviews ? val : 0)}
                </span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Individual Reviews (paginated) -->
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <h3>${t('admin.approved_reviews')}</h3>
        ${data.completion_rates && data.completion_rates.length > 0 ? `<button class="btn btn-sm btn-outline" onclick="showCompletionRatesModal()">📊 ${t('teacher.completion_rates_btn')}</button>` : ''}
      </div>
      <div class="card-body" id="teacherReviewsList">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </div>
  `;
  // Load first page of approved reviews
  window._teacherReviewPage = 1;
  window._teacherReviewsLoading = false;
  loadTeacherReviewsPage(1, true);
}

function renderTeacherReviewCard(r) {
  const tags = JSON.parse(r.tags || '[]');
  const avg = criteriaAverage(r);
  const colorVal = avg !== null ? avg : (r.overall_rating || 0);
  return `<div class="review-card">
    <div class="review-header">
      <div>
        <span style="color:var(--gray-500);font-size:0.85rem">${r.classroom_subject} (${r.grade_level}) &middot; ${r.period_name}</span>
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
          <span style="font-size:1.3rem;font-weight:700;color:${scoreColor(colorVal)}">${fmtRatingFloat(avg)}</span>
          ${starsHTML(avg !== null ? avg : 0, 'large')}
        </div>
      </div>
      <span style="font-size:0.78rem;color:var(--gray-400)">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
    </div>
    <details class="criteria-collapse">
      <summary>
        <span>${t('student.criteria_breakdown')}</span>
        <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </summary>
      ${ratingGridHTML(r)}
    </details>
    ${r.feedback_text
      ? `<div class="review-text">${r.feedback_text}</div>`
      : `<div class="review-text review-text-empty">${t('review.no_written_feedback')}</div>`}
    ${tags.length > 0 ? `<div class="review-tags">${tags.map(tag => `<span class="tag">${translateTag(tag)}</span>`).join('')}</div>` : ''}
  </div>`;
}

async function loadTeacherReviewsPage(page, reset = false) {
  if (window._teacherReviewsLoading) return;
  window._teacherReviewsLoading = true;
  const container = document.getElementById('teacherReviewsList');
  if (!container) return;
  try {
    const result = await API.get(`/dashboard/teacher/reviews?page=${page}&limit=50`);
    if (reset) container.innerHTML = '';
    // Remove old load-more button
    const old = document.getElementById('loadMoreReviewsBtn');
    if (old) old.remove();

    if (result.reviews.length === 0 && page === 1) {
      container.innerHTML = `<div class="empty-state"><h3>${t('teacher.no_approved_reviews')}</h3><p>${t('teacher.approved_reviews_hint')}</p></div>`;
    } else {
      const frag = document.createDocumentFragment();
      result.reviews.forEach(r => {
        const div = document.createElement('div');
        div.innerHTML = renderTeacherReviewCard(r);
        frag.appendChild(div.firstElementChild);
      });
      container.appendChild(frag);

      if (page < result.pages) {
        const btn = document.createElement('div');
        btn.id = 'loadMoreReviewsBtn';
        btn.style.textAlign = 'center';
        btn.style.padding = '16px 0';
        btn.innerHTML = `<button class="btn btn-outline" onclick="loadTeacherReviewsPage(${page + 1})">${t('teacher.load_more', {remaining: result.total - page * 50})}</button>`;
        container.appendChild(btn);
      } else if (result.total > 0) {
        const note = document.createElement('p');
        note.style.cssText = 'text-align:center;color:var(--gray-400);font-size:0.82rem;padding:12px 0';
        note.textContent = t('teacher.all_loaded', {total: result.total});
        container.appendChild(note);
      }
    }
    window._teacherReviewPage = page;
  } catch (err) {
    if (container) container.innerHTML += `<p style="color:var(--danger)">${err.message}</p>`;
  } finally {
    window._teacherReviewsLoading = false;
  }
}

function showCompletionRatesModal() {
  const rates = window._teacherCompletionRates || [];
  openModal(`
    <div class="modal-header"><h3>${t('teacher.completion_rates_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${rates.length === 0 ? `<p style="color:var(--gray-500)">${t('teacher.no_data_available')}</p>` : rates.map(c => `
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="font-weight:500">${c.subject} (${c.grade_level})</span>
            <span style="font-weight:600;color:${c.rate >= 70 ? 'var(--success)' : c.rate >= 40 ? 'var(--warning)' : 'var(--danger)'}">${c.submitted}/${c.total} (${c.rate}%)</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${c.rate >= 70 ? 'green' : c.rate >= 40 ? 'yellow' : 'red'}" style="width:${c.rate}%"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">${t('common.close')}</button></div>
  `);
}

async function renderTeacherMentorFeedback() {
  const data = await cachedGet('/dashboard/teacher');
  const el = document.getElementById('contentArea');
  const reviews = (data.recent_reviews || []).filter(r => r.review_kind === 'mentor' && r.approved_status === 1);

  // Aggregate across all mentor reviews — powers the "Overall Performance"
  // card. Same shape as the academic Overall Performance card in the
  // Teacher Feedback tab, just with the 5 mentor criteria.
  const n = reviews.length;
  const overallAvg = n ? reviews.reduce((s, r) => s + (r.overall_rating || 0), 0) / n : 0;
  const overallPerCriterion = {};
  MENTOR_CRITERIA_CONFIG.forEach(c => {
    const vals = reviews.map(r => r[c.db_col]).filter(v => v != null && v > 0);
    overallPerCriterion[c.slug] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });

  // Per-mentor-group breakdown (same as before, sits below Overall Performance).
  const byGroup = {};
  reviews.forEach(r => {
    const key = `${r.classroom_subject} (${r.grade_level})`;
    if (!byGroup[key]) byGroup[key] = { reviews: [], subject: r.classroom_subject, grade: r.grade_level };
    byGroup[key].reviews.push(r);
  });

  Object.keys(byGroup).forEach(key => {
    const rs = byGroup[key].reviews;
    byGroup[key].count = rs.length;
    byGroup[key].avg_overall = (rs.reduce((s, r) => s + r.overall_rating, 0) / rs.length).toFixed(2);
    MENTOR_CRITERIA_CONFIG.forEach(c => {
      byGroup[key][`avg_${c.slug}`] = (rs.reduce((s, r) => s + (r[c.db_col] || 0), 0) / rs.length).toFixed(2);
    });
  });

  el.innerHTML = `
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><h3>${t('teacher.overall_performance')}</h3></div>
      <div class="card-body">
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:3rem;font-weight:700;color:${n > 0 ? scoreColor(overallAvg) : 'var(--gray-300)'};margin-bottom:16px">
            ${n > 0 ? fmtScore(overallAvg) : '0.00'}
          </div>
          ${starsHTML(overallAvg, 'large')}
          <div style="color:var(--gray-500);margin-top:16px;font-size:1rem">${n} mentor review${n !== 1 ? 's' : ''}</div>
          ${n === 0 ? `<div style="margin-top:8px;font-size:0.8rem;color:var(--gray-400)">No mentor feedback yet — mentees will rate you when a feedback period is active.</div>` : ''}
        </div>
        <div style="margin-top:24px">
          ${MENTOR_CRITERIA_CONFIG.map((c, i) => {
            const val = overallPerCriterion[c.slug];
            const border = i < MENTOR_CRITERIA_CONFIG.length - 1 ? 'border-bottom:1px solid var(--gray-100)' : '';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;${border}">
              <span style="display:flex;align-items:center;gap:4px">${escapeHtml(c.label)}${criteriaInfoIcon(c.info_key)}</span>
              <span style="font-weight:600;color:${n > 0 ? scoreColor(val) : 'var(--gray-300)'}">
                ${n > 0 ? fmtScore(val) : '0.00'} ${starsHTML(n > 0 ? val : 0)}
              </span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    ${reviews.length === 0
      ? `<div class="card"><div class="card-body"><div class="empty-state">
          <h3 style="color:var(--gray-500)">No mentor feedback yet</h3>
          <p style="color:var(--gray-400);font-size:0.88rem">Mentees will be able to leave feedback once a feedback period is active for your mentor group.</p>
        </div></div></div>`
      : Object.entries(byGroup).map(([key, g]) => `
          <div class="card" style="margin-bottom:18px">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <h3>${escapeHtml(g.subject)} <span style="font-weight:400;color:var(--gray-500);font-size:0.85rem">${escapeHtml(g.grade)}</span></h3>
              <span style="font-size:0.85rem">Overall <strong style="color:${scoreColor(parseFloat(g.avg_overall))};font-size:1rem">${g.avg_overall}</strong> · ${g.count} review${g.count !== 1 ? 's' : ''}</span>
            </div>
            <div class="card-body">
              <div class="grid grid-2" style="gap:10px;margin-bottom:18px">
                ${MENTOR_CRITERIA_CONFIG.map(c => {
                  const v = parseFloat(g[`avg_${c.slug}`]);
                  return `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--gray-50);border-radius:8px">
                    <span style="font-size:0.86rem;display:inline-flex;align-items:center;gap:4px">${escapeHtml(c.label)}${criteriaInfoIcon(c.info_key)}</span>
                    <strong style="color:${scoreColor(v)}">${g[`avg_${c.slug}`]}</strong>
                  </div>`;
                }).join('')}
              </div>
              ${g.reviews.filter(r => r.feedback_text).slice(0, 5).map(r => `
                <div class="review-text" style="margin-bottom:10px">${escapeHtml(r.feedback_text)}</div>
              `).join('')}
            </div>
          </div>
        `).join('')}
  `;
}

async function renderTeacherAnalytics() {
  const data = await cachedGet('/dashboard/teacher');
  const el = document.getElementById('contentArea');

  const periods = data.trend?.periods || [];
  const trendLabel = data.trend?.trend || 'stable';
  const trendMeta = {
    improving: { color: '#16a34a', bg: '#dcfce7', icon: '↑', text: t('analytics.improving') },
    declining:  { color: '#dc2626', bg: '#fee2e2', icon: '↓', text: t('analytics.declining') },
    stable:     { color: '#6b7280', bg: '#f3f4f6', icon: '→', text: t('analytics.stable') }
  }[trendLabel];

  // Per-period delta rows
  const periodRows = periods.map((p, i) => {
    const prev = periods[i - 1];
    const hasScore = p.score !== null && p.score !== undefined;
    const delta = (prev && hasScore && prev.score !== null) ? (p.score - prev.score) : null;
    const deltaHtml = delta === null ? '<span style="color:var(--gray-400)">—</span>'
      : delta > 0 ? `<span style="color:#16a34a;font-weight:600">+${delta.toFixed(2)} ↑</span>`
      : delta < 0 ? `<span style="color:#dc2626;font-weight:600">${delta.toFixed(2)} ↓</span>`
      : `<span style="color:var(--gray-500)">0.00 →</span>`;
    return `<tr>
      <td>${p.name || 'Period ' + (i+1)}</td>
      <td style="font-weight:600;color:${hasScore ? scoreColor(p.score) : 'var(--gray-400)'}">${hasScore ? p.score.toFixed(2) : '—'}</td>
      <td>${p.review_count || 0}</td>
      <td>${deltaHtml}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="padding:10px 16px;background:var(--primary-light);border-left:4px solid var(--primary);border-radius:8px;font-size:0.92rem">
        <strong>${t('teacher.current_term')}</strong> ${data.active_term?.name || t('teacher.no_active_term_label')}
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;background:${trendMeta.bg};border-radius:20px">
        <span style="font-size:1.1rem;font-weight:700;color:${trendMeta.color}">${trendMeta.icon}</span>
        <span style="font-weight:600;color:${trendMeta.color}">${trendMeta.text}</span>
        <span style="color:var(--gray-500);font-size:0.82rem">this term</span>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <div class="card-header"><h3>${t('analytics.category_breakdown')}</h3></div>
        <div class="card-body">
          ${data.overall_scores.review_count > 0
            ? '<div class="chart-container"><canvas id="radarChart"></canvas></div>'
            : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;text-align:center;color:var(--gray-400)"><p style="font-weight:500;margin-bottom:4px">${t('teacher.no_data_yet')}</p><p style="font-size:0.82rem">${t('teacher.no_data_hint')}</p></div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('analytics.score_trend')}</h3></div>
        <div class="card-body">
          ${periods.length > 0
            ? '<div class="chart-container"><canvas id="trendChart"></canvas></div>'
            : `<div class="empty-state" style="padding:32px 0"><p style="color:var(--gray-400)">${t('analytics.no_periods')}</p></div>`}
        </div>
      </div>
    </div>

    ${periods.length > 0 ? `
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><h3>${t('analytics.period_progress')}</h3></div>
      <div class="card-body" style="padding:0">
        <table>
          <thead>
            <tr>
              <th>${t('analytics.feedback_period')}</th>
              <th>${t('analytics.avg_score')}</th>
              <th>${t('common.reviews')}</th>
              <th>${t('analytics.change_vs_prev')}</th>
            </tr>
          </thead>
          <tbody>${periodRows}</tbody>
        </table>
      </div>
    </div>
    ` : ''}
  `;

  // Trend chart
  if (periods.length > 0) {
    const ctx = document.getElementById('trendChart');
    if (ctx) {
      const pointColors = periods.map((p, i) => {
        if (i === 0 || p.score === null) return '#059669';
        return p.score > (periods[i-1].score || 0) ? '#16a34a' : p.score < (periods[i-1].score || 0) ? '#dc2626' : '#6b7280';
      });
      chartInstances.trend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: periods.map(p => p.name),
          datasets: [{
            label: t('chart.score'),
            data: periods.map(p => p.score),
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 7,
            pointBackgroundColor: pointColors,
            pointBorderColor: '#fff',
            pointBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { min: 0, max: 5, ticks: { stepSize: 1 } }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  const p = periods[ctx.dataIndex];
                  return `Reviews: ${p.review_count || 0}`;
                }
              }
            }
          }
        }
      });
    }
  }

  // Radar chart
  const s = data.overall_scores;
  if (s.review_count > 0) {
    const ctx2 = document.getElementById('radarChart');
    if (ctx2) {
      chartInstances.radar = new Chart(ctx2, {
        type: 'radar',
        data: {
          labels: CRITERIA_CONFIG.map(c => t(c.label_key)),
          datasets: [{
            label: t('teacher.your_scores'),
            data: CRITERIA_CONFIG.map(c => s[`avg_${c.slug}`]),
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.15)',
            pointBackgroundColor: '#059669'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { r: { min: 0, max: 5, ticks: { stepSize: 1 } } }
        }
      });
    }
  }
}

// ============ STUDENT ANNOUNCEMENTS (separate view) ============
async function renderStudentAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading')}</p></div>`;
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium).catch(() => []);
    el.innerHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('student-comms')">${t('common.back')}</button>
      </div>
      <h2 style="margin-bottom:16px">${t('nav.announcements')}</h2>
      ${announcements.length === 0
        ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>' + t('ann.no_announcements') + '</h3><p>' + t('ann.no_announcements_student') + '</p></div></div></div>'
        : announcements.map(a => announcementCardHTML(a, false, true)).join('')}
    `;
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><h3>' + t('common.error') + '</h3><p>' + err.message + '</p></div>';
  }
}

// ============ TEACHER FORMS ============
async function renderTeacherForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading')}</p></div>`;
  try {
    const [forms, classrooms] = await Promise.all([
      cachedGet('/forms', CACHE_TTL.medium),
      cachedGet('/classrooms', CACHE_TTL.medium)
    ]);

    const statusBadge = s => {
      const map = { draft: ['#6b7280', t('forms.status_draft')], active: ['#16a34a', t('forms.status_active')], closed: ['#9ca3af', t('forms.status_closed')] };
      const [color, label] = map[s] || ['#6b7280', s];
      return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600">${label}</span>`;
    };

    el.innerHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('teacher-comms')">${t('common.back')}</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <h2 style="margin:0">${t('forms.my_forms')}</h2>
        <button class="btn btn-primary" onclick="showCreateFormModal()">${t('forms.new_form')}</button>
      </div>

      ${forms.length === 0 ? `
        <div class="card"><div class="card-body">
          <div class="empty-state">
            <h3>${t('forms.no_forms')}</h3>
            <p>${t('forms.no_forms_msg')}</p>
            <button class="btn btn-primary" style="margin-top:12px" onclick="showCreateFormModal()">${t('forms.create_first')}</button>
          </div>
        </div></div>
      ` : `
        <div class="grid grid-3" style="gap:16px">
          ${forms.map(f => `
            <div class="card" style="display:flex;flex-direction:column">
              <div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div>
                  <h3 style="margin:0 0 4px">${f.title}</h3>
                  <span style="font-size:0.8rem;color:var(--gray-500)">${f.classroom_label || '—'}</span>
                </div>
                ${statusBadge(f.status)}
              </div>
              <div class="card-body" style="flex:1">
                ${f.description ? `<p style="color:var(--gray-600);font-size:0.85rem;margin-bottom:12px">${f.description}</p>` : ''}
                <div style="display:flex;gap:16px;font-size:0.82rem;color:var(--gray-500);flex-wrap:wrap">
                  <span>📋 ${f.question_count} question${f.question_count !== 1 ? 's' : ''}</span>
                  <span>💬 ${f.response_count} response${f.response_count !== 1 ? 's' : ''}</span>
                  ${f.deadline ? `<span style="color:${new Date(f.deadline) < new Date() ? 'var(--danger)' : 'var(--warning)'}">⏰ ${new Date(f.deadline) < new Date() ? t('forms.expired') : t('forms.deadline')}: ${new Date(f.deadline).toLocaleDateString()}</span>` : ''}
                </div>
              </div>
              <div class="card-footer" style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px">
                ${f.status === 'draft' ? `<button class="btn btn-sm btn-outline" onclick="openFormBuilder(${f.id})">${t('forms.edit_questions')}</button>` : ''}
                ${f.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="setFormStatus(${f.id},'active')">${t('forms.activate')}</button>` : ''}
                ${f.status === 'active' ? `<button class="btn btn-sm btn-outline" onclick="setFormStatus(${f.id},'closed')">${t('forms.close_btn')}</button>` : ''}
                ${f.response_count > 0 || f.status !== 'draft' ? `<button class="btn btn-sm btn-outline" onclick="openFormResults(${f.id})">${t('forms.results')}</button>` : ''}
                ${f.status !== 'active' ? `<button class="btn btn-sm btn-danger" onclick="deleteForm(${f.id},'${f.title.replace(/'/g, "\\'")}')">${t('common.delete')}</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `}

      <!-- Hidden classroom list for modal -->
      <div id="teacherClassroomList" style="display:none">${JSON.stringify(classrooms)}</div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

function showCreateFormModal() {
  const classroomsEl = document.getElementById('teacherClassroomList');
  const classrooms = classroomsEl ? JSON.parse(classroomsEl.textContent) : [];
  openModal(`
    <div class="modal-header"><h3>${t('forms.new_form_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('forms.title_label')}</label>
        <input type="text" class="form-control" id="newFormTitle" placeholder="${t('forms.title_placeholder')}">
      </div>
      <div class="form-group">
        <label>${t('forms.desc_label')} <span style="color:var(--gray-400);font-weight:400">${t('forms.optional')}</span></label>
        <textarea class="form-control" id="newFormDesc" rows="2" placeholder="${t('forms.desc_placeholder')}"></textarea>
      </div>
      <div class="form-group">
        <label>${t('forms.classroom_label')}</label>
        <select class="form-control" id="newFormClassroom">
          <option value="">${t('forms.select_classroom')}</option>
          ${classrooms.map(c => `<option value="${c.id}">${c.subject} &middot; ${c.grade_level}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>${t('forms.deadline_label')} <span style="color:var(--gray-400);font-weight:400">${t('forms.deadline_hint')}</span></label>
        <input type="datetime-local" class="form-control" id="newFormDeadline">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createForm()">${t('forms.create_btn')}</button>
    </div>
  `);
  setTimeout(() => document.getElementById('newFormTitle')?.focus(), 50);
}

async function createForm() {
  const title = document.getElementById('newFormTitle').value.trim();
  const description = document.getElementById('newFormDesc').value.trim();
  const classroom_id = document.getElementById('newFormClassroom').value;
  const deadline = document.getElementById('newFormDeadline')?.value || null;
  if (!title) return toast(t('admin.fill_required'), 'error');
  if (!classroom_id) return toast(t('forms.select_classroom'), 'error');
  try {
    await API.post('/forms', { title, description, classroom_id: parseInt(classroom_id), deadline: deadline || undefined });
    closeModal();
    toast(t('forms.created_msg'));
    await renderTeacherForms();
    // Open builder for the newly created form — get the first draft
    const forms = await cachedGet('/forms', CACHE_TTL.medium);
    const newest = forms.find(f => f.title === title && f.status === 'draft');
    if (newest) openFormBuilder(newest.id);
  } catch (err) { toast(err.message, 'error'); }
}

async function openFormBuilder(formId) {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading_builder')}</p></div>`;
  try {
    const form = await API.get(`/forms/${formId}`);
    const statusBadgeColor = { draft: '#6b7280', active: '#16a34a', closed: '#9ca3af' };

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo(currentUser.role === 'teacher' ? 'teacher-forms' : 'admin-forms')">${t('forms.back_to_forms')}</button>
        <div style="flex:1">
          <h2 style="margin:0">${form.title}</h2>
          <span style="font-size:0.82rem;color:var(--gray-500)">${form.classrooms && form.classrooms.length > 1 ? form.classrooms.map(c => c.subject + ' ' + c.grade_level).join(', ') : (form.classroom_subject + ' · ' + form.grade_level)}</span>
        </div>
        <span style="background:${statusBadgeColor[form.status]};color:#fff;padding:3px 12px;border-radius:12px;font-size:0.8rem;font-weight:600">${form.status}</span>
      </div>

      ${form.status !== 'draft' ? `
        <div class="card" style="margin-bottom:16px;border-left:4px solid #f59e0b">
          <div class="card-body" style="padding:12px 16px;font-size:0.85rem;color:var(--gray-600)">
            ${t('forms.edit_warning', {status: form.status})}
          </div>
        </div>
      ` : ''}

      <div id="formQuestionsList">
        ${renderFormQuestionsList(form.questions, form.status)}
      </div>

      ${form.status === 'draft' ? `
        <div class="card" style="margin-top:16px;border:2px dashed var(--gray-200)">
          <div class="card-body" style="text-align:center;padding:24px">
            <p style="color:var(--gray-500);margin-bottom:16px">${t('forms.add_question_prompt')}</p>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
              <button class="btn btn-outline" onclick="showAddQuestionModal(${formId},'text')">${t('forms.text_type')}</button>
              <button class="btn btn-outline" onclick="showAddQuestionModal(${formId},'multiple_choice')">${t('forms.mc_type')}</button>
              <button class="btn btn-outline" onclick="showAddQuestionModal(${formId},'yes_no')">${t('forms.yn_type')}</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

function renderFormQuestionsList(questions, formStatus) {
  if (questions.length === 0) {
    return `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('forms.no_questions')}</h3><p>${t('forms.no_questions_hint')}</p></div></div></div>`;
  }
  return questions.map((q, idx) => `
    <div class="card" style="margin-bottom:10px">
      <div class="card-body" style="display:flex;align-items:flex-start;gap:12px">
        <span style="background:var(--gray-100);color:var(--gray-500);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;flex-shrink:0">${idx + 1}</span>
        <div style="flex:1">
          <div style="font-weight:600;margin-bottom:4px">${q.question_text} ${q.required ? `<span style="color:#ef4444;font-size:0.75rem">${t('forms.required')}</span>` : ''}</div>
          <div style="font-size:0.78rem;color:var(--gray-400)">
            ${q.question_type === 'text' ? t('forms.text_type') : q.question_type === 'yes_no' ? t('forms.yn_type') : '&#9673; ' + (q.options || []).join(' &middot; ')}
          </div>
        </div>
        ${formStatus === 'draft' ? `
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm btn-outline" onclick="showEditQuestionModal(${q.form_id},${q.id})">${t('common.edit')}</button>
            <button class="btn btn-sm btn-danger" onclick="deleteFormQuestion(${q.form_id},${q.id})">✕</button>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function showAddQuestionModal(formId, questionType) {
  const typeLabel = { text: t('forms.text_type'), multiple_choice: t('forms.mc_type'), yes_no: t('forms.yn_type') };
  const optionsHTML = questionType === 'multiple_choice' ? `
    <div class="form-group">
      <label>${t('forms.options_label')} <span style="color:var(--gray-400);font-weight:400">${t('forms.options_min_hint')}</span></label>
      <div id="mcOptions">
        <div class="mc-option-row" style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" class="form-control mc-option-input" placeholder="${t('forms.option_placeholder', {n: 1})}" style="flex:1">
          <button type="button" class="btn btn-sm btn-outline" onclick="removeMcOption(this)" style="flex-shrink:0">✕</button>
        </div>
        <div class="mc-option-row" style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" class="form-control mc-option-input" placeholder="${t('forms.option_placeholder', {n: 2})}" style="flex:1">
          <button type="button" class="btn btn-sm btn-outline" onclick="removeMcOption(this)" style="flex-shrink:0">✕</button>
        </div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" style="margin-top:4px" onclick="addMcOption()">${t('forms.add_option')}</button>
    </div>
  ` : '';
  openModal(`
    <div class="modal-header"><h3>${typeLabel[questionType]}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('forms.question_label')}</label>
        <input type="text" class="form-control" id="newQText" placeholder="${t('forms.question_placeholder')}">
      </div>
      ${optionsHTML}
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="newQRequired" checked style="width:16px;height:16px">
        <label for="newQRequired" style="margin:0;cursor:pointer">${t('forms.required_checkbox')}</label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="addFormQuestion(${formId},'${questionType}')">${t('forms.add_question')}</button>
    </div>
  `);
  setTimeout(() => document.getElementById('newQText')?.focus(), 50);
}

function addMcOption() {
  const container = document.getElementById('mcOptions');
  const idx = container.querySelectorAll('.mc-option-row').length + 1;
  const row = document.createElement('div');
  row.className = 'mc-option-row';
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  row.innerHTML = `<input type="text" class="form-control mc-option-input" placeholder="${t('forms.option_placeholder', {n: idx})}" style="flex:1"><button type="button" class="btn btn-sm btn-outline" onclick="removeMcOption(this)" style="flex-shrink:0">✕</button>`;
  container.appendChild(row);
}
function removeMcOption(btn) {
  const container = document.getElementById('mcOptions');
  if (container.querySelectorAll('.mc-option-row').length <= 2) return toast(t('forms.need_2_options'), 'error');
  btn.closest('.mc-option-row').remove();
}

async function addFormQuestion(formId, questionType) {
  const question_text = document.getElementById('newQText').value.trim();
  const required = document.getElementById('newQRequired').checked;
  if (!question_text) return toast(t('forms.question_required'), 'error');
  let options;
  if (questionType === 'multiple_choice') {
    options = [...document.querySelectorAll('.mc-option-input')].map(i => i.value.trim()).filter(Boolean);
    if (options.length < 2) return toast(t('forms.options_required'), 'error');
  }
  try {
    await API.post(`/forms/${formId}/questions`, { question_text, question_type: questionType, options, required });
    closeModal();
    toast(t('forms.question_added'));
    openFormBuilder(formId);
  } catch (err) { toast(err.message, 'error'); }
}

async function showEditQuestionModal(formId, questionId) {
  try {
    const form = await API.get(`/forms/${formId}`);
    const q = form.questions.find(q => q.id === questionId);
    if (!q) return toast(t('forms.question_not_found'), 'error');
    const optionsHTML = q.question_type === 'multiple_choice' ? `
      <div class="form-group">
        <label>${t('forms.options_label')}</label>
        <div id="mcOptions">
          ${(q.options || []).map((opt, i) => `
            <div class="mc-option-row" style="display:flex;gap:6px;margin-bottom:6px">
              <input type="text" class="form-control mc-option-input" value="${opt}" placeholder="${t('forms.option_placeholder', {n: i+1})}" style="flex:1">
              <button type="button" class="btn btn-sm btn-outline" onclick="removeMcOption(this)" style="flex-shrink:0">✕</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="margin-top:4px" onclick="addMcOption()">${t('forms.add_option')}</button>
      </div>
    ` : '';
    openModal(`
      <div class="modal-header"><h3>${t('forms.edit_question')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="form-group">
          <label>${t('forms.question_label')}</label>
          <input type="text" class="form-control" id="editQText" value="${q.question_text.replace(/"/g, '&quot;')}">
        </div>
        ${optionsHTML}
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="editQRequired" ${q.required ? 'checked' : ''} style="width:16px;height:16px">
          <label for="editQRequired" style="margin:0;cursor:pointer">${t('forms.required_checkbox')}</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
        <button class="btn btn-primary" onclick="saveEditQuestion(${formId},${questionId},'${q.question_type}')">${t('common.save_short')}</button>
      </div>
    `);
  } catch (err) { toast(err.message, 'error'); }
}

async function saveEditQuestion(formId, questionId, questionType) {
  const question_text = document.getElementById('editQText').value.trim();
  const required = document.getElementById('editQRequired').checked;
  if (!question_text) return toast(t('forms.question_required'), 'error');
  let options;
  if (questionType === 'multiple_choice') {
    options = [...document.querySelectorAll('.mc-option-input')].map(i => i.value.trim()).filter(Boolean);
    if (options.length < 2) return toast(t('forms.need_2_options'), 'error');
  }
  try {
    await API.put(`/forms/${formId}/questions/${questionId}`, { question_text, options, required });
    closeModal();
    toast(t('forms.question_updated'));
    openFormBuilder(formId);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteFormQuestion(formId, questionId) {
  const confirmed = await confirmDialog(t('forms.delete_question_confirm'), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/forms/${formId}/questions/${questionId}`);
    toast(t('forms.question_deleted'));
    openFormBuilder(formId);
  } catch (err) { toast(err.message, 'error'); }
}

async function setFormStatus(formId, status) {
  const confirmed = await confirmDialog(status === 'active' ? t('forms.confirm_activate') : t('forms.confirm_close'), t('common.confirm'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.patch(`/forms/${formId}`, { status });
    toast(status === 'active' ? t('forms.form_activated') : t('forms.form_closed'));
    renderTeacherForms();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteForm(formId, title) {
  const confirmed = await confirmDialog(t('forms.delete_form_confirm', {title}), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/forms/${formId}`);
    toast(t('forms.form_deleted'));
    renderTeacherForms();
  } catch (err) { toast(err.message, 'error'); }
}

async function openFormResults(formId) {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading_results')}</p></div>`;
  try {
    const data = await API.get(`/forms/${formId}/results`);
    const { form, total_responses, results } = data;

    const renderResult = r => {
      if (r.question_type === 'text') {
        return `
          <div class="card" style="margin-bottom:12px">
            <div class="card-header"><strong>${r.question_text}</strong> <span style="color:var(--gray-400);font-size:0.8rem">(${r.total_answers} response${r.total_answers !== 1 ? 's' : ''})</span></div>
            <div class="card-body">
              ${r.answers.length === 0
                ? `<p style="color:var(--gray-400);font-style:italic">${t('forms.no_text_answers')}</p>`
                : r.answers.map(a => `<div style="padding:8px 12px;background:var(--gray-50);border-radius:8px;margin-bottom:6px;font-size:0.88rem">"${a}"</div>`).join('')}
            </div>
          </div>`;
      }
      const entries = Object.entries(r.counts);
      const total = entries.reduce((s, [, c]) => s + c, 0) || 1;
      return `
        <div class="card" style="margin-bottom:12px">
          <div class="card-header"><strong>${r.question_text}</strong> <span style="color:var(--gray-400);font-size:0.8rem">(${r.total_answers} response${r.total_answers !== 1 ? 's' : ''})</span></div>
          <div class="card-body">
            ${entries.map(([label, count]) => {
              const pct = Math.round((count / total) * 100);
              const barColor = label === 'Yes' ? '#16a34a' : label === 'No' ? '#ef4444' : '#059669';
              return `
                <div style="margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:0.88rem">
                    <span>${label}</span>
                    <span style="font-weight:600">${count} <span style="color:var(--gray-400)">(${pct}%)</span></span>
                  </div>
                  <div style="background:var(--gray-100);border-radius:4px;height:10px;overflow:hidden">
                    <div style="width:${pct}%;background:${barColor};height:100%;border-radius:4px;transition:width 0.5s"></div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    };

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo(currentUser.role === 'teacher' ? 'teacher-forms' : 'admin-forms')">${t('forms.back_to_forms')}</button>
        <div style="flex:1">
          <h2 style="margin:0">${t('forms.results_title', {count: total_responses})}</h2>
          <span style="font-size:0.82rem;color:var(--gray-500)">${t('forms.results_responses', {count: total_responses, s: total_responses !== 1 ? 's' : ''})}</span>
        </div>
      </div>
      ${results.length === 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('forms.no_questions_results')}</h3></div></div></div>`
        : results.map(renderResult).join('')}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

// ============ SCHOOL HEAD VIEWS ============
async function renderHeadHome() {
  const [data, stats] = await Promise.all([
    cachedGet('/dashboard/school-head'),
    cachedGet('/admin/stats')
  ]);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card"><div class="stat-label">${t('head.teachers')}</div><div class="stat-value">${stats.total_teachers}</div></div>
      <div class="stat-card"><div class="stat-label">${t('head.students')}</div><div class="stat-value">${stats.total_students}</div></div>
      <div class="stat-card"><div class="stat-label">${t('head.classrooms')}</div><div class="stat-value">${stats.total_classrooms}</div></div>
      <div class="stat-card"><div class="stat-label">${t('head.avg_rating')}</div><div class="stat-value" style="color:${scoreColor(stats.average_rating || 0)}">${fmtScore(stats.average_rating)}</div></div>
    </div>

    <div class="grid grid-2" style="margin-bottom:28px">
      <div class="card">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <h3>${t('head.teacher_rankings')}</h3>
          <span style="font-size:0.78rem;color:var(--gray-500)">Top 5 of ${data.teachers.length}</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column">
          <table>
            <thead><tr><th style="width:48px">#</th><th>${t('common.teacher')}</th><th>${t('common.department')}</th><th>${t('chart.score')}</th><th>${t('common.reviews')}</th><th>${t('common.trend')}</th></tr></thead>
            <tbody>
              ${data.teachers
                .sort((a, b) => (b.scores.avg_overall || 0) - (a.scores.avg_overall || 0))
                .slice(0, 5)
                .map((tchr, i) => `
                <tr>
                  <td style="font-weight:600;text-align:center">${rankBadge(i)}</td>
                  <td><strong>${tchr.full_name}</strong></td>
                  <td>${tchr.department || '-'}</td>
                  <td style="font-weight:600;color:${scoreColor(tchr.scores.avg_overall || 0)}">${fmtScore(tchr.scores.avg_overall)}</td>
                  <td>${tchr.scores.review_count}</td>
                  <td>${tchr.trend ? trendArrow(tchr.trend.trend) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${data.teachers.length > 5 ? `<div style="margin-top:12px;text-align:center"><button class="btn btn-sm btn-outline" onclick="navigateTo('head-teachers')">Show more →</button></div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('head.dept_comparison')}</h3></div>
        <div class="card-body"><canvas id="deptChart"></canvas></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:28px">
      <div class="card">
        <div class="card-header"><h3>${t('head.users_breakdown')}</h3></div>
        <div class="card-body" style="display:flex;justify-content:center;align-items:center;min-height:280px">
          <canvas id="headUsersChart"></canvas>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('head.reviews_by_rating')}</h3></div>
        <div class="card-body" style="display:flex;justify-content:center;align-items:center;min-height:280px">
          <canvas id="headReviewsChart"></canvas>
        </div>
      </div>
    </div>
  `;

  // Department chart
  const deptLabels = Object.keys(data.departments);
  if (deptLabels.length > 0) {
    chartInstances.dept = new Chart(document.getElementById('deptChart'), {
      type: 'bar',
      data: {
        labels: deptLabels,
        datasets: [{
          label: t('analytics.avg_score'),
          data: deptLabels.map(d => data.departments[d].avg_score),
          backgroundColor: deptLabels.map((_, i) => ['#059669', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 5 } }
      }
    });
  }

  // Users breakdown doughnut chart
  const headUsersCtx = document.getElementById('headUsersChart');
  if (headUsersCtx) {
    chartInstances.headUsers = new Chart(headUsersCtx, {
      type: 'doughnut',
      data: {
        labels: [t('chart.students_label'), t('chart.teachers_label'), t('chart.school_heads_label'), t('chart.admins_label')],
        datasets: [{
          data: [stats.total_students, stats.total_teachers, stats.total_school_heads || 0, stats.total_admins || 0],
          backgroundColor: ['#059669', '#10b981', '#f59e0b', '#8b5cf6'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } }
        }
      }
    });
  }

  // Reviews by rating bar chart
  const hrd = stats.rating_distribution || {};
  const headReviewsCtx = document.getElementById('headReviewsChart');
  if (headReviewsCtx) {
    chartInstances.headReviews = new Chart(headReviewsCtx, {
      type: 'bar',
      data: {
        labels: [t('chart.1_star'), t('chart.2_stars'), t('chart.3_stars'), t('chart.4_stars'), t('chart.5_stars')],
        datasets: [{
          label: t('common.reviews'),
          data: [hrd[1] || 0, hrd[2] || 0, hrd[3] || 0, hrd[4] || 0, hrd[5] || 0],
          backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#059669'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } }
      }
    });
  }
}

async function renderHeadTeachers() {
  const data = await cachedGet('/dashboard/school-head');
  const el = document.getElementById('contentArea');
  window._headTeachersAll = data.teachers || [];

  const filter = window._headTeachersFilter || 'all';
  const visible = filter === 'mentors'
    ? window._headTeachersAll.filter(t => !!t.is_mentor)
    : window._headTeachersAll;

  const sorted = [...visible].sort(
    (a, b) => (b.scores.avg_overall || 0) - (a.scores.avg_overall || 0)
  );

  const rowsHTML = sorted.map((tchr, i) => `
    <tr data-search="${escAttr([tchr.full_name, tchr.subject, tchr.department].filter(Boolean).join(' ').toLowerCase())}">
      <td style="text-align:center;font-weight:600;color:var(--gray-500)">${i + 1}</td>
      <td>
        <strong>${escapeHtml(tchr.full_name)}</strong>
        ${tchr.is_mentor ? '<span style="font-size:0.65rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:0.04em;margin-left:6px;vertical-align:middle">MENTOR</span>' : ''}
      </td>
      <td>${tchr.subject || '<span class="score-empty">N/A</span>'}</td>
      <td>${tchr.department || '<span class="score-empty">N/A</span>'}</td>
      <td style="font-weight:600;color:${scoreColor(tchr.scores.avg_overall || 0)}">${fmtScore(tchr.scores.avg_overall)}</td>
      <td>${tchr.scores.review_count}</td>
      <td>${tchr.trend ? trendArrow(tchr.trend.trend) : '-'}</td>
      <td style="text-align:right;white-space:nowrap">
        ${tchr.is_mentor ? `<button class="btn btn-sm btn-outline" style="font-size:0.78rem;padding:5px 10px" onclick="viewMentorMentees(${tchr.id}, ${jsAttr(tchr.full_name)})">View mentees</button>` : ''}
        <button class="btn btn-sm btn-primary" style="font-size:0.78rem;padding:5px 12px" onclick="viewTeacherFeedback(${tchr.id})">View</button>
        <button class="btn btn-sm btn-outline" style="font-size:0.78rem;padding:5px 10px" onclick="exportTeacherPDF(${tchr.id})" title="${t('admin.export_pdf')}">PDF</button>
      </td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="position:relative;flex:1;min-width:240px;max-width:420px">
        <input id="headTeachersSearch" type="search" class="form-control" placeholder="Search by name, subject, or department" oninput="filterHeadTeachers(this.value)" autocomplete="off" style="padding-left:36px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--gray-400);pointer-events:none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <span id="headTeachersCount" style="font-size:0.78rem;color:var(--gray-500)">${visible.length} of ${window._headTeachersAll.length}</span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setHeadTeachersFilter('all')">All</button>
      <button class="btn btn-sm ${filter === 'mentors' ? 'btn-primary' : 'btn-outline'}" onclick="setHeadTeachersFilter('mentors')">Mentors only</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width:48px">#</th>
              <th>${t('common.teacher')}</th>
              <th>${t('common.subject')}</th>
              <th>${t('common.department')}</th>
              <th>${t('chart.score')}</th>
              <th>${t('common.reviews')}</th>
              <th>${t('common.trend')}</th>
              <th style="text-align:right">${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody id="headTeachersBody">
            ${rowsHTML}
            <tr id="headTeachersEmpty" style="display:none"><td colspan="8" style="text-align:center;padding:32px;color:var(--gray-500);font-size:0.9rem">No teachers match that search.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window.setHeadTeachersFilter = function (mode) {
  window._headTeachersFilter = mode;
  renderHeadTeachers();
};

window.filterHeadTeachers = function (raw) {
  const q = (raw || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#headTeachersBody tr[data-search]');
  let visible = 0;
  rows.forEach(row => {
    const hay = row.dataset.search || '';
    const match = !q || hay.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const empty = document.getElementById('headTeachersEmpty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
  const counter = document.getElementById('headTeachersCount');
  if (counter) {
    const total = rows.length;
    counter.textContent = q
      ? `${visible} of ${total} teacher${total !== 1 ? 's' : ''}`
      : `${total} teacher${total !== 1 ? 's' : ''}`;
  }
};

async function renderHeadMentors() {
  const data = await cachedGet('/dashboard/school-head/mentors');
  const el = document.getElementById('contentArea');
  const mentors = data.mentors || [];
  const sorted = [...mentors].sort(
    (a, b) => (b.scores.avg_overall || 0) - (a.scores.avg_overall || 0)
  );

  // Mirror the Teachers tab columns. Criteria breakdown lives inside the
  // "View" feedback modal, not as inline columns. The extra column here is
  // "View Mentees" — opens the same per-mentee timeline a mentor sees.
  const rowsHTML = sorted.map((m, i) => `
    <tr data-search="${escapeAttr([m.full_name, m.subject, m.department].filter(Boolean).join(' ').toLowerCase())}">
      <td style="text-align:center;font-weight:600;color:var(--gray-500)">${i + 1}</td>
      <td><strong>${escapeHtml(m.full_name)}</strong></td>
      <td>${m.subject || '<span class="score-empty">N/A</span>'}</td>
      <td>${m.department || '<span class="score-empty">N/A</span>'}</td>
      <td style="font-weight:600;color:${scoreColor(m.scores.avg_overall || 0)}">${fmtScore(m.scores.avg_overall)}</td>
      <td>${m.scores.review_count}</td>
      <td>${m.group_count}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm btn-outline" style="font-size:0.78rem;padding:5px 10px" onclick="viewMentorMentees(${m.id}, '${escapeAttr(m.full_name).replace(/'/g, "\\'")}')">View mentees</button>
        <button class="btn btn-sm btn-primary" style="font-size:0.78rem;padding:5px 12px" onclick="viewTeacherFeedback(${m.id})">View</button>
        <button class="btn btn-sm btn-outline" style="font-size:0.78rem;padding:5px 10px" onclick="exportTeacherPDF(${m.id})" title="${t('admin.export_pdf')}">PDF</button>
      </td>
    </tr>
  `).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="position:relative;flex:1;min-width:240px;max-width:420px">
        <input id="headMentorsSearch" type="search" class="form-control" placeholder="Search by name, subject, or department" oninput="filterHeadMentors(this.value)" autocomplete="off" style="padding-left:36px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--gray-400);pointer-events:none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <span id="headMentorsCount" style="font-size:0.78rem;color:var(--gray-500)">${mentors.length} mentor${mentors.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width:48px">#</th>
              <th>Mentor</th>
              <th>${t('common.subject')}</th>
              <th>${t('common.department')}</th>
              <th>${t('chart.score')}</th>
              <th>${t('common.reviews')}</th>
              <th>Mentor groups</th>
              <th style="text-align:right">${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody id="headMentorsBody">
            ${sorted.length === 0
              ? `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--gray-500)">No mentors yet. Grant the mentor role to a teacher from the Admin → Users tab.</td></tr>`
              : rowsHTML}
            <tr id="headMentorsEmpty" style="display:none"><td colspan="8" style="text-align:center;padding:32px;color:var(--gray-500);font-size:0.9rem">No mentors match that search.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// View Mentees modal — head can see who a given mentor's mentees are with
// a per-student reflection-count summary. Drilldown to a single mentee's
// timeline goes through the existing head endpoint.
window.viewMentorMentees = async function (mentorId, mentorName) {
  try {
    const res = await API.get(`/dashboard/school-head/mentors/${mentorId}/mentees`);
    const mentees = res.mentees || [];
    openModal(`
      <div class="modal-header">
        <h3>${escapeHtml(mentorName)}'s mentees</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body" style="min-width:0">
        ${mentees.length === 0
          ? '<p style="color:var(--gray-500);text-align:center;padding:32px">No mentees yet.</p>'
          : `<div style="overflow-x:auto"><table style="width:100%">
              <thead><tr><th>${t('common.name')}</th><th>Group</th><th>Cohort</th><th style="text-align:right">Reflections</th><th>Last reflection</th><th style="text-align:right">${t('common.actions')}</th></tr></thead>
              <tbody>
                ${mentees.map(m => `
                  <tr>
                    <td><strong>${escapeHtml(m.student_name)}</strong></td>
                    <td>${escapeHtml(m.group_name)}</td>
                    <td>${m.grade ? escapeHtml(m.grade) : '<span style="color:var(--gray-400)">N/A</span>'}</td>
                    <td style="text-align:right;font-weight:600">${m.reflection_count}</td>
                    <td>${m.last_date ? formatExpDate(m.last_date) : '<span style="color:var(--gray-400)">N/A</span>'}</td>
                    <td style="text-align:right">
                      <button class="btn btn-sm ${m.reflection_count > 0 ? 'btn-primary' : 'btn-outline'}" ${m.reflection_count === 0 ? 'disabled' : ''} onclick="closeModal();viewStudentExperiencesAsHead(${m.student_id})">View map</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table></div>`}
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">${t('common.close')}</button></div>
    `);
  } catch (err) {
    toast(err.message || 'Could not load mentees', 'error');
  }
};

window.filterHeadMentors = function (raw) {
  const q = (raw || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#headMentorsBody tr[data-search]');
  let visible = 0;
  rows.forEach(row => {
    const hay = row.dataset.search || '';
    const match = !q || hay.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const empty = document.getElementById('headMentorsEmpty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
  const counter = document.getElementById('headMentorsCount');
  if (counter) {
    const total = rows.length;
    counter.textContent = q ? `${visible} of ${total} mentor${total !== 1 ? 's' : ''}` : `${total} mentor${total !== 1 ? 's' : ''}`;
  }
};

async function renderHeadClassrooms() {
  const data = await cachedGet('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="position:relative;flex:1;min-width:240px;max-width:420px">
        <input id="headClassroomsSearch" type="search" class="form-control" placeholder="Search by subject, teacher, or grade" oninput="filterHeadClassrooms(this.value)" autocomplete="off" style="padding-left:36px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--gray-400);pointer-events:none"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <span id="headClassroomsCount" style="font-size:0.78rem;color:var(--gray-500)">${data.classrooms.length} classroom${data.classrooms.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>${t('common.subject')}</th><th>${t('common.teacher')}</th><th>${t('common.grade')}</th><th>${t('common.students')}</th><th>${t('common.actions')}</th></tr></thead>
          <tbody id="headClassroomsBody">
            ${data.classrooms.map(c => `
              <tr data-search="${escAttr([c.subject, c.teacher_name, c.grade_level].filter(Boolean).join(' ').toLowerCase())}">
                <td><strong>${c.subject}</strong></td>
                <td>${c.teacher_name}</td>
                <td>${c.grade_level}</td>
                <td><a href="#" onclick="event.preventDefault();viewHeadClassroomMembers(${c.id},'${c.subject.replace(/'/g, "\\'")}')" style="color:var(--primary);font-weight:600">${c.student_count || 0}</a></td>
                <td><button class="btn btn-sm btn-outline" onclick="viewHeadClassroomMembers(${c.id},'${c.subject.replace(/'/g, "\\'")}')">${t('teacher.members')}</button></td>
              </tr>
            `).join('')}
            <tr id="headClassroomsEmpty" style="display:none"><td colspan="5" style="text-align:center;padding:32px;color:var(--gray-500);font-size:0.9rem">No classrooms match that search.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window.filterHeadClassrooms = function (raw) {
  const q = (raw || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#headClassroomsBody tr[data-search]');
  let visible = 0;
  rows.forEach(row => {
    const hay = row.dataset.search || '';
    const match = !q || hay.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const empty = document.getElementById('headClassroomsEmpty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
  const counter = document.getElementById('headClassroomsCount');
  if (counter) {
    const total = rows.length;
    counter.textContent = q
      ? `${visible} of ${total} classroom${total !== 1 ? 's' : ''}`
      : `${total} classroom${total !== 1 ? 's' : ''}`;
  }
};

async function viewHeadClassroomMembers(classroomId, subject) {
  try {
    const members = await API.get(`/classrooms/${classroomId}/members`);
    openModal(`
      <div class="modal-header"><h3>${t('admin.members_title', {subject})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body" style="min-width:0">
        ${members.length === 0
          ? `<p style="color:var(--gray-500)">${t('admin.no_students_enrolled')}</p>`
          : `<div style="overflow-x:auto"><table style="width:100%">
              <thead><tr><th>${t('common.name')}</th><th>${t('common.email')}</th><th>${t('admin.grade_position_col')}</th><th>${t('common.joined')}</th></tr></thead>
              <tbody>
                ${members.map(m => `
                  <tr>
                    <td><strong>${m.full_name}</strong></td>
                    <td>${m.email}</td>
                    <td>${m.grade_or_position || '-'}</td>
                    <td>${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table></div>`}
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">${t('common.close')}</button></div>
    `);
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Head analytics — supplementary charts ───────────────────────────────────
// Heatmap is great for "every teacher × every criterion" but loses signal once
// the cohort exceeds ~20. Two complementary lenses go above it:
//   (1) Department radar   — where each department is strong/weak across criteria
//   (2) Score distribution — per-teacher polarisation (every teacher, no top-N)
function renderHeadAnalyticsExtras(data) {
  // Distribution chart needs vertical room proportional to the cohort so every
  // teacher gets a readable row (≥30 teachers = ~22 px per bar).
  const distHeight = Math.max(320, (data.teachers || []).length * 22 + 80);
  return `
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><h3>Department comparison</h3></div>
      <div class="card-body" style="height:520px">
        <canvas id="headDeptRadar"></canvas>
      </div>
    </div>
    <div class="card" style="margin-bottom:24px">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3>Score distribution per teacher</h3>
        <span style="font-size:0.75rem;color:var(--gray-500)">All teachers · stacked 1★ → 5★</span>
      </div>
      <div class="card-body" style="height:${distHeight}px">
        <canvas id="headScoreDist"></canvas>
      </div>
    </div>
  `;
}

function drawHeadAnalyticsExtras(data) {
  const teachers = data.teachers || [];

  // (1) Department radar — average per criterion, grouped by department
  const deptRadarCtx = document.getElementById('headDeptRadar');
  if (deptRadarCtx && teachers.length) {
    const byDept = {};
    teachers.forEach(t => {
      const d = t.department || 'Unassigned';
      if (!byDept[d]) byDept[d] = [];
      byDept[d].push(t);
    });
    const palette = ['#059669', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#ec4899', '#84cc16'];
    const labels = CRITERIA_CONFIG.map(c => t(c.label_key));
    const datasets = Object.keys(byDept).map((d, i) => {
      const list = byDept[d];
      return {
        label: d,
        data: CRITERIA_CONFIG.map(c => {
          const vals = list.map(x => x.scores[`avg_${c.slug}`]).filter(v => v != null);
          return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 0;
        }),
        backgroundColor: palette[i % palette.length] + '22',
        borderColor: palette[i % palette.length],
        borderWidth: 2,
        pointBackgroundColor: palette[i % palette.length]
      };
    });
    chartInstances.headDeptRadar = new Chart(deptRadarCtx, {
      type: 'radar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 16 } },
        plugins: { legend: { position: 'right', align: 'center', labels: { padding: 14, usePointStyle: true, boxWidth: 10, font: { size: 12 } } } },
        scales: { r: { suggestedMin: 0, suggestedMax: 5, ticks: { stepSize: 1, font: { size: 11 } }, pointLabels: { font: { size: 11 } } } }
      }
    });
  }

  // (2) Stacked star-distribution per teacher — surfaces polarised feedback
  // that gets averaged-away in the heatmap.
  const distCtx = document.getElementById('headScoreDist');
  if (distCtx && teachers.length) {
    const sorted = [...teachers].sort(
      (a, b) => (b.scores.avg_overall || 0) - (a.scores.avg_overall || 0)
    );
    const starColors = ['#dc2626', '#f97316', '#f59e0b', '#10b981', '#059669'];
    const datasets = [1, 2, 3, 4, 5].map((star, i) => ({
      label: star + '★',
      data: sorted.map(tc => {
        const dist = tc.distribution || {};
        const total = (dist[1] || 0) + (dist[2] || 0) + (dist[3] || 0) + (dist[4] || 0) + (dist[5] || 0);
        return total ? Math.round((dist[star] || 0) / total * 100) : 0;
      }),
      backgroundColor: starColors[i]
    }));
    chartInstances.headScoreDist = new Chart(distCtx, {
      type: 'bar',
      data: { labels: sorted.map(tc => tc.full_name), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 10, usePointStyle: true, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } }
        },
        scales: {
          x: { stacked: true, max: 100, ticks: { callback: v => v + '%', font: { size: 10 } } },
          y: { stacked: true, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

}

async function renderHeadAnalytics() {
  const data = await cachedGet('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  // Heatmap transposed: criteria as rows, teachers as columns. Reads naturally
  // for the pilot (a few teachers × 13 criteria) and stays scannable when many
  // teachers are added — sticky header + sticky first column + bounded scroll
  // box keep the matrix usable up to ~30+ teachers.
  const cell = (val) => {
    const bg = !val ? 'var(--gray-100)' : val >= 4 ? 'var(--success-bg)' : val >= 3 ? 'var(--warning-bg)' : 'var(--danger-bg)';
    const color = !val ? 'var(--gray-400)' : val >= 4 ? '#047857' : val >= 3 ? '#92400e' : '#dc2626';
    return `<td class="heatmap-cell-td" style="background:${bg};color:${color}">${fmtScore(val)}</td>`;
  };

  // Sort teachers by overall score descending so the strongest performers sit
  // closest to the sticky criteria column (where they're seen without scroll).
  const sortedTeachers = [...data.teachers].sort(
    (a, b) => (b.scores.avg_overall || 0) - (a.scores.avg_overall || 0)
  );

  el.innerHTML = `
    ${renderHeadAnalyticsExtras(data)}
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3>${t('head.performance_heatmap')}</h3>
        <span style="font-size:0.78rem;color:var(--gray-500)">${sortedTeachers.length} teacher${sortedTeachers.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="card-body" style="padding:0">
        <div class="heatmap-toolbar">
          <span class="heatmap-width-control">
            Column width
            <input type="range" min="100" max="260" value="160" oninput="setHeatmapColWidth(this.value)" aria-label="Heatmap column width">
            <span id="heatmapColWidthLabel">160px</span>
          </span>
          <span class="heatmap-legend">
            <span class="heatmap-legend-swatch"><i style="background:var(--success-bg)"></i> ≥ 4</span>
            <span class="heatmap-legend-swatch"><i style="background:var(--warning-bg)"></i> 3–3.9</span>
            <span class="heatmap-legend-swatch"><i style="background:var(--danger-bg)"></i> &lt; 3</span>
            <span class="heatmap-legend-swatch"><i style="background:var(--gray-100)"></i> No data</span>
          </span>
        </div>
        <div class="heatmap-scroll" style="--heatmap-col-w:160px">
          <table class="heatmap-table">
            <thead>
              <tr>
                <th class="heatmap-row-label">${t('admin.criteria')}</th>
                ${sortedTeachers.map(tchr => `<th class="heatmap-teacher-col" title="${escAttr(tchr.full_name)}${tchr.subject ? ' — ' + escAttr(tchr.subject) : ''}"><div class="heatmap-teacher-name">${tchr.full_name}</div>${tchr.subject ? `<div class="heatmap-teacher-sub">${tchr.subject}</div>` : ''}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${CRITERIA_CONFIG.map(c => `
                <tr>
                  <td class="heatmap-row-label">
                    <span style="display:inline-flex;align-items:center;gap:6px">${t(c.label_key)}${criteriaInfoIcon(c.info_key)}</span>
                  </td>
                  ${sortedTeachers.map(tchr => cell(tchr.scores[`avg_${c.slug}`])).join('')}
                </tr>
              `).join('')}
              <tr class="heatmap-overall-row">
                <td class="heatmap-row-label"><strong>${t('head.final')}</strong></td>
                ${sortedTeachers.map(tchr => cell(tchr.scores.avg_overall)).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  drawHeadAnalyticsExtras(data);
}

// ============ TEACHER ANNOUNCEMENTS (separate view) ============
async function renderTeacherAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium).catch(() => []);
    el.innerHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('teacher-comms')">${t('common.back')}</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">${t('nav.announcements')}</h2>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      ${announcements.length === 0
        ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>' + t('ann.no_announcements') + '</h3><p>' + t('ann.post_classrooms_hint') + '</p></div></div></div>'
        : announcements.map(a => announcementCardHTML(a, a.creator_id === (currentUser?.id))).join('')}
    `;
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><h3>' + t('common.error') + '</h3><p>' + err.message + '</p></div>';
  }
}

// ============ HEAD FORMS (placeholder) ============
async function renderHeadForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `
    <div style="margin-bottom:24px">
      <button class="btn btn-sm btn-outline" onclick="navigateTo('head-comms')">${t('common.back')}</button>
    </div>
    <div class="card"><div class="card-body"><div class="empty-state">
      <h3>${t('nav.forms')}</h3>
      <p>Forms management for heads is coming soon.</p>
    </div></div></div>
  `;
}

// ============ HEAD ANNOUNCEMENTS (separate view) ============
async function renderHeadAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium);
    el.innerHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('head-comms')">${t('common.back')}</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">${t('nav.announcements')}</h2>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      <p style="color:var(--gray-500);margin-bottom:16px">${announcements.length} announcement${announcements.length !== 1 ? 's' : ''}</p>
      ${announcements.length === 0
        ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>' + t('ann.no_announcements') + '</h3><p>' + t('ann.post_school_hint') + '</p></div></div></div>'
        : announcements.map(a => announcementCardHTML(a, true)).join('')}
    `;
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><h3>' + t('common.error') + '</h3><p>' + err.message + '</p></div>';
  }
}

// ============ ADMIN FORMS ============
async function renderAdminForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const forms = await cachedGet('/forms', CACHE_TTL.medium);

    const orgFilterHTML = '';

    el.innerHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('admin-comms')">${t('common.back')}</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 style="margin:0">${t('forms.title')}</h2>
          ${orgFilterHTML}
        </div>
        <button class="btn btn-primary" onclick="showAdminCreateFormModal()">${t('forms.new_form')}</button>
      </div>
      <div id="adminFormsList">
        ${renderAdminFormCards(forms)}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

function renderAdminFormCards(forms) {
  if (!forms.length) return `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('admin_forms.no_forms')}</h3><p>${t('admin_forms.no_forms_msg')}</p></div></div></div>`;
  const statusBadge = s => `<span class="badge badge-${s === 'active' ? 'success' : s === 'closed' ? 'gray' : 'warning'}">${s}</span>`;
  return `<div class="grid grid-2">
    ${forms.map(f => `
      <div class="card">
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:1rem;margin-bottom:4px">${f.title}</div>
              ${f.org_name ? `<div style="font-size:0.78rem;color:var(--primary);margin-bottom:2px">🏢 ${f.org_name}</div>` : ''}
              <div style="font-size:0.82rem;color:var(--gray-500)">${f.classroom_label || '—'}</div>
              ${f.creator_name ? `<div style="font-size:0.78rem;color:var(--gray-400);margin-top:2px">by ${f.creator_name}</div>` : ''}
            </div>
            ${statusBadge(f.status)}
          </div>
          <div style="display:flex;gap:16px;font-size:0.82rem;color:var(--gray-500);margin-bottom:12px">
            <span>📋 ${f.question_count} question${f.question_count !== 1 ? 's' : ''}</span>
            <span>💬 ${f.response_count} response${f.response_count !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="card-footer" style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px">
          ${f.status === 'draft' ? `<button class="btn btn-sm btn-outline" onclick="openFormBuilder(${f.id})">${t('forms.edit_questions')}</button>` : ''}
          ${f.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="adminSetFormStatus(${f.id},'active')">${t('forms.activate')}</button>` : ''}
          ${f.status === 'active' ? `<button class="btn btn-sm btn-outline" onclick="adminSetFormStatus(${f.id},'closed')">${t('forms.close_btn')}</button>` : ''}
          ${f.response_count > 0 || f.status !== 'draft' ? `<button class="btn btn-sm btn-outline" onclick="openFormResults(${f.id})">${t('forms.results')}</button>` : ''}
          ${f.status !== 'active' ? `<button class="btn btn-sm btn-danger" onclick="adminDeleteForm(${f.id},'${f.title.replace(/'/g, "\\'")}')">${t('common.delete')}</button>` : ''}
        </div>
      </div>
    `).join('')}
  </div>`;
}

async function filterAdminFormsByOrg(orgId) {
  const el = document.getElementById('adminFormsList');
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const url = orgId ? `/forms?org_id=${orgId}` : '/forms';
    const forms = await API.get(url);
    el.innerHTML = renderAdminFormCards(forms);
  } catch (err) { toast(err.message, 'error'); }
}

async function adminSetFormStatus(formId, status) {
  try {
    await API.patch(`/forms/${formId}`, { status });
    toast(status === 'active' ? t('forms.form_activated') : t('forms.form_closed'));
    renderAdminForms();
  } catch (err) { toast(err.message, 'error'); }
}

async function adminDeleteForm(formId, title) {
  const confirmed = await confirmDialog(t('forms.delete_form_confirm', {title}), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/forms/${formId}`);
    toast(t('forms.form_deleted'));
    renderAdminForms();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Admin Create Form Modal ──────────────────────────────────────────────────

async function showAdminCreateFormModal() {
  const orgPickerHTML = '';

  openModal(`
    <div class="modal-header"><h3>${t('forms.new_form_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('forms.title_label')}</label>
        <input type="text" class="form-control" id="adminFormTitle" placeholder="${t('admin_forms.title_placeholder')}" maxlength="200">
      </div>
      <div class="form-group">
        <label>${t('forms.desc_label')} <span style="color:var(--gray-400);font-weight:400">${t('forms.optional')}</span></label>
        <textarea class="form-control" id="adminFormDesc" rows="2" placeholder="${t('forms.desc_placeholder')}"></textarea>
      </div>
      ${orgPickerHTML}
      <div class="form-group">
        <label>${t('forms.classroom_label')}</label>
        <div id="adminClassroomPickerWrap">
          ${currentUser.role === 'admin' ? '<div class="loading" style="padding:12px"><div class="spinner"></div></div>' : `<div style="color:var(--gray-400);font-size:0.88rem;padding:4px 0">${t('admin_forms.select_org_first')}</div>`}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createAdminForm()">${t('forms.create_btn')}</button>
    </div>
  `);

  setTimeout(() => document.getElementById('adminFormTitle')?.focus(), 50);
  if (currentUser.role === 'admin') {
    loadClassroomsForAdminForm(null);
  }
}

async function loadClassroomsForAdminForm(orgId) {
  const wrap = document.getElementById('adminClassroomPickerWrap');
  if (!wrap) return;
  const targetOrgId = orgId || (currentUser.role === 'admin' ? '' : '');
  const url = targetOrgId ? `/forms/admin/classrooms?org_id=${targetOrgId}` : '/forms/admin/classrooms';
  wrap.innerHTML = `<div class="loading" style="padding:12px"><div class="spinner"></div></div>`;
  try {
    const classrooms = await API.get(url);
    if (!classrooms.length) {
      wrap.innerHTML = `<div style="color:var(--gray-400);font-size:0.88rem;padding:8px 0">${t('admin_forms.no_classrooms')}</div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px">
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
          <input type="text" id="adminClSearch" class="form-control" style="flex:1;padding:7px 10px;font-size:0.88rem" placeholder="${t('admin_forms.search_placeholder')}" oninput="filterAdminClassroomPicker(this.value)">
          <button type="button" class="btn btn-sm btn-outline" onclick="selectAllAdminClassrooms(true)">${t('common.all')}</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="selectAllAdminClassrooms(false)">${t('admin_forms.none_btn')}</button>
        </div>
        <div id="adminClList" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
          ${classrooms.map(c => `
            <label class="admin-cl-item" data-search="${(c.subject + ' ' + c.grade_level + ' ' + (c.teacher_name || '') + ' ' + (c.org_name || '')).toLowerCase()}" style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:6px;cursor:pointer;user-select:none" onmouseover="this.style.background='var(--gray-50)'" onmouseout="this.style.background=''">
              <input type="checkbox" class="admin-cl-cb" value="${c.id}" onchange="updateAdminClCount()" style="width:15px;height:15px;cursor:pointer">
              <div style="min-width:0">
                <div style="font-weight:500;font-size:0.88rem">${c.subject} <span style="color:var(--gray-500)">${c.grade_level}</span></div>
                ${c.teacher_name ? `<div style="font-size:0.76rem;color:var(--gray-400)">${c.teacher_name}${c.org_name ? ' · ' + c.org_name : ''}</div>` : ''}
              </div>
            </label>
          `).join('')}
        </div>
        <div id="adminClCount" style="font-size:0.8rem;color:var(--gray-500);margin-top:8px;padding-top:8px;border-top:1px solid var(--gray-100)">0 classrooms selected</div>
      </div>
    `;
  } catch (err) {
    wrap.innerHTML = `<div style="color:#ef4444;font-size:0.88rem">${err.message}</div>`;
  }
}

function filterAdminClassroomPicker(q) {
  const term = q.toLowerCase().trim();
  document.querySelectorAll('.admin-cl-item').forEach(item => {
    item.style.display = !term || item.dataset.search.includes(term) ? '' : 'none';
  });
}

function selectAllAdminClassrooms(checked) {
  document.querySelectorAll('.admin-cl-cb').forEach(cb => {
    const item = cb.closest('.admin-cl-item');
    if (!item || item.style.display !== 'none') cb.checked = checked;
  });
  updateAdminClCount();
}

function updateAdminClCount() {
  const total = document.querySelectorAll('.admin-cl-cb:checked').length;
  const el = document.getElementById('adminClCount');
  if (el) el.textContent = t('admin_forms.classrooms_selected', {count: total});
}

async function createAdminForm() {
  const title = document.getElementById('adminFormTitle')?.value?.trim();
  if (!title) return toast('Title is required', 'error');

  const desc = document.getElementById('adminFormDesc')?.value?.trim() || null;

  const checkedBoxes = [...document.querySelectorAll('.admin-cl-cb:checked')];
  if (!checkedBoxes.length) return toast('Select at least one classroom', 'error');
  const classroom_ids = checkedBoxes.map(cb => parseInt(cb.value));

  const body = { title, description: desc, classroom_ids };

  try {
    const created = await API.post('/forms', body);
    closeModal();
    toast(t('forms.created_msg'));
    if (created?.id) {
      openFormBuilder(created.id);
    } else {
      renderAdminForms();
    }
  } catch (err) { toast(err.message, 'error'); }
}

// ============ ADMIN ANNOUNCEMENTS (separate view) ============
async function renderAdminAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium).catch(() => []);
    el.innerHTML = `
      <div style="margin-bottom:24px">
        <button class="btn btn-sm btn-outline" onclick="navigateTo('admin-comms')">${t('common.back')}</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">${t('nav.announcements')}</h2>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      ${announcements.length === 0
        ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>' + t('ann.no_announcements') + '</h3><p>' + t('ann.post_classrooms_hint') + '</p></div></div></div>'
        : announcements.map(a => announcementCardHTML(a, true)).join('')}
    `;
  } catch (err) {
    el.innerHTML = '<div class="empty-state"><h3>' + t('common.error') + '</h3><p>' + err.message + '</p></div>';
  }
}

// ============ ADMIN VIEWS ============
async function renderAdminHome() {
  const [stats, periodTrend] = await Promise.all([
    cachedGet('/admin/stats'),
    API.get('/admin/org-period-trend').catch(() => [])
  ]);
  const isOrgAdmin = true;
  const el = document.getElementById('contentArea');

  const hasTrend = isOrgAdmin && periodTrend && periodTrend.length > 0;
  const withData = hasTrend ? periodTrend.filter(p => p.review_count > 0) : [];

  // Trend direction
  let trendHtml = '';
  if (withData.length >= 2) {
    const diff = withData[withData.length - 1].avg_overall - withData[0].avg_overall;
    const dir = diff > 0.1 ? { icon: '↑', text: t('analytics.improving'), color: '#16a34a', bg: '#dcfce7' }
      : diff < -0.1 ? { icon: '↓', text: t('analytics.declining'), color: '#dc2626', bg: '#fee2e2' }
      : { icon: '→', text: t('analytics.stable'), color: '#6b7280', bg: '#f3f4f6' };
    trendHtml = `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:${dir.bg};border-radius:16px;font-size:0.82rem;font-weight:600;color:${dir.color}">${dir.icon} ${dir.text}</span>`;
  }

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card"><div class="stat-label">${t('admin.total_users')}</div><div class="stat-value">${stats.total_users}</div></div>
      <div class="stat-card"><div class="stat-label">${t('admin.students')}</div><div class="stat-value">${stats.total_students}</div></div>
      <div class="stat-card"><div class="stat-label">${t('admin.teachers')}</div><div class="stat-value">${stats.total_teachers}</div></div>
      <div class="stat-card"><div class="stat-label">${t('admin.classrooms')}</div><div class="stat-value">${stats.total_classrooms}</div></div>
    </div>
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card" style="border-left:4px solid var(--warning)">
        <div class="stat-label">${t('admin.pending_reviews')}</div>
        <div class="stat-value" style="color:var(--warning)">${stats.pending_reviews}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--danger)">
        <div class="stat-label">${t('admin.flagged_reviews')}</div>
        <div class="stat-value" style="color:var(--danger)">${stats.flagged_reviews}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--success)">
        <div class="stat-label">${t('admin.approved_reviews')}</div>
        <div class="stat-value" style="color:var(--success)">${stats.approved_reviews}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">${t('admin.avg_rating')}</div>
        <div class="stat-value">${fmtScore(stats.average_rating)}</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <div class="card-header"><h3>${t('admin.users_breakdown')}</h3></div>
        <div class="card-body" style="display:flex;justify-content:center;align-items:center;min-height:280px">
          <canvas id="adminUsersChart"></canvas>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('admin.reviews_by_rating')}</h3></div>
        <div class="card-body" style="display:flex;justify-content:center;align-items:center;min-height:280px">
          <canvas id="adminReviewsChart"></canvas>
        </div>
      </div>
    </div>
    ${isOrgAdmin ? `
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;gap:12px">
        <h3 style="margin:0">${t('admin.org_avg_trend')}</h3>
        ${trendHtml}
      </div>
      <div class="card-body">
        ${hasTrend
          ? '<div class="chart-container"><canvas id="orgPeriodChart"></canvas></div>'
          : `<div class="empty-state" style="padding:32px 0"><p style="color:var(--gray-400)">${t('admin.no_periods_trend')}</p></div>`}
      </div>
      ${hasTrend ? `
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>${t('common.term')}</th><th>${t('admin.period_col')}</th><th>${t('analytics.avg_score')}</th><th>${t('common.reviews')}</th><th>${t('admin.change_col')}</th></tr></thead>
          <tbody>
            ${periodTrend.map((p, i) => {
              const prev = periodTrend[i - 1];
              const delta = (prev && p.avg_overall !== null && prev.avg_overall !== null) ? (p.avg_overall - prev.avg_overall) : null;
              const deltaHtml = delta === null ? '<span style="color:var(--gray-400)">—</span>'
                : delta > 0 ? `<span style="color:#16a34a;font-weight:600">+${delta.toFixed(2)} ↑</span>`
                : delta < 0 ? `<span style="color:#dc2626;font-weight:600">${delta.toFixed(2)} ↓</span>`
                : `<span style="color:var(--gray-500)">0.00 →</span>`;
              return `<tr>
                <td style="color:var(--gray-500);font-size:0.85rem">${p.term_name}</td>
                <td>${p.period_name}</td>
                <td style="font-weight:600;color:${p.avg_overall ? scoreColor(p.avg_overall) : 'var(--gray-400)'}">${p.avg_overall !== null ? p.avg_overall.toFixed(2) : '—'}</td>
                <td>${p.review_count}</td>
                <td>${deltaHtml}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : ''}
    </div>` : ''}
  `;

  // Users breakdown doughnut chart
  const usersCtx = document.getElementById('adminUsersChart');
  if (usersCtx) {
    chartInstances.adminUsers = new Chart(usersCtx, {
      type: 'doughnut',
      data: {
        labels: [t('chart.students_label'), t('chart.teachers_label'), t('chart.school_heads_label'), t('chart.admins_label')],
        datasets: [{
          data: [stats.total_students, stats.total_teachers, stats.total_school_heads || 0, stats.total_admins || 0],
          backgroundColor: ['#059669', '#10b981', '#f59e0b', '#8b5cf6'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } }
        }
      }
    });
  }

  // Reviews by rating bar chart
  const rd = stats.rating_distribution || {};
  const reviewsCtx = document.getElementById('adminReviewsChart');
  if (reviewsCtx) {
    chartInstances.adminReviews = new Chart(reviewsCtx, {
      type: 'bar',
      data: {
        labels: [t('chart.1_star'), t('chart.2_stars'), t('chart.3_stars'), t('chart.4_stars'), t('chart.5_stars')],
        datasets: [{
          label: t('common.reviews'),
          data: [rd[1] || 0, rd[2] || 0, rd[3] || 0, rd[4] || 0, rd[5] || 0],
          backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#059669'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  // Org period trend line chart (org_admin only)
  if (isOrgAdmin && hasTrend) {
    const periodCtx = document.getElementById('orgPeriodChart');
    if (periodCtx) {
      const labels = periodTrend.map(p => p.period_name);
      const scores = periodTrend.map(p => p.avg_overall);
      const pointColors = scores.map((s, i) => {
        if (i === 0 || s === null) return '#059669';
        return s > (scores[i-1] || 0) ? '#16a34a' : s < (scores[i-1] || 0) ? '#dc2626' : '#6b7280';
      });
      chartInstances.orgPeriod = new Chart(periodCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: t('admin.org_avg_label'),
            data: scores,
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 7,
            pointBackgroundColor: pointColors,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            spanGaps: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => `Reviews: ${periodTrend[ctx.dataIndex]?.review_count || 0}`
              }
            }
          }
        }
      });
    }
  }
}

// Handle clicks on the top-bar org badge.
// Mobile (≤768): first tap expands the icon to show the full org name
// (auto-collapses after 4s); the edit pencil inside handles rename on its
// own tap via stopPropagation. Desktop: admins rename on click anywhere.
function handleOrgBadgeClick(el, event) {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    // On mobile we drive everything through expand/collapse; the pencil
    // has its own onclick with stopPropagation for rename.
    event.preventDefault();
    if (!el.classList.contains('expanded')) {
      el.classList.add('expanded');
      clearTimeout(el._collapseTimer);
      el._collapseTimer = setTimeout(() => el.classList.remove('expanded'), 4000);
    } else {
      clearTimeout(el._collapseTimer);
      el.classList.remove('expanded');
    }
    return;
  }
  // Desktop: if admin, a click anywhere on the badge opens rename
  if (el.dataset.admin === '1') renameOrg();
}

// Rename the single organization (admin only)
async function renameOrg() {
  const current = document.getElementById('topBarOrgName')?.textContent || currentUser.org_name || '';
  openModal(`
    <div class="modal-header"><h3>Rename Organization</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Organization Name</label>
        <input type="text" class="form-control" id="renameOrgInput" value="${current}" placeholder="Enter organization name">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveOrgName()">Save</button>
    </div>
  `);
  setTimeout(() => document.getElementById('renameOrgInput')?.select(), 50);
}

async function saveOrgName() {
  const name = document.getElementById('renameOrgInput')?.value.trim();
  if (!name) return toast('Organization name cannot be empty', 'error');
  try {
    await API.put('/admin/org', { name });
    // Update in-memory and UI
    currentUser.org_name = name;
    const el = document.getElementById('topBarOrgName');
    if (el) el.textContent = name;
    invalidateCache('/organizations', '/admin/stats');
    closeModal();
    toast('Organization renamed successfully');
  } catch (err) { toast(err.message, 'error'); }
}

// Store orgs globally for editing
let cachedOrgs = [];

async function renderAdminOrgs() {
  // Force direct API call without org filter
  const savedOrg = currentOrg;
  currentOrg = null; // Temporarily disable org filtering
  const orgs = await cachedGet('/organizations', CACHE_TTL.long);
  currentOrg = savedOrg; // Restore org filter

  // Cache orgs for editing
  cachedOrgs = orgs;

  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h3>${t('admin.organizations')} (${orgs.length})</h3>
      <button class="btn btn-primary" onclick="createOrganization()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${t('admin.create_org')}
      </button>
    </div>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>${t('admin.org_name')}</th>
            <th>${t('admin.org_slug')}</th>
            <th>${t('admin.subscription')}</th>
            <th>${t('admin.teachers')}</th>
            <th>${t('admin.students')}</th>
            <th>${t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          ${orgs.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:40px">${t('common.no_data')}</td></tr>` :
            orgs.map((org, index) => `
              <tr>
                <td><strong>${org.name}</strong></td>
                <td><code>${org.slug}</code></td>
                <td><span class="badge ${org.subscription_status === 'active' ? 'badge-approved' : org.subscription_status === 'suspended' ? 'badge-rejected' : 'badge-pending'}">${org.subscription_status}</span></td>
                <td>${org.teacher_count || 0}</td>
                <td>${org.student_count || 0}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="editOrganization(${index})">${t('common.edit')}</button>
                  <button class="btn btn-sm btn-outline" onclick="viewOrgMembers(${org.id}, '${org.name.replace(/'/g, "\\'")}')">${t('admin.org_members')}</button>
                  <button class="btn btn-sm btn-outline" onclick="viewOrgStats(${org.id}, '${org.name.replace(/'/g, "\\'")}')">${t('admin.stats')}</button>
                  <button class="btn btn-sm btn-outline" style="color:#ef4444" onclick="deleteOrganization(${org.id}, '${org.name.replace(/'/g, "\\'")}', ${org.total_members || 0})">${t('common.delete')}</button>
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function viewOrgStats(orgId, orgName) {
  openModal(`
    <div class="modal-header"><h3>${t('admin.period_trend_title', {name: orgName})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="loading" style="padding:32px"><div class="spinner"></div></div>
    </div>
  `);

  try {
    const savedOrg = currentOrg;
    currentOrg = null;
    const periods = await fetch(`/api/admin/org-period-trend?org_id=${orgId}`, {
      credentials: 'include',
      headers: { 'Authorization': 'Bearer ' + API.token }
    }).then(r => r.json());
    currentOrg = savedOrg;

    if (!Array.isArray(periods) || periods.length === 0) {
      document.querySelector('#modalContent .modal-body').innerHTML =
        `<div class="empty-state" style="padding:32px 0"><p style="color:var(--gray-400)">${t('admin.no_periods_org')}</p></div>`;
      return;
    }

    const withData = periods.filter(p => p.review_count > 0);
    let trendHtml = '';
    if (withData.length >= 2) {
      const diff = withData[withData.length-1].avg_overall - withData[0].avg_overall;
      const dir = diff > 0.1 ? { icon: '↑', text: t('analytics.improving'), color: '#16a34a', bg: '#dcfce7' }
        : diff < -0.1 ? { icon: '↓', text: t('analytics.declining'), color: '#dc2626', bg: '#fee2e2' }
        : { icon: '→', text: t('analytics.stable'), color: '#6b7280', bg: '#f3f4f6' };
      trendHtml = `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;background:${dir.bg};border-radius:16px;font-size:0.82rem;font-weight:600;color:${dir.color}">${dir.icon} ${dir.text}</span>`;
    }

    const rows = periods.map((p, i) => {
      const prev = periods[i - 1];
      const delta = (prev && p.avg_overall !== null && prev.avg_overall !== null) ? (p.avg_overall - prev.avg_overall) : null;
      const dHtml = delta === null ? '—'
        : delta > 0 ? `<span style="color:#16a34a;font-weight:600">+${delta.toFixed(2)} ↑</span>`
        : delta < 0 ? `<span style="color:#dc2626;font-weight:600">${delta.toFixed(2)} ↓</span>`
        : '<span style="color:var(--gray-500)">0.00 →</span>';
      return `<tr>
        <td style="color:var(--gray-500);font-size:0.82rem">${p.term_name}</td>
        <td>${p.period_name}</td>
        <td style="font-weight:600;color:${p.avg_overall ? scoreColor(p.avg_overall) : 'var(--gray-400)'}">${p.avg_overall !== null ? p.avg_overall.toFixed(2) : '—'}</td>
        <td>${p.review_count}</td>
        <td>${dHtml}</td>
      </tr>`;
    }).join('');

    document.querySelector('#modalContent .modal-body').innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <span style="font-size:0.88rem;color:var(--gray-500)">${t('admin.feedback_period_count', {count: periods.length})}</span>
        ${trendHtml}
      </div>
      <div class="chart-container" style="margin-bottom:16px"><canvas id="orgStatsModalChart"></canvas></div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>${t('common.term')}</th><th>${t('admin.period_col')}</th><th>${t('analytics.avg_score')}</th><th>${t('common.reviews')}</th><th>${t('admin.change_col')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    const ctx = document.getElementById('orgStatsModalChart');
    if (ctx) {
      const scores = periods.map(p => p.avg_overall);
      const pointColors = scores.map((s, i) => {
        if (i === 0 || s === null) return '#059669';
        return s > (scores[i-1] || 0) ? '#16a34a' : s < (scores[i-1] || 0) ? '#dc2626' : '#6b7280';
      });
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: periods.map(p => p.period_name),
          datasets: [{ label: t('admin.org_avg_label'), data: scores, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.08)', fill: true, tension: 0.3, pointRadius: 6, pointBackgroundColor: pointColors, pointBorderColor: '#fff', pointBorderWidth: 2, spanGaps: true }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => `Reviews: ${periods[c.dataIndex]?.review_count || 0}` } } }
        }
      });
    }
  } catch (err) {
    document.querySelector('#modalContent .modal-body').innerHTML =
      `<p style="color:#ef4444">${err.message}</p>`;
  }
}

window._selectedUserIds = window._selectedUserIds || new Set();

function _buildUserRows(users) {
  if (users.length === 0) return `<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:24px">${t('admin.no_users')}</td></tr>`;
  return users.map(u => {
    const isSelf = u.id === currentUser.id;
    const canDelete = !isSelf && (
      (currentUser.role === 'admin' && u.role !== 'admin')
    );
    const safeName = u.full_name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const checked = window._selectedUserIds.has(u.id) ? 'checked' : '';
    const checkboxCell = canDelete
      ? `<input type="checkbox" class="user-select-cb" data-user-id="${u.id}" onchange="toggleUserSelect(${u.id}, this.checked)" ${checked}>`
      : `<input type="checkbox" disabled title="${isSelf ? t('admin.cannot_select_self') : t('admin.cannot_delete_this_user')}" style="opacity:0.3">`;
    return `
    <tr>
      <td style="width:32px;text-align:center">${checkboxCell}</td>
      <td><strong>${u.full_name}</strong></td>
      <td style="font-size:0.8rem;color:var(--gray-500)">${u.email}</td>
      <td>
        <span class="badge ${u.role === 'super_admin' ? 'badge-flagged' : u.role === 'admin' ? 'badge-flagged' : u.role === 'teacher' ? 'badge-active' : u.role === 'head' ? 'badge-approved' : 'badge-pending'}">${({student: t('common.student'), teacher: t('common.teacher'), school_head: t('common.school_head'), admin: t('common.admin'), super_admin: t('common.super_admin')}[u.role] || u.role)}</span>
        ${u.role === 'student' && u.is_student_council ? '<span class="badge badge-active" style="margin-left:4px">StuCo</span>' : ''}
        ${u.role === 'teacher' && u.is_mentor ? '<span class="badge badge-approved" style="margin-left:4px;background:#eef2ff;color:#4338ca;border-color:#c7d2fe">Mentor</span>' : ''}
      </td>
      <td>${u.grade_or_position || '-'}</td>
      <td>${u.suspended ? `<span class="badge badge-rejected">${t('common.suspended')}</span>` : `<span class="badge badge-approved">${t('common.active')}</span>`}</td>
      <td>
        <div class="action-dropdown" id="dropdown-${u.id}">
          <button class="action-dropdown-trigger" onclick="toggleActionMenu(${u.id}, event)" title="${t('common.actions')}">⋮</button>
          <div class="action-dropdown-menu" id="dropdown-menu-${u.id}">
            <button class="action-dropdown-item" onclick="closeActionMenus();editUserById(${u.id})">${t('common.edit')}</button>
            <button class="action-dropdown-item" onclick="closeActionMenus();resetPassword(${u.id}, '${safeName}')">${t('admin.reset_password')}</button>
            ${u.role === 'student' ? `<button class="action-dropdown-item" onclick="closeActionMenus();toggleCouncilMember(${u.id}, ${u.is_student_council ? 0 : 1})">${u.is_student_council ? 'Revoke council access' : 'Grant council access'}</button>` : ''}
            ${u.role === 'teacher' ? `<button class="action-dropdown-item" onclick="closeActionMenus();toggleMentor(${u.id}, ${u.is_mentor ? 0 : 1})">${u.is_mentor ? 'Revoke mentor role' : 'Make mentor'}</button>` : ''}
            ${!isSelf ? `<button class="action-dropdown-item" onclick="closeActionMenus();toggleSuspend(${u.id})">${u.suspended ? t('admin.unsuspend') : t('admin.suspend')}</button>` : ''}
            ${canDelete ? `<button class="action-dropdown-item danger" onclick="closeActionMenus();deleteUser(${u.id}, '${safeName}')">${t('admin.delete_account')}</button>` : ''}
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleUserSelect(userId, checked) {
  if (checked) window._selectedUserIds.add(userId);
  else window._selectedUserIds.delete(userId);
  _updateBulkBar();
}

function _getSelectableUsers() {
  const isSelf = (u) => u.id === currentUser.id;
  return (window._allUsers || []).filter(u => !isSelf(u) && u.role !== 'admin');
}

function _getVisibleSelectableUsers() {
  const search = (window._userSearch || '').toLowerCase();
  return _getSelectableUsers().filter(u => {
    const roleMatch = _userMatchesFilter(u, window._userFilter);
    const searchMatch = !search || u.full_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
    return roleMatch && searchMatch;
  });
}

function selectAllVisibleUsers(checked) {
  const visible = _getVisibleSelectableUsers();
  if (checked) visible.forEach(u => window._selectedUserIds.add(u.id));
  else visible.forEach(u => window._selectedUserIds.delete(u.id));
  // Sync checkboxes in table
  document.querySelectorAll('.user-select-cb').forEach(cb => {
    const id = parseInt(cb.dataset.userId);
    if (!isNaN(id)) cb.checked = window._selectedUserIds.has(id);
  });
  _updateBulkBar();
}

function _updateBulkBar() {
  const bar = document.getElementById('bulkDeleteBar');
  const count = window._selectedUserIds.size;
  if (!bar) return;
  if (count === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    const label = document.getElementById('bulkDeleteCount');
    if (label) label.textContent = count;
  }
  // Update header checkbox state
  const headerCb = document.getElementById('selectAllUsersCb');
  if (headerCb) {
    const visibleIds = _getVisibleSelectableUsers().map(u => u.id);
    const selectedVisible = visibleIds.filter(id => window._selectedUserIds.has(id)).length;
    headerCb.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    headerCb.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  }
}

async function bulkDeleteUsers() {
  const ids = Array.from(window._selectedUserIds);
  if (ids.length === 0) return;
  const confirmed = await confirmWithText(
    t('admin.bulk_delete_confirm', {count: ids.length}),
    'delete selected',
    t('admin.bulk_delete_warning')
  );
  if (!confirmed) return;
  let ok = 0, fail = 0;
  const failures = [];
  for (const id of ids) {
    try {
      await API.delete(`/admin/users/${id}`);
      ok++;
    } catch (err) {
      fail++;
      const user = (window._allUsers || []).find(u => u.id === id);
      failures.push(`${user ? user.full_name : id}: ${err.message}`);
    }
  }
  window._selectedUserIds.clear();
  invalidateCache('/admin/stats', '/admin/users', '/admin/teachers');
  if (fail === 0) {
    toast(t('admin.bulk_delete_success', {count: ok}));
  } else {
    toast(t('admin.bulk_delete_partial', {ok, fail}) + '\n' + failures.slice(0, 3).join('\n'), 'error');
  }
  renderAdminUsers();
}

function toggleActionMenu(userId, event) {
  event.stopPropagation();
  const menu = document.getElementById(`dropdown-menu-${userId}`);
  const trigger = event.currentTarget;
  const isOpen = menu.classList.contains('open');
  closeActionMenus();
  if (!isOpen) {
    // Make menu a direct child of body so no ancestor overflow clips it
    if (menu.parentElement !== document.body) {
      menu.dataset.origParent = menu.parentElement.id || '';
      document.body.appendChild(menu);
    }
    menu.classList.add('open');
    // Measure after display: block so we know the menu's real height
    const tRect = trigger.getBoundingClientRect();
    const mRect = menu.getBoundingClientRect();
    const margin = 4;
    // Right-align to trigger, clamped to viewport
    let left = tRect.right - mRect.width;
    if (left < 8) left = 8;
    if (left + mRect.width > window.innerWidth - 8) left = window.innerWidth - mRect.width - 8;
    // Below trigger, flip above if it would overflow
    let top = tRect.bottom + margin;
    if (top + mRect.height > window.innerHeight - 8) {
      top = tRect.top - mRect.height - margin;
      if (top < 8) top = 8;
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
}

function closeActionMenus() {
  document.querySelectorAll('.action-dropdown-menu.open').forEach(m => {
    m.classList.remove('open');
    m.style.left = '';
    m.style.top = '';
  });
}

// Close dropdowns when clicking anywhere outside
document.addEventListener('click', closeActionMenus);
// Close on scroll/resize (fixed-positioned menus would otherwise stay stuck)
window.addEventListener('scroll', closeActionMenus, true);
window.addEventListener('resize', closeActionMenus);

// Close fixed announcement classroom popup when clicking outside
document.addEventListener('click', (e) => {
  const popup = document.getElementById('_annClsPopup');
  if (popup && popup.style.display !== 'none' && !popup.contains(e.target) && !e.target.closest('[data-ann-cls-btn]')) {
    popup.style.display = 'none';
  }
});

// 'stuco' is a virtual filter: matches students with the council flag set.
// All other filter keys map straight to the user.role column.
function _userMatchesFilter(u, filter) {
  if (!filter) return true;
  if (filter === 'stuco') return u.role === 'student' && !!u.is_student_council;
  if (filter === 'mentor') return u.role === 'teacher' && !!u.is_mentor;
  return u.role === filter;
}

function _filterUserTable() {
  const search = (window._userSearch || '').toLowerCase();
  const filtered = (window._allUsers || []).filter(u => {
    const roleMatch = _userMatchesFilter(u, window._userFilter);
    const searchMatch = !search || u.full_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
    return roleMatch && searchMatch;
  });
  const tbody = document.getElementById('userTableBody');
  if (tbody) tbody.innerHTML = _buildUserRows(filtered);
  _updateBulkBar();
}

async function renderAdminUsers(refetch = true) {
  if (refetch) {
    window._allUsers = await API.get('/admin/users');
    // Drop any selected IDs that are no longer in the list
    const ids = new Set((window._allUsers || []).map(u => u.id));
    window._selectedUserIds = new Set(Array.from(window._selectedUserIds).filter(id => ids.has(id)));
  }
  const el = document.getElementById('contentArea');
  const search = (window._userSearch || '').toLowerCase();
  const users = (window._allUsers || []).filter(u => {
    const roleMatch = _userMatchesFilter(u, window._userFilter);
    const searchMatch = !search || u.full_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
    return roleMatch && searchMatch;
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm ${!window._userFilter ? 'btn-primary' : 'btn-outline'}" onclick="window._userFilter=null;renderAdminUsers()">${t('common.all')}</button>
        ${[{key: 'student', label: t('common.student')}, {key: 'stuco', label: 'StuCo'}, {key: 'teacher', label: t('common.teacher')}, {key: 'mentor', label: 'Mentor'}, {key: 'head', label: t('common.school_head')}, {key: 'admin', label: t('common.admin')}].map(r =>
          `<button class="btn btn-sm ${window._userFilter === r.key ? 'btn-primary' : 'btn-outline'}" onclick="window._userFilter='${r.key}';renderAdminUsers()">${r.label}</button>`
        ).join('')}
      </div>
      <button class="btn btn-primary" onclick="showCreateUser()">${t('admin.add_user')}</button>
    </div>
    <div style="margin-bottom:16px">
      <input type="text" class="form-control" id="userSearchInput" placeholder="${t('admin.search_users')}"
        style="max-width:320px"
        value="${window._userSearch || ''}"
        oninput="window._userSearch=this.value;_filterUserTable()">
    </div>
    <div id="bulkDeleteBar" style="display:none;align-items:center;justify-content:space-between;gap:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <div style="color:#991b1b;font-weight:600"><span id="bulkDeleteCount">0</span> ${t('admin.selected')}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-outline" onclick="window._selectedUserIds.clear();renderAdminUsers(false)">${t('common.clear')}</button>
        <button class="btn btn-sm btn-danger" onclick="bulkDeleteUsers()">${t('admin.delete_selected')}</button>
      </div>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr>
            <th style="width:32px;text-align:center"><input type="checkbox" id="selectAllUsersCb" onchange="selectAllVisibleUsers(this.checked)" title="${t('admin.select_all')}"></th>
            <th>${t('common.name')}</th><th>${t('common.email')}</th><th>${t('common.role')}</th><th>${t('admin.grade_position')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th>
          </tr></thead>
          <tbody id="userTableBody">
            ${_buildUserRows(users)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  _updateBulkBar();
}

async function showCreateUser() {
  openModal(`
    <div class="modal-header"><h3>${t('admin.create_user_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('account.full_name')}</label>
        <input type="text" class="form-control" id="newUserName" required>
      </div>
      <div class="form-group">
        <label>${t('account.email')}</label>
        <input type="email" class="form-control" id="newUserEmail" required>
      </div>
      <div class="form-group">
        <label>${t('admin.password')}</label>
        <input type="password" class="form-control" id="newUserPassword" required>
      </div>
      <div class="form-group">
        <label>${t('account.role')}</label>
        <select class="form-control" id="newUserRole" onchange="onNewUserRoleChange(this.value)">
          <option value="student">${t('common.student')}</option>
          <option value="teacher">${t('common.teacher')}</option>
          <option value="head">${t('common.school_head')}</option>
          <option value="admin">${t('common.admin') || 'Admin'}</option>
        </select>
      </div>
      <div class="form-group" id="gradeFieldWrap">
        <label id="newUserGradeLabel">Graduation class</label>
        <select class="form-control" id="newUserGrade">
          <option value="">Choose graduation class</option>
          <option value="Class of 2026">Class of 2026</option>
          <option value="Class of 2027">Class of 2027</option>
          <option value="Class of 2028">Class of 2028</option>
          <option value="Class of 2029">Class of 2029</option>
        </select>
        <input type="text" class="form-control" id="newUserGradeText" placeholder="e.g. Senior Teacher" style="display:none;margin-top:8px">
      </div>
      <div id="teacherFields" style="display:none">
        <div class="form-group"><label>${t('account.subject')}</label><input type="text" class="form-control" id="newTeacherSubject"></div>
        <div class="form-group"><label>${t('account.department')}</label><input type="text" class="form-control" id="newTeacherDept"></div>
        <div class="form-group"><label>${t('admin.years_experience')}</label><input type="number" class="form-control" id="newTeacherExp" min="0"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createUser()">${t('common.create')}</button>
    </div>
  `);
  // Default role is student → set the cohort dropdown layout
  setTimeout(() => onNewUserRoleChange('student'), 0);
}

function onNewUserRoleChange(role) {
  document.getElementById('teacherFields').style.display = role === 'teacher' ? 'block' : 'none';
  // Grade/Position is the cohort dropdown for students, free-text for
  // teachers (position title), hidden for head/admin.
  const gradeWrap = document.getElementById('gradeFieldWrap');
  const gradeLabel = document.getElementById('newUserGradeLabel');
  const gradeSelect = document.getElementById('newUserGrade');
  const gradeText = document.getElementById('newUserGradeText');
  if (!gradeWrap) return;
  if (role === 'student') {
    gradeWrap.style.display = 'block';
    if (gradeLabel) gradeLabel.textContent = 'Graduation class';
    if (gradeSelect) gradeSelect.style.display = '';
    if (gradeText) gradeText.style.display = 'none';
  } else if (role === 'teacher') {
    gradeWrap.style.display = 'block';
    if (gradeLabel) gradeLabel.textContent = 'Position';
    if (gradeSelect) gradeSelect.style.display = 'none';
    if (gradeText) gradeText.style.display = '';
  } else {
    gradeWrap.style.display = 'none';
  }
}

async function createUser() {
  const role = document.getElementById('newUserRole').value;
  let gradeOrPosition = '';
  if (role === 'student') {
    gradeOrPosition = document.getElementById('newUserGrade').value;
  } else if (role === 'teacher') {
    gradeOrPosition = document.getElementById('newUserGradeText').value;
  }
  const body = {
    full_name: document.getElementById('newUserName').value,
    email: document.getElementById('newUserEmail').value,
    password: document.getElementById('newUserPassword').value,
    role: role,
    grade_or_position: gradeOrPosition,
  };
  if (body.role === 'teacher') {
    body.subject = document.getElementById('newTeacherSubject').value;
    body.department = document.getElementById('newTeacherDept').value;
    body.experience_years = parseInt(document.getElementById('newTeacherExp').value) || 0;
  }
  if (!body.full_name || !body.email || !body.password) return toast(t('admin.fill_required'), 'error');
  try {
    await API.post('/admin/users', body);
    toast(t('admin.user_created'));
    invalidateCache('/admin/stats', '/admin/users', '/admin/teachers');
    closeModal();
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

function editUserById(id) {
  const user = (window._allUsers || []).find(u => u.id === id);
  if (user) editUser(user);
}

function editUser(user) {
  const showGrade = (user.role === 'student' || user.role === 'teacher');
  const showAvatar = (user.role === 'teacher' || user.role === 'head');
  const initials = (user.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  openModal(`
    <div class="modal-header"><h3>${t('admin.edit_user_title', {name: user.full_name})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${showAvatar ? `
      <div class="form-group" style="display:flex;align-items:center;gap:16px">
        <div id="editUserAvatarPreview" style="width:64px;height:64px;border-radius:50%;background:var(--gray-100);display:flex;align-items:center;justify-content:center;font-weight:600;color:var(--gray-600);overflow:hidden;flex-shrink:0">
          ${user.avatar_url ? `<img src="${user.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover">` : initials}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <input type="file" id="editUserAvatarFile" accept="image/*" style="display:none" onchange="adminUploadAvatar(${user.id}, this)">
          <button type="button" class="btn btn-sm btn-outline" onclick="document.getElementById('editUserAvatarFile').click()">${user.avatar_url ? t('account.change_photo') || 'Change photo' : t('account.upload_photo') || 'Upload photo'}</button>
          ${user.avatar_url ? `<button type="button" class="btn btn-sm btn-outline" style="color:var(--danger)" onclick="adminRemoveAvatar(${user.id})">${t('account.remove_photo') || 'Remove photo'}</button>` : ''}
        </div>
      </div>
      ` : ''}
      <div class="form-group">
        <label>${t('account.full_name')}</label>
        <input type="text" class="form-control" id="editUserName" value="${user.full_name}">
      </div>
      <div class="form-group">
        <label>${t('account.email')}</label>
        <input type="email" class="form-control" id="editUserEmail" value="${user.email}">
      </div>
      <div class="form-group" id="editGradeFieldWrap" style="display:${showGrade ? 'block' : 'none'}">
        <label id="editUserGradeLabel">${user.role === 'student' ? 'Graduation class' : 'Position'}</label>
        ${user.role === 'student' ? `
          <select class="form-control" id="editUserGrade">
            <option value="">Choose graduation class</option>
            ${['Class of 2026','Class of 2027','Class of 2028','Class of 2029'].map(opt =>
              `<option value="${opt}" ${user.grade_or_position === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            ${user.grade_or_position && !['Class of 2026','Class of 2027','Class of 2028','Class of 2029'].includes(user.grade_or_position)
              ? `<option value="${escapeAttr(user.grade_or_position)}" selected>${escapeHtml(user.grade_or_position)}</option>` : ''}
          </select>
        ` : `
          <input type="text" class="form-control" id="editUserGrade" value="${escapeAttr(user.grade_or_position || '')}">
        `}
      </div>
      <div class="form-group">
        <label>${t('account.role')}</label>
        <select class="form-control" id="editUserRole" onchange="onEditUserRoleChange(this.value)">
          <option value="student" ${user.role === 'student' ? 'selected' : ''}>${t('common.student')}</option>
          <option value="teacher" ${user.role === 'teacher' ? 'selected' : ''}>${t('common.teacher')}</option>
          <option value="head" ${user.role === 'head' ? 'selected' : ''}>${t('common.school_head')}</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="saveUserEdit(${user.id})">${t('admin.save_changes')}</button>
    </div>
  `);
}

function onEditUserRoleChange(role) {
  const wrap = document.getElementById('editGradeFieldWrap');
  if (wrap) wrap.style.display = (role === 'student' || role === 'teacher') ? 'block' : 'none';
}

// Admin: upload an avatar for a teacher / head from the edit user modal.
// Reads the file as a base64 data URL (same shape as the self-serve endpoint
// expects) and posts to /api/admin/users/:id/avatar.
async function adminUploadAvatar(userId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    return toast('Image must be smaller than 5MB', 'error');
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read file'));
      r.readAsDataURL(file);
    });
    const res = await API.post(`/admin/users/${userId}/avatar`, { avatar: dataUrl });
    toast('Avatar updated');
    invalidateCache('/admin/users', '/admin/teachers');
    // Re-open the modal with refreshed data so the preview + remove button update.
    const fresh = (await API.get('/admin/users')).find(u => u.id === userId);
    if (fresh) editUser(fresh);
  } catch (err) {
    toast(err.message || 'Failed to upload avatar', 'error');
  }
}

async function adminRemoveAvatar(userId) {
  if (!confirm('Remove this user\'s avatar?')) return;
  try {
    await API.delete(`/admin/users/${userId}/avatar`);
    toast('Avatar removed');
    invalidateCache('/admin/users', '/admin/teachers');
    const fresh = (await API.get('/admin/users')).find(u => u.id === userId);
    if (fresh) editUser(fresh);
  } catch (err) {
    toast(err.message || 'Failed to remove avatar', 'error');
  }
}

async function saveUserEdit(userId) {
  const role = document.getElementById('editUserRole').value;
  const gradeEl = document.getElementById('editUserGrade');
  const body = {
    full_name: document.getElementById('editUserName').value,
    email: document.getElementById('editUserEmail').value,
    grade_or_position: (role === 'student' || role === 'teacher') && gradeEl ? gradeEl.value : '',
    role: role
  };
  if (!body.full_name || !body.email) return toast(t('admin.name_email_required'), 'error');
  try {
    await API.put(`/admin/users/${userId}`, body);
    toast(t('admin.user_updated'));
    invalidateCache('/admin/users', '/admin/teachers', '/admin/stats');
    closeModal();
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function resetPassword(userId, userName) {
  const newPassword = prompt(t('admin.enter_new_password', {name: userName}));
  if (!newPassword) return;
  if (newPassword.length < 8) return toast(t('admin.password_min_8'), 'error');

  const confirmed = await confirmDialog(t('admin.reset_password_confirm', {name: userName}), t('admin.reset'), t('common.cancel'));
  if (!confirmed) return;

  API.post(`/admin/users/${userId}/reset-password`, { new_password: newPassword })
    .then(() => toast(t('admin.password_reset')))
    .catch(err => toast(err.message, 'error'));
}

async function toggleSuspend(userId) {
  try {
    const data = await API.put(`/admin/users/${userId}/suspend`);
    toast(data.message);
    invalidateCache('/admin/users', '/admin/stats');
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteUser(userId, userName) {
  const confirmed = await confirmWithText(
    t('admin.delete_user_confirm', {name: userName}),
    userName,
    t('admin.delete_user_details')
  );
  if (!confirmed) return;
  try {
    await API.delete(`/admin/users/${userId}`);
    toast(t('admin.user_deleted', {name: userName}));
    invalidateCache('/admin/users', '/admin/stats', '/admin/teachers', '/dashboard');
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function renderAdminTerms() {
  const terms = await cachedGet('/admin/terms', CACHE_TTL.medium);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
      <button class="btn btn-primary" onclick="showCreateTerm()">${t('admin.create_term_title')}</button>
    </div>
    ${terms.length === 0 ? `<p style="color:var(--gray-500);text-align:center;padding:40px">${t('admin.no_terms')}</p>` : ''}
    ${terms.map(term => `
      <div class="card" style="margin-bottom:20px;max-width:700px">
        <div class="card-header">
          <div>
            ${currentUser.role === 'super_admin' && term.org_name ? `<div style="font-size:0.72rem;font-weight:600;color:var(--primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${term.org_name}</div>` : ''}
            <h3>${term.name}</h3>
            <span style="font-size:0.8rem;color:var(--gray-500)">${term.start_date} → ${term.end_date}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="badge ${term.active_status ? 'badge-active' : 'badge-inactive'}">${term.active_status ? t('common.active') : t('common.inactive')}</span>
            <span class="badge ${term.feedback_visible ? 'badge-approved' : 'badge-flagged'}">${term.feedback_visible ? t('admin.feedback_visible') : t('admin.feedback_hidden')}</span>
            <button class="btn btn-sm btn-outline" onclick="editTerm(${term.id}, '${escAttr(term.name)}', '${term.start_date}', '${term.end_date}', ${term.active_status}, ${term.feedback_visible})">${t('common.edit')}</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTerm(${term.id}, '${escAttr(term.name)}')">${t('common.delete')}</button>
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <span style="font-size:0.85rem;font-weight:600;color:var(--gray-600)">${t('admin.feedback_periods_count', {count: term.periods.length})}</span>
            <button class="btn btn-sm btn-outline" onclick="showAddPeriodModal(${term.id}, '${escAttr(term.name)}', '${term.start_date}', '${term.end_date}')">${t('admin.add_period')}</button>
          </div>
          ${term.periods.length === 0
            ? `<p style="font-size:0.85rem;color:var(--gray-400);padding:4px 0">${t('admin.no_feedback_periods_hint')}</p>`
            : term.periods.map(p => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1.5px solid ${p.active_status ? 'var(--success)' : 'var(--gray-200)'};border-radius:8px;margin-bottom:6px;gap:8px">
                <div style="min-width:0;flex:1">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-weight:600;font-size:0.88rem">${p.name}</span>
                    <span class="badge ${p.active_status ? 'badge-active' : 'badge-inactive'}" style="font-size:0.72rem">${p.active_status ? t('status.open') : t('status.closed')}</span>
                    <span class="badge" style="font-size:0.7rem;background:${p.teacher_private ? '#fef3c7' : '#d1fae5'};color:${p.teacher_private ? '#92400e' : '#065f46'};padding:2px 8px;border-radius:4px">${p.teacher_private ? '🔒 Teacher Only' : '👁 Visible to HODs'}</span>
                    <span style="font-size:0.75rem;color:var(--gray-400)">${p.classroom_count || 0} classroom${(p.classroom_count || 0) !== 1 ? 's' : ''}</span>
                  </div>
                  <div style="font-size:0.75rem;color:var(--gray-500);margin-top:2px">${p.start_date || '—'} → ${p.end_date || '—'}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                  ${p.active_status
                    ? `<button class="btn btn-sm btn-danger" onclick="togglePeriod(${p.id}, 0)">${t('common.closed')}</button>`
                    : `<button class="btn btn-sm btn-success" onclick="togglePeriod(${p.id}, 1)">${t('status.open')}</button>`}
                  <button class="btn btn-sm btn-outline" style="font-size:0.75rem" onclick="togglePeriodVisibility(${p.id}, ${p.teacher_private ? 0 : 1})" title="${p.teacher_private ? 'Make visible to HODs' : 'Make teacher-only'}">${p.teacher_private ? '👁' : '🔒'}</button>
                  <button class="btn btn-sm btn-outline" onclick="editPeriod(${p.id}, '${escAttr(p.name)}', '${p.start_date || ''}', '${p.end_date || ''}', ${JSON.stringify(p.classroom_ids || [])}, ${p.teacher_private ? 1 : 0})">${t('common.edit')}</button>
                  <button class="btn btn-sm btn-danger" onclick="deletePeriod(${p.id}, '${escAttr(p.name)}')">✕</button>
                </div>
              </div>
            `).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

async function showAddPeriodModal(termId, termName, termStart, termEnd) {
  let classrooms = [];
  try { classrooms = await API.get('/admin/classrooms'); } catch (e) { /* handled below */ }

  const clPickerInner = classrooms.length === 0
    ? `<div style="color:var(--gray-400);font-size:0.88rem;padding:8px 0">No classrooms found in your organization.</div>`
    : `<div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px">
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
          <input type="text" id="periodClSearch" class="form-control" style="flex:1;padding:7px 10px;font-size:0.85rem" placeholder="Search classrooms..." oninput="filterPeriodClassroomPicker(this.value)">
          <button type="button" class="btn btn-sm btn-outline" onclick="selectAllPeriodClassrooms(true)">All</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="selectAllPeriodClassrooms(false)">None</button>
        </div>
        <div id="periodClList" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
          ${classrooms.map(c => `
            <label class="period-cl-item" data-search="${escAttr((c.subject + ' ' + c.grade_level + ' ' + (c.teacher_name || '')).toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;user-select:none">
              <input type="checkbox" class="period-cl-cb" value="${c.id}" onchange="updatePeriodClCount()" style="width:15px;height:15px;cursor:pointer">
              <div style="min-width:0">
                <div style="font-weight:500;font-size:0.85rem">${escapeHtml(c.subject)} <span style="color:var(--gray-500)">${escapeHtml(c.grade_level)}</span></div>
                ${c.teacher_name ? `<div style="font-size:0.75rem;color:var(--gray-400)">${escapeHtml(c.teacher_name)}</div>` : ''}
              </div>
            </label>
          `).join('')}
        </div>
        <div id="periodClCount" style="font-size:0.78rem;color:var(--gray-500);margin-top:6px;padding-top:6px;border-top:1px solid var(--gray-100)">0 selected</div>
      </div>`;

  openModal(`
    <div class="modal-header"><h3>${t('admin.add_period_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:16px">${t('admin.term_label')} <strong>${escapeHtml(termName)}</strong> (${termStart} → ${termEnd})</p>
      <div class="form-group"><label>${t('admin.period_name')} <span style="color:var(--gray-400);font-weight:400">${t('forms.optional')}</span></label><input type="text" class="form-control" id="newPeriodName" placeholder="${t('admin.period_name_placeholder')}"></div>
      <div class="form-group"><label>${t('admin.start_date')}</label><input type="date" class="form-control" id="newPeriodStart" min="${termStart}" max="${termEnd}"></div>
      <div class="form-group"><label>${t('admin.end_date')}</label><input type="date" class="form-control" id="newPeriodEnd" min="${termStart}" max="${termEnd}"></div>
      <div class="form-group">
        <label>Classrooms <span style="font-size:0.78rem;color:var(--gray-400);font-weight:400">(snapshot — new classrooms added later won't be included automatically)</span></label>
        ${clPickerInner}
      </div>
      <div class="form-group" style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;border:1px solid #fde68a">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
          <input type="checkbox" id="newPeriodPrivate" checked style="width:16px;height:16px">
          <span style="font-weight:600">🔒 Teacher-only visibility</span>
        </label>
        <p style="margin:6px 0 0 24px;font-size:0.8rem;color:#92400e">When checked, feedback from this period is only visible to teachers. Uncheck to make it visible to HODs and leadership.</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createFeedbackPeriod(${termId})">${t('admin.add_period_btn')}</button>
    </div>
  `);
}

function filterPeriodClassroomPicker(q) {
  const term = q.toLowerCase().trim();
  document.querySelectorAll('.period-cl-item').forEach(item => {
    item.style.display = !term || item.dataset.search.includes(term) ? '' : 'none';
  });
}

function selectAllPeriodClassrooms(checked) {
  document.querySelectorAll('.period-cl-cb').forEach(cb => {
    const item = cb.closest('.period-cl-item');
    if (!item || item.style.display !== 'none') cb.checked = checked;
  });
  updatePeriodClCount();
}

function updatePeriodClCount() {
  const total = document.querySelectorAll('.period-cl-cb:checked').length;
  const el = document.getElementById('periodClCount');
  if (el) el.textContent = `${total} classroom${total !== 1 ? 's' : ''} selected`;
}

async function createFeedbackPeriod(termId) {
  const name = document.getElementById('newPeriodName').value;
  const start_date = document.getElementById('newPeriodStart').value;
  const end_date = document.getElementById('newPeriodEnd').value;
  if (!start_date || !end_date) return toast(t('admin.dates_required'), 'error');
  const classroom_ids = [...document.querySelectorAll('.period-cl-cb:checked')].map(cb => parseInt(cb.value));
  if (!classroom_ids.length) return toast('Select at least one classroom', 'error');
  try {
    const teacher_private = document.getElementById('newPeriodPrivate')?.checked ? 1 : 0;
    await API.post('/admin/feedback-periods', { term_id: termId, name, start_date, end_date, classroom_ids, teacher_private });
    toast(t('admin.period_added'));
    invalidateCache('/admin/terms', '/dashboard', '/reviews');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function editPeriod(periodId, name, startDate, endDate, currentClassroomIds, teacherPrivate) {
  const existingIds = Array.isArray(currentClassroomIds) ? currentClassroomIds : [];
  let classrooms = [];
  try { classrooms = await API.get('/admin/classrooms'); } catch (e) { /* handled below */ }

  const clPickerInner = classrooms.length === 0
    ? `<div style="color:var(--gray-400);font-size:0.88rem;padding:8px 0">No classrooms found.</div>`
    : `<div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px">
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
          <input type="text" id="editPeriodClSearch" class="form-control" style="flex:1;padding:7px 10px;font-size:0.85rem" placeholder="Search..." oninput="filterEditPeriodPicker(this.value)">
          <button type="button" class="btn btn-sm btn-outline" onclick="selectAllEditPeriodClassrooms(true)">All</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="selectAllEditPeriodClassrooms(false)">None</button>
        </div>
        <div id="editPeriodClList" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
          ${classrooms.map(c => `
            <label class="edit-period-cl-item" data-search="${escAttr((c.subject + ' ' + c.grade_level + ' ' + (c.teacher_name || '')).toLowerCase())}" style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;user-select:none">
              <input type="checkbox" class="edit-period-cl-cb" value="${c.id}" ${existingIds.includes(c.id) ? 'checked' : ''} onchange="updateEditPeriodClCount()" style="width:15px;height:15px;cursor:pointer">
              <div style="min-width:0">
                <div style="font-weight:500;font-size:0.85rem">${escapeHtml(c.subject)} <span style="color:var(--gray-500)">${escapeHtml(c.grade_level)}</span></div>
                ${c.teacher_name ? `<div style="font-size:0.75rem;color:var(--gray-400)">${escapeHtml(c.teacher_name)}</div>` : ''}
              </div>
            </label>
          `).join('')}
        </div>
        <div id="editPeriodClCount" style="font-size:0.78rem;color:var(--gray-500);margin-top:6px;padding-top:6px;border-top:1px solid var(--gray-100)">${existingIds.length} classroom${existingIds.length !== 1 ? 's' : ''} selected</div>
      </div>`;

  openModal(`
    <div class="modal-header"><h3>${t('admin.edit_period_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>${t('admin.period_name')}</label><input type="text" class="form-control" id="editPeriodName" value="${escAttr(name)}"></div>
      <div class="form-group"><label>${t('admin.start_date')}</label><input type="date" class="form-control" id="editPeriodStart" value="${startDate}"></div>
      <div class="form-group"><label>${t('admin.end_date')}</label><input type="date" class="form-control" id="editPeriodEnd" value="${endDate}"></div>
      <div class="form-group"><label>Classrooms</label>${clPickerInner}</div>
      <div class="form-group" style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;border:1px solid #fde68a">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
          <input type="checkbox" id="editPeriodPrivate" ${teacherPrivate ? 'checked' : ''} style="width:16px;height:16px">
          <span style="font-weight:600">🔒 Teacher-only visibility</span>
        </label>
        <p style="margin:6px 0 0 24px;font-size:0.8rem;color:#92400e">When checked, feedback from this period is only visible to teachers. Uncheck to make it visible to HODs and leadership.</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="updatePeriod(${periodId})">${t('common.save_short')}</button>
    </div>
  `);
}

function filterEditPeriodPicker(q) {
  const term = q.toLowerCase().trim();
  document.querySelectorAll('.edit-period-cl-item').forEach(item => {
    item.style.display = !term || item.dataset.search.includes(term) ? '' : 'none';
  });
}

function selectAllEditPeriodClassrooms(checked) {
  document.querySelectorAll('.edit-period-cl-cb').forEach(cb => {
    const item = cb.closest('.edit-period-cl-item');
    if (!item || item.style.display !== 'none') cb.checked = checked;
  });
  updateEditPeriodClCount();
}

function updateEditPeriodClCount() {
  const total = document.querySelectorAll('.edit-period-cl-cb:checked').length;
  const el = document.getElementById('editPeriodClCount');
  if (el) el.textContent = `${total} classroom${total !== 1 ? 's' : ''} selected`;
}

async function updatePeriod(periodId) {
  const name = document.getElementById('editPeriodName').value;
  const start_date = document.getElementById('editPeriodStart').value;
  const end_date = document.getElementById('editPeriodEnd').value;
  if (!name || !start_date || !end_date) return toast(t('admin.fill_all_fields'), 'error');
  const classroom_ids = [...document.querySelectorAll('.edit-period-cl-cb:checked')].map(cb => parseInt(cb.value));
  try {
    const teacher_private = document.getElementById('editPeriodPrivate')?.checked ? 1 : 0;
    await API.put(`/admin/feedback-periods/${periodId}`, { name, start_date, end_date, classroom_ids, teacher_private });
    toast(t('admin.period_updated'));
    invalidateCache('/admin/terms', '/dashboard', '/reviews');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePeriod(periodId, periodName) {
  const confirmed = await confirmDialog(
    t('admin.delete_period_confirm', {name: periodName}),
    t('common.delete'), t('common.cancel')
  );
  if (!confirmed) return;
  try {
    await API.delete(`/admin/feedback-periods/${periodId}`);
    toast(t('admin.period_deleted'));
    invalidateCache('/admin/terms', '/dashboard', '/reviews');
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function showCreateTerm() {
  const orgPickerHTML = '';
  openModal(`
    <div class="modal-header"><h3>${t('admin.create_term_modal')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${orgPickerHTML}
      <div class="form-group"><label>${t('admin.term_name')} <span style="color:var(--gray-400);font-weight:400">${t('forms.optional')}</span></label><input type="text" class="form-control" id="termName" placeholder="${t('admin.term_name_placeholder')}"></div>
      <div class="form-group"><label>${t('admin.start_date')}</label><input type="date" class="form-control" id="termStart"></div>
      <div class="form-group"><label>${t('admin.end_date')}</label><input type="date" class="form-control" id="termEnd"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createTerm()">${t('common.create')}</button>
    </div>
  `);
}

async function createTerm() {
  const name = document.getElementById('termName').value;
  const start_date = document.getElementById('termStart').value;
  const end_date = document.getElementById('termEnd').value;
  if (!start_date || !end_date) return toast(t('admin.dates_required'), 'error');
  const body = { name, start_date, end_date };
  try {
    await API.post('/admin/terms', body);
    toast(t('admin.term_created'));
    invalidateCache('/admin/terms', '/dashboard');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function activateTerm(termId) {
  try {
    await API.put(`/admin/terms/${termId}`, { active_status: 1 });
    toast(t('admin.term_activated'));
    invalidateCache('/admin/terms', '/dashboard');
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function togglePeriod(periodId, status) {
  try {
    await API.put(`/admin/feedback-periods/${periodId}`, { active_status: status });
    toast(status ? t('admin.period_opened') : t('admin.period_closed'));
    invalidateCache('/admin/terms', '/dashboard', '/reviews');
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function togglePeriodVisibility(periodId, teacherPrivate) {
  try {
    await API.put(`/admin/feedback-periods/${periodId}`, { teacher_private: teacherPrivate });
    toast(teacherPrivate ? 'Period is now teacher-only' : 'Period is now visible to HODs');
    invalidateCache('/admin/terms', '/dashboard');
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

function editTerm(termId, name, startDate, endDate, activeStatus, feedbackVisible) {
  openModal(`
    <div class="modal-header"><h3>${t('admin.edit_term_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>${t('admin.term_name')}</label><input type="text" class="form-control" id="editTermName" value="${name}"></div>
      <div class="form-group"><label>${t('admin.start_date')}</label><input type="date" class="form-control" id="editTermStart" value="${startDate}"></div>
      <div class="form-group"><label>${t('admin.end_date')}</label><input type="date" class="form-control" id="editTermEnd" value="${endDate}"></div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="editTermActive" ${activeStatus ? 'checked' : ''}>
          <span>${t('admin.term_active')}</span>
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="editTermFeedbackVisible" ${feedbackVisible ? 'checked' : ''}>
          <span>${t('admin.feedback_visible_label')}</span>
        </label>
        <p style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">${t('admin.feedback_visible_hint')}</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="updateTerm(${termId})">${t('common.save_changes')}</button>
    </div>
  `);
}

async function updateTerm(termId) {
  const name = document.getElementById('editTermName').value;
  const start_date = document.getElementById('editTermStart').value;
  const end_date = document.getElementById('editTermEnd').value;
  const active_status = document.getElementById('editTermActive').checked ? 1 : 0;
  const feedback_visible = document.getElementById('editTermFeedbackVisible').checked ? 1 : 0;

  if (!name || !start_date || !end_date) return toast(t('admin.fill_all_fields'), 'error');

  try {
    await API.put(`/admin/terms/${termId}`, { name, start_date, end_date, active_status, feedback_visible });
    toast(t('admin.term_updated'));
    invalidateCache('/admin/terms', '/dashboard');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTerm(termId, termName) {
  const confirmed = await confirmDialog(
    t('admin.delete_term_confirm', {name: termName}) + '<br><br>' +
    t('admin.delete_term_warning') + '<br>' +
    `• ${t('admin.delete_term_periods')}<br>` +
    `• ${t('admin.delete_term_reviews')}<br>` +
    `• ${t('admin.delete_term_classrooms')}<br><br>` +
    t('admin.delete_term_irreversible'),
    t('admin.continue'), t('common.cancel')
  );

  if (!confirmed) return;

  // Additional confirmation with text input
  const doubleConfirm = prompt(t('admin.type_delete', {name: termName}));

  if (doubleConfirm !== 'DELETE') {
    return toast(t('admin.deletion_cancelled'), 'info');
  }

  try {
    await API.delete(`/admin/terms/${termId}`);
    toast(t('admin.term_deleted'), 'success');
    invalidateCache('/admin/terms', '/dashboard', '/reviews');
    renderAdminTerms();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderAdminClassrooms() {
  const classrooms = await API.get('/admin/classrooms');
  // Cache so editClassroom(id) can look up by id instead of relying on a
  // JSON-stringified attribute that breaks on apostrophes / quotes.
  window._adminClassrooms = classrooms;
  const filter = window._adminClassroomFilter || 'all';
  const visible = filter === 'all'
    ? classrooms
    : classrooms.filter(c => (c.kind || 'academic') === filter);
  const el = document.getElementById('contentArea');

  const isSuperAdmin = false;
  const orgColumnHeader = isSuperAdmin ? `<th>${t('admin.organization')}</th>` : '';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <h2>${t('admin.classroom_management_count', {count: classrooms.length})}</h2>
      <button class="btn btn-primary" onclick="showCreateClassroom()">+ ${t('admin.create_classroom_title')}</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline'}" onclick="setAdminClassroomFilter('all')">All</button>
      <button class="btn btn-sm ${filter === 'academic' ? 'btn-primary' : 'btn-outline'}" onclick="setAdminClassroomFilter('academic')">Classrooms</button>
      <button class="btn btn-sm ${filter === 'mentor' ? 'btn-primary' : 'btn-outline'}" onclick="setAdminClassroomFilter('mentor')">Mentor groups</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>${t('common.subject')}</th>${orgColumnHeader}<th>${t('common.teacher')}</th><th>${t('common.grade')}</th><th>${t('common.students')}</th><th>${t('admin.join_code')}</th><th>${t('common.actions')}</th></tr></thead>
          <tbody>
            ${visible.length === 0 ? `<tr><td colspan="${6 + (isSuperAdmin ? 1 : 0)}" style="text-align:center;color:var(--gray-500);padding:32px">No classrooms in this view.</td></tr>` : ''}
            ${visible.map(c => {
              const orgColumn = isSuperAdmin ? `<td>${c.org_name || '-'}</td>` : '';
              const isMentor = (c.kind || 'academic') === 'mentor';
              const subjectCell = `<strong>${escapeHtml(c.subject)}</strong>${isMentor ? ' <span style="font-size:0.65rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:0.04em;margin-left:4px;vertical-align:middle">MENTOR</span>' : ''}`;
              return `
              <tr>
                <td>${subjectCell}</td>
                ${orgColumn}
                <td>${escapeHtml(c.teacher_name || '-')}</td>
                <td>${escapeHtml(c.grade_level)}</td>
                <td><a href="#" onclick="event.preventDefault();viewClassroomMembers(${c.id}, ${jsAttr(c.subject)})" style="color:var(--primary);font-weight:600">${c.student_count || 0}</a></td>
                <td><code style="background:var(--gray-100);padding:2px 8px;border-radius:4px">${formatJoinCode(c.join_code)}</code></td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="viewClassroomMembers(${c.id}, ${jsAttr(c.subject)})">${t('teacher.members')}</button>
                  <button class="btn btn-sm btn-outline" onclick="editClassroom(${c.id})">${t('common.edit')}</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteClassroom(${c.id}, ${jsAttr(c.subject)})">${t('common.delete')}</button>
                </td>
              </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window.setAdminClassroomFilter = function (kind) {
  window._adminClassroomFilter = kind;
  renderAdminClassrooms();
};

function showCreateClassroom() {
  cachedGet('/admin/teachers', CACHE_TTL.medium).then(teachers => {
    openModal(`
      <div class="modal-header"><h3>${t('admin.create_classroom_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="form-group">
          <label>${t('admin.subject_required')}</label>
          <input type="text" class="form-control" id="newClassroomSubject" placeholder="${t('admin.subject_placeholder')}">
        </div>
        <div class="form-group">
          <label>${t('admin.grade_required')}</label>
          <input type="text" class="form-control" id="newClassroomGrade" placeholder="${t('admin.grade_placeholder')}">
        </div>
        <div class="form-group">
          <label>${t('admin.teacher_required')}</label>
          <select class="form-control" id="newClassroomTeacher">
            <option value="">${t('admin.select_teacher')}</option>
            ${teachers.map(tchr => `<option value="${tchr.id}">${tchr.full_name} - ${tchr.subject || t('admin.no_subject')}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
        <button class="btn btn-primary" onclick="createClassroom()">${t('common.create')}</button>
      </div>
    `);
  });
}

async function createClassroom() {
  const body = {
    subject: document.getElementById('newClassroomSubject').value,
    grade_level: document.getElementById('newClassroomGrade').value,
    teacher_id: parseInt(document.getElementById('newClassroomTeacher').value)
  };
  if (!body.subject || !body.grade_level || !body.teacher_id) {
    return toast(t('admin.all_fields_required'), 'error');
  }
  try {
    await API.post('/classrooms', body);
    toast(t('admin.classroom_created'));
    closeModal();
    renderAdminClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

function editClassroom(idOrObject) {
  // Accepts either an id (preferred — looked up from window._adminClassrooms)
  // or a classroom object (legacy callers). Mentor groups skip the Subject
  // input and ask for cohort only, since they don't have a subject by design.
  const classroom = typeof idOrObject === 'number'
    ? (window._adminClassrooms || []).find(c => c.id === idOrObject)
    : idOrObject;
  if (!classroom) {
    toast('Classroom not found', 'error');
    return;
  }
  const isMentor = (classroom.kind || 'academic') === 'mentor';
  cachedGet('/admin/teachers', CACHE_TTL.medium).then(teachers => {
    openModal(`
      <div class="modal-header"><h3>${t('admin.edit_classroom_title', {subject: classroom.subject})}${isMentor ? ' <span style="font-size:0.7rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:6px;vertical-align:middle">MENTOR</span>' : ''}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        ${isMentor ? '' : `
          <div class="form-group">
            <label>${t('common.subject')}</label>
            <input type="text" class="form-control" id="editClassroomSubject" value="${escapeAttr(classroom.subject)}">
          </div>
        `}
        <div class="form-group">
          <label>${isMentor ? 'Mentor group name / cohort' : t('admin.grade_level')}</label>
          <input type="text" class="form-control" id="editClassroomGrade" value="${escapeAttr(classroom.grade_level)}">
        </div>
        <div class="form-group">
          <label>${isMentor ? 'Mentor' : t('common.teacher')}</label>
          <select class="form-control" id="editClassroomTeacher">
            ${teachers.filter(tchr => isMentor ? !!tchr.is_mentor : true).map(tchr => `<option value="${tchr.id}" ${tchr.id === classroom.teacher_id ? 'selected' : ''}>${escapeHtml(tchr.full_name)}${tchr.subject ? ' — ' + escapeHtml(tchr.subject) : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
        <button class="btn btn-primary" onclick="saveClassroomEdit(${classroom.id}, ${isMentor ? 'true' : 'false'})">${t('admin.save_changes')}</button>
      </div>
    `);
  });
}

async function saveClassroomEdit(classroomId, isMentor = false) {
  const subjectInput = document.getElementById('editClassroomSubject');
  const body = {
    grade_level: document.getElementById('editClassroomGrade').value,
    teacher_id: parseInt(document.getElementById('editClassroomTeacher').value),
  };
  if (isMentor) {
    body.subject = 'Mentor Group';
  } else if (subjectInput) {
    body.subject = subjectInput.value;
  }
  try {
    await API.put(`/admin/classrooms/${classroomId}`, body);
    toast(t('admin.classroom_updated'));
    invalidateCache('/classrooms', '/dashboard');
    closeModal();
    renderAdminClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteClassroom(classroomId, subject) {
  const confirmed = await confirmDialog(t('admin.delete_classroom_confirm', {subject}), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/admin/classrooms/${classroomId}`);
    toast(t('admin.classroom_deleted'));
    invalidateCache('/classrooms', '/dashboard', '/admin/stats');
    renderAdminClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

async function viewClassroomMembers(classroomId, subject) {
  try {
    const members = await API.get(`/classrooms/${classroomId}/members`);
    openModal(`
      <div class="modal-header"><h3>${t('admin.members_title', {subject})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body" style="min-width:0">
        ${members.length === 0
          ? `<p style="color:var(--gray-500)">${t('admin.no_students_enrolled')}</p>`
          : `<div style="overflow-x:auto"><table style="width:100%">
              <thead><tr><th>${t('common.name')}</th><th>${t('common.email')}</th><th>${t('admin.grade_position_col')}</th><th>${t('common.joined')}</th><th style="width:80px">${t('common.actions')}</th></tr></thead>
              <tbody>
                ${members.map(m => `
                  <tr id="member-row-${m.student_id}">
                    <td><strong>${m.full_name}</strong></td>
                    <td>${m.email}</td>
                    <td>${m.grade_or_position || '-'}</td>
                    <td>${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '-'}</td>
                    <td><button class="btn btn-danger" style="padding:4px 10px;font-size:0.78rem" onclick="removeStudentFromClassroom(${classroomId}, ${m.student_id}, '${m.full_name.replace(/'/g, "\\'")}', '${subject.replace(/'/g, "\\'")}')">${t('admin.remove')}</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table></div>`
        }
        <p style="margin-top:12px;color:var(--gray-500);font-size:0.85rem">${t('admin.students_enrolled', {count: members.length})}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">${t('common.close')}</button>
      </div>
    `);
  } catch (err) { toast(t('admin.failed_load_members') + err.message, 'error'); }
}

async function removeStudentFromClassroom(classroomId, studentId, studentName, subject) {
  const confirmed = await confirmDialog(t('admin.remove_confirm', {student: studentName, subject}), t('admin.remove'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/classrooms/${classroomId}/members/${studentId}`);
    toast(t('admin.student_removed', {name: studentName}));
    viewClassroomMembers(classroomId, subject);
  } catch (err) { toast(err.message, 'error'); }
}

async function renderAdminModerate() {
  const [reviews, flagged] = await Promise.all([
    API.get('/admin/reviews/pending'),
    API.get('/admin/reviews/flagged')
  ]);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <p style="color:var(--gray-500);margin:0">${t('admin.reviews_awaiting', {count: reviews.length})}</p>
        ${reviews.length > 0 ? `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem"><input type="checkbox" id="selectAllReviews" onchange="toggleSelectAllReviews(this)"> ${t('moderate.select_all')}</label>` : ''}
      </div>
      ${reviews.length > 0 ? `
        <div style="display:flex;gap:8px">
          <button class="btn btn-success" id="approveSelectedBtn" onclick="approveSelectedReviews()" style="display:none">${t('moderate.approve_selected')}</button>
          <button class="btn btn-success" onclick="bulkApproveAll(${JSON.stringify(reviews.map(r => r.id))})">${t('admin.approve_all', {count: reviews.length})}</button>
        </div>` : ''}
    </div>
    ${reviews.length === 0
      ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('admin.all_clear_title')}</h3><p>${t('admin.all_clear_desc')}</p></div></div></div>`
      : reviews.map(r => `
        <div class="card" style="margin-bottom:16px">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
              <div style="display:flex;align-items:start;gap:10px">
                <input type="checkbox" class="review-select-cb" value="${r.id}" onchange="updateApproveSelectedBtn()" style="margin-top:4px;width:16px;height:16px;cursor:pointer">
                <div>
                  <div><strong>${r.teacher_name}</strong> <span style="color:var(--gray-500);font-size:0.85rem">&middot; ${r.classroom_subject} (${r.grade_level}) &middot; ${r.term_name} &middot; ${r.period_name}</span></div>
                  <div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">${t('moderate.from_label')} <strong>${r.student_name}</strong> (${r.student_email})</div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                ${badgeHTML(r.flagged_status)}
                <span style="font-size:0.78rem;color:var(--gray-400)">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
              </div>
            </div>
            ${moderationRatingGridHTML(r)}
            ${r.feedback_text ? `<div class="review-text" style="margin-bottom:12px">${r.feedback_text}</div>` : `<p style="color:var(--gray-400);font-size:0.85rem;font-style:italic;margin-bottom:12px">${t('review.no_written_feedback')}</p>`}
            ${JSON.parse(r.tags || '[]').length > 0 ? `
              <div class="review-tags" style="margin-bottom:16px">
                ${JSON.parse(r.tags).map(tag => `<span class="tag">${translateTag(tag)}</span>`).join('')}
              </div>
            ` : ''}
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-success" onclick="moderateReview(${r.id}, 'approve')">${t('admin.approve_btn')}</button>
              <button class="btn btn-danger" onclick="moderateReview(${r.id}, 'reject')">${t('admin.reject_btn')}</button>
              <button class="btn btn-outline" onclick="confirmDeleteReview(${r.id})">${t('common.delete')}</button>
            </div>
          </div>
        </div>
      `).join('')}
    ${flagged.length > 0 ? `
      <div style="margin-top:32px;margin-bottom:16px">
        <h3 style="display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--danger)"></span>
          ${t('admin.flagged_reviews', {count: flagged.length})}
        </h3>
        <p style="color:var(--gray-500);font-size:0.9rem;margin-top:4px">${t('moderate.flagged_desc')}</p>
      </div>
      ${flagged.map(r => `
        <div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
              <div>
                <div><strong>${r.teacher_name}</strong> <span style="color:var(--gray-500);font-size:0.85rem">&middot; ${r.classroom_subject} &middot; ${r.term_name} &middot; ${r.period_name}</span></div>
                <div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">${t('moderate.from_label')} <strong>${r.student_name}</strong> (${r.student_email})</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <span class="badge badge-flagged">${t('common.flagged_badge')}</span>
                <span style="font-size:0.78rem;color:var(--gray-400)">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
              </div>
            </div>
            ${moderationRatingGridHTML(r)}
            ${r.feedback_text ? `<div class="review-text" style="border-left:3px solid var(--danger);margin-bottom:12px">${r.feedback_text}</div>` : `<p style="color:var(--gray-400);font-size:0.85rem;font-style:italic;margin-bottom:12px">${t('review.no_written_feedback')}</p>`}
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-success" onclick="moderateReview(${r.id}, 'approve')">${t('admin.approve_anyway')}</button>
              <button class="btn btn-danger" onclick="moderateReview(${r.id}, 'reject')">${t('admin.reject_btn')}</button>
              <button class="btn btn-outline" onclick="confirmDeleteReview(${r.id})">${t('common.delete')}</button>
            </div>
          </div>
        </div>
      `).join('')}
    ` : ''}
  `;
}

async function renderAdminFlagged() {
  const reviews = await API.get('/admin/reviews/flagged');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <p style="color:var(--gray-500)">${t('admin.flagged_count', {count: reviews.length})}</p>
    </div>
    ${reviews.length === 0
      ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('admin.no_flagged_title')}</h3><p>${t('admin.no_flagged_desc')}</p></div></div></div>`
      : reviews.map(r => `
        <div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
              <div>
                <div><strong>${r.teacher_name}</strong> <span style="color:var(--gray-500);font-size:0.85rem">&middot; ${r.classroom_subject} &middot; ${r.term_name} &middot; ${r.period_name}</span></div>
                <div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">${t('moderate.from_label')} <strong>${r.student_name}</strong> (${r.student_email})</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <span class="badge badge-flagged">${t('common.flagged_badge')}</span>
                <span style="font-size:0.78rem;color:var(--gray-400)">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
              </div>
            </div>
            ${moderationRatingGridHTML(r)}
            ${r.feedback_text ? `<div class="review-text" style="border-left:3px solid var(--danger);margin-bottom:12px">${r.feedback_text}</div>` : `<p style="color:var(--gray-400);font-size:0.85rem;font-style:italic;margin-bottom:12px">${t('review.no_written_feedback')}</p>`}
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-success" onclick="moderateReview(${r.id}, 'approve')">${t('admin.approve_anyway')}</button>
              <button class="btn btn-danger" onclick="moderateReview(${r.id}, 'reject')">${t('admin.reject_btn')}</button>
              <button class="btn btn-outline" onclick="confirmDeleteReview(${r.id})">${t('common.delete')}</button>
            </div>
          </div>
        </div>
      `).join('')}
  `;
}

async function moderateReview(id, action) {
  try {
    await API.put(`/admin/reviews/${id}/${action}`);
    toast(action === 'approve' ? t('admin.review_approved') : t('admin.review_rejected'));
    invalidateCache('/admin/stats', '/dashboard', '/admin/teachers', '/admin/teacher');
    renderAdminModerate();
  } catch (err) { toast(err.message, 'error'); }
}

async function bulkApproveAll(reviewIds) {
  const confirmed = await confirmDialog(t('admin.approve_all_confirm', {count: reviewIds.length}), t('admin.approve_all_btn'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.post('/admin/reviews/bulk-approve', { review_ids: reviewIds });
    toast(t('admin.bulk_approved', {count: reviewIds.length}), 'success');
    invalidateCache('/admin/stats', '/dashboard', '/admin/teachers', '/admin/teacher');
    renderAdminModerate();
  } catch (err) { toast(err.message, 'error'); }
}

function toggleSelectAllReviews(cb) {
  document.querySelectorAll('.review-select-cb').forEach(el => el.checked = cb.checked);
  updateApproveSelectedBtn();
}

function updateApproveSelectedBtn() {
  const selected = [...document.querySelectorAll('.review-select-cb:checked')];
  const btn = document.getElementById('approveSelectedBtn');
  if (btn) {
    btn.style.display = selected.length > 0 ? 'inline-flex' : 'none';
    btn.textContent = t('moderate.approve_selected_count', {count: selected.length});
  }
}

async function approveSelectedReviews() {
  const ids = [...document.querySelectorAll('.review-select-cb:checked')].map(cb => parseInt(cb.value));
  if (ids.length === 0) return;
  const confirmed = await confirmDialog(t('moderate.approve_selected_confirm', {count: ids.length}), t('admin.approve_btn'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.post('/admin/reviews/bulk-approve', { review_ids: ids });
    toast(t('moderate.approved_selected_toast', {count: ids.length}), 'success');
    invalidateCache('/admin/stats', '/dashboard', '/admin/teachers', '/admin/teacher');
    renderAdminModerate();
  } catch (err) { toast(err.message, 'error'); }
}


async function confirmDeleteReview(id) {
  const confirmed = await confirmDialog(t('admin.delete_review_confirm'), t('common.delete'), t('common.cancel'));
  if (confirmed) {
    await deleteReview(id);
  }
}

async function deleteReview(id) {
  try {
    await API.delete(`/admin/reviews/${id}`);
    toast(t('admin.review_deleted'));
    invalidateCache('/admin/stats', '/dashboard', '/admin/teachers', '/admin/teacher');
    if (currentView === 'admin-moderate') renderAdminModerate();
    else if (currentView === 'admin-flagged') renderAdminFlagged();
  } catch (err) { toast(err.message, 'error'); }
}

function editTeacher(teacher) {
  openModal(`
    <div class="modal-header"><h3>${t('admin.edit_teacher_title', { name: teacher.full_name })}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('common.full_name')}</label>
        <input type="text" class="form-control" id="editTeacherName" value="${teacher.full_name}">
      </div>
      <div class="form-group">
        <label>${t('common.subject')}</label>
        <input type="text" class="form-control" id="editTeacherSubject" value="${teacher.subject || ''}">
      </div>
      <div class="form-group">
        <label>${t('common.department')}</label>
        <input type="text" class="form-control" id="editTeacherDept" value="${teacher.department || ''}">
      </div>
      <div class="form-group">
        <label>${t('admin.years_of_experience')}</label>
        <input type="number" class="form-control" id="editTeacherExp" value="${teacher.experience_years || 0}" min="0">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="saveTeacherEdit(${teacher.id})">${t('common.save_changes')}</button>
    </div>
  `);
}

async function saveTeacherEdit(teacherId) {
  const body = {
    full_name: document.getElementById('editTeacherName').value,
    subject: document.getElementById('editTeacherSubject').value,
    department: document.getElementById('editTeacherDept').value,
    experience_years: parseInt(document.getElementById('editTeacherExp').value) || 0
  };
  if (!body.full_name) return toast(t('admin.name_required'), 'error');
  try {
    await API.put(`/admin/teachers/${teacherId}`, body);
    toast(t('admin.teacher_updated'));
    invalidateCache('/admin/teachers', '/admin/teacher', '/dashboard');
    closeModal();
    renderAdminTeachers();
  } catch (err) { toast(err.message, 'error'); }
}

// ============ ADMIN: TEACHER FEEDBACK VIEWER ============
async function renderAdminTeachers() {
  const teachers = await cachedGet('/admin/teachers', CACHE_TTL.medium);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>${t('admin.all_teachers', {count: teachers.length})}</h3></div>
      <div class="card-body">
        <table>
          <thead>
            <tr>
              <th>${t('admin.name_col')}</th>
              <th>${t('common.subject')}</th>
              <th>${t('admin.dept_col')}</th>
              <th>${t('admin.avg_rating_col')}</th>
              <th>${t('admin.reviews_col')}</th>
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${teachers.map(tchr => `
              <tr>
                <td><strong>${tchr.full_name}</strong></td>
                <td>${tchr.subject || '-'}</td>
                <td>${tchr.department || '-'}</td>
                <td style="font-weight:600;color:${scoreColor(tchr.scores?.avg_overall || 0)}">${fmtScore(tchr.scores?.avg_overall)}</td>
                <td>${tchr.scores?.review_count || 0}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick='editTeacher(${JSON.stringify(tchr)})'>${t('common.edit')}</button>
                  <button class="btn btn-sm btn-primary" onclick="viewTeacherFeedback(${tchr.id})">${t('admin.view_feedback')}</button>
                  <button class="btn btn-sm btn-outline" onclick="exportTeacherPDF(${tchr.id})">${t('admin.export_pdf')}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function viewTeacherFeedback(teacherId) {
  const data = await API.get(`/admin/teacher/${teacherId}/feedback`);
  const allReviews = data.reviews || [];
  const academicReviews = allReviews.filter(r => (r.review_kind || 'teacher') !== 'mentor');
  const mentorReviews = allReviews.filter(r => r.review_kind === 'mentor');
  const isMentor = !!data.teacher.is_mentor;

  // Cache for tab switching
  window._feedbackModalState = {
    teacher: data.teacher,
    scores: data.scores,
    academicReviews,
    mentorReviews,
    isMentor,
    tab: 'academic',
  };

  openModal(`
    <div class="modal-header">
      <h2>${t('admin.feedback_for', {name: escapeHtml(data.teacher.full_name)})}${isMentor ? ' <span style="font-size:0.7rem;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:10px;font-weight:600;margin-left:6px;vertical-align:middle">MENTOR</span>' : ''}</h2>
      <button onclick="closeModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer">&times;</button>
    </div>
    <div class="modal-body" id="feedbackModalBody">
      ${isMentor ? `
        <div class="exp-tabs" style="margin-bottom:18px">
          <button class="exp-tab is-active" id="fbTab-academic" onclick="setFeedbackTab('academic')">Teacher feedback <span class="exp-tab-count">${academicReviews.length}</span></button>
          <button class="exp-tab" id="fbTab-mentor" onclick="setFeedbackTab('mentor')">Mentor feedback <span class="exp-tab-count">${mentorReviews.length}</span></button>
        </div>
      ` : ''}
      <div id="feedbackTabPanel">${renderFeedbackTabPanel('academic')}</div>
    </div>
  `);
}

window.setFeedbackTab = function (tab) {
  if (!window._feedbackModalState) return;
  window._feedbackModalState.tab = tab;
  document.getElementById('fbTab-academic')?.classList.toggle('is-active', tab === 'academic');
  document.getElementById('fbTab-mentor')?.classList.toggle('is-active', tab === 'mentor');
  const panel = document.getElementById('feedbackTabPanel');
  if (panel) panel.innerHTML = renderFeedbackTabPanel(tab);
};

function renderFeedbackTabPanel(tab) {
  const s = window._feedbackModalState;
  if (!s) return '';
  const reviews = tab === 'mentor' ? s.mentorReviews : s.academicReviews;
  const isMentorTab = tab === 'mentor';

  // Compute aggregates from the active reviews so the headline numbers match
  // the visible tab. Mentor criteria use the mentor_c{n}_rating columns.
  const ratingFor = (r, col) => Number(r[col]) || null;
  const cols = isMentorTab ? MENTOR_CRITERIA_COLS : CRITERIA_COLS;
  const reviewCount = reviews.length;
  const avgOverall = reviewCount
    ? +(reviews.reduce((sum, r) => sum + (Number(r.overall_rating) || 0), 0) / reviewCount).toFixed(2)
    : null;
  const avgPerCriterion = {};
  cols.forEach(col => {
    const vals = reviews.map(r => ratingFor(r, col)).filter(v => v != null);
    avgPerCriterion[col] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
  });

  const criteriaList = isMentorTab
    ? MENTOR_CRITERIA_CONFIG.map(c => ({ db_col: c.db_col, label: c.label, info_key: c.info_key }))
    : CRITERIA_CONFIG.map(c => ({ db_col: c.db_col, label: t(c.label_key), info_key: c.info_key }));

  return `
    <div style="margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:var(--radius-md)">
      <div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:20px">
        <div>
          <div style="font-size:2rem;font-weight:700;color:${scoreColor(avgOverall || 0)}">${fmtScore(avgOverall)}</div>
          <div style="color:var(--gray-500);font-size:0.85rem">${t('profile.overall_rating')}</div>
        </div>
        <div>
          <div style="font-size:2rem;font-weight:700">${reviewCount}</div>
          <div style="color:var(--gray-500);font-size:0.85rem">${t('profile.total_reviews')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-top:16px;border-top:1px solid var(--gray-200)">
        ${criteriaList.map(c => {
          const val = avgPerCriterion[c.db_col] || 0;
          return `<div style="text-align:center">
            <div style="font-size:1.3rem;font-weight:600;color:${scoreColor(val)}">${fmtScore(avgPerCriterion[c.db_col])}</div>
            <div style="color:var(--gray-500);font-size:0.85rem;display:flex;align-items:center;justify-content:center;gap:3px">${escapeHtml(c.label)}${c.info_key ? criteriaInfoIcon(c.info_key) : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div style="max-height:400px;overflow-y:auto">
      ${reviews.length === 0
        ? `<div class="empty-state"><p>${t('admin.no_approved_reviews')}</p></div>`
        : reviews.map(r => {
            const ratingValues = cols.map(c => Number(r[c]) || 0).filter(v => v > 0);
            const avg = ratingValues.length ? ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length : null;
            const colorVal = avg != null ? avg : (r.overall_rating || 0);
            return `
            <div class="review-card" style="padding:14px;border:1px solid var(--gray-200);border-radius:var(--radius-md);margin-bottom:12px">
              <div class="review-header">
                <div>
                  <div style="font-size:0.85rem;color:var(--gray-500)">${new Date(r.created_at).toLocaleDateString()}</div>
                  <div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">${escapeHtml(r.classroom_subject)} (${escapeHtml(r.grade_level)}) &middot; ${escapeHtml(r.term_name)} &middot; ${escapeHtml(r.period_name)}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                  <div style="font-weight:700;font-size:1.05rem;color:${scoreColor(colorVal)}">${fmtRatingFloat(avg)}</div>
                  ${starsHTML(avg != null ? avg : 0, 'small')}
                </div>
              </div>
              <details class="criteria-collapse">
                <summary>
                  <span>${t('student.criteria_breakdown')}</span>
                  <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </summary>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 0">
                  ${criteriaList.map(c => `<div style="display:flex;justify-content:space-between;padding:4px 8px;background:var(--gray-50);border-radius:6px"><span style="font-size:0.82rem">${escapeHtml(c.label)}</span><span style="font-weight:600">${r[c.db_col] || '-'}/5</span></div>`).join('')}
                </div>
              </details>
              ${r.feedback_text
                ? `<div class="review-text">${escapeHtml(r.feedback_text)}</div>`
                : `<div class="review-text review-text-empty">${t('review.no_written_feedback')}</div>`}
            </div>`;
          }).join('')}
    </div>
  `;
}

async function exportMyPDF() {
  try {
    const data = await cachedGet('/dashboard/teacher');
    const s = data.overall_scores || {};
    const reviews = (data.recent_reviews || []).filter(r => r.approved_status === 1);
    const orgName = (userOrgs.find(o => o.id === currentUser.org_id) || userOrgs[0])?.name || '';
    const tchr = {
      full_name: currentUser.full_name,
      subject: teacherInfo?.subject || '',
      department: teacherInfo?.department || '',
      bio: teacherInfo?.bio || '',
      experience_years: teacherInfo?.experience_years || null,
      org_name: orgName
    };
    buildAndPrintPDF(tchr, s, reviews);
  } catch (err) { toast(err.message, 'error'); }
}

async function exportTeacherPDF(teacherId) {
  try {
    const data = await API.get(`/admin/teacher/${teacherId}/feedback`);
    const tchr = data.teacher;
    const s = data.scores;
    const reviews = data.reviews || [];
    buildAndPrintPDF(tchr, s, reviews);
  } catch (err) { toast(err.message, 'error'); }
}

function buildAndPrintPDF(tchr, s, reviews) {
  try {
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const oc = (s.avg_overall || 0) >= 4 ? '#15803d' : (s.avg_overall || 0) >= 3 ? '#b45309' : '#b91c1c';
    const barColor = (v) => (v || 0) >= 4 ? '#15803d' : (v || 0) >= 3 ? '#b45309' : '#b91c1c';

    // Stars using ★/☆ — inline print-color-adjust on each span
    const stars = (v) => {
      const n = Math.round(v || 0);
      return Array.from({length:5}, (_,i) =>
        `<span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;color:${i<n?'#f59e0b':'#d1d5db'};font-size:16px;letter-spacing:1px">&#9733;</span>`
      ).join('');
    };

    // Bar built with two table-cells (colored fill + gray remainder) — survives print
    const bar = (v) => {
      if (!v) return `<span style="color:#9ca3af;font-size:11px">—</span>`;
      const pct  = Math.round((v / 5) * 100);
      const rest = 100 - pct;
      const col  = barColor(v);
      return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td style="padding:0;vertical-align:middle">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;overflow:hidden;border-radius:3px">
              <tr>
                <td width="${pct}%" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:${col};height:10px;line-height:10px;font-size:0"> </td>
                ${rest > 0 ? `<td width="${rest}%" style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#e5e7eb;height:10px;line-height:10px;font-size:0"> </td>` : ''}
              </tr>
            </table>
          </td>
          <td style="width:38px;text-align:right;padding-left:8px;font-weight:700;font-size:12px;color:${col};white-space:nowrap;vertical-align:middle">${Number(v).toFixed(1)}</td>
        </tr>
      </table>`;
    };

    const quotes = reviews.filter(r => r.feedback_text).slice(0, 6);

    const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>${tchr.full_name} — Teacher Performance Report</title>
  <style>
    /* ── PAGE: 85% content width on A4 (16mm each side ≈ 7.5%) ── */
    @page { size: A4 portrait; margin: 22mm 16mm; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Force backgrounds to print in all browsers */
    html, body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #1a2e1a;
      font-size: 12px;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
    }

    /* ── HEADER ── */
    .hdr {
      -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
      background: #1e3a5f;
      color: #fff;
      padding: 26px 28px 22px;
      border-radius: 6px 6px 0 0;
    }
    .hdr-name  { font-size: 26px; font-weight: 800; letter-spacing: -0.3px; line-height: 1.1; }
    .hdr-sub   { font-size: 12.5px; color: #93c5fd; margin-top: 5px; }
    .hdr-right { text-align: right; white-space: nowrap; vertical-align: top; padding-left: 20px; }
    .hdr-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #93c5fd; }
    .hdr-date  { font-size: 11px; color: #bfdbfe; margin-top: 3px; }
    .hdr-pills { margin-top: 14px; }
    .pill {
      -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
      display: inline-block;
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 100px;
      padding: 3px 11px;
      font-size: 10px;
      color: #dbeafe;
      margin: 2px 3px 0 0;
    }
    .accent {
      -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
      height: 4px;
      background: #059669;
    }

    /* ── TWO-COLUMN BODY (CSS table = reliable in print) ── */
    .body-tbl  { width: 95%; border-collapse: collapse; margin: 0 2.5%; }
    .col-left  { width: 36%; vertical-align: top; padding: 22px 22px 22px 8px; border-right: 1.5px solid #e2e8f0; }
    .col-right { vertical-align: top; padding: 22px 24px 22px 28px; }

    /* ── SCORE BOX ── */
    .score-box {
      -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
      background: #eff6ff;
      border: 2px solid #bfdbfe;
      border-radius: 8px;
      text-align: center;
      padding: 16px 12px 14px;
      margin-bottom: 18px;
    }
    .score-num   { font-size: 46px; font-weight: 800; line-height: 1; }
    .score-denom { font-size: 15px; font-weight: 400; color: #64748b; }
    .score-lbl   { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.09em; color: #64748b; margin-top: 5px; }

    /* ── SECTION LABEL ── */
    .sec {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #64748b;
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 5px;
      margin: 18px 0 10px;
    }
    .sec:first-child { margin-top: 0; }

    .stat-n { font-size: 22px; font-weight: 700; color: #0f172a; }
    .stat-l { font-size: 9.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.07em; }

    /* ── CRITERIA ── */
    .crit   { margin-bottom: 11px; }
    .crit-n { font-size: 11.5px; color: #374151; font-weight: 500; margin-bottom: 5px; }

    /* ── FEEDBACK ── */
    .q {
      -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
      background: #f8fafc;
      border-left: 3px solid #059669;
      padding: 9px 13px;
      margin-bottom: 8px;
      font-size: 11px;
      color: #334155;
      line-height: 1.65;
      page-break-inside: avoid;
    }

    /* ── FOOTER ── */
    .ftr {
      margin-top: 20px;
      border-top: 1px solid #e2e8f0;
      padding-top: 9px;
      font-size: 9.5px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>

<!-- HEADER (table for reliable print layout) -->
<div class="hdr">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:top">
      <div class="hdr-name">${tchr.full_name}</div>
      <div class="hdr-sub">${[tchr.subject, tchr.department].filter(Boolean).join(' &nbsp;&middot;&nbsp; ') || '&nbsp;'}</div>
      <div class="hdr-pills">
        ${tchr.org_name           ? `<span class="pill">${tchr.org_name}</span>` : ''}
        ${tchr.experience_years   ? `<span class="pill">${tchr.experience_years} ${t('pdf.years_experience')}</span>` : ''}
        <span class="pill">${s.review_count || 0} ${t('pdf.total_reviews_label').toLowerCase()}</span>
      </div>
    </td>
    <td class="hdr-right">
      <div class="hdr-label">${t('pdf.report_label')}</div>
      <div class="hdr-date">${now}</div>
    </td>
  </tr></table>
</div>
<div class="accent"></div>

<!-- TWO-COLUMN BODY -->
<table class="body-tbl"><tr>

  <!-- LEFT: score + stats + bio -->
  <td class="col-left">
    <div class="score-box">
      <div class="score-num" style="color:${oc}">${s.avg_overall ? Number(s.avg_overall).toFixed(1) : '—'}<span class="score-denom"> / 5</span></div>
      <div style="margin:7px 0 2px">${stars(s.avg_overall)}</div>
      <div class="score-lbl">${t('pdf.overall_rating_label')}</div>
    </div>

    <div class="sec">${t('pdf.total_reviews_label')}</div>
    <div class="stat-n">${s.review_count || 0}</div>
    <div class="stat-l">${t('pdf.total_reviews_label')}</div>

    ${tchr.experience_years ? `
    <div class="sec">${t('pdf.years_experience')}</div>
    <div class="stat-n">${tchr.experience_years}</div>
    <div class="stat-l">${t('pdf.years_experience')}</div>` : ''}

    ${tchr.bio ? `
    <div class="sec">About</div>
    <div style="font-size:11px;color:#475569;line-height:1.65;font-style:italic">${tchr.bio}</div>` : ''}
  </td>

  <!-- RIGHT: rating bars + feedback quotes -->
  <td class="col-right">
    <div class="sec" style="margin-top:0">${t('pdf.rating_breakdown')}</div>
    ${CRITERIA_CONFIG.map(c => `
      <div class="crit">
        <div class="crit-n">${t(c.label_key)}</div>
        ${bar(s[`avg_${c.slug}`])}
      </div>`).join('')}

    ${quotes.length ? `
      <div class="sec" style="margin-top:22px">${t('pdf.feedback_sample')}</div>
      ${quotes.map(r => `<div class="q">${r.feedback_text}</div>`).join('')}` : ''}
  </td>

</tr></table>

<div class="ftr">${t('pdf.footer', {date: now})} &nbsp;&bull;&nbsp; <strong style="color:#475569">Oasis</strong></div>
</body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 600);
  } catch (err) { toast(err.message, 'error'); }
}

// ============ ADMIN: SUBMISSION TRACKING ============
async function renderAdminSubmissions(selectedPeriodId = null) {
  const periods = await API.get('/admin/feedback-periods');
  const activePeriod = periods.find(p => p.active_status === 1);
  const el = document.getElementById('contentArea');

  // Use selected period or default to active period
  const currentPeriod = selectedPeriodId
    ? periods.find(p => p.id === selectedPeriodId)
    : activePeriod;

  if (!currentPeriod && !activePeriod) {
    el.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('admin.no_feedback_periods')}</h3><p>${t('admin.create_period_hint')}</p></div></div></div>`;
    return;
  }

  const periodToShow = currentPeriod || activePeriod;
  const overview = await API.get(`/admin/submission-overview?feedback_period_id=${periodToShow.id}`);

  // Deduplicate by term_id — one option per term (prefer active period, then most recent)
  const seenTerms = new Set();
  const termOptions = [];
  const sortedForDedup = [...periods].sort((a, b) => (b.active_status - a.active_status) || (b.id - a.id));
  for (const p of sortedForDedup) {
    if (!seenTerms.has(p.term_id)) {
      seenTerms.add(p.term_id);
      termOptions.push(p);
    }
  }
  termOptions.sort((a, b) => b.id - a.id);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <label style="margin-right:10px;font-weight:600">${t('admin.term_filter_label')}</label>
        <select class="form-control" style="display:inline-block;width:auto" onchange="renderAdminSubmissions(parseInt(this.value))">
          ${termOptions.map(p => `
            <option value="${p.id}" ${p.id === periodToShow.id ? 'selected' : ''}>
              ${p.term_name}${p.active_status !== 1 ? ' ' + t('admin.period_closed_badge') : ''}
            </option>
          `).join('')}
        </select>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <div class="card-header">
        <h3>${t('admin.submission_overview_period', {name: periodToShow.term_name})}</h3>
      </div>
      <div class="card-body">
        <div class="grid grid-4" style="margin-bottom:24px">
          <div class="stat-card"><div class="stat-label">${t('admin.total_classrooms')}</div><div class="stat-value">${overview.summary.total_classrooms}</div></div>
          <div class="stat-card"><div class="stat-label">${t('admin.total_students')}</div><div class="stat-value">${overview.summary.total_students}</div></div>
          <div class="stat-card"><div class="stat-label">${t('admin.submitted_col')}</div><div class="stat-value" style="color:var(--success)">${overview.summary.total_submitted}</div></div>
          <div class="stat-card"><div class="stat-label">${t('admin.completion_rate')}</div><div class="stat-value" style="color:${overview.summary.overall_completion_rate >= 70 ? 'var(--success)' : overview.summary.overall_completion_rate >= 50 ? 'var(--warning)' : 'var(--danger)'}">${overview.summary.overall_completion_rate}%</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>${t('admin.classroom_col')}</th>
              <th>${t('admin.teacher_col')}</th>
              <th>${t('admin.total_students_col')}</th>
              <th>${t('admin.submitted_col')}</th>
              <th>${t('admin.not_submitted_col')}</th>
              <th>${t('admin.completion_rate_col')}</th>
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${overview.classrooms.map(c => `
              <tr>
                <td><strong>${c.subject} (${c.grade_level})</strong></td>
                <td>${c.teacher_name}</td>
                <td>${c.total_students}</td>
                <td style="color:var(--success);font-weight:600">${c.submitted_count}</td>
                <td style="color:${c.not_submitted > 0 ? 'var(--danger)' : 'var(--gray-400)'};font-weight:600">${c.not_submitted}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden">
                      <div style="width:${c.completion_rate}%;height:100%;background:${c.completion_rate >= 70 ? 'var(--success)' : 'var(--warning)'}"></div>
                    </div>
                    <span style="font-weight:600;min-width:40px">${c.completion_rate}%</span>
                  </div>
                </td>
                <td><button class="btn btn-sm btn-outline" onclick="viewClassroomSubmissions(${c.id}, ${periodToShow.id})">${t('admin.view_details')}</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function viewClassroomSubmissions(classroomId, periodId) {
  const data = await API.get(`/admin/submission-tracking?classroom_id=${classroomId}&feedback_period_id=${periodId}`);

  openModal(`
    <div class="modal-header">
      <h2>${data.classroom.subject} (${data.classroom.grade_level}) - ${data.classroom.teacher_name}</h2>
      <button onclick="closeModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer">&times;</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:20px">
        <strong>${t('admin.students_submitted', {submitted: data.summary.submitted, total: data.summary.total_students, rate: data.summary.completion_rate})}</strong>
      </div>

      <div style="max-height:400px;overflow-y:auto">
        <table>
          <thead>
            <tr>
              <th>${t('admin.student_col')}</th>
              <th>${t('admin.grade_col')}</th>
              <th>${t('admin.status_col')}</th>
              <th>${t('admin.rating_col')}</th>
              <th>${t('admin.submitted_at')}</th>
            </tr>
          </thead>
          <tbody>
            ${data.students.map(s => `
              <tr>
                <td><strong>${s.full_name}</strong><br><span style="font-size:0.85rem;color:var(--gray-500)">${s.email}</span></td>
                <td>${s.grade_or_position || '-'}</td>
                <td>
                  ${s.submitted
                    ? `<span class="badge badge-approved" style="white-space:nowrap">${t('common.submitted')}</span>`
                    : `<span class="badge badge-rejected" style="white-space:nowrap">${t('common.not_submitted')}</span>`}
                </td>
                <td>${s.submitted ? starsHTML(s.overall_rating) : '-'}</td>
                <td>${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `);
}

// ============ ADMIN: ORGANIZATION APPLICATIONS ============
async function renderAdminApplications() {
  const applications = await API.get('/admin/applications');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <p style="color:var(--gray-500)">${t('admin.applications_count', {count: applications.length})}</p>
    </div>
    ${applications.length === 0 ? `
      <div class="card"><div class="card-body">
        <div class="empty-state">
          <h3>${t('admin.no_applications')}</h3>
          <p>${t('admin.no_applications_hint')}</p>
        </div>
      </div></div>
    ` : `
      <div class="card">
        <div class="table-container">
          <table>
            <thead><tr><th>${t('common.date')}</th><th>${t('admin.organization')}</th><th>${t('admin.contact_col')}</th><th>${t('common.email')}</th><th>${t('admin.phone_col')}</th><th>${t('common.message')}</th><th>${t('common.actions')}</th></tr></thead>
            <tbody>
              ${applications.map(a => `
                <tr>
                  <td style="white-space:nowrap;font-size:0.85rem">${new Date(a.created_at).toLocaleDateString()}</td>
                  <td><strong>${a.org_name}</strong></td>
                  <td>${a.contact_name}</td>
                  <td><a href="mailto:${a.email}" style="color:var(--primary)">${a.email}</a></td>
                  <td style="font-size:0.85rem">${a.phone ? `<a href="tel:${a.phone}" style="color:var(--primary)">${a.phone}</a>` : '<em style="color:var(--gray-400)">—</em>'}</td>
                  <td style="max-width:240px;font-size:0.85rem;color:var(--gray-600)">${a.message ? `<span title="${a.message}">${a.message.length > 70 ? a.message.slice(0, 70) + '…' : a.message}</span>` : '<em style="color:var(--gray-400)">—</em>'}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="deleteApplication(${a.id}, '${a.org_name.replace(/'/g, "\\'")}')">${t('common.delete')}</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;

  // Refresh badge after viewing
  loadApplicationBadge();
}

async function deleteApplication(id, orgName) {
  const confirmed = await confirmDialog(t('admin.delete_app_confirm', {name: orgName}), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/admin/applications/${id}`);
    toast(t('admin.app_deleted'));
    renderAdminApplications();
  } catch (err) { toast(err.message, 'error'); }
}

// ============ ADMIN: SUPPORT MESSAGES ============
async function renderAdminSupport() {
  const { messages, total } = await API.get('/admin/support/messages?limit=100');
  const stats = await API.get('/admin/support/stats');
  const el = document.getElementById('contentArea');

  const categoryLabels = {
    technical: t('support.category_technical'),
    account: t('support.category_account'),
    question: t('support.category_question'),
    feature: t('support.category_feature'),
    other: t('support.category_other')
  };

  el.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px;gap:24px">
      <div class="stat-card">
        <div class="stat-label">${t('admin.total_messages')}</div>
        <div class="stat-value">${stats.total}</div>
      </div>
      <div class="stat-card" style="background:var(--warning-light);border-left:4px solid var(--warning)">
        <div class="stat-label">${t('common.new')}</div>
        <div class="stat-value">${stats.new}</div>
      </div>
      <div class="stat-card" style="background:#e3f2fd;border-left:4px solid var(--primary)">
        <div class="stat-label">${t('common.in_progress')}</div>
        <div class="stat-value">${stats.in_progress}</div>
      </div>
      <div class="stat-card" style="background:var(--success-light);border-left:4px solid var(--success)">
        <div class="stat-label">${t('common.resolved')}</div>
        <div class="stat-value">${stats.resolved}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>${t('admin.support_messages_count', {count: total})}</h3>
      </div>
      <div class="card-body">
        ${messages.length === 0 ? `
          <div class="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
            <h3>${t('admin.no_support_title')}</h3>
            <p>${t('admin.no_support_desc')}</p>
          </div>
        ` : `
          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>${t('common.date')}</th>
                  <th>${t('admin.user_col')}</th>
                  ${currentUser.role === 'super_admin' ? `<th>${t('admin.organization')}</th>` : ''}
                  <th>${t('common.category')}</th>
                  <th>${t('admin.subject_col')}</th>
                  <th>${t('admin.status_col')}</th>
                  <th>${t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                ${messages.map(msg => `
                  <tr>
                    <td style="white-space:nowrap;font-size:0.85rem">${new Date(msg.created_at).toLocaleString()}</td>
                    <td>
                      <div><strong>${msg.user_name}</strong></div>
                      <div style="font-size:0.85rem;color:var(--gray-500)">${msg.user_email}</div>
                      <div><span class="badge badge-pending">${msg.user_role}</span></div>
                    </td>
                    ${currentUser.role === 'super_admin' ? `<td style="font-size:0.85rem">${msg.org_name || '<span style="color:var(--gray-400)">—</span>'}</td>` : ''}
                    <td><span class="badge badge-approved">${categoryLabels[msg.category]}</span></td>
                    <td style="max-width:300px">
                      <strong>${msg.subject}</strong>
                    </td>
                    <td>
                      <span class="badge ${
                        msg.status === 'new' ? 'badge-flagged' :
                        msg.status === 'in_progress' ? 'badge-pending' :
                        'badge-approved'
                      }">${msg.status === 'new' ? t('common.new') : msg.status === 'in_progress' ? t('common.in_progress') : t('common.resolved')}</span>
                    </td>
                    <td style="white-space:nowrap">
                      <button class="btn btn-sm btn-outline" onclick="viewSupportMessage(${msg.id})">${t('admin.view')}</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

async function viewSupportMessage(id) {
  const message = await API.get(`/admin/support/messages?limit=1000`).then(data =>
    data.messages.find(m => m.id === id)
  );

  if (!message) {
    return toast(t('admin.message_not_found'), 'error');
  }

  const categoryLabels = {
    technical: t('support.category_technical'),
    account: t('support.category_account'),
    question: t('support.category_question'),
    feature: t('support.category_feature'),
    other: t('support.category_other')
  };

  openModal(`
    <div class="modal-header">
      <h3>${t('admin.support_message_title', {id: message.id})}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:20px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
          <div>
            <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">${t('common.from')}</div>
            <div style="font-weight:600">${message.user_name}</div>
            <div style="font-size:0.85rem;color:var(--gray-600)">${message.user_email}</div>
            <span class="badge badge-pending" style="margin-top:4px;display:inline-block">${message.user_role}</span>
          </div>
          <div>
            <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">${t('admin.date_label')}</div>
            <div>${new Date(message.created_at).toLocaleString()}</div>
            <div style="margin-top:8px">
              <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">${t('admin.category_label')}</div>
              <span class="badge badge-approved">${categoryLabels[message.category]}</span>
            </div>
          </div>
        </div>

        <div style="margin-bottom:12px">
          <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">${t('admin.status_label')}</div>
          <span class="badge ${
            message.status === 'new' ? 'badge-flagged' :
            message.status === 'in_progress' ? 'badge-pending' :
            'badge-approved'
          }">${message.status === 'new' ? t('common.new') : message.status === 'in_progress' ? t('common.in_progress') : t('common.resolved')}</span>
        </div>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-weight:600;margin-bottom:8px">${t('admin.subject_label')}</div>
        <div style="font-size:1.1rem">${message.subject}</div>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-weight:600;margin-bottom:8px">${t('admin.message_label')}</div>
        <div style="background:#fff;padding:16px;border:1px solid var(--gray-200);border-radius:8px;white-space:pre-wrap">${message.message}</div>
      </div>

      ${message.admin_notes ? `
        <div style="margin-bottom:20px">
          <div style="font-weight:600;margin-bottom:8px">${t('admin.admin_notes')}</div>
          <div style="background:var(--success-light);padding:16px;border-radius:8px;white-space:pre-wrap">${message.admin_notes}</div>
        </div>
      ` : ''}

      ${message.resolved_at ? `
        <div style="color:var(--gray-600);font-size:0.85rem">
          ${t('admin.resolved_on', {date: new Date(message.resolved_at).toLocaleString()})}
        </div>
      ` : ''}

      <div style="margin-top:20px">
        <label style="display:block;margin-bottom:8px;font-weight:600">${t('admin.update_status')}</label>
        <select class="form-control" id="supportMessageStatus" style="margin-bottom:12px">
          <option value="new" ${message.status === 'new' ? 'selected' : ''}>${t('common.new')}</option>
          <option value="in_progress" ${message.status === 'in_progress' ? 'selected' : ''}>${t('common.in_progress')}</option>
          <option value="resolved" ${message.status === 'resolved' ? 'selected' : ''}>${t('common.resolved')}</option>
        </select>

        <label style="display:block;margin-bottom:8px;font-weight:600">${t('admin.admin_notes_label')}</label>
        <textarea class="form-control" id="supportMessageNotes" rows="3" placeholder="${t('admin.admin_notes_placeholder')}">${message.admin_notes || ''}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="deleteSupportMessage(${message.id})">${t('common.delete')}</button>
      <button class="btn btn-outline" onclick="closeModal()">${t('common.close')}</button>
      <button class="btn btn-primary" onclick="updateSupportMessage(${message.id})">${t('common.update')}</button>
    </div>
  `);
}

async function updateSupportMessage(id) {
  const status = document.getElementById('supportMessageStatus').value;
  const admin_notes = document.getElementById('supportMessageNotes').value;

  try {
    await API.put(`/admin/support/messages/${id}`, { status, admin_notes });
    toast(t('admin.support_updated'), 'success');
    closeModal();
    navigateTo('admin-support');
  } catch (error) {
    toast(error.message || 'Failed to update support message', 'error');
  }
}

async function deleteSupportMessage(id) {
  const confirmed = await confirmDialog(t('admin.delete_support_confirm'), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;

  try {
    await API.delete(`/admin/support/messages/${id}`);
    toast(t('admin.support_deleted'), 'success');
    closeModal();
    navigateTo('admin-support');
  } catch (error) {
    toast(error.message || 'Failed to delete support message', 'error');
  }
}

// ============ ADMIN: AUDIT LOGS ============
let currentAuditPage = 1;
const LOGS_PER_PAGE = 50;

async function renderAdminAudit(page = 1) {
  currentAuditPage = page;
  const offset = (page - 1) * LOGS_PER_PAGE;

  // Get total count and logs for current page
  const [allLogs, pagedLogs] = await Promise.all([
    API.get('/admin/audit-logs?limit=10000'), // Get all to count total
    API.get(`/admin/audit-logs?limit=${LOGS_PER_PAGE}&offset=${offset}`)
  ]);

  const totalLogs = allLogs.length;
  const totalPages = Math.ceil(totalLogs / LOGS_PER_PAGE);
  const el = document.getElementById('contentArea');

  // Generate pagination buttons
  const paginationHTML = totalPages > 1 ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:0 16px">
      <div style="color:var(--gray-600);font-size:0.9rem">
        ${t('admin.showing_logs', {start: offset + 1, end: Math.min(offset + LOGS_PER_PAGE, totalLogs), total: totalLogs})}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(1)" ${page === 1 ? 'disabled' : ''}>${t('admin.first')}</button>
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(${page - 1})" ${page === 1 ? 'disabled' : ''}>${t('admin.previous')}</button>
        ${Array.from({length: Math.min(5, totalPages)}, (_, i) => {
          let pageNum;
          if (totalPages <= 5) {
            pageNum = i + 1;
          } else if (page <= 3) {
            pageNum = i + 1;
          } else if (page >= totalPages - 2) {
            pageNum = totalPages - 4 + i;
          } else {
            pageNum = page - 2 + i;
          }
          return `<button class="btn ${pageNum === page ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderAdminAudit(${pageNum})">${pageNum}</button>`;
        }).join('')}
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(${page + 1})" ${page === totalPages ? 'disabled' : ''}>${t('admin.next')}</button>
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(${totalPages})" ${page === totalPages ? 'disabled' : ''}>${t('admin.last')}</button>
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>${t('admin.audit_title', {count: totalLogs})}</h3>
        <p style="margin:4px 0 0;color:var(--gray-600);font-size:0.9rem">${t('admin.page_info', {page, total: totalPages})}</p>
      </div>
      <div class="card-body">
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>${t('admin.timestamp')}</th>
                <th>${t('admin.user_col')}</th>
                <th>${t('common.role')}</th>
                <th>${t('admin.action_col')}</th>
                <th>${t('admin.description')}</th>
                <th>${t('admin.target')}</th>
              </tr>
            </thead>
            <tbody>
              ${pagedLogs.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--gray-400)">${t('admin.no_audit_logs')}</td></tr>` : pagedLogs.map(log => `
                <tr>
                  <td style="white-space:nowrap;font-size:0.85rem">${new Date(log.created_at).toLocaleString()}</td>
                  <td><strong>${log.user_name}</strong></td>
                  <td><span class="badge ${log.user_role === 'super_admin' || log.user_role === 'admin' ? 'badge-flagged' : 'badge-pending'}">${log.user_role}</span></td>
                  <td><code style="font-size:0.85rem">${log.action_type}</code></td>
                  <td style="max-width:300px">${log.action_description}</td>
                  <td>${log.target_type ? `<span class="badge badge-approved">${log.target_type} #${log.target_id}</span>` : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML}
      </div>
    </div>
  `;
}

// ============ UWC EXPERIENCE MAP ============
//
// Student-authored reflections tied to UWC values. Privacy: Model B — every
// reflection is visible to the head of school (by name) and to admins (via
// Users → user → View experiences). Students consent on first visit; the
// consent is stored server-side. A persistent privacy notice on the page
// keeps the visibility model honest, not hidden behind a one-time gate.

const EXP_VALUE_PALETTE = [
  '#059669', '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#a16207'
];

let _expCache = null;       // {experiences, config}
let _expFilters = { category: '', value: '', q: '' };
let _expTab = 'hub';        // 'hub' | 'create' | 'my'

const EXP_ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const EXP_ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

async function loadExperienceConfig() {
  if (_expCache?.config) return _expCache.config;
  const config = await API.get('/experiences/config');
  _expCache = _expCache || {};
  _expCache.config = config;
  return config;
}

function expValueColor(value, config) {
  const i = config.values.indexOf(value);
  return EXP_VALUE_PALETTE[(i >= 0 ? i : 0) % EXP_VALUE_PALETTE.length];
}

function expValueChip(value, config, opts = {}) {
  const color = expValueColor(value, config);
  const removable = opts.removable;
  return `<span class="exp-value-chip" style="--chip-color:${color}">
    ${value}${removable ? `<button type="button" class="exp-value-chip-x" onclick="expRemoveValueFromForm(this)" aria-label="Remove">×</button>` : ''}
  </span>`;
}

async function renderStudentExperiences() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const [config, experiences] = await Promise.all([
    loadExperienceConfig(),
    API.get('/experiences/mine'),
  ]);
  _expCache = { config, experiences };
  _expDraft = _expDraft || { category: null, values: [] };
  paintStudentExperiences();
}

function paintStudentExperiences() {
  const { config, experiences } = _expCache;
  const el = document.getElementById('contentArea');

  if (_expTab === 'hub') {
    el.innerHTML = renderExpHub(experiences.length);
    return;
  }

  const backBtn = `<button class="btn btn-outline btn-sm exp-back-btn" onclick="expSetTab('hub')">← Back</button>`;
  el.innerHTML = `
    <div class="exp-hero">
      <h1 class="exp-hero-title">UWC EXPERIENCE MAP</h1>
      <p class="exp-hero-sub">Every moment is a landmark. Map your journey through our shared values.</p>
    </div>
    ${backBtn}
    ${_expTab === 'create' ? renderExpOrbitPicker(config) : renderExpMyTab(config, experiences)}
  `;
}

function renderExpHub(count) {
  return `
    <div class="exp-hero">
      <h1 class="exp-hero-title">UWC EXPERIENCE MAP</h1>
      <p class="exp-hero-sub">Every moment is a landmark. Map your journey through our shared values.</p>
    </div>
    <div class="exp-hub">
      <div class="exp-hub-card" onclick="expSetTab('create')" tabindex="0" onkeydown="if(event.key==='Enter')expSetTab('create')" role="button" aria-label="Create a UWC Experience Map">
        <div class="exp-hub-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <circle cx="12" cy="12" r="4"/>
            <circle cx="12" cy="3" r="1.4" fill="currentColor"/>
            <circle cx="21" cy="12" r="1.4" fill="currentColor"/>
            <circle cx="12" cy="21" r="1.4" fill="currentColor"/>
            <circle cx="3"  cy="12" r="1.4" fill="currentColor"/>
          </svg>
        </div>
        <div class="exp-hub-title">Create a UWC Experience Map</div>
        <div class="exp-hub-desc">Pick an experience, connect it to UWC values, and capture what it meant to you.</div>
        <div class="exp-hub-arrow">→</div>
      </div>
      <div class="exp-hub-card" onclick="expSetTab('my')" tabindex="0" onkeydown="if(event.key==='Enter')expSetTab('my')" role="button" aria-label="My UWC Experience Maps">
        <div class="exp-hub-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/>
            <path d="M9 4v14"/>
            <path d="M15 6v14"/>
          </svg>
        </div>
        <div class="exp-hub-title">My UWC Experience Maps ${count ? `<span class="exp-hub-count">${count}</span>` : ''}</div>
        <div class="exp-hub-desc">Browse, search, edit, or delete the moments you've already mapped.</div>
        <div class="exp-hub-arrow">→</div>
      </div>
    </div>
  `;
}

function renderExpMyTab(config, experiences) {
  const q = (_expFilters.q || '').trim().toLowerCase();
  const filtered = experiences.filter(e => {
    if (_expFilters.category && e.category !== _expFilters.category) return false;
    if (_expFilters.value && !(e.values || []).includes(_expFilters.value)) return false;
    if (q) {
      const hay = (e.title + ' ' + e.reflection + ' ' + e.category + ' ' + (e.values || []).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const valueCounts = Object.fromEntries(config.values.map(v => [v, 0]));
  experiences.forEach(e => (e.values || []).forEach(v => { if (valueCounts[v] !== undefined) valueCounts[v]++; }));
  const topValue = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]).find(([, c]) => c > 0);
  const valuesExplored = Object.values(valueCounts).filter(c => c > 0).length;

  return `
    <div class="grid grid-3 exp-summary">
      <div class="exp-stat-card">
        <div class="exp-stat-label">Total reflections</div>
        <div class="exp-stat-value">${experiences.length}</div>
      </div>
      <div class="exp-stat-card">
        <div class="exp-stat-label">Most connected value</div>
        <div class="exp-stat-value-sm">${topValue ? `<span class="exp-value-chip" style="--chip-color:${expValueColor(topValue[0], config)}">${topValue[0]}</span> <span class="exp-stat-meta">${topValue[1]}×</span>` : '<span class="exp-stat-empty">—</span>'}</div>
      </div>
      <div class="exp-stat-card">
        <div class="exp-stat-label">Values explored</div>
        <div class="exp-stat-value">${valuesExplored} <span class="exp-stat-meta">/ ${config.values.length}</span></div>
      </div>
    </div>

    <div class="card exp-filters-card">
      <div class="card-body exp-filters-body">
        <div class="exp-filter-row">
          <div class="exp-filter-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="expSearch" type="search" class="form-control" placeholder="Search title or reflection" value="${escapeAttr(_expFilters.q || '')}" oninput="expSetFilterQ(this.value)" autocomplete="off" style="padding-left:36px">
          </div>
          <select id="expCategoryFilter" onchange="expSetFilterCategory(this.value)" class="form-control exp-filter-select">
            <option value="">All categories</option>
            ${config.categories.map(c => `<option value="${escapeAttr(c)}" ${_expFilters.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <select id="expValueFilter" onchange="expSetFilterValue(this.value)" class="form-control exp-filter-select">
            <option value="">All values</option>
            ${config.values.map(v => `<option value="${escapeAttr(v)}" ${_expFilters.value === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          ${(_expFilters.category || _expFilters.value || _expFilters.q) ? `<button class="btn btn-sm btn-outline" onclick="expClearFilters()">Clear filters</button>` : ''}
        </div>
        <div class="exp-filter-summary">${filtered.length} of ${experiences.length} reflection${experiences.length !== 1 ? 's' : ''}</div>
      </div>
    </div>

    <div id="expCardList" class="exp-card-list">
      ${experiences.length === 0
        ? `<div class="exp-empty-state">
            <div class="exp-empty-icon">📍</div>
            <h3>No reflections yet</h3>
            <p>Switch to "Create a UWC Experience Map" to capture your first moment.</p>
            <button class="btn btn-primary" onclick="expSetTab('create')">Create a UWC Experience Map</button>
          </div>`
        : filtered.length === 0
          ? `<div class="exp-empty-state exp-empty-state--filtered">
              <p>No reflections match these filters.</p>
              <button class="btn btn-sm btn-outline" onclick="expClearFilters()">Clear filters</button>
            </div>`
          : filtered.map(e => expCardHTML(e, config)).join('')
      }
    </div>
  `;
}

window.expSetTab = function (tab) {
  _expTab = tab;
  paintStudentExperiences();
};

function expCardHTML(e, config) {
  const preview = (e.reflection || '').slice(0, 240);
  const truncated = (e.reflection || '').length > 240;
  return `<article class="exp-card" data-id="${e.id}">
    <div class="exp-card-head">
      <div>
        <h3 class="exp-card-title">${escapeHtml(e.title)}</h3>
        <div class="exp-card-meta">
          <span class="exp-card-category">${escapeHtml(e.category)}</span>
          <span class="exp-card-dot">·</span>
          <span class="exp-card-date">${formatExpDate(e.date)}</span>
        </div>
      </div>
      <div class="exp-card-actions">
        <button class="btn btn-sm btn-outline exp-card-action-btn" title="Edit" onclick="openExperienceForm(${e.id})" aria-label="Edit">${EXP_ICON_EDIT}<span>Edit</span></button>
        <button class="btn btn-sm btn-outline exp-card-action-btn exp-card-action-btn--danger" title="Delete" onclick="confirmDeleteExperience(${e.id})" aria-label="Delete">${EXP_ICON_TRASH}<span>Delete</span></button>
      </div>
    </div>
    <div class="exp-card-values">
      ${(e.values || []).map(v => expValueChip(v, config)).join('')}
    </div>
    <div class="exp-card-reflection">${escapeHtml(preview)}${truncated ? '…' : ''}</div>
  </article>`;
}

// ─── Orbital picker ───────────────────────────────────────────────────────────
// Outer ring = experience categories (10). Inner ring = UWC values (9).
// Center = live "N/3 VALUES" counter. Right panel = title + date + reflection
// + save. The picker is the primary "add" surface; editing still uses the
// modal because re-entering the orbital state for an existing entry is
// noisier than just opening a focused dialog.

let _expDraft = { category: null, values: [] };

// Outer ring uses the full category names. Inner ring shows a 1-2 word short
// label inside the circle (so the orb stays compact) plus a small "i" badge
// that reveals the full UWC value name in a modal. Hover tooltip is also
// wired via the title attribute as a fallback.
const EXP_VALUE_SHORT = {
  'Intercultural understanding': 'Intercultural',
  'Celebration of difference': 'Diversity',
  'Personal responsibility and integrity': 'Integrity',
  'Mutual responsibility and respect': 'Mutual respect',
  'Compassion and service': 'Compassion',
  'Respect for the environment': 'Environment',
  'A sense of idealism': 'Idealism',
  'Personal challenge': 'Challenge',
  'Action and personal example': 'Action',
};

function expOrbitPosition(index, total, radiusPct) {
  // Place item index on a circle, top of circle = index 0.
  const angle = ((index / total) * 360 - 90) * Math.PI / 180;
  const x = 50 + radiusPct * Math.cos(angle);
  const y = 50 + radiusPct * Math.sin(angle);
  return { x, y };
}

function expGetAllCategories(config) {
  // Outer ring is now a fixed list of UWC categories. Custom "+" was
  // removed in favour of a permanent "Global Issues Forum (GIFs)" slot.
  return [...(config.categories || [])];
}

function renderExpOrbitPicker(config) {
  const cats = expGetAllCategories(config);
  const vals = config.values;

  const outerSlots = cats.length;
  const outerNodes = cats.map((c, i) => {
    const { x, y } = expOrbitPosition(i, outerSlots, 47);
    const isSelected = _expDraft.category === c;
    return `<button type="button"
      class="exp-orbit-node exp-orbit-node--outer ${isSelected ? 'is-selected' : ''}"
      style="left:${x}%;top:${y}%"
      data-category="${escapeAttr(c)}"
      onclick="expSelectCategory('${escapeAttr(c).replace(/'/g, "\\'")}')"
      title="${escapeAttr(c)}">
      <span class="exp-orbit-node-label">${escapeHtml(c)}</span>
    </button>`;
  }).join('');

  const innerNodes = vals.map((v, i) => {
    const { x, y } = expOrbitPosition(i, vals.length, 26);
    // Place the info badge on the side of the orb that faces the orbit
    // center: opposite the wrapper's angular position. Math: wrapper sits
    // at angle θ from orbit center (same as expOrbitPosition); the
    // center-facing direction is θ+180°. We translate that vector inside
    // the wrapper's coordinate space (50,50 = wrapper center, 50,100 =
    // wrapper bottom, etc.).
    const angleDeg = (i / vals.length) * 360 - 90;
    const opp = (angleDeg + 180) * Math.PI / 180;
    const infoX = 50 + 50 * Math.cos(opp);
    const infoY = 50 + 50 * Math.sin(opp);
    const isSelected = _expDraft.values.includes(v);
    const shortLabel = EXP_VALUE_SHORT[v] || v;
    const safeFull = escapeAttr(v).replace(/'/g, "\\'");
    return `<div class="exp-orbit-inner-wrap" style="left:${x}%;top:${y}%">
      <button type="button"
        class="exp-orbit-node exp-orbit-node--inner ${isSelected ? 'is-selected' : ''}"
        data-value="${escapeAttr(v)}"
        onclick="expToggleValue('${safeFull}')"
        title="${escapeAttr(v)}">
        <span class="exp-orbit-node-label">${escapeHtml(shortLabel)}</span>
      </button>
      <button type="button"
        class="exp-orbit-info-btn"
        style="left:${infoX.toFixed(1)}%;top:${infoY.toFixed(1)}%"
        onclick="expShowValueInfo('${safeFull}')"
        aria-label="What does ${escapeAttr(v)} mean?"
        title="View full name">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
    </div>`;
  }).join('');

  const valueChips = _expDraft.values.length === 0
    ? '<span class="exp-orbit-panel-empty">Pick up to 3 values from the inner ring</span>'
    : _expDraft.values.map(v => `<span class="exp-value-chip" style="--chip-color:${expValueColor(v, config)}">${v}</span>`).join('');

  return `
    <section class="exp-orbit-shell">
      <div class="exp-orbit-stage" id="expOrbitStage">
        <div class="exp-orbit-ring exp-orbit-ring--outer" aria-hidden="true"></div>
        <div class="exp-orbit-ring exp-orbit-ring--inner" aria-hidden="true"></div>
        <div class="exp-orbit-center">
          <div class="exp-orbit-center-count"><span id="expValueCount">${_expDraft.values.length}</span>/3</div>
        </div>
        ${outerNodes}
        ${innerNodes}
      </div>
      <aside class="exp-orbit-panel">
        <h3 class="exp-orbit-panel-title">CAPTURE A MOMENT</h3>
        <div class="exp-orbit-panel-block">
          <div class="exp-orbit-panel-label">Selected experience</div>
          <div class="exp-orbit-panel-value" id="expDraftCategory">${_expDraft.category ? escapeHtml(_expDraft.category) : '<span class="exp-orbit-panel-empty">Click a category on the outer ring</span>'}</div>
        </div>
        <div class="exp-orbit-panel-block">
          <div class="exp-orbit-panel-label">UWC values <span class="exp-orbit-panel-meta"><span id="expValueCountInline">${_expDraft.values.length}</span>/3</span></div>
          <div class="exp-orbit-panel-chips" id="expDraftValues">${valueChips}</div>
        </div>
        <div class="exp-orbit-panel-divider"></div>
        <form id="expOrbitForm" onsubmit="expSaveOrbital(event)">
          <input type="text" id="expOrbitTitle" class="form-control exp-orbit-input" placeholder="Title" maxlength="${config.limits.max_title}" required>
          <textarea id="expOrbitReflection" class="form-control exp-orbit-textarea" rows="5" minlength="${config.limits.min_reflection}" maxlength="${config.limits.max_reflection}" placeholder="How did this experience develop your understanding of the UWC values?" required oninput="document.getElementById('expOrbitCounter').textContent = this.value.length"></textarea>
          <div class="exp-orbit-counter"><span id="expOrbitCounter">0</span> / ${config.limits.max_reflection} (min ${config.limits.min_reflection})</div>
          <button type="submit" class="exp-orbit-save">CAPTURE THIS MOMENT</button>
        </form>
      </aside>
    </section>
  `;
}

window.expSelectCategory = function (cat) {
  _expDraft.category = _expDraft.category === cat ? null : cat;
  expRepaintOrbit();
};

window.expShowValueInfo = function (fullName) {
  openModal(`
    <div class="modal-header">
      <h3>UWC Value</h3>
      <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body" style="text-align:center;padding:32px 24px">
      <div style="font-size:1.4rem;font-weight:700;color:#0f172a;line-height:1.35">${escapeHtml(fullName)}</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal()">Got it</button>
    </div>
  `);
};

window.expToggleValue = function (v) {
  const i = _expDraft.values.indexOf(v);
  if (i >= 0) {
    _expDraft.values.splice(i, 1);
  } else {
    if (_expDraft.values.length >= 3) {
      toast('You can select up to 3 values for each experience.', 'error');
      return;
    }
    _expDraft.values.push(v);
  }
  expRepaintOrbit();
};

function expRepaintOrbit() {
  // In-place updates so the form's text/date/reflection inputs keep state.
  const config = _expCache?.config;
  if (!config) return;

  // Outer ring selection
  document.querySelectorAll('.exp-orbit-node--outer').forEach(btn => {
    btn.classList.toggle('is-selected', btn.dataset.category === _expDraft.category);
  });
  // Inner ring selection
  document.querySelectorAll('.exp-orbit-node--inner').forEach(btn => {
    btn.classList.toggle('is-selected', _expDraft.values.includes(btn.dataset.value));
  });
  // Counters
  const countEls = [document.getElementById('expValueCount'), document.getElementById('expValueCountInline')];
  countEls.forEach(e => { if (e) e.textContent = _expDraft.values.length; });
  // Selected category text
  const catEl = document.getElementById('expDraftCategory');
  if (catEl) {
    catEl.innerHTML = _expDraft.category
      ? escapeHtml(_expDraft.category)
      : '<span class="exp-orbit-panel-empty">Click a category on the outer ring</span>';
  }
  // Selected values chips
  const chipsEl = document.getElementById('expDraftValues');
  if (chipsEl) {
    chipsEl.innerHTML = _expDraft.values.length === 0
      ? '<span class="exp-orbit-panel-empty">Pick up to 3 values from the inner ring</span>'
      : _expDraft.values.map(v => `<span class="exp-value-chip" style="--chip-color:${expValueColor(v, config)}">${v}</span>`).join('');
  }
}

window.expSaveOrbital = async function (e) {
  e.preventDefault();
  if (!_expDraft.category) return toast('Pick an experience on the outer ring.', 'error');
  if (_expDraft.values.length < 1) return toast('Pick at least one UWC value.', 'error');

  const title = document.getElementById('expOrbitTitle').value.trim();
  const reflection = document.getElementById('expOrbitReflection').value.trim();

  const payload = {
    title,
    category: _expDraft.category,
    experience_date: new Date().toISOString().slice(0, 10),
    reflection,
    values: _expDraft.values,
  };

  try {
    await API.post('/experiences', payload);
    toast('Your experience has been added to your map.');
    _expDraft = { category: null, values: [] };
    _expTab = 'my';
    _expCache = null;
    renderStudentExperiences();
  } catch (err) {
    toast(err.message || 'Could not save experience', 'error');
  }
};

window.expSetFilterCategory = function (v) {
  _expFilters.category = v || '';
  paintStudentExperiences();
};
window.expSetFilterValue = function (v) {
  _expFilters.value = v || '';
  paintStudentExperiences();
};
let _expSearchTimer = null;
window.expSetFilterQ = function (v) {
  _expFilters.q = v || '';
  if (_expSearchTimer) clearTimeout(_expSearchTimer);
  // Debounce repaints; keep input focused
  _expSearchTimer = setTimeout(() => {
    const list = document.getElementById('expCardList');
    if (!list) return paintStudentExperiences();
    paintStudentExperiences();
    const search = document.getElementById('expSearch');
    if (search) {
      search.focus();
      const len = search.value.length;
      try { search.setSelectionRange(len, len); } catch (_) {}
    }
  }, 80);
};
window.expClearFilters = function () {
  _expFilters = { category: '', value: '', q: '' };
  paintStudentExperiences();
};

window.openExperienceForm = function (id) {
  const config = _expCache?.config;
  if (!config) return;
  const editing = id ? _expCache.experiences.find(e => e.id === id) : null;
  const today = new Date().toISOString().slice(0, 10);
  const initialValues = editing ? [...(editing.values || [])] : [];

  openModal(`
    <form id="experienceForm" onsubmit="submitExperienceForm(event, ${id || 'null'})">
      <div class="modal-header">
        <h3>${editing ? 'Edit experience' : 'Add experience'}</h3>
        <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="expTitle">Title</label>
          <input id="expTitle" name="title" class="form-control" type="text" maxlength="${config.limits.max_title}" required value="${editing ? escapeAttr(editing.title) : ''}" placeholder="What happened?">
        </div>

        <div class="exp-form-row">
          <div class="form-group">
            <label for="expCategory">Category</label>
            <select id="expCategory" name="category" class="form-control" required>
              <option value="">Choose a category</option>
              ${config.categories.map(c => `<option value="${escapeAttr(c)}" ${editing && editing.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="expDate">Date</label>
            <input id="expDate" name="experience_date" class="form-control" type="date" required max="${today}" value="${editing ? editing.date : today}">
          </div>
        </div>

        <div class="form-group">
          <label>UWC values <span class="exp-form-hint">Pick 1 to 3</span></label>
          <div id="expValuesPicker" class="exp-values-picker">
            ${initialValues.map(v => expValueChip(v, config, { removable: true })).join('')}
            <select id="expValueSelect" class="form-control exp-values-select" onchange="expAddValueToForm(this)">
              <option value="">Add a value…</option>
              ${config.values.map(v => `<option value="${escapeAttr(v)}" ${initialValues.includes(v) ? 'disabled' : ''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label for="expReflection">Reflection</label>
          <textarea id="expReflection" name="reflection" class="form-control" rows="6" minlength="${config.limits.min_reflection}" maxlength="${config.limits.max_reflection}" required placeholder="What did this experience teach you? Which values did it connect to and why?">${editing ? escapeHtml(editing.reflection) : ''}</textarea>
          <div class="exp-form-counter"><span id="expReflectionCount">${editing ? editing.reflection.length : 0}</span> / ${config.limits.max_reflection} (min ${config.limits.min_reflection})</div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Experience</button>
      </div>
    </form>
  `);

  const ta = document.getElementById('expReflection');
  if (ta) ta.addEventListener('input', () => {
    const cnt = document.getElementById('expReflectionCount');
    if (cnt) cnt.textContent = ta.value.length;
  });
};

window.expAddValueToForm = function (select) {
  const v = select.value;
  if (!v) return;
  const picker = document.getElementById('expValuesPicker');
  const chips = picker.querySelectorAll('.exp-value-chip');
  if (chips.length >= 3) {
    toast('You can select up to 3 values for each experience.', 'error');
    select.value = '';
    return;
  }
  const config = _expCache.config;
  const chipHTML = expValueChip(v, config, { removable: true });
  select.insertAdjacentHTML('beforebegin', chipHTML);
  // Disable that option
  Array.from(select.options).forEach(o => { if (o.value === v) o.disabled = true; });
  select.value = '';
};

window.expRemoveValueFromForm = function (btn) {
  const chip = btn.closest('.exp-value-chip');
  const value = chip.textContent.replace('×', '').trim();
  chip.remove();
  const select = document.getElementById('expValueSelect');
  if (select) {
    Array.from(select.options).forEach(o => { if (o.value === value) o.disabled = false; });
  }
};

window.submitExperienceForm = async function (e, id) {
  e.preventDefault();
  const form = e.target;
  const picker = document.getElementById('expValuesPicker');
  const values = Array.from(picker.querySelectorAll('.exp-value-chip')).map(c =>
    c.textContent.replace('×', '').trim()
  );
  const payload = {
    title: form.title.value.trim(),
    category: form.category.value,
    experience_date: form.experience_date.value,
    reflection: form.reflection.value.trim(),
    values,
  };
  if (values.length < 1) return toast('Pick at least one UWC value.', 'error');
  if (values.length > 3) return toast('You can select up to 3 values for each experience.', 'error');

  try {
    if (id) {
      await API.patch(`/experiences/${id}`, payload);
      toast('Experience updated.');
    } else {
      await API.post('/experiences', payload);
      toast('Your experience has been added to your map.');
    }
    closeModal();
    _expCache = null;
    renderStudentExperiences();
  } catch (err) {
    toast(err.message || 'Could not save experience', 'error');
  }
};

window.confirmDeleteExperience = async function (id) {
  const ok = await confirmDialog('Delete this experience? This cannot be undone.', 'Delete', 'Cancel');
  if (!ok) return;
  try {
    await API.delete(`/experiences/${id}`);
    toast('Experience deleted.');
    _expCache = null;
    renderStudentExperiences();
  } catch (err) {
    toast(err.message || 'Could not delete experience', 'error');
  }
};

function formatExpDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Safe interpolation of a string into an inline `onclick="..."` attribute.
// JSON.stringify produces `"value"` (with double quotes) which would close
// the surrounding double-quoted attribute. HTML-encoding the inner double
// quotes yields a payload that the HTML parser converts back to a JS string
// literal when the onclick is evaluated. Use for any string passed as a JS
// argument inside an inline event handler.
function jsAttr(value) {
  return JSON.stringify(value == null ? '' : String(value)).replace(/"/g, '&quot;');
}

// ============ HEAD: Experience Map overview ============
let _headExpData = null;
let _headExpConfig = null;
let _headExpStudentsPage = 1;
let _headExpStudentsQuery = '';
const HEAD_EXP_PAGE_SIZE = 10;

async function renderHeadExperiences() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const [data, config] = await Promise.all([
    API.get('/experiences/head/overview'),
    loadExperienceConfig(),
  ]);
  _headExpData = data;
  _headExpConfig = config;
  _headExpStudentsPage = 1;
  _headExpStudentsQuery = '';
  paintHeadExperiences();
}

function paintHeadExperiences() {
  const data = _headExpData;
  const el = document.getElementById('contentArea');
  const { totals, by_category, by_value, students } = data;
  const topValue = by_value[0]?.count ? by_value[0] : null;
  const topCategory = by_category[0]?.count ? by_category[0] : null;

  el.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:24px">
      <div class="stat-card"><div class="stat-label">Total reflections</div><div class="stat-value">${totals.total_experiences}</div></div>
      <div class="stat-card exp-top-card">
        <div class="stat-label">Top value</div>
        <div class="exp-top-tag-row">${topValue
          ? `<span class="exp-top-tag exp-top-tag--value">${escapeHtml(topValue.value)}</span><span class="exp-top-count">${topValue.count}×</span>`
          : '<span class="score-empty">N/A</span>'}</div>
      </div>
      <div class="stat-card exp-top-card">
        <div class="stat-label">Top experience</div>
        <div class="exp-top-tag-row">${topCategory
          ? `<span class="exp-top-tag exp-top-tag--experience">${escapeHtml(topCategory.category)}</span><span class="exp-top-count">${topCategory.count}×</span>`
          : '<span class="score-empty">N/A</span>'}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <div class="card-header"><h3>Reflections by UWC value</h3></div>
        <div class="card-body" style="height:340px">${by_value.some(v => v.count) ? '<canvas id="headExpByValue"></canvas>' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-400);font-size:0.9rem">N/A.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Reflections by category</h3></div>
        <div class="card-body" style="height:340px">${by_category.length ? '<canvas id="headExpByCategory"></canvas>' : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-400);font-size:0.9rem">N/A.</div>'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h3>Students</h3>
        <span style="font-size:0.78rem;color:var(--gray-500)" id="headExpStudentsCount"></span>
      </div>
      <div class="card-body" style="padding:0">
        <div style="padding:12px 16px;border-bottom:1px solid var(--gray-100)">
          <input id="headExpStudentSearch" type="search" class="form-control" placeholder="Search students by name" value="${escapeAttr(_headExpStudentsQuery)}" oninput="headExpSetStudentQuery(this.value)" autocomplete="off">
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Grade</th>
                <th style="text-align:right">Reflections</th>
                <th>Last reflection</th>
                <th style="text-align:right">${t('common.actions')}</th>
              </tr>
            </thead>
            <tbody id="headExpStudentsBody"></tbody>
          </table>
        </div>
        <div id="headExpStudentsPager" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--gray-100);flex-wrap:wrap"></div>
      </div>
    </div>
  `;

  paintHeadExpStudentsTable();

  // Charts
  const palette = ['#059669', '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#a16207'];
  const valCtx = document.getElementById('headExpByValue');
  if (valCtx) {
    chartInstances.headExpByValue = new Chart(valCtx, {
      type: 'bar',
      data: {
        labels: by_value.map(v => v.value),
        datasets: [{ label: 'Reflections', data: by_value.map(v => v.count), backgroundColor: by_value.map((_, i) => palette[i % palette.length]), borderRadius: 6 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } }, y: { ticks: { font: { size: 11 } } } },
      },
    });
  }
  const catCtx = document.getElementById('headExpByCategory');
  if (catCtx) {
    // Each category bar gets its own color — same palette as the by-value
    // chart so the two charts feel like one set rather than two random ones.
    chartInstances.headExpByCategory = new Chart(catCtx, {
      type: 'bar',
      data: {
        labels: by_category.map(c => c.category),
        datasets: [{
          label: 'Reflections',
          data: by_category.map(c => c.count),
          backgroundColor: by_category.map((_, i) => palette[i % palette.length]),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } },
      },
    });
  }
}

function paintHeadExpStudentsTable() {
  const all = _headExpData?.students || [];
  const q = _headExpStudentsQuery.trim().toLowerCase();
  const filtered = q
    ? all.filter(s => (s.student_name || '').toLowerCase().includes(q))
    : all;
  const totalPages = Math.max(1, Math.ceil(filtered.length / HEAD_EXP_PAGE_SIZE));
  if (_headExpStudentsPage > totalPages) _headExpStudentsPage = totalPages;
  if (_headExpStudentsPage < 1) _headExpStudentsPage = 1;
  const start = (_headExpStudentsPage - 1) * HEAD_EXP_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + HEAD_EXP_PAGE_SIZE);

  const body = document.getElementById('headExpStudentsBody');
  if (!body) return;
  body.innerHTML = pageRows.length
    ? pageRows.map(s => `
        <tr>
          <td><strong>${escapeHtml(s.student_name || '')}</strong></td>
          <td>${s.grade ? escapeHtml(s.grade) : '<span style="color:var(--gray-400)">N/A</span>'}</td>
          <td style="text-align:right;font-weight:600">${s.count}</td>
          <td>${s.last_date ? formatExpDate(s.last_date) : '<span style="color:var(--gray-400)">N/A</span>'}</td>
          <td style="text-align:right">
            <button class="btn btn-sm ${s.count > 0 ? 'btn-primary' : 'btn-outline'}" ${s.count === 0 ? 'disabled' : ''} onclick="viewStudentExperiencesAsHead(${s.student_id})">View</button>
          </td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-500)">No students match.</td></tr>`;

  const counter = document.getElementById('headExpStudentsCount');
  if (counter) {
    counter.textContent = q
      ? `${filtered.length} of ${all.length} student${all.length !== 1 ? 's' : ''}`
      : `${all.length} student${all.length !== 1 ? 's' : ''}`;
  }

  const pager = document.getElementById('headExpStudentsPager');
  if (pager) {
    if (filtered.length <= HEAD_EXP_PAGE_SIZE) {
      pager.innerHTML = '';
    } else {
      const from = filtered.length === 0 ? 0 : start + 1;
      const to = Math.min(filtered.length, start + HEAD_EXP_PAGE_SIZE);
      pager.innerHTML = `
        <span style="font-size:0.82rem;color:var(--gray-500)">${from}–${to} of ${filtered.length}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-sm btn-outline" onclick="headExpStudentsPage(${_headExpStudentsPage - 1})" ${_headExpStudentsPage === 1 ? 'disabled' : ''}>← Prev</button>
          <span style="font-size:0.82rem;color:var(--gray-600)">Page ${_headExpStudentsPage} of ${totalPages}</span>
          <button class="btn btn-sm btn-outline" onclick="headExpStudentsPage(${_headExpStudentsPage + 1})" ${_headExpStudentsPage >= totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      `;
    }
  }
}

let _headExpStudentsTimer = null;
window.headExpSetStudentQuery = function (v) {
  _headExpStudentsQuery = v || '';
  _headExpStudentsPage = 1;
  if (_headExpStudentsTimer) clearTimeout(_headExpStudentsTimer);
  _headExpStudentsTimer = setTimeout(() => {
    paintHeadExpStudentsTable();
    const input = document.getElementById('headExpStudentSearch');
    if (input) {
      input.focus();
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (_) {}
    }
  }, 80);
};

window.headExpStudentsPage = function (page) {
  _headExpStudentsPage = page;
  paintHeadExpStudentsTable();
};

// Reflection drilldown — the modal HTML is shared between head and mentor.
// Endpoints differ (head can read any student; mentor only their mentees) so
// the calling site picks the right URL.
function renderStudentExperiencesModalHTML(data, config) {
  const { student, experiences } = data;

  // Same four headline stats as the student's own "My UWC Experience Maps"
  // page. Computed from the student's reflections so the head sees exactly
  // what the student would see on their own dashboard, plus the timeline below.
  const valueCounts = Object.fromEntries((config.values || []).map(v => [v, 0]));
  experiences.forEach(e => (e.values || []).forEach(v => {
    if (valueCounts[v] !== undefined) valueCounts[v]++;
  }));
  const topValueEntry = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]).find(([, c]) => c > 0);
  const valuesExplored = Object.values(valueCounts).filter(c => c > 0).length;

  const statsHTML = `
    <div class="grid grid-3 exp-summary" style="margin-bottom:20px">
      <div class="exp-stat-card">
        <div class="exp-stat-label">Total reflections</div>
        <div class="exp-stat-value">${experiences.length}</div>
      </div>
      <div class="exp-stat-card">
        <div class="exp-stat-label">Most connected value</div>
        <div class="exp-stat-value-sm">${topValueEntry
          ? `<span class="exp-value-chip" style="--chip-color:${expValueColor(topValueEntry[0], config)}">${escapeHtml(topValueEntry[0])}</span> <span class="exp-stat-meta">${topValueEntry[1]}×</span>`
          : '<span class="exp-stat-empty">—</span>'}</div>
      </div>
      <div class="exp-stat-card">
        <div class="exp-stat-label">Values explored</div>
        <div class="exp-stat-value">${valuesExplored} <span class="exp-stat-meta">/ ${(config.values || []).length}</span></div>
      </div>
    </div>
  `;

  return `
    <div class="modal-header">
      <h3>${escapeHtml(student.full_name)}'s UWC Experience Map</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body" style="min-width:0">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px;font-size:0.85rem;color:var(--gray-600)">
        <span>${escapeHtml(student.email)}${student.grade_or_position ? ' · ' + escapeHtml(student.grade_or_position) : ''}</span>
        <span>${experiences.length} reflection${experiences.length !== 1 ? 's' : ''}</span>
      </div>
      ${experiences.length === 0
        ? `${statsHTML}<p style="color:var(--gray-500);text-align:center;padding:32px">No reflections yet.</p>`
        : `${statsHTML}${experiences.map(e => `
          <article class="exp-card exp-card--readonly">
            <div class="exp-card-head">
              <div>
                <h3 class="exp-card-title">${escapeHtml(e.title)}</h3>
                <div class="exp-card-meta">
                  <span class="exp-card-category">${escapeHtml(e.category)}</span>
                  <span class="exp-card-dot">·</span>
                  <span class="exp-card-date">${formatExpDate(e.date)}</span>
                </div>
              </div>
            </div>
            <div class="exp-card-values">${(e.values || []).map(v => expValueChip(v, config)).join('')}</div>
            <div class="exp-card-reflection">${escapeHtml(e.reflection)}</div>
          </article>
        `).join('')}`}
    </div>
    <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
  `;
}

window.viewStudentExperiencesAsHead = async function (studentId) {
  try {
    const [data, config] = await Promise.all([
      API.get(`/experiences/head/student/${studentId}`),
      loadExperienceConfig(),
    ]);
    openModal(renderStudentExperiencesModalHTML(data, config));
  } catch (err) {
    toast(err.message || 'Could not load student', 'error');
  }
};

window.viewMenteeExperiences = async function (studentId) {
  try {
    const [data, config] = await Promise.all([
      API.get(`/experiences/mentor/student/${studentId}`),
      loadExperienceConfig(),
    ]);
    openModal(renderStudentExperiencesModalHTML(data, config));
  } catch (err) {
    toast(err.message || 'Could not load mentee', 'error');
  }
};


// ============ ACCOUNT DETAILS ============
async function renderAccount() {
  const data = await API.get('/auth/me');
  currentUser = data.user;
  const u = currentUser;
  const el = document.getElementById('contentArea');

  const memberSince = new Date(u.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  el.innerHTML = `
    <div class="grid grid-2">
      <!-- Profile Info -->
      <div class="card">
        <div class="card-header"><h3>${t('account.profile_info')}</h3></div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:28px">
            <div id="avatarPreview" style="width:72px;height:72px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.5rem;font-weight:700;flex-shrink:0">
              ${u.full_name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <div style="font-size:1.25rem;font-weight:600">${u.full_name}</div>
              <div style="color:var(--gray-500);font-size:0.9rem">${u.email}</div>
              <div style="margin-top:6px">
                <span class="badge ${u.role === 'super_admin' ? 'badge-flagged' : u.role === 'admin' ? 'badge-flagged' : u.role === 'teacher' ? 'badge-active' : u.role === 'head' ? 'badge-approved' : 'badge-pending'}">${{student: t('common.student'), teacher: t('common.teacher'), school_head: t('common.school_head'), admin: t('common.admin'), super_admin: t('common.super_admin')}[u.role] || u.role}</span>
              </div>
            </div>
          </div>

          <form onsubmit="updateProfile(event)">
            <div class="form-group">
              <label>${t('account.full_name')}</label>
              <input type="text" class="form-control" id="profileName" value="${u.full_name}" required>
            </div>
            <div class="form-group">
              <label>${t('account.email')}</label>
              <input type="email" class="form-control" value="${u.email}" disabled style="background:var(--gray-50);color:var(--gray-500)">
              <p style="font-size:0.75rem;color:var(--gray-400);margin-top:4px">${t('account.email_cannot_change')}</p>
            </div>
            <div class="form-group">
              <label>${u.role === 'student' ? t('account.grade_label') : t('account.position_label')}</label>
              <input type="text" class="form-control" id="profileGrade" value="${u.grade_or_position || ''}">
            </div>
            ${u.role === 'teacher' && data.teacher ? `
              <div class="form-group">
                <label>${t('account.subject')}</label>
                <input type="text" class="form-control" id="profileSubject" value="${data.teacher.subject || ''}" placeholder="${t('account.subject_placeholder')}">
              </div>
              <div class="form-group">
                <label>${t('account.department')}</label>
                <input type="text" class="form-control" id="profileDepartment" value="${data.teacher.department || ''}" placeholder="${t('account.department_placeholder')}">
              </div>
            ` : ''}
            <div class="form-group">
              <label>${t('account.role')}</label>
              <input type="text" class="form-control" value="${{student: t('common.student'), teacher: t('common.teacher'), school_head: t('common.school_head'), admin: t('common.admin'), super_admin: t('common.super_admin')}[u.role] || u.role}" disabled style="background:var(--gray-50);color:var(--gray-500);text-transform:capitalize">
            </div>
            <div class="form-group">
              <label>${t('account.member_since')}</label>
              <input type="text" class="form-control" value="${memberSince}" disabled style="background:var(--gray-50);color:var(--gray-500)">
            </div>
            <button type="submit" class="btn btn-primary" id="saveProfileBtn">${t('account.save_changes')}</button>
          </form>
        </div>
      </div>

      <!-- Change Password -->
      <div>
        <div class="card" style="margin-bottom:24px">
          <div class="card-header"><h3>${t('account.change_password')}</h3></div>
          <div class="card-body">
            <form onsubmit="changePassword(event)">
              <div class="form-group">
                <label>${t('account.current_password')}</label>
                <input type="password" class="form-control" id="currentPassword" required placeholder="${t('account.current_password_placeholder')}">
              </div>
              <div class="form-group">
                <label>${t('account.new_password')}</label>
                <input type="password" class="form-control" id="newPassword" required placeholder="${t('account.new_password_placeholder')}" minlength="8">
                <p style="font-size:0.75rem;color:var(--gray-400);margin-top:4px">${t('account.password_requirements')}</p>
              </div>
              <div class="form-group">
                <label>${t('account.confirm_password')}</label>
                <input type="password" class="form-control" id="confirmPassword" required placeholder="${t('account.confirm_password_placeholder')}">
              </div>
              <button type="submit" class="btn btn-primary" id="changePwBtn">${t('account.change_password_btn')}</button>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>${t('account.account_status')}</h3></div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span>${t('account.verification')}</span>
              <span class="badge badge-approved">${t('common.verified')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span>${t('account.account_status_label')}</span>
              <span class="badge ${u.suspended ? 'badge-rejected' : 'badge-approved'}">${u.suspended ? t('common.suspended') : t('common.active')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
              <span>${t('account.school_id')}</span>
              <span style="font-weight:600">${u.school_id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function updateProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  btn.textContent = t('account.saving');
  try {
    const body = {
      full_name: document.getElementById('profileName').value.trim(),
      grade_or_position: document.getElementById('profileGrade').value.trim()
    };

    // Add teacher-specific fields if teacher
    if (currentUser.role === 'teacher') {
      const subjectEl = document.getElementById('profileSubject');
      const deptEl = document.getElementById('profileDepartment');
      if (subjectEl) body.subject = subjectEl.value.trim();
      if (deptEl) body.department = deptEl.value.trim();
    }

    const data = await API.put('/auth/update-profile', body);
    currentUser = data.user;
    // Update sidebar
    document.getElementById('userName').textContent = data.user.full_name;
    const userAvatar = document.getElementById('userAvatar');
    userAvatar.textContent = data.user.full_name.split(' ').map(n => n[0]).join('');
    toast(t('account.profile_updated'));
  } catch (err) {
    toast(err.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = t('account.save_changes');
}

async function changePassword(e) {
  e.preventDefault();
  const newPw = document.getElementById('newPassword').value;
  const confirmPw = document.getElementById('confirmPassword').value;

  if (newPw !== confirmPw) {
    return toast(t('account.passwords_no_match'), 'error');
  }

  const btn = document.getElementById('changePwBtn');
  btn.disabled = true;
  btn.textContent = t('account.changing');
  try {
    await API.put('/auth/change-password', {
      current_password: document.getElementById('currentPassword').value,
      new_password: newPw
    });
    toast(t('account.password_changed'));
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (err) {
    toast(err.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = t('account.change_password_btn');
}

function showSupportModal() {
  openModal(`
    <div class="modal-header">
      <h3>${t('support.title')}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom:20px;color:var(--gray-600)">
        ${t('support.description')}
      </p>
      <form onsubmit="submitSupportRequest(event)">
        <div class="form-group">
          <label>${t('support.category_label')}</label>
          <select class="form-control" id="supportCategory" required>
            <option value="">${t('support.select_category')}</option>
            <option value="technical">${t('support.category_technical')}</option>
            <option value="account">${t('support.category_account')}</option>
            <option value="question">${t('support.category_question')}</option>
            <option value="feature">${t('support.category_feature')}</option>
            <option value="other">${t('support.category_other')}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${t('support.subject_label')}</label>
          <input type="text" class="form-control" id="supportSubject" required placeholder="${t('support.subject_placeholder')}">
        </div>
        <div class="form-group">
          <label>${t('support.message_label')}</label>
          <textarea class="form-control" id="supportMessage" rows="6" required placeholder="${t('support.message_placeholder')}"></textarea>
        </div>
        <div style="background:var(--info-bg,#e0f2fe);border:1px solid var(--info,#06b6d4);border-radius:var(--radius-md);padding:12px;margin-top:16px">
          <div style="font-size:0.85rem;color:var(--gray-700)">
            <strong>${t('support.your_info')}</strong><br>
            ${t('support.name_label', {name: currentUser.full_name})}<br>
            ${t('support.email_label', {email: currentUser.email})}<br>
            ${t('support.role_label', {role: currentUser.role})}
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="submitSupportRequest(event)">${t('support.send_request')}</button>
    </div>
  `);
}

async function submitSupportRequest(e) {
  if (e) e.preventDefault();

  const category = document.getElementById('supportCategory').value;
  const subject = document.getElementById('supportSubject').value;
  const message = document.getElementById('supportMessage').value;

  if (!category || !subject || !message) {
    return toast(t('support.fill_all_fields'), 'error');
  }

  if (subject.trim().length < 3) {
    return toast(t('support.subject_min_3'), 'error');
  }

  if (message.trim().length < 10) {
    return toast(t('support.message_min_10'), 'error');
  }

  try {
    await API.post('/support/message', { category, subject, message });
    toast(t('support.submitted'), 'success');
    closeModal();
  } catch (error) {
    toast(error.message || 'Failed to submit support request', 'error');
  }
}

// ============ ORGANIZATION MANAGEMENT ============
function createOrganization() {
  openModal(`
    <div class="modal-header">
      <h2>${t('admin.create_org')}</h2>
    </div>
    <div class="modal-body">
      <form id="createOrgForm" onsubmit="return false">
        <div class="form-group">
          <label>${t('admin.org_name')}</label>
          <input type="text" class="form-control" id="createOrgName" required>
        </div>
        <div class="form-group">
          <label>${t('admin.org_slug')}</label>
          <input type="text" class="form-control" id="createOrgSlug" required pattern="[a-z0-9-]+" placeholder="${t('admin.org_slug_placeholder')}">
        </div>
        <div class="form-group">
          <label>${t('admin.contact_email')}</label>
          <input type="email" class="form-control" id="createOrgEmail" required>
        </div>
        <div class="form-group">
          <label>${t('admin.contact_phone')}</label>
          <input type="tel" class="form-control" id="createOrgPhone">
        </div>
        <div class="form-group">
          <label>${t('admin.address')}</label>
          <textarea class="form-control" id="createOrgAddress" rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>${t('admin.subscription')}</label>
          <select class="form-control" id="createOrgStatus">
            <option value="active">${t('org.subscription_active')}</option>
            <option value="trial">${t('org.subscription_trial')}</option>
            <option value="suspended">${t('org.subscription_suspended')}</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('admin.max_teachers')}</label>
            <input type="number" class="form-control" id="createOrgMaxTeachers" value="50" min="1">
          </div>
          <div class="form-group">
            <label>${t('admin.max_students')}</label>
            <input type="number" class="form-control" id="createOrgMaxStudents" value="1000" min="1">
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="saveNewOrganization()">${t('admin.create_org')}</button>
    </div>
  `);
}

async function saveNewOrganization() {
  const name = document.getElementById('createOrgName').value.trim();
  const slug = document.getElementById('createOrgSlug').value.trim();
  const contact_email = document.getElementById('createOrgEmail').value.trim();
  const contact_phone = document.getElementById('createOrgPhone').value.trim();
  const address = document.getElementById('createOrgAddress').value.trim();
  const subscription_status = document.getElementById('createOrgStatus').value;
  const max_teachers = parseInt(document.getElementById('createOrgMaxTeachers').value);
  const max_students = parseInt(document.getElementById('createOrgMaxStudents').value);

  if (!name || !slug || !contact_email) {
    return toast(t('org.required_error'), 'error');
  }

  try {
    await API.post('/organizations', {
      name, slug, contact_email, contact_phone, address,
      subscription_status, max_teachers, max_students
    });
    toast(t('org.created'), 'success');
    closeModal();
    navigateTo('admin-orgs');
  } catch (error) {
    toast(error.message || 'Failed to create organization', 'error');
  }
}

function editOrganization(orgIndex) {
  const org = cachedOrgs[orgIndex];
  if (!org) {
    toast(t('org.not_found'), 'error');
    return;
  }

  openModal(`
    <div class="modal-header">
      <h2>${t('admin.edit_org')}</h2>
    </div>
    <div class="modal-body">
      <form id="editOrgForm" onsubmit="return false">
        <div class="form-group">
          <label>${t('admin.org_name')}</label>
          <input type="text" class="form-control" id="editOrgName" value="${org.name}" required>
        </div>
        <div class="form-group">
          <label>${t('admin.org_slug')}</label>
          <input type="text" class="form-control" id="editOrgSlug" value="${org.slug}" required pattern="[a-z0-9-]+">
        </div>
        <div class="form-group">
          <label>${t('admin.contact_email')}</label>
          <input type="email" class="form-control" id="editOrgEmail" value="${org.contact_email || ''}" required>
        </div>
        <div class="form-group">
          <label>${t('admin.contact_phone')}</label>
          <input type="tel" class="form-control" id="editOrgPhone" value="${org.contact_phone || ''}">
        </div>
        <div class="form-group">
          <label>${t('admin.address')}</label>
          <textarea class="form-control" id="editOrgAddress" rows="3">${org.address || ''}</textarea>
        </div>
        <div class="form-group">
          <label>${t('admin.subscription')}</label>
          <select class="form-control" id="editOrgStatus">
            <option value="active" ${org.subscription_status === 'active' ? 'selected' : ''}>${t('org.subscription_active')}</option>
            <option value="trial" ${org.subscription_status === 'trial' ? 'selected' : ''}>${t('org.subscription_trial')}</option>
            <option value="suspended" ${org.subscription_status === 'suspended' ? 'selected' : ''}>${t('org.subscription_suspended')}</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>${t('admin.max_teachers')}</label>
            <input type="number" class="form-control" id="editOrgMaxTeachers" value="${org.max_teachers || 50}" min="1">
          </div>
          <div class="form-group">
            <label>${t('admin.max_students')}</label>
            <input type="number" class="form-control" id="editOrgMaxStudents" value="${org.max_students || 1000}" min="1">
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="saveOrganizationEdit(${org.id})">${t('admin.save_changes')}</button>
    </div>
  `);
}

function copySuperInviteCode() {
  const code = document.getElementById('superInviteCode')?.textContent;
  if (!code || code === 'N/A' || code === 'N/A' || code === 'Loading...' || code === 'Error' || code === '—') return;
  navigator.clipboard.writeText(code).then(() => toast(t('org.code_copied'), 'success')).catch(() => toast(t('org.copy_failed'), 'error'));
}

async function regenerateSuperInviteCode(orgId) {
  if (!await confirmDialog(t('org.regenerate_confirm'), t('org.regenerate'))) return;
  try {
    const data = await API.post('/admin/regenerate-invite-code', { org_id: orgId });
    const display = document.getElementById('superInviteCode');
    if (display) display.textContent = data.invite_code;
    const cached = cachedOrgs.find(o => o.id === orgId);
    if (cached) cached.invite_code = data.invite_code;
    toast(t('org.code_regenerated'), 'success');
  } catch (err) {
    toast(err.message || t('org.regen_failed'), 'error');
  }
}

async function saveOrganizationEdit(orgId) {
  const name = document.getElementById('editOrgName').value.trim();
  const slug = document.getElementById('editOrgSlug').value.trim();
  const contact_email = document.getElementById('editOrgEmail').value.trim();
  const contact_phone = document.getElementById('editOrgPhone').value.trim();
  const address = document.getElementById('editOrgAddress').value.trim();
  const subscription_status = document.getElementById('editOrgStatus').value;
  const max_teachers = parseInt(document.getElementById('editOrgMaxTeachers').value);
  const max_students = parseInt(document.getElementById('editOrgMaxStudents').value);

  if (!name || !slug || !contact_email) {
    return toast(t('org.required_error'), 'error');
  }

  try {
    await API.put(`/organizations/${orgId}`, {
      name, slug, contact_email, contact_phone, address,
      subscription_status, max_teachers, max_students
    });
    toast(t('org.updated'), 'success');
    closeModal();
    navigateTo('admin-orgs');
  } catch (error) {
    toast(error.message || 'Failed to update organization', 'error');
  }
}

async function viewOrgMembers(orgId, orgName) {
  try {
    const members = await API.get(`/organizations/${orgId}/members`);

    openModal(`
      <div class="modal-header">
        <h2>${t('admin.org_members')}: ${orgName}</h2>
      </div>
      <div class="modal-body">
        <table>
          <thead>
            <tr>
              <th>${t('common.name')}</th>
              <th>${t('common.email')}</th>
              <th>${t('common.role')}</th>
              <th>${t('common.joined')}</th>
              <th>${t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${members.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--gray-400)">${t('common.no_data')}</td></tr>` :
              members.map(m => `
                <tr>
                  <td>${m.full_name}</td>
                  <td style="font-size:0.85rem;color:var(--gray-500)">${m.email}</td>
                  <td><span class="badge ${m.role_in_org === 'admin' ? 'badge-flagged' : m.role_in_org === 'teacher' ? 'badge-active' : 'badge-pending'}">${m.role_in_org}</span></td>
                  <td style="font-size:0.85rem">${new Date(m.joined_at).toLocaleDateString()}</td>
                  <td>
                    <button class="btn btn-sm btn-outline" style="color:#ef4444" onclick="removeOrgMember(${orgId}, ${m.user_id}, '${m.full_name.replace(/'/g, "\\'")}', '${orgName.replace(/'/g, "\\'")}')">${t('admin.remove')}</button>
                  </td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="closeModal()">${t('common.close')}</button>
      </div>
    `);
  } catch (error) {
    toast(error.message || 'Failed to load members', 'error');
  }
}

function copyInviteCode() {
  const code = document.getElementById('inviteCodeDisplay')?.textContent;
  if (!code || code === '—') return;
  navigator.clipboard.writeText(code).then(() => toast(t('org.code_copied'), 'success')).catch(() => toast(t('org.copy_failed'), 'error'));
}

async function confirmRegenerateInviteCode() {
  const ok = await confirmDialog(t('org.regen_confirm_long'), t('org.regenerate'));
  if (!ok) return;
  try {
    const data = await API.post('/admin/regenerate-invite-code', {});
    const display = document.getElementById('inviteCodeDisplay');
    if (display) display.textContent = data.invite_code;
    toast(t('org.code_regenerated'), 'success');
  } catch (err) {
    toast(err.message || t('org.regen_failed'), 'error');
  }
}

async function deleteOrganization(orgId, orgName, memberCount) {
  const warningMsg = memberCount > 0
    ? t('admin.delete_org_warning', {count: memberCount})
    : t('admin.delete_org_simple');

  const confirmed = await confirmWithText(
    t('admin.delete_org_confirm', {name: orgName}),
    'Delete',
    warningMsg
  );

  if (!confirmed) return;

  try {
    await API.delete(`/organizations/${orgId}`);
    toast(t('org.deleted'), 'success');
    navigateTo('admin-orgs');
  } catch (error) {
    toast(error.message || 'Failed to delete organization', 'error');
  }
}

async function removeOrgMember(orgId, userId, userName, orgName) {
  const confirmed = await confirmDialog(
    t('org.remove_member_confirm', {user: userName, org: orgName}),
    t('common.remove'),
    t('common.cancel')
  );

  if (!confirmed) return;

  try {
    await API.delete(`/organizations/${orgId}/members/${userId}`);
    toast(t('org.member_removed'), 'success');
    closeModal();
    // Refresh the members view
    viewOrgMembers(orgId, orgName);
  } catch (error) {
    toast(error.message || 'Failed to remove member', 'error');
  }
}

// ============ ANNOUNCEMENTS ============

function showAnnClassrooms(btn, labels) {
  let popup = document.getElementById('_annClsPopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = '_annClsPopup';
    popup.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid var(--gray-200);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.15);padding:10px 14px;min-width:160px;max-width:280px;display:none';
    document.body.appendChild(popup);
  }
  // Toggle off if already open for this button
  if (popup.style.display !== 'none' && popup._srcBtn === btn) {
    popup.style.display = 'none';
    popup._srcBtn = null;
    return;
  }
  popup._srcBtn = btn;
  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-size:0.72rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.04em">${t('nav.classrooms')}</span>
      <button type="button" onclick="document.getElementById('_annClsPopup').style.display='none'" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--gray-400);line-height:1;padding:0;margin-left:12px">&times;</button>
    </div>
    ${labels.map(l => `<div style="padding:5px 0;border-bottom:1px solid var(--gray-100);font-size:0.85rem;color:var(--gray-700)">${l}</div>`).join('')}
  `;
  const rect = btn.getBoundingClientRect();
  popup.style.display = 'block';
  // Position below the badge, clamped to viewport
  let top = rect.bottom + 6;
  let left = rect.left;
  if (left + 280 > window.innerWidth - 8) left = window.innerWidth - 288;
  if (left < 8) left = 8;
  popup.style.top = top + 'px';
  popup.style.left = left + 'px';
}

function announcementCardHTML(a, canDelete, isStudent = false) {
  const d = new Date(a.created_at + (a.created_at.endsWith('Z') ? '' : 'Z'));
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  let targetMeta;
  if (isStudent) {
    // Students see who sent it and which classroom(s)
    const from = a.creator_name ? `${a.creator_name}` : '';
    const cls = a.classroom_labels?.length > 0 ? a.classroom_labels[0] : '';
    const parts = [from, cls, date].filter(Boolean);
    targetMeta = parts.join(' &middot; ');
  } else if (a.target_type === 'classrooms' && a.classroom_labels?.length > 0) {
    // Teachers/admins: clickable badge using fixed popup (won't be clipped)
    const labelsJson = escAttr(JSON.stringify(a.classroom_labels));
    const count = a.classroom_labels.length;
    targetMeta = `<span data-ann-cls-btn onclick="showAnnClassrooms(this,JSON.parse(this.dataset.labels));event.stopPropagation()" data-labels="${labelsJson}"
      style="cursor:pointer;background:var(--gray-100);border-radius:10px;padding:2px 9px;font-size:0.75rem;color:var(--gray-600);user-select:none">
      ${count} ${count === 1 ? t('common.classroom') : t('nav.classrooms')} &#9660;
    </span> &middot; ${date}`;
  } else {
    const targetLabel = a.target_type === 'org' ? t('ann.org_wide') : a.target_type === 'all' ? t('ann.all_orgs') : t('ann.selected_classrooms');
    targetMeta = `${targetLabel} &middot; ${date}`;
  }

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <h3 style="margin:0 0 4px;font-size:1.05rem">${a.title}</h3>
            <span style="font-size:0.78rem;color:var(--gray-400)">${targetMeta}</span>
          </div>
          ${canDelete ? `<button class="btn btn-sm btn-outline" style="color:var(--danger);flex-shrink:0" onclick="deleteAnnouncement(${a.id})">${t('common.delete')}</button>` : ''}
        </div>
        <div style="color:var(--gray-700);line-height:1.6;font-size:0.92rem">${a.content}</div>
      </div>
    </div>`;
}

// ============ STUDENT COUNCIL (council posts: announcements + petitions) ============
// All council UI lives here so the surface is contained. Backend is routes/council.js.
// Voting is anonymous to other students; staff and council members see counts.

function _councilFmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function _councilFmtRelative(iso) {
  if (!iso) return '';
  const target = new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return t('council.closed');
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return t('council.closes_in', { when: `in ${days}d ${hours}h` });
  if (hours > 0) return t('council.closes_in', { when: `in ${hours}h` });
  const mins = Math.max(1, Math.floor(diff / 60000));
  return t('council.closes_in', { when: `in ${mins}m` });
}

function councilPostCardHTML(p) {
  // Soft-deleted posts are filtered out by the API; this guard is defensive.
  if (p.status === 'removed') return '';

  const isPetition = p.type === 'petition';
  const date = _councilFmtDate(p.published_at);
  const isAuthor = currentUser && p.creator_id === currentUser.id;
  const isStaff = currentUser && (currentUser.role === 'admin' || currentUser.role === 'head');
  // Author can edit/take-down within 15 minutes; staff anytime.
  const publishedMs = new Date(p.published_at + (p.published_at.endsWith('Z') ? '' : 'Z')).getTime();
  const inEditWindow = (Date.now() - publishedMs) < 15 * 60 * 1000;
  const canEdit = isStaff || (isAuthor && inEditWindow);
  const canTakedown = isStaff || (isAuthor && inEditWindow);

  const badgeColor = isPetition ? '#7c3aed' : '#0ea5e9';
  const badgeLabel = isPetition ? 'Petition' : 'Announcement';
  const councilBadge = p.author_is_council
    ? `<span style="font-size:0.7rem;background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-weight:600">${t('council.badge')}</span>`
    : `<span style="font-size:0.7rem;background:var(--gray-100);color:var(--gray-500);padding:1px 8px;border-radius:10px">${t('council.former_member')}</span>`;

  const closedNotice = isPetition && p.status === 'closed'
    ? `<span style="font-size:0.78rem;color:var(--danger);font-weight:600">&middot; ${t('council.closed')}</span>`
    : isPetition
      ? `<span style="font-size:0.78rem;color:var(--gray-500)">&middot; ${escapeHtml(_councilFmtRelative(p.closes_at))}</span>`
      : '';

  const attachment = p.attachment_url
    ? `<div style="margin-top:10px"><a href="${p.attachment_url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--primary);text-decoration:none">📎 ${escapeHtml(p.attachment_name || t('council.attachment_label'))}</a></div>`
    : '';

  const voteSection = isPetition && p.status === 'active'
    ? `<div id="petitionVote-${p.id}" style="margin-top:14px;border-top:1px solid var(--gray-100);padding-top:14px">
         <div style="font-size:0.78rem;color:var(--gray-500);margin-bottom:8px">${t('council.anonymous_disclaimer')}</div>
         <div style="display:flex;gap:8px;flex-wrap:wrap">
           <button class="btn btn-sm btn-outline" data-vote-btn="agree" onclick="submitPetitionVote(${p.id}, 'agree')">${t('council.vote_agree')}</button>
           <button class="btn btn-sm btn-outline" data-vote-btn="disagree" onclick="submitPetitionVote(${p.id}, 'disagree')">${t('council.vote_disagree')}</button>
           <button class="btn btn-sm btn-outline" data-vote-btn="neutral" onclick="submitPetitionVote(${p.id}, 'neutral')">${t('council.vote_neutral')}</button>
         </div>
         <div id="petitionResults-${p.id}" style="margin-top:12px;font-size:0.85rem;color:var(--gray-500)">…</div>
       </div>`
    : isPetition
      ? `<div id="petitionVote-${p.id}" style="margin-top:14px;border-top:1px solid var(--gray-100);padding-top:14px">
           <div id="petitionResults-${p.id}" style="font-size:0.85rem;color:var(--gray-500)">…</div>
         </div>`
      : '';

  return `
    <div class="card" style="margin-bottom:16px;border-left:4px solid ${badgeColor}">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <h3 style="margin:0;font-size:1.05rem">${escapeHtml(p.title)}</h3>
              <span style="font-size:0.7rem;background:${badgeColor};color:#fff;padding:1px 8px;border-radius:10px">${badgeLabel}</span>
              ${councilBadge}
            </div>
            <span style="font-size:0.78rem;color:var(--gray-400)">${escapeHtml(p.creator_name || '')} &middot; ${date} ${closedNotice}</span>
          </div>
          ${(canEdit || canTakedown) ? `<div style="display:flex;gap:6px;flex-shrink:0">
            ${canEdit ? `<button class="btn btn-sm btn-outline" onclick="openCouncilEditModal(${p.id})">${t('council.edit')}</button>` : ''}
            ${canTakedown ? `<button class="btn btn-sm btn-outline" style="color:var(--danger)" onclick="takedownCouncilPost(${p.id})">${t('council.takedown')}</button>` : ''}
          </div>` : ''}
        </div>
        <div style="color:var(--gray-700);line-height:1.6;font-size:0.92rem;white-space:pre-wrap">${escapeHtml(p.body)}</div>
        ${attachment}
        ${voteSection}
      </div>
    </div>`;
}

// Type chooser modal — shown when council member clicks "+ New post".
// Splits announcement vs petition into separate forms because the field set
// (and the consequences) are different enough that one combined form would
// confuse first-time authors.
function openCouncilPublishChooser() {
  openModal(`
    <div class="modal-header"><h3>${t('council.choose_type')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;gap:12px">
        <button class="btn btn-outline" style="text-align:left;padding:16px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:4px" onclick="openCouncilPublishModal('announcement')">
          <div style="font-weight:600">📢 ${t('council.choose_announcement')}</div>
          <div style="font-size:0.85rem;color:var(--gray-500);font-weight:400">${t('council.choose_announcement_desc')}</div>
        </button>
        <button class="btn btn-outline" style="text-align:left;padding:16px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:4px" onclick="openCouncilPublishModal('petition')">
          <div style="font-weight:600">✊ ${t('council.choose_petition')}</div>
          <div style="font-size:0.85rem;color:var(--gray-500);font-weight:400">${t('council.choose_petition_desc')}</div>
        </button>
      </div>
    </div>
  `);
}

function openCouncilPublishModal(type) {
  // Default deadline: 7 days from now, in <input type="datetime-local"> format.
  const def = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const tzOffset = def.getTimezoneOffset() * 60000;
  const localISO = new Date(def.getTime() - tzOffset).toISOString().slice(0, 16);

  const isPetition = type === 'petition';
  openModal(`
    <div class="modal-header">
      <h3>${isPetition ? '✊ ' + t('council.choose_petition') : '📢 ' + t('council.choose_announcement')}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('council.title_label')}</label>
        <input type="text" class="form-control" id="councilTitle" maxlength="200">
      </div>
      <div class="form-group">
        <label>${t('council.body_label')}</label>
        <textarea class="form-control" id="councilBody" rows="6" placeholder="${isPetition ? t('council.body_placeholder') : t('council.body_placeholder_announcement')}"></textarea>
      </div>
      ${isPetition ? `
      <div class="form-group">
        <label>${t('council.deadline')}</label>
        <input type="datetime-local" class="form-control" id="councilDeadline" value="${localISO}">
      </div>
      <div class="form-group">
        <label>${t('council.attach_pdf')}</label>
        <input type="file" id="councilAttachment" accept="application/pdf,.pdf">
      </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="councilPublishBtn" onclick="submitCouncilPost('${type}')">${t('council.publish')}</button>
    </div>
  `);
}

async function submitCouncilPost(type) {
  const title = document.getElementById('councilTitle').value.trim();
  const body = document.getElementById('councilBody').value.trim();
  if (!title || !body) return toast(t('admin.fill_required'), 'error');

  const payload = { type, title, body };

  if (type === 'petition') {
    const deadline = document.getElementById('councilDeadline').value;
    if (!deadline) return toast(t('council.deadline_must_be_future'), 'error');
    const deadlineMs = new Date(deadline).getTime();
    if (deadlineMs <= Date.now()) return toast(t('council.deadline_must_be_future'), 'error');
    payload.closes_at = new Date(deadline).toISOString();

    const fileInput = document.getElementById('councilAttachment');
    const file = fileInput?.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') return toast(t('council.pdf_only'), 'error');
      if (file.size > 8 * 1024 * 1024) return toast(t('council.pdf_too_large'), 'error');
      try {
        payload.attachment = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error('Could not read file'));
          r.readAsDataURL(file);
        });
        payload.attachment_name = file.name;
      } catch (e) {
        return toast(e.message, 'error');
      }
    }
  }

  const btn = document.getElementById('councilPublishBtn');
  if (btn) { btn.disabled = true; btn.textContent = t('council.publishing'); }
  try {
    await API.post('/council/posts', payload);
    toast(t('council.publish'));
    closeModal();
    // Refresh whichever comms view is visible.
    const role = currentUser?.role;
    if (role) renderCommsUnified(role);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = t('council.publish'); }
    toast(err.message || 'Failed to publish', 'error');
  }
}

async function openCouncilEditModal(postId) {
  try {
    // Pull the latest version from the feed cache (no edit-specific endpoint needed).
    const posts = await API.get('/council/posts');
    const post = posts.find(p => p.id === postId);
    if (!post) return toast('Post not found', 'error');
    const isPetition = post.type === 'petition';

    // Format closes_at for datetime-local.
    let localISO = '';
    if (post.closes_at) {
      const d = new Date(post.closes_at + (post.closes_at.endsWith('Z') ? '' : 'Z'));
      const tzOffset = d.getTimezoneOffset() * 60000;
      localISO = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    }

    openModal(`
      <div class="modal-header"><h3>${t('council.edit')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="form-group">
          <label>${t('council.title_label')}</label>
          <input type="text" class="form-control" id="councilEditTitle" maxlength="200" value="${escAttr(post.title)}">
        </div>
        <div class="form-group">
          <label>${t('council.body_label')}</label>
          <textarea class="form-control" id="councilEditBody" rows="6">${escapeHtml(post.body)}</textarea>
        </div>
        ${isPetition ? `
        <div class="form-group">
          <label>${t('council.deadline')}</label>
          <input type="datetime-local" class="form-control" id="councilEditDeadline" value="${localISO}">
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
        <button class="btn btn-primary" onclick="saveCouncilEdit(${post.id}, '${post.type}')">${t('admin.save_changes')}</button>
      </div>
    `);
  } catch (err) {
    toast(err.message || 'Failed to load post', 'error');
  }
}

async function saveCouncilEdit(postId, type) {
  const body = {
    title: document.getElementById('councilEditTitle').value.trim(),
    body: document.getElementById('councilEditBody').value.trim(),
  };
  if (type === 'petition') {
    const deadline = document.getElementById('councilEditDeadline').value;
    if (deadline) body.closes_at = new Date(deadline).toISOString();
  }
  if (!body.title || !body.body) return toast(t('admin.fill_required'), 'error');
  try {
    await API.put(`/council/posts/${postId}`, body);
    toast(t('admin.user_updated'));
    closeModal();
    const role = currentUser?.role;
    if (role) renderCommsUnified(role);
  } catch (err) {
    toast(err.message || 'Failed to save', 'error');
  }
}

async function takedownCouncilPost(postId) {
  const ok = await confirmDialog(t('council.confirm_takedown'), t('council.takedown'), t('common.cancel'));
  if (!ok) return;
  try {
    await API.delete(`/council/posts/${postId}`);
    toast('Removed');
    const role = currentUser?.role;
    if (role) renderCommsUnified(role);
  } catch (err) {
    toast(err.message || 'Failed to take down', 'error');
  }
}

async function submitPetitionVote(postId, vote) {
  try {
    await API.post(`/council/posts/${postId}/vote`, { vote });
    toast(t('council.your_vote') + ': ' + t('council.vote_' + vote));
    loadPetitionResults(postId);
  } catch (err) {
    toast(err.message || 'Failed to vote', 'error');
  }
}

async function loadPetitionResults(postId) {
  const el = document.getElementById(`petitionResults-${postId}`);
  if (!el) return;
  try {
    const [results, mine] = await Promise.all([
      API.get(`/council/posts/${postId}/results`).catch(() => ({})),
      API.get(`/council/posts/${postId}/my-vote`).catch(() => ({ vote: null })),
    ]);

    // Highlight the user's own vote button if they've voted.
    if (mine.vote) {
      const wrap = document.getElementById(`petitionVote-${postId}`);
      if (wrap) {
        wrap.querySelectorAll('[data-vote-btn]').forEach(btn => {
          if (btn.dataset.voteBtn === mine.vote) {
            btn.classList.remove('btn-outline');
            btn.classList.add('btn-primary');
          } else {
            btn.classList.add('btn-outline');
            btn.classList.remove('btn-primary');
          }
        });
      }
    }

    if (results.pending) {
      el.innerHTML = `<em>${t('council.vote_first_to_see_results')}</em>`;
      return;
    }
    const total = results.total || 0;
    if (total === 0) {
      el.innerHTML = `<em>0 votes yet</em>`;
      return;
    }
    const pct = (n) => Math.round((n / total) * 100);
    const bar = (color, n, label) => `
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:2px">
          <span>${label}</span><span>${n} (${pct(n)}%)</span>
        </div>
        <div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
          <div style="background:${color};height:100%;width:${pct(n)}%"></div>
        </div>
      </div>`;
    el.innerHTML = `
      ${bar('#16a34a', results.agree || 0, t('council.vote_agree'))}
      ${bar('#dc2626', results.disagree || 0, t('council.vote_disagree'))}
      ${bar('#6b7280', results.neutral || 0, t('council.vote_neutral'))}
      <div style="font-size:0.75rem;color:var(--gray-400);margin-top:4px">${t('council.tally_total', { n: total })}</div>
    `;
  } catch (err) {
    el.innerHTML = `<em>Could not load results</em>`;
  }
}

// Admin: toggle Student Council membership for a student. Surfaced as a row
// action in the user list dropdown. Backend enforces "must be a student".
async function toggleCouncilMember(userId, makeCouncil) {
  try {
    await API.put(`/admin/users/${userId}/council`, { is_council: makeCouncil ? 1 : 0 });
    toast(makeCouncil ? 'Granted council access' : 'Revoked council access');
    invalidateCache('/admin/users');
    renderAdminUsers();
  } catch (err) {
    toast(err.message || 'Failed to update', 'error');
  }
}

async function toggleMentor(userId, makeMentor) {
  try {
    await API.put(`/admin/users/${userId}/mentor`, { is_mentor: makeMentor ? 1 : 0 });
    toast(makeMentor ? 'Granted mentor role' : 'Revoked mentor role');
    invalidateCache('/admin/users');
    renderAdminUsers();
  } catch (err) {
    toast(err.message || 'Failed to update', 'error');
  }
}
window.toggleMentor = toggleMentor;

// Expose council functions to inline onclick handlers.
window.openCouncilPublishChooser = openCouncilPublishChooser;
window.openCouncilPublishModal = openCouncilPublishModal;
window.submitCouncilPost = submitCouncilPost;
window.openCouncilEditModal = openCouncilEditModal;
window.saveCouncilEdit = saveCouncilEdit;
window.takedownCouncilPost = takedownCouncilPost;
window.submitPetitionVote = submitPetitionVote;
window.loadPetitionResults = loadPetitionResults;
window.toggleCouncilMember = toggleCouncilMember;

function richTextToolbar(editorId) {
  return `<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
    ${[['Bold','B','bold'],['Italic','I','italic'],['Underline','U','underline']].map(([title, label, cmd]) =>
      `<button type="button" title="${title}" onclick="document.execCommand('${cmd}',false,null);document.getElementById('${editorId}').focus()"
        style="border:1px solid var(--gray-200);background:var(--gray-50);border-radius:4px;padding:3px 10px;font-weight:${cmd==='bold'?'700':'400'};font-style:${cmd==='italic'?'italic':'normal'};text-decoration:${cmd==='underline'?'underline':'none'};cursor:pointer;font-size:0.85rem">${label}</button>`
    ).join('')}
  </div>
  <div id="${editorId}" contenteditable="true" style="min-height:100px;padding:10px;border:1px solid var(--gray-200);border-radius:6px;font-size:0.92rem;line-height:1.6;outline:none" placeholder="${t('ann.write_placeholder')}"></div>`;
}

async function showCreateAnnouncementModal() {
  const role = currentUser?.role;
  // Fetch classrooms available for targeting
  let classrooms = [];
  try { classrooms = await API.get('/announcements/classrooms'); } catch {}

  const classroomSelect = classrooms.length > 0 ? `
    <div class="form-group" id="annClassroomsGroup" style="display:none">
      <label>${t('ann.target_classrooms_label')}</label>
      <div style="max-height:160px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:8px">
        ${classrooms.map(c => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">
          <input type="checkbox" name="annClassroom" value="${c.id}">
          ${c.subject} &middot; ${c.grade_level}${c.teacher_name ? ' &middot; ' + c.teacher_name : ''}
        </label>`).join('')}
      </div>
    </div>` : '';

  const targetOptions = role === 'teacher'
    ? `<option value="classrooms">${t('ann.my_classrooms')}</option>`
    : `<option value="org">${t('ann.entire_org')}</option><option value="classrooms">${t('ann.specific_classrooms')}</option>`;

  openModal(`
    <div class="modal-header"><h3>${t('ann.new_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('ann.title_label')}</label>
        <input type="text" class="form-control" id="annTitle" placeholder="${t('ann.title_placeholder')}">
      </div>
      ${role !== 'teacher' ? `
      <div class="form-group">
        <label>${t('ann.target_label')}</label>
        <select class="form-control" id="annTargetType" onchange="updateAnnTargetUI()">
          ${targetOptions}
        </select>
      </div>` : `<input type="hidden" id="annTargetType" value="classrooms">`}
      ${classroomSelect}
      <div class="form-group">
        <label>${t('ann.content_label')}</label>
        ${richTextToolbar('annContent')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="submitAnnouncement()">${t('ann.post_btn')}</button>
    </div>
  `);

  // Auto-select all classrooms for teachers
  if (role === 'teacher') {
    setTimeout(() => {
      const grp = document.getElementById('annClassroomsGroup');
      if (grp) grp.style.display = '';
      document.querySelectorAll('input[name=annClassroom]').forEach(cb => cb.checked = true);
    }, 50);
  }
}

function updateAnnTargetUI() {
  const val = document.getElementById('annTargetType')?.value;
  const grp = document.getElementById('annClassroomsGroup');
  if (grp) grp.style.display = val === 'classrooms' ? '' : 'none';
}

async function submitAnnouncement() {
  const title = document.getElementById('annTitle')?.value.trim();
  const content = document.getElementById('annContent')?.innerHTML.trim();
  const target_type = document.getElementById('annTargetType')?.value || 'org';
  const classroom_ids = [...document.querySelectorAll('input[name=annClassroom]:checked')].map(cb => parseInt(cb.value));

  if (!title) return toast(t('ann.title_required'), 'error');
  if (!content || content === '') return toast(t('ann.content_required'), 'error');
  if (target_type === 'classrooms' && classroom_ids.length === 0) return toast(t('ann.select_classroom'), 'error');

  try {
    await API.post('/announcements', { title, content, target_type, classroom_ids });
    toast(t('ann.posted'), 'success');
    invalidateCache('/announcements');
    closeModal();
    const view = currentView;
    if (view) navigateTo(view);
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteAnnouncement(id) {
  const confirmed = await confirmDialog(t('ann.delete_confirm'), t('common.delete'), t('common.cancel'));
  if (!confirmed) return;
  try {
    await API.delete(`/announcements/${id}`);
    toast(t('ann.deleted'));
    invalidateCache('/announcements');
    const view = currentView;
    if (view) navigateTo(view);
  } catch (err) { toast(err.message, 'error'); }
}

// ============ HELP TAB ============
async function renderHelp() {
  const el = document.getElementById('contentArea');
  const role = currentUser.role;
  const isAdmin = role === 'admin';

  if (isAdmin) {
    // Admins go straight to docs — they don't submit support tickets
    el.innerHTML = `
      <div class="help-wrap">
        <div class="help-section-card">
          <h2 class="help-section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
            How to Use Oasis
          </h2>
          ${renderHelpDocs(role)}
        </div>
      </div>
    `;
    return;
  }

  // Non-admins: landing with two option cards
  el.innerHTML = `
    <div class="help-landing">
      <p style="color:var(--gray-500);margin-bottom:28px">What do you need help with?</p>
      <div class="help-options">
        <div class="help-option-card" onclick="showHelpContact()" tabindex="0" onkeydown="if(event.key==='Enter')showHelpContact()">
          <div class="help-option-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <div class="help-option-title">Contact &amp; Support</div>
          <div class="help-option-desc">Submit a support message or check the status of a previous request</div>
          <div class="help-option-arrow">→</div>
        </div>
        <div class="help-option-card" onclick="showHelpDocsView()" tabindex="0" onkeydown="if(event.key==='Enter')showHelpDocsView()">
          <div class="help-option-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
          </div>
          <div class="help-option-title">How to Use Oasis</div>
          <div class="help-option-desc">Step-by-step guides for every feature available to your role</div>
          <div class="help-option-arrow">→</div>
        </div>
      </div>
    </div>
  `;
}

async function showHelpContact() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `
    <div class="help-wrap">
      <button class="btn btn-outline btn-sm" style="margin-bottom:20px" onclick="renderHelp()">← Back</button>
      <div class="help-section-card">
        <h2 class="help-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          Contact &amp; Support
        </h2>
        <div class="help-form-card">
          <h3 style="margin-bottom:16px;font-size:1rem;color:var(--gray-700)">Send a New Message</h3>
          <form id="helpSupportForm">
            <div class="form-row">
              <div class="form-group">
                <label>Category</label>
                <select class="form-control" id="helpCategory">
                  <option value="">Select category…</option>
                  <option value="technical">Technical Issue</option>
                  <option value="account">Account</option>
                  <option value="question">Question</option>
                  <option value="feature">Feature Request</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="form-group">
                <label>Subject</label>
                <input type="text" class="form-control" id="helpSubject" placeholder="Brief description…" maxlength="200">
              </div>
            </div>
            <div class="form-group">
              <label>Message</label>
              <textarea class="form-control" id="helpMessage" rows="5" placeholder="Describe your issue or question in detail…" maxlength="5000"></textarea>
            </div>
            <button type="submit" class="btn btn-primary">Send Message</button>
          </form>
        </div>
        <div id="myHelpMessages"></div>
      </div>
    </div>
  `;

  document.getElementById('helpSupportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const category = document.getElementById('helpCategory').value;
    const subject = document.getElementById('helpSubject').value.trim();
    const message = document.getElementById('helpMessage').value.trim();
    if (!category || !subject || !message) return toast('Please fill all fields', 'error');
    if (subject.length < 3) return toast('Subject must be at least 3 characters', 'error');
    if (message.length < 10) return toast('Message must be at least 10 characters', 'error');
    try {
      await API.post('/support/message', { category, subject, message });
      toast('Message sent! An administrator will review it shortly.', 'success');
      document.getElementById('helpSupportForm').reset();
      loadPrevMessages();
    } catch (err) {
      toast(err.message || 'Failed to send message', 'error');
    }
  });

  loadPrevMessages();
}

async function loadPrevMessages() {
  try {
    const msgs = await API.get('/support/my-messages');
    const myEl = document.getElementById('myHelpMessages');
    if (!myEl) return;
    if (!msgs.length) { myEl.innerHTML = ''; return; }
    myEl.innerHTML = `
      <div class="help-prev-msgs">
        <div class="help-prev-msgs-header">My Previous Messages</div>
        ${msgs.map(msg => `
          <div class="help-prev-msg-row">
            <div style="flex:1;min-width:0">
              <div class="help-prev-msg-subject">${escapeHtml(msg.subject)}</div>
              <div class="help-prev-msg-date">${new Date(msg.created_at).toLocaleDateString()}${msg.admin_notes ? ` · <em style="color:var(--success)">${escapeHtml(msg.admin_notes)}</em>` : ''}</div>
            </div>
            <span class="badge ${msg.status === 'new' ? 'badge-flagged' : msg.status === 'in_progress' ? 'badge-pending' : 'badge-approved'}" style="flex-shrink:0">${msg.status}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) { /* silently fail */ }
}

function showHelpDocsView() {
  const el = document.getElementById('contentArea');
  const role = currentUser.role;
  el.innerHTML = `
    <div class="help-wrap">
      <button class="btn btn-outline btn-sm" style="margin-bottom:20px" onclick="renderHelp()">← Back</button>
      <div class="help-section-card">
        <h2 class="help-section-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
          How to Use Oasis
        </h2>
        ${renderHelpDocs(role)}
      </div>
    </div>
  `;
}

function renderHelpDocs(role) {
  const sections = {
    student: [
      { icon: '🏫', title: 'Joining Classrooms', body: 'Go to <strong>My Classrooms</strong> and click <strong>Join Classroom</strong>. Enter the 6-digit join code provided by your teacher. Once joined, the classroom appears in your list.' },
      { icon: '⭐', title: 'Writing Reviews', body: `Navigate to <strong>Write a Review</strong>. Select a classroom, then rate your teacher across ${CRITERIA_COUNT} criteria. You can also add optional tags and written feedback.` },
      { icon: '📋', title: 'My Reviews', body: 'View all reviews you have submitted under <strong>My Reviews</strong>. You can see their approval status and edit a review while it is still pending.' },
      { icon: '📢', title: 'Announcements & Forms', body: 'Check <strong>Announcements</strong> for messages from your school or teachers. Active forms that require your input will also appear here — submit them before the deadline.' },
      { icon: '👥', title: 'Classroom Members', body: 'On any classroom card, click <strong>Members</strong> to see who else is enrolled in that class.' },
      { icon: '🔔', title: 'Notifications', body: 'The bell icon at the top shows in-app notifications. You will be notified when your review is approved. Click a notification to go directly to the related section.' }
    ],
    teacher: [
      { icon: '🏫', title: 'Managing Classrooms', body: 'Go to <strong>My Classrooms</strong> to see all your classes. Click <strong>New Classroom</strong> to create one — give it a subject, grade level, and optionally link it to a term. Share the join code with your students so they can enroll.' },
      { icon: '📊', title: 'Viewing Student Feedback', body: 'The <strong>Feedback</strong> tab shows all approved reviews for your classes, including criterion scores, written comments, and tags. Only approved reviews are visible to you.' },
      { icon: '📈', title: 'Analytics', body: 'The <strong>Analytics</strong> tab shows your overall performance scores, score distribution, period-by-period trend, and how you compare to your department average.' },
      { icon: '📝', title: 'Custom Forms & Announcements', body: 'Under <strong>Forms</strong>, you can create custom questionnaires for your students. Post class-specific announcements to keep students informed.' },
      { icon: '📄', title: 'PDF Export', body: 'From the <strong>Feedback</strong> tab, click <strong>Export PDF</strong> to download your own professional performance report. You can print it or share it with others.' }
    ],
    head: [
      { icon: '📊', title: 'Teacher Performance Overview', body: 'The <strong>Dashboard</strong> shows all teachers in your organization with their overall scores, review counts, and trend directions. Click a teacher row to see their detailed breakdown.' },
      { icon: '🏢', title: 'Department Analytics', body: 'The <strong>Departments</strong> tab lists all departments. Click a department card to view: a Criterion Radar comparing your department to the org average, a Teacher Ranking bar chart, and a Trend line showing improvement over time.' },
      { icon: '🏫', title: 'Classroom Management', body: 'View all classrooms across your organization under <strong>Classrooms</strong>. See enrollment counts and which term each classroom belongs to.' },
      { icon: '📢', title: 'Announcements', body: 'Post announcements to your entire organization or specific classrooms via the <strong>Forms</strong> tab.' },
      { icon: '📄', title: 'Exporting Reports', body: 'From the Teacher Performance view, click <strong>Export PDF</strong> on any teacher to generate a printable report.' }
    ],
    admin: [
      { icon: '👥', title: 'Managing Users', body: 'The <strong>Users</strong> tab shows all staff in your organization. You can create new users, edit their roles, reset passwords, and suspend accounts if needed.' },
      { icon: '📅', title: 'Terms & Feedback Periods', body: 'Under <strong>Terms & Periods</strong>, create academic terms and the feedback periods within them. Only one term and one period can be active at a time. Activating a period notifies all teachers.' },
      { icon: '🛡️', title: 'Review Moderation', body: 'Approve or flag student reviews under <strong>Moderate Reviews</strong>. Approved reviews become visible to teachers. Flagged reviews are quarantined. Students are notified when their review is approved.' },
      { icon: '📝', title: 'Forms Management', body: 'Create and manage custom forms under <strong>Forms</strong>. Activate a form to make it available to students or teachers. Deactivating hides it from users.' },
      { icon: '🏢', title: 'Department Management', body: 'Under <strong>Departments</strong>, create and manage departments for your organization. The teacher invite code is only shown once at least one department exists. Teachers select a department during registration.' },
      { icon: '📨', title: 'Support Messages', body: 'View and respond to support tickets submitted by your users under <strong>Support Messages</strong>. Update the status (New → In Progress → Resolved) and add admin notes. Users are notified when their ticket is resolved.' },
      { icon: '🔍', title: 'Audit Logs', body: 'The <strong>Audit Logs</strong> tab records every significant action in your organization — logins, role changes, review approvals, and more. Filter by action type or date range.' },
      { icon: '⚙️', title: 'Organization Settings', body: 'Your invite code and teacher/student limits are managed from the <strong>Teacher Feedback</strong> tab (invite code) or via the platform admin. To regenerate your invite code, click Regenerate next to it.' }
    ]
  };

  const intros = {
    student: 'As a student on Oasis, your role is to provide honest, constructive feedback on your learning experience. Your reviews help teachers grow professionally and give your school the data it needs to improve education quality. Everything you do here — joining classrooms, writing reviews, responding to forms — contributes directly to that goal.',
    teacher: 'As a teacher on Oasis, you have a dedicated space to understand how your students experience your classes. The platform collects anonymous feedback, turns it into clear scores and summaries, and gives you tools to communicate back through forms, announcements, and exportable reports. Your performance data is visible to your school\'s management.',
    school_head: 'As a School Head on Oasis, you have analytical oversight of all teachers and departments in your organization. You can monitor performance trends, identify teachers who may need support, and track how each department evolves over time. Day-to-day settings and access control are managed by your Organization Admin.',
    admin: 'As an Admin, you manage the full operation of your school\'s Oasis account. You control who has access, when feedback periods open, and how reviews are moderated. You are the primary support contact for your teachers and students, and the person responsible for keeping the platform correctly configured for your organization.'
  };

  const roleSections = sections[role] || sections.head;
  const intro = intros[role] || intros.head;

  return `
    <p class="help-role-intro">${intro}</p>
    <div class="help-docs-grid">
      ${roleSections.map(s => `
        <div class="help-doc-card">
          <div class="help-doc-icon">${s.icon}</div>
          <div class="help-doc-body">
            <h4 class="help-doc-title">${s.title}</h4>
            <p class="help-doc-text">${s.body}</p>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ============ DEPARTMENTS ============
async function renderAdminDepartments() {
  const el = document.getElementById('contentArea');
  const role = currentUser.role;
  const departments = await API.get('/departments');

  const canManage = role === 'admin' || role === 'head';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <p style="color:var(--gray-500);max-width:560px">Departments help organize your teachers. The invite code is only shown to teachers after at least one department is created.</p>
      <button class="btn btn-primary" onclick="document.getElementById('addDeptPanel').style.display='block';document.getElementById('newDeptName').focus()">+ Add Department</button>
    </div>

    <div id="addDeptPanel" style="display:none;margin-bottom:20px" class="card">
      <div class="card-body">
        <h3 style="margin-bottom:14px;font-size:1rem">New Department</h3>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:200px;margin:0">
            <label>Name</label>
            <input type="text" class="form-control" id="newDeptName" placeholder="e.g. Mathematics, Sciences…" maxlength="80"
              onkeydown="if(event.key==='Enter'){event.preventDefault();createDepartment();}">
          </div>
          <button class="btn btn-primary" onclick="createDepartment()">Add</button>
          <button class="btn btn-outline" onclick="document.getElementById('addDeptPanel').style.display='none'">Cancel</button>
        </div>
      </div>
    </div>

    ${departments.length === 0 ? `
      <div class="empty-state">
        <div style="font-size:3rem;margin-bottom:12px">🏢</div>
        <h3>No Departments Yet</h3>
        <p>Create your first department so teachers can select one when registering with your invite code.</p>
        <div style="margin-top:20px;padding:14px 18px;background:var(--warning-light);border-radius:8px;border-left:4px solid var(--warning);text-align:left;max-width:440px;margin-inline:auto">
          <strong>Note:</strong> Your invite code is hidden from the teacher registration flow until at least one department is created.
        </div>
      </div>
    ` : `
      <div class="grid grid-3" id="deptCardGrid">
        ${departments.map(d => `
          <div class="dept-card" id="dept-card-${d.id}" onclick="renderDeptDetail('${d.name.replace(/'/g, "\\'")}')">
            <div class="dept-card-top">
              <div class="dept-card-icon">🏢</div>
              <div style="flex:1">
                <div class="dept-card-name" id="dept-name-${d.id}">${escapeHtml(d.name)}</div>
                <div class="dept-card-meta">${d.teacher_count} teacher${d.teacher_count !== 1 ? 's' : ''}</div>
              </div>
            </div>
            ${canManage ? `
              <div class="dept-card-footer" style="gap:8px" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-outline" onclick="startEditDept(${d.id})">Edit</button>
                <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)"
                  onclick="deleteDepartment(${d.id},'${d.name.replace(/'/g, "\\'")}',${d.teacher_count})">Delete</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `}
  `;
}

async function createDepartment() {
  const name = document.getElementById('newDeptName')?.value.trim();
  if (!name || name.length < 2) return toast('Department name must be at least 2 characters', 'error');
  try {
    await API.post('/departments', { name });
    toast('Department added', 'success');
    invalidateCache('/departments');
    renderAdminDepartments();
  } catch (err) {
    toast(err.message || 'Failed to add department', 'error');
  }
}

async function deleteDepartment(id, name, teacherCount) {
  if (teacherCount > 0) {
    return toast(`Cannot delete — ${teacherCount} teacher${teacherCount !== 1 ? 's are' : ' is'} assigned to this department`, 'error');
  }
  if (!await confirmDialog(`Delete department "${name}"? This cannot be undone.`, 'Delete')) return;
  try {
    await API.delete(`/departments/${id}`);
    toast('Department deleted', 'success');
    invalidateCache('/departments');
    renderAdminDepartments();
  } catch (err) {
    toast(err.message || 'Failed to delete department', 'error');
  }
}

function startEditDept(id) {
  const card = document.getElementById(`dept-card-${id}`);
  if (!card) return;
  card.removeAttribute('onclick');
  card.style.cursor = 'default';
  const nameEl = document.getElementById(`dept-name-${id}`);
  if (!nameEl) return;
  const currentName = nameEl.textContent;
  nameEl.innerHTML = `
    <div style="display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
      <input type="text" class="form-control" id="edit-dept-input-${id}"
        style="padding:4px 8px;font-size:0.9rem;height:auto"
        onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditDept(${id});}if(event.key==='Escape')renderAdminDepartments();">
      <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();saveEditDept(${id})">Save</button>
      <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();renderAdminDepartments()">Cancel</button>
    </div>
  `;
  const inp = document.getElementById(`edit-dept-input-${id}`);
  if (inp) { inp.value = currentName; inp.focus(); inp.select(); }
}

async function saveEditDept(id) {
  const inp = document.getElementById(`edit-dept-input-${id}`);
  if (!inp) return;
  const newName = inp.value.trim();
  if (!newName || newName.length < 2) return toast('Name must be at least 2 characters', 'error');
  try {
    await API.patch(`/departments/${id}`, { name: newName });
    toast('Department renamed', 'success');
    invalidateCache('/departments');
    renderAdminDepartments();
  } catch (err) {
    toast(err.message || 'Failed to rename department', 'error');
  }
}

// ============ DEPARTMENT DETAIL (3 charts) ============
async function renderDeptDetail(deptName) {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  destroyCharts();

  let data;
  try {
    data = await API.get(`/dashboard/departments/${encodeURIComponent(deptName)}`);
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>Failed to load</h3><p>${err.message}</p></div>`;
    return;
  }

  const { teachers, trend, org_averages } = data;
  // Dept averages per criterion
  const validTeachers = teachers.filter(t => t.review_count > 0);
  const deptCriteriaAvg = CRITERIA_CONFIG.map(c => {
    const vals = validTeachers.map(t => t[`avg_${c.slug}`]).filter(v => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : 0;
  });
  const orgCriteriaAvg = org_averages ? CRITERIA_CONFIG.map(c => org_averages[`avg_${c.slug}`] || 0) : [];

  // Teacher ranking sorted by overall score
  const ranked = [...teachers].filter(t => t.review_count > 0).sort((a, b) => (b.avg_overall || 0) - (a.avg_overall || 0));

  el.innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn btn-outline btn-sm" onclick="renderAdminDepartments()">← Back to Departments</button>
    </div>
    <h2 style="margin-bottom:4px">${escapeHtml(deptName)}</h2>
    <p style="color:var(--gray-500);margin-bottom:24px">${teachers.length} teacher${teachers.length !== 1 ? 's' : ''} · ${validTeachers.length} with reviews</p>

    ${teachers.length === 0 ? `
      <div class="empty-state"><h3>No teachers in this department yet.</h3></div>
    ` : `
      <div class="grid grid-3" style="margin-bottom:32px">
        <div class="stat-card"><div class="stat-label">Teachers</div><div class="stat-value">${teachers.length}</div></div>
        <div class="stat-card"><div class="stat-label">Avg Score</div><div class="stat-value" style="color:${scoreColor(validTeachers.length ? deptCriteriaAvg.reduce((a,b)=>a+b,0)/CRITERIA_COUNT : 0)}">${validTeachers.length ? fmtScore(deptCriteriaAvg.reduce((a,b)=>a+b,0)/CRITERIA_COUNT) : '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Total Reviews</div><div class="stat-value">${teachers.reduce((s,t)=>s+(t.review_count||0),0)}</div></div>
      </div>

      <div class="grid grid-2" style="margin-bottom:32px">
        <!-- Chart 1: Criterion Radar -->
        <div class="card">
          <div class="card-header"><h3>Criterion Comparison vs Org Average</h3></div>
          <div class="card-body"><div style="position:relative;height:280px"><canvas id="deptRadarChart"></canvas></div></div>
        </div>

        <!-- Chart 2: Teacher Ranking -->
        <div class="card">
          <div class="card-header"><h3>Teacher Ranking</h3></div>
          <div class="card-body">
            ${ranked.length === 0 ? '<div class="empty-state"><p>No review data yet.</p></div>' : `
              <div style="position:relative;height:280px"><canvas id="deptRankChart"></canvas></div>
            `}
          </div>
        </div>
      </div>

      <!-- Chart 3: Trend -->
      <div class="card" style="margin-bottom:24px">
        <div class="card-header"><h3>Department Score Trend</h3></div>
        <div class="card-body">
          ${trend.length < 2 ? '<div class="empty-state"><p>Not enough data across periods to show a trend yet.</p></div>' : `
            <div style="position:relative;height:220px"><canvas id="deptTrendChart"></canvas></div>
          `}
        </div>
      </div>

      <!-- Teacher list -->
      <div class="card">
        <div class="card-header"><h3>Teachers</h3></div>
        <div class="card-body" style="overflow-x:auto">
          <table>
            <thead><tr><th>Name</th><th>Subject</th><th>Avg Score</th><th>Reviews</th></tr></thead>
            <tbody>
              ${teachers.map(t => `
                <tr>
                  <td><strong>${escapeHtml(t.full_name)}</strong></td>
                  <td>${t.subject || '—'}</td>
                  <td style="font-weight:600;color:${scoreColor(t.avg_overall || 0)}">${t.review_count ? fmtScore(t.avg_overall) : '—'}</td>
                  <td>${t.review_count || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;

  if (teachers.length === 0 || validTeachers.length === 0) return;

  // Render Chart 1: Radar
  if (window.Chart && document.getElementById('deptRadarChart')) {
    const radarDatasets = [{
      label: escapeHtml(deptName),
      data: deptCriteriaAvg,
      backgroundColor: 'rgba(37,99,235,0.15)',
      borderColor: '#059669',
      borderWidth: 2,
      pointBackgroundColor: '#059669'
    }];
    if (org_averages && orgCriteriaAvg.length) {
      radarDatasets.push({
        label: 'Org Average',
        data: orgCriteriaAvg,
        backgroundColor: 'rgba(100,116,139,0.1)',
        borderColor: '#94a3b8',
        borderWidth: 2,
        borderDash: [4, 4],
        pointBackgroundColor: '#94a3b8'
      });
    }
    const radarChart = new Chart(document.getElementById('deptRadarChart'), {
      type: 'radar',
      data: { labels: CRITERIA_CONFIG.map(c => t(c.label_key)), datasets: radarDatasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { r: { min: 0, max: 5, ticks: { stepSize: 1, font: { size: 11 } }, pointLabels: { font: { size: 12 } } } },
        plugins: { legend: { position: 'bottom' } }
      }
    });
    if (typeof registerChart === 'function') registerChart(radarChart);
  }

  // Render Chart 2: Horizontal bar ranking
  if (window.Chart && ranked.length > 0 && document.getElementById('deptRankChart')) {
    const colors = ranked.map(t => {
      const s = t.avg_overall || 0;
      return s >= 4 ? '#22c55e' : s >= 3 ? '#f59e0b' : '#ef4444';
    });
    const rankChart = new Chart(document.getElementById('deptRankChart'), {
      type: 'bar',
      data: {
        labels: ranked.map(t => t.full_name),
        datasets: [{ label: 'Avg Score', data: ranked.map(t => t.avg_overall || 0), backgroundColor: colors }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: { x: { min: 0, max: 5, ticks: { stepSize: 1 } } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => ranked[items[0].dataIndex].full_name,
              label: (item) => {
                const t = ranked[item.dataIndex];
                const subj = t.subject ? ` · ${t.subject}` : '';
                return `Score: ${(item.raw || 0).toFixed(2)}${subj}`;
              }
            }
          }
        }
      }
    });
    if (typeof registerChart === 'function') registerChart(rankChart);
  }

  // Render Chart 3: Trend line
  if (window.Chart && trend.length >= 2 && document.getElementById('deptTrendChart')) {
    const trendWithScore = trend.filter(p => p.avg_score !== null);
    const trendChart = new Chart(document.getElementById('deptTrendChart'), {
      type: 'line',
      data: {
        labels: trendWithScore.map(p => p.period_name),
        datasets: [{
          label: `${escapeHtml(deptName)} Avg`,
          data: trendWithScore.map(p => p.avg_score),
          borderColor: '#059669',
          backgroundColor: 'rgba(37,99,235,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 } } },
        plugins: { legend: { display: false } }
      }
    });
    if (typeof registerChart === 'function') registerChart(trendChart);
  }
}

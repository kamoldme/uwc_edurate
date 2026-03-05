// ============ API HELPER ============
const API = {
  token: localStorage.getItem('edurate_token'),
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
    const hashView = window.location.hash.slice(1);
    const validViews = ['student-home','student-classrooms','student-review','student-my-reviews','student-forms','teacher-home','teacher-classrooms','teacher-feedback','teacher-analytics','teacher-forms','head-home','head-teachers','head-classrooms','head-analytics','head-forms','admin-home','admin-users','admin-terms','admin-classrooms','admin-teachers','admin-submissions','admin-moderate','admin-flagged','admin-support','admin-audit','admin-forms','admin-departments','account','help'];
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
    const orgBadge = isAdmin
      ? `<button onclick="renameOrg()" title="Click to rename organization" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--gray-100);border-radius:8px;border:1px solid var(--gray-200);cursor:pointer;font-family:inherit;transition:background 0.15s" onmouseover="this.style.background='var(--gray-200)'" onmouseout="this.style.background='var(--gray-100)'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary);flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span id="topBarOrgName" style="font-size:0.82rem;font-weight:500;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${u.org_name}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--gray-400);flex-shrink:0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>`
      : `<div style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--gray-100);border-radius:8px;border:1px solid var(--gray-200)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary);flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span style="font-size:0.82rem;font-weight:500;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${u.org_name}</span>
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
  department: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9" y1="14.5" x2="15" y2="14.5"/></svg>'
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
      { id: 'student-forms', label: t('nav.announcements'), icon: 'review' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  } else if (role === 'teacher') {
    items = [
      { id: 'teacher-home', label: t('nav.dashboard'), icon: 'home' },
      { id: 'teacher-classrooms', label: t('nav.my_classrooms'), icon: 'classroom' },
      { id: 'teacher-feedback', label: t('nav.feedback'), icon: 'review' },
      { id: 'teacher-analytics', label: t('nav.analytics'), icon: 'chart' },
      { id: 'teacher-forms', label: t('nav.forms'), icon: 'review' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  } else if (role === 'head') {
    items = [
      { id: 'head-home', label: t('nav.dashboard'), icon: 'home' },
      { id: 'head-teachers', label: t('nav.teachers'), icon: 'users' },
      { id: 'head-classrooms', label: t('nav.classrooms'), icon: 'classroom' },
      { id: 'head-analytics', label: t('nav.analytics'), icon: 'chart' },
      { id: 'admin-departments', label: 'Departments', icon: 'department' },
      { id: 'head-forms', label: t('nav.forms'), icon: 'review' },
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
      { id: 'admin-forms', label: t('nav.forms'), icon: 'review' },
      { id: 'admin-departments', label: 'Departments', icon: 'department' },
      { id: 'admin-support', label: t('nav.support_messages'), icon: 'settings' },
      { id: 'admin-audit', label: t('nav.audit_logs'), icon: 'list' },
      { id: 'help', label: 'Help', icon: 'help' }
    ];
  }

  // Language switcher — single dropdown button
  const locales = I18n.getAvailableLocales();
  const currentLang = I18n.getLocale();
  const currentLocale = locales.find(l => l.code === currentLang) || locales[0];
  const langSwitcher = `<div style="padding:8px 12px 12px">
    <div style="position:relative">
      <button id="langDropdownBtn" onclick="toggleLangDropdown(event)" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;border-radius:8px;border:1px solid var(--gray-200);background:var(--gray-50);cursor:pointer;font-size:0.85rem;color:var(--gray-700)">
        <span>${currentLocale.flag} ${currentLocale.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div id="langDropdownMenu" style="display:none;position:absolute;bottom:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid var(--gray-200);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);overflow:hidden;z-index:1000">
        ${locales.map(l => `
          <button onclick="switchLanguage('${l.code}')" style="width:100%;display:flex;align-items:center;gap:10px;padding:9px 14px;border:none;background:${l.code === currentLang ? 'var(--primary-light)' : '#fff'};cursor:pointer;font-size:0.875rem;color:${l.code === currentLang ? 'var(--primary)' : 'var(--gray-700)'};font-weight:${l.code === currentLang ? '600' : '400'};text-align:left">
            <span style="font-size:1.1rem">${l.flag}</span>
            <span>${l.label}</span>
            ${l.code === currentLang ? '<span style="margin-left:auto;font-size:0.75rem">✓</span>' : ''}
          </button>`).join('')}
      </div>
    </div>
  </div>`;

  nav.innerHTML = '<div class="nav-section"><div class="nav-section-title">' + t('nav.main_menu') + '</div>' +
    items.map(it => `
      <button class="nav-item" data-view="${it.id}" onclick="navigateTo('${it.id}')">
        ${ICONS[it.icon]}
        ${it.label}
      </button>
    `).join('') + '</div>' +
    '<div class="nav-section"><div class="nav-section-title">' + t('nav.account_section') + '</div>' +
    `<button class="nav-item" data-view="account" onclick="navigateTo('account')">
      ${ICONS.settings}
      ${t('nav.account_details')}
    </button></div>` + langSwitcher;
}

function toggleLangDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('langDropdownMenu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Close when clicking outside
    setTimeout(() => document.addEventListener('click', closeLangDropdown, { once: true }), 0);
  }
}

function closeLangDropdown() {
  const menu = document.getElementById('langDropdownMenu');
  if (menu) menu.style.display = 'none';
}

async function switchLanguage(lang) {
  closeLangDropdown();
  await I18n.setLocale(lang);
  buildNavigation();
  navigateTo(currentView || getDefaultView());
}

// ============ NAVIGATION ============
function navigateTo(view) {
  currentView = view;
  window.location.hash = view;
  destroyCharts();
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
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
    'teacher-home': t('title.teacher_dashboard'),
    'teacher-classrooms': t('title.my_classrooms'),
    'teacher-feedback': t('title.student_feedback'),
    'teacher-analytics': t('title.analytics'),
    'head-home': t('title.school_overview'),
    'head-teachers': t('title.teacher_performance'),
    'head-classrooms': t('title.all_classrooms'),
    'head-analytics': t('title.analytics'),
    'admin-home': t('title.admin_dashboard'),
    'student-forms': t('nav.announcements'),
    'teacher-forms': t('nav.forms'),
    'admin-forms': t('nav.forms'),
    'admin-users': t('title.user_management'),
    'admin-terms': t('title.terms_periods'),
    'admin-classrooms': t('title.classroom_management'),
    'admin-teachers': t('title.teacher_feedback'),
    'admin-submissions': t('title.submission_tracking'),
    'admin-moderate': t('title.review_moderation'),
    'admin-flagged': t('title.flagged_reviews'),
    'admin-support': t('title.support_messages'),
    'admin-audit': t('title.audit_logs'),
    'head-forms': t('title.forms'),
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
    'student-forms': renderStudentForms,
    'teacher-home': renderTeacherHome,
    'teacher-classrooms': renderTeacherClassrooms,
    'teacher-feedback': renderTeacherFeedback,
    'teacher-analytics': renderTeacherAnalytics,
    'teacher-forms': renderTeacherForms,
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
    'admin-forms': renderAdminForms,
    'head-forms': renderHeadForms,
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

function ratingGridHTML(r) {
  return `<div class="rating-grid-responsive">
    ${[{k:'clarity_rating',l:t('criteria.clarity'),n:'Clarity'},{k:'engagement_rating',l:t('criteria.engagement'),n:'Engagement'},{k:'fairness_rating',l:t('criteria.fairness'),n:'Fairness'},{k:'supportiveness_rating',l:t('criteria.support_short'),n:'Supportiveness'},{k:'preparation_rating',l:t('criteria.preparation'),n:'Preparation'},{k:'workload_rating',l:t('criteria.workload'),n:'Workload'}].map(c => {
      const v = r[c.k]; const val = v || 0;
      return `<div class="rating-grid-item">
        <span class="rating-grid-label">${c.l}${criteriaInfoIcon(c.n)}</span>
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
  return [
    {name: t('criteria.clarity'), key: 'Clarity', desc: t('criteria.clarity_desc')},
    {name: t('criteria.engagement'), key: 'Engagement', desc: t('criteria.engagement_desc')},
    {name: t('criteria.fairness'), key: 'Fairness', desc: t('criteria.fairness_desc')},
    {name: t('criteria.supportiveness'), key: 'Supportiveness', desc: t('criteria.supportiveness_desc')},
    {name: t('criteria.preparation'), key: 'Preparation', desc: t('criteria.preparation_desc')},
    {name: t('criteria.workload'), key: 'Workload', desc: t('criteria.workload_desc')}
  ];
}
const CRITERIA_INFO = [
  {name:'Clarity', desc:'How clearly does the teacher explain topics? Consider whether instructions, lessons, and expectations are easy to understand, and whether the teacher uses examples that help make concepts click.'},
  {name:'Engagement', desc:'How well does the teacher keep the class interesting and involved? Think about whether lessons feel interactive, whether the teacher encourages questions and discussion, and whether you stay focused during class.'},
  {name:'Fairness', desc:'How fair is the teacher in grading, enforcing rules, and treating all students? Consider whether grades reflect your actual work, whether rules are applied equally, and whether every student gets the same respect.'},
  {name:'Supportiveness', desc:'How approachable and helpful is the teacher when you need assistance? Think about whether the teacher is willing to re-explain things, offers extra help, and creates a safe environment where it\'s okay to make mistakes.'},
  {name:'Preparation', desc:'How well-prepared is the teacher for each class? Consider whether lessons are organized, materials are ready, and the teacher has a clear plan \u2014 or whether class time often feels improvised or wasted.'},
  {name:'Workload', desc:'How reasonable is the amount of work assigned? Think about whether homework, projects, and readings are manageable alongside your other classes, and whether the effort required matches what you\'re expected to learn.'}
];

function criteriaInfoIcon(name) {
  return `<span class="criteria-info-btn" onclick="showCriteriaInfo('${name}')" style="cursor:pointer;color:var(--primary);font-size:0.75rem;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--primary);font-weight:700;font-style:normal;line-height:1;transition:all 0.15s;flex-shrink:0;margin-left:4px">i</span>`;
}

function showCriteriaInfo(name) {
  const localizedInfo = getCriteriaInfo();
  const info = localizedInfo.find(c => c.key === name) || CRITERIA_INFO.find(c => c.name === name);
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

// Format a score to always show 2 decimal places (e.g. 4 → "4.00", 3.5 → "3.50")
function fmtScore(val) {
  if (val === null || val === undefined) return 'N/A';
  return Number(val).toFixed(2);
}

function logout() {
  stopInactivityTimer();
  localStorage.removeItem('edurate_token');
  localStorage.removeItem('edurate_user');
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
      <button onclick="resetInactivityTimer()" style="background:#c0392b;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:0.95rem;font-weight:600;cursor:pointer;width:100%">${t('inactivity.stay')}</button>
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
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>${t('student.active_period_label')}</strong> ${data.period.name}
            <span style="color:var(--gray-500);margin-left:12px">${t('student.anonymous_hint')}</span>
          </div>
          <span class="badge badge-active">${t('status.open')}</span>
        </div>
      </div>

      ${eligible.length === 0 && reviewed.length > 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('student.all_done_title')}</h3><p>${t('student.all_done_desc')}</p></div></div></div>`
        : eligible.length === 0
          ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('student.no_teachers_title')}</h3><p>${t('student.no_teachers_desc')}</p></div></div></div>`
          : ''}

      ${eligible.map(teacher => `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header" style="display:flex;align-items:center;gap:12px">
            ${avatarHTML({ full_name: teacher.teacher_name, avatar_url: teacher.avatar_url, teacher_id: teacher.teacher_id }, 'normal', true)}
            <div style="flex:1">
              <h3 style="margin:0">${teacher.teacher_name}</h3>
              <span style="color:var(--gray-500);font-size:0.85rem">${teacher.classroom_subject} &middot; ${teacher.grade_level}</span>
            </div>
          </div>
          <div class="card-body">
            <form onsubmit="submitReview(event, ${teacher.teacher_id}, ${teacher.classroom_id})" data-teacher-id="${teacher.teacher_id}">
              <div class="form-group" style="margin-bottom:24px;padding:20px;background:linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);border-radius:12px;border:2px solid #bae6fd">
                <label style="font-size:1.1rem;font-weight:600;margin-bottom:12px;display:block;color:#0c4a6e">${t('student.overall_rating_label')}</label>
                <div style="display:flex;align-items:center;gap:16px">
                  <div id="overall-stars-${teacher.teacher_id}" class="fractional-stars" style="font-size:2.5rem;display:flex;gap:4px"></div>
                  <div id="overall-value-${teacher.teacher_id}" style="font-size:2rem;font-weight:700;color:#0369a1;min-width:60px">-</div>
                </div>
                <div style="margin-top:8px;color:#0369a1;font-size:0.85rem;font-style:italic">${t('student.rate_all_criteria')}</div>
              </div>
              <div class="grid grid-2" style="margin-bottom:20px">
                ${CRITERIA_INFO.map(cat => `
                  <div class="form-group" style="margin-bottom:12px">
                    <label style="display:flex;align-items:center;gap:6px">${cat.name} ${criteriaInfoIcon(cat.name)}</label>
                    <div class="star-rating-input" data-name="${cat.name.toLowerCase()}_rating" data-form="review-${teacher.teacher_id}">
                      ${[1,2,3,4,5].map(i => `<button type="button" class="star-btn" data-value="${i}" onclick="setRating(this)">\u2606</button>`).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
              <div class="form-group">
                <label>${t('student.feedback_tags_label')}</label>
                <div class="tag-container" id="tags-${teacher.teacher_id}">
                  ${tags.map(tag => `<div class="tag" onclick="this.classList.toggle('selected')" data-tag="${tag}">${translateTag(tag)}</div>`).join('')}
                </div>
              </div>
              <div class="form-group">
                <label>${t('student.written_feedback_label')}</label>
                <textarea class="form-control" name="feedback_text" placeholder="${t('student.written_feedback_placeholder')}" rows="3"></textarea>
              </div>
              <button type="submit" class="btn btn-primary">${t('student.submit_review')}</button>
            </form>
          </div>
        </div>
      `).join('')}

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
  const teacherId = form.dataset.teacherId;
  if (!teacherId) return;

  const clarity = parseInt(form.querySelector('[data-name="clarity_rating"]')?.dataset.value || 0);
  const engagement = parseInt(form.querySelector('[data-name="engagement_rating"]')?.dataset.value || 0);
  const fairness = parseInt(form.querySelector('[data-name="fairness_rating"]')?.dataset.value || 0);
  const supportiveness = parseInt(form.querySelector('[data-name="supportiveness_rating"]')?.dataset.value || 0);
  const preparation = parseInt(form.querySelector('[data-name="preparation_rating"]')?.dataset.value || 0);
  const workload = parseInt(form.querySelector('[data-name="workload_rating"]')?.dataset.value || 0);

  if (clarity && engagement && fairness && supportiveness && preparation && workload) {
    const overall = (clarity + engagement + fairness + supportiveness + preparation + workload) / 6;
    const rounded = Math.round(overall);

    renderFractionalStars(`overall-stars-${teacherId}`, overall);

    const valueEl = document.getElementById(`overall-value-${teacherId}`);
    if (valueEl) {
      valueEl.textContent = overall.toFixed(2);
      valueEl.style.color = overall >= 4 ? '#059669' : overall >= 3 ? '#0369a1' : overall >= 2 ? '#d97706' : '#dc2626';
    }
  } else {
    const starsEl = document.getElementById(`overall-stars-${teacherId}`);
    const valueEl = document.getElementById(`overall-value-${teacherId}`);
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
  const getRating = (name) => {
    const el = form.closest('.card-body').querySelector(`[data-name="${name}"]`);
    return parseInt(el?.dataset.value || 0);
  };

  const clarity = getRating('clarity_rating');
  const engagement = getRating('engagement_rating');
  const fairness = getRating('fairness_rating');
  const supportiveness = getRating('supportiveness_rating');
  const preparation = getRating('preparation_rating');
  const workload = getRating('workload_rating');

  if (!clarity || !engagement || !fairness || !supportiveness || !preparation || !workload) {
    return toast(t('student.rate_all_categories'), 'error');
  }

  // Auto-calculate overall rating as average of 6 criteria
  const overall = Math.round((clarity + engagement + fairness + supportiveness + preparation + workload) / 6);

  const tagsContainer = document.getElementById(`tags-${teacherId}`);
  const selectedTags = [...tagsContainer.querySelectorAll('.tag.selected')].map(el => el.dataset.tag);
  const feedbackText = form.querySelector('[name="feedback_text"]').value;

  try {
    await API.post('/reviews', {
      teacher_id: teacherId,
      classroom_id: classroomId,
      overall_rating: overall,
      clarity_rating: clarity,
      engagement_rating: engagement,
      fairness_rating: fairness,
      supportiveness_rating: supportiveness,
      preparation_rating: preparation,
      workload_rating: workload,
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
          : reviews.map(r => `
            <div class="review-card">
              <div class="review-header">
                <div>
                  <strong>${r.teacher_name}</strong>
                  <span style="color:var(--gray-500);font-size:0.85rem"> &middot; ${r.classroom_subject} &middot; ${r.term_name} &middot; ${r.period_name}</span>
                  <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
                    <span style="font-size:1.3rem;font-weight:700;color:${scoreColor(r.overall_rating)}">${r.overall_rating}/5</span>
                    ${starsHTML(r.overall_rating, 'large')}
                  </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                  ${r.approved_status === 1 ? `<span class="badge" style="background:#16a34a;color:#fff">${t('review.approved_badge')}</span>` : badgeHTML(r.flagged_status)}
                  <span style="font-size:0.78rem;color:var(--gray-400)">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
                  ${r.approved_status !== 1 ? `<button class="btn btn-sm btn-outline" onclick="editMyReview(${r.id})">${t('common.edit')}</button>` : `<span style="font-size:0.75rem;color:var(--gray-400)">${t('review.cannot_edit')}</span>`}
                </div>
              </div>
              <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-100)">
                ${ratingGridHTML(r)}
              </div>
              ${r.feedback_text ? `<div class="review-text">${r.feedback_text}</div>` : ''}
              ${JSON.parse(r.tags || '[]').length > 0 ? `
                <div class="review-tags">
                  ${JSON.parse(r.tags).map(tag => `<span class="tag">${translateTag(tag)}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

async function editMyReview(reviewId) {
  const reviews = await API.get('/reviews/my-reviews').catch(() => []);
  const review = reviews.find(r => r.id === reviewId);
  if (!review) return toast(t('review.not_found'), 'error');
  if (review.approved_status === 1) return toast(t('review.cannot_edit_approved'), 'error');

  const tags = await cachedGet('/reviews/tags', CACHE_TTL.long).catch(() => []);
  const currentTags = JSON.parse(review.tags || '[]');

  openModal(`
    <div class="modal-header"><h3>${t('review.edit_title', {teacher: review.teacher_name})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:16px">${review.classroom_subject} &middot; ${review.period_name}</p>
      ${['clarity','engagement','fairness','supportiveness','preparation','workload'].map(cat => `
        <div class="form-group">
          <label>${t('criteria.' + cat)}</label>
          <select class="form-control" id="edit_${cat}">
            ${[1,2,3,4,5].map(v => `<option value="${v}" ${review[cat+'_rating'] == v ? 'selected' : ''}>${v} - ${[t('rating.very_poor'),t('rating.poor'),t('rating.average'),t('rating.good'),t('rating.excellent')][v-1]}</option>`).join('')}
          </select>
        </div>
      `).join('')}
      <div class="form-group">
        <label>${t('review.written_feedback_label')} <span style="color:var(--gray-400);font-weight:400">${t('forms.optional')}</span></label>
        <textarea class="form-control" id="edit_feedback" rows="3" placeholder="${t('review.share_thoughts')}">${review.feedback_text || ''}</textarea>
      </div>
      <div class="form-group">
        <label>${t('review.tags_label')}</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${tags.map(tag => `<label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" value="${escAttr(tag)}" ${currentTags.includes(tag) ? 'checked' : ''}> ${translateTag(tag)}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="submitReviewEdit(${reviewId})">${t('common.save_changes')}</button>
    </div>
  `);
}

async function submitReviewEdit(reviewId) {
  const body = {
    clarity_rating: parseInt(document.getElementById('edit_clarity').value),
    engagement_rating: parseInt(document.getElementById('edit_engagement').value),
    fairness_rating: parseInt(document.getElementById('edit_fairness').value),
    supportiveness_rating: parseInt(document.getElementById('edit_supportiveness').value),
    preparation_rating: parseInt(document.getElementById('edit_preparation').value),
    workload_rating: parseInt(document.getElementById('edit_workload').value),
    feedback_text: document.getElementById('edit_feedback').value,
    tags: [...document.querySelectorAll('#modal input[type=checkbox]:checked')].map(cb => cb.value)
  };
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
              ${['clarity', 'engagement', 'fairness', 'supportiveness', 'preparation', 'workload'].map(cat => {
                const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
                return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
                  <span style="font-weight:500;display:flex;align-items:center;gap:4px">${t('criteria.' + cat)}${criteriaInfoIcon(capName)}</span>
                  <div style="display:flex;align-items:center;gap:8px">
                    ${starsHTML(scores[`avg_${cat}`] || 0)}
                    <span style="font-weight:600">${fmtScore(scores[`avg_${cat}`])}</span>
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

// ============ STUDENT ANNOUNCEMENTS & FORMS ============
async function renderStudentForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading')}</p></div>`;
  try {
    const [announcements, forms] = await Promise.all([
      cachedGet('/announcements', CACHE_TTL.medium).catch(() => []),
      API.get('/forms/student/available').catch(() => [])
    ]);

    const announcementsHTML = `
      <div style="margin-bottom:32px">
        <h2 style="margin-bottom:16px">${t('nav.announcements')}</h2>
        ${announcements.length === 0
          ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${t('ann.no_announcements_student')}</p></div></div></div>`
          : announcements.map(a => announcementCardHTML(a, false, true)).join('')}
      </div>`;

    const formsHTML = forms.length === 0 ? '' : `
      <div>
        <h2 style="margin-bottom:16px">${t('forms.title_count', {count: forms.length})}</h2>
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
      </div>`;

    el.innerHTML = announcementsHTML + formsHTML;
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
          ${['clarity', 'engagement', 'fairness', 'supportiveness', 'preparation', 'workload'].map(cat => {
            const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
            return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span style="font-weight:500;display:flex;align-items:center;gap:4px">${t('criteria.' + cat)}${criteriaInfoIcon(capName)}</span>
              <div style="display:flex;align-items:center;gap:8px">
                ${starsHTML(s[`avg_${cat}`] || 0)}
                <span style="font-weight:600;color:${s.review_count > 0 ? scoreColor(s[`avg_${cat}`] || 0) : 'var(--gray-400)'}">${s.review_count > 0 ? fmtScore(s[`avg_${cat}`]) : '0.00'}</span>
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
  const data = await cachedGet('/dashboard/teacher');
  window._teacherTerms = data.all_terms || [];
  window._teacherActiveTerm = data.active_term || null;
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <p style="color:var(--gray-500)">${t('teacher.manage_classrooms')}</p>
      <button class="btn btn-primary" onclick="showCreateClassroomTeacher()">${t('teacher.create_classroom')}</button>
    </div>
    ${(() => {
      const active = data.classrooms.filter(c => c.active_status !== 0);
      const archived = data.classrooms.filter(c => c.active_status === 0);
      if (data.classrooms.length === 0) return `<div class="empty-state" style="margin-top:40px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--gray-300);margin-bottom:12px"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <h3 style="color:var(--gray-500);margin-bottom:6px">${t('teacher.no_classrooms_title')}</h3>
          <p style="color:var(--gray-400);font-size:0.875rem">${t('teacher.create_first_classroom')}</p>
        </div>`;
      const renderCard = (c, isArchived) => `
        <div class="classroom-card" style="${isArchived ? 'opacity:0.65;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div>
              <div class="class-subject">${c.subject}</div>
              <div class="class-meta">${c.grade_level} &middot; ${c.student_count} ${t('common.students').toLowerCase()}</div>
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
      return `<div class="grid grid-2">
        ${active.map(c => renderCard(c, false)).join('')}
      </div>
      ${archived.length > 0 ? `
        <div style="margin-top:32px">
          <h3 style="color:var(--gray-500);font-size:0.95rem;margin-bottom:12px">${t('teacher.archived')} (${archived.length})</h3>
          <div class="grid grid-2">${archived.map(c => renderCard(c, true)).join('')}</div>
        </div>` : ''}`;
    })()}
  `;
}

function showCreateClassroomTeacher() {
  openModal(`
    <div class="modal-header"><h3>${t('teacher.create_classroom_title')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('common.subject')}</label>
        <input type="text" class="form-control" id="newSubject" placeholder="${t('teacher.subject_placeholder')}">
      </div>
      <div class="form-group">
        <label>${t('common.grade')}</label>
        <input type="text" class="form-control" id="newGradeLevel" placeholder="${t('teacher.grade_placeholder')}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="createClassroomTeacher()">${t('common.create')}</button>
    </div>
  `);
}

async function createClassroomTeacher() {
  const subject = document.getElementById('newSubject').value.trim();
  const grade_level = document.getElementById('newGradeLevel').value.trim();
  if (!subject || !grade_level) return toast(t('teacher.fill_all_fields'), 'error');
  try {
    const data = await API.post('/classrooms', { subject, grade_level });
    toast(t('teacher.classroom_created', {code: formatJoinCode(data.join_code)}));
    invalidateCache('/dashboard/teacher', '/classrooms', '/forms');
    closeModal();
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

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

  // Separate approved and pending reviews
  const approvedReviews = data.recent_reviews.filter(r => r.approved_status === 1);
  const pendingReviews = data.recent_reviews.filter(r => r.approved_status === 0);
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
    bySubject[key].avg_clarity = (reviews.reduce((sum, r) => sum + r.clarity_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_engagement = (reviews.reduce((sum, r) => sum + r.engagement_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_fairness = (reviews.reduce((sum, r) => sum + r.fairness_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_supportiveness = (reviews.reduce((sum, r) => sum + r.supportiveness_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_preparation = (reviews.reduce((sum, r) => sum + (r.preparation_rating || 0), 0) / reviews.length).toFixed(2);
    bySubject[key].avg_workload = (reviews.reduce((sum, r) => sum + (r.workload_rating || 0), 0) / reviews.length).toFixed(2);
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
                    <div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t('criteria.clarity')}${criteriaInfoIcon('Clarity')}</span><span style="font-weight:600;color:${scoreColor(s.avg_clarity)};display:flex;align-items:center;gap:8px">${s.avg_clarity} ${starsHTML(parseFloat(s.avg_clarity))}</span></div>
                    <div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t('criteria.engagement')}${criteriaInfoIcon('Engagement')}</span><span style="font-weight:600;color:${scoreColor(s.avg_engagement)};display:flex;align-items:center;gap:8px">${s.avg_engagement} ${starsHTML(parseFloat(s.avg_engagement))}</span></div>
                    <div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t('criteria.fairness')}${criteriaInfoIcon('Fairness')}</span><span style="font-weight:600;color:${scoreColor(s.avg_fairness)};display:flex;align-items:center;gap:8px">${s.avg_fairness} ${starsHTML(parseFloat(s.avg_fairness))}</span></div>
                    <div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t('criteria.supportiveness')}${criteriaInfoIcon('Supportiveness')}</span><span style="font-weight:600;color:${scoreColor(s.avg_supportiveness)};display:flex;align-items:center;gap:8px">${s.avg_supportiveness} ${starsHTML(parseFloat(s.avg_supportiveness))}</span></div>
                    <div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t('criteria.preparation')}${criteriaInfoIcon('Preparation')}</span><span style="font-weight:600;color:${scoreColor(s.avg_preparation)};display:flex;align-items:center;gap:8px">${s.avg_preparation} ${starsHTML(parseFloat(s.avg_preparation))}</span></div>
                    <div class="rating-item"><span style="display:flex;align-items:center;gap:4px">${t('criteria.workload')}${criteriaInfoIcon('Workload')}</span><span style="font-weight:600;color:${scoreColor(s.avg_workload)};display:flex;align-items:center;gap:8px">${s.avg_workload} ${starsHTML(parseFloat(s.avg_workload))}</span></div>
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
            ${['clarity', 'engagement', 'fairness', 'supportiveness', 'preparation', 'workload'].map((cat, i, arr) => {
              const name = t('criteria.' + cat);
              const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
              const key = 'avg_' + cat;
              const val = data.overall_scores[key] || 0;
              const hasReviews = data.overall_scores.review_count > 0;
              const border = i < arr.length - 1 ? 'border-bottom:1px solid var(--gray-100)' : '';
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;${border}">
                <span style="display:flex;align-items:center;gap:4px">${name}${criteriaInfoIcon(capName)}</span>
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
  return `<div class="review-card">
    <div class="review-header">
      <div>
        <span style="color:var(--gray-500);font-size:0.85rem">${r.classroom_subject} (${r.grade_level}) &middot; ${r.period_name}</span>
        <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
          <span style="font-size:1.3rem;font-weight:700;color:${scoreColor(r.overall_rating)}">${r.overall_rating}/5</span>
          ${starsHTML(r.overall_rating, 'large')}
        </div>
      </div>
      <span style="font-size:0.78rem;color:var(--gray-400)">${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-100)">${ratingGridHTML(r)}</div>
    ${r.feedback_text ? `<div class="review-text">${r.feedback_text}</div>` : ''}
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
        <div class="card-header"><h3>${t('analytics.score_trend')}</h3></div>
        <div class="card-body">
          ${periods.length > 0
            ? '<div class="chart-container"><canvas id="trendChart"></canvas></div>'
            : `<div class="empty-state" style="padding:32px 0"><p style="color:var(--gray-400)">${t('analytics.no_periods')}</p></div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${t('analytics.category_breakdown')}</h3></div>
        <div class="card-body">
          ${data.overall_scores.review_count > 0
            ? '<div class="chart-container"><canvas id="radarChart"></canvas></div>'
            : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;text-align:center;color:var(--gray-400)"><p style="font-weight:500;margin-bottom:4px">${t('teacher.no_data_yet')}</p><p style="font-size:0.82rem">${t('teacher.no_data_hint')}</p></div>`}
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
        if (i === 0 || p.score === null) return '#c0392b';
        return p.score > (periods[i-1].score || 0) ? '#16a34a' : p.score < (periods[i-1].score || 0) ? '#dc2626' : '#6b7280';
      });
      chartInstances.trend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: periods.map(p => p.name),
          datasets: [{
            label: t('chart.score'),
            data: periods.map(p => p.score),
            borderColor: '#c0392b',
            backgroundColor: 'rgba(192,57,43,0.08)',
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
          labels: [t('criteria.clarity'), t('criteria.engagement'), t('criteria.fairness'), t('criteria.supportiveness'), t('criteria.preparation'), t('criteria.workload')],
          datasets: [{
            label: t('teacher.your_scores'),
            data: [s.avg_clarity, s.avg_engagement, s.avg_fairness, s.avg_supportiveness, s.avg_preparation, s.avg_workload],
            borderColor: '#c0392b',
            backgroundColor: 'rgba(192,57,43,0.15)',
            pointBackgroundColor: '#c0392b'
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

// ============ TEACHER FORMS ============
async function renderTeacherForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="empty-state"><p>${t('forms.loading')}</p></div>`;
  try {
    const [forms, classrooms, announcements] = await Promise.all([
      cachedGet('/forms', CACHE_TTL.medium),
      cachedGet('/classrooms', CACHE_TTL.medium),
      cachedGet('/announcements', CACHE_TTL.medium).catch(() => [])
    ]);

    const statusBadge = s => {
      const map = { draft: ['#6b7280', t('forms.status_draft')], active: ['#16a34a', t('forms.status_active')], closed: ['#9ca3af', t('forms.status_closed')] };
      const [color, label] = map[s] || ['#6b7280', s];
      return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600">${label}</span>`;
    };

    el.innerHTML = `
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

      <div style="margin-top:40px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">${t('nav.announcements')}</h2>
          <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
        </div>
        ${announcements.length === 0
          ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${t('ann.post_classrooms_hint')}</p></div></div></div>`
          : announcements.map(a => announcementCardHTML(a, a.creator_id === (currentUser?.id))).join('')}
      </div>
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
              const barColor = label === 'Yes' ? '#16a34a' : label === 'No' ? '#ef4444' : '#c0392b';
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
        <div class="card-header"><h3>${t('head.teacher_rankings')}</h3></div>
        <div class="card-body">
          <table>
            <thead><tr><th>${t('common.teacher')}</th><th>${t('common.department')}</th><th>${t('chart.score')}</th><th>${t('common.reviews')}</th><th>${t('common.trend')}</th></tr></thead>
            <tbody>
              ${data.teachers.sort((a, b) => (b.scores.avg_overall || 0) - (a.scores.avg_overall || 0)).map(tchr => `
                <tr>
                  <td><strong>${tchr.full_name}</strong></td>
                  <td>${tchr.department || '-'}</td>
                  <td style="font-weight:600;color:${scoreColor(tchr.scores.avg_overall || 0)}">${fmtScore(tchr.scores.avg_overall)}</td>
                  <td>${tchr.scores.review_count}</td>
                  <td>${tchr.trend ? trendArrow(tchr.trend.trend) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
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
          backgroundColor: deptLabels.map((_, i) => ['#c0392b', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]),
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
          backgroundColor: ['#c0392b', '#10b981', '#f59e0b', '#8b5cf6'],
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
          backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#c0392b'],
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

  el.innerHTML = `
    <div class="grid grid-2">
      ${data.teachers.map(teacher => `
        <div class="card" style="margin-bottom:0">
          <div class="card-header">
            <h3>${teacher.full_name}</h3>
            <span style="color:var(--gray-500);font-size:0.85rem">${teacher.department || ''}</span>
          </div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;margin-bottom:16px">
              <div>
                <div style="font-size:0.8rem;color:var(--gray-500)">${t('common.subject')}</div>
                <div style="font-weight:500">${teacher.subject}</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:0.8rem;color:var(--gray-500)">${t('head.overall_rating')}</div>
                <div style="font-size:1.5rem;font-weight:700;color:${scoreColor(teacher.scores.avg_overall || 0)}">${fmtScore(teacher.scores.avg_overall)}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:0.8rem;color:var(--gray-500)">${t('head.reviews')}</div>
                <div style="font-weight:500">${teacher.scores.review_count}</div>
              </div>
            </div>
            ${['avg_clarity', 'avg_engagement', 'avg_fairness', 'avg_supportiveness', 'avg_preparation', 'avg_workload'].map(key => {
              const label = key.replace('avg_', '');
              const capName = label.charAt(0).toUpperCase() + label.slice(1);
              const val = teacher.scores[key] || 0;
              return `<div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;margin-bottom:3px">
                  <span style="display:flex;align-items:center;gap:3px">${capName}${criteriaInfoIcon(capName)}</span><span style="font-weight:600">${val}/5</span>
                </div>
                <div class="progress-bar"><div class="progress-fill blue" style="width:${(val/5)*100}%"></div></div>
              </div>`;
            }).join('')}
            ${teacher.trend ? `<div style="margin-top:12px;font-size:0.85rem">Trend: ${trendArrow(teacher.trend.trend)} <span class="trend-${teacher.trend.trend === 'improving' ? 'up' : teacher.trend.trend === 'declining' ? 'down' : 'stable'}">${teacher.trend.trend}</span></div>` : ''}
            <div style="margin-top:16px;display:flex;gap:8px">
              <button class="btn btn-primary" style="flex:1;font-size:0.85rem" onclick="viewTeacherFeedback(${teacher.id})">${t('admin.view_feedback')}</button>
              <button class="btn btn-outline" style="font-size:0.85rem" onclick="exportTeacherPDF(${teacher.id})" title="${t('admin.export_pdf')}">PDF</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderHeadClassrooms() {
  const data = await cachedGet('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>${t('common.subject')}</th><th>${t('common.teacher')}</th><th>${t('common.grade')}</th><th>${t('common.students')}</th><th>${t('common.actions')}</th></tr></thead>
          <tbody>
            ${data.classrooms.map(c => `
              <tr>
                <td><strong>${c.subject}</strong></td>
                <td>${c.teacher_name}</td>
                <td>${c.grade_level}</td>
                <td><a href="#" onclick="event.preventDefault();viewHeadClassroomMembers(${c.id},'${c.subject.replace(/'/g, "\\'")}')" style="color:var(--primary);font-weight:600">${c.student_count || 0}</a></td>
                <td><button class="btn btn-sm btn-outline" onclick="viewHeadClassroomMembers(${c.id},'${c.subject.replace(/'/g, "\\'")}')">${t('teacher.members')}</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

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

async function renderHeadAnalytics() {
  const data = await cachedGet('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>${t('head.performance_heatmap')}</h3></div>
      <div class="card-body">
        <table>
          <thead>
            <tr><th>${t('common.teacher')}</th><th><span style="display:flex;align-items:center;gap:3px">${t('criteria.clarity')}${criteriaInfoIcon('Clarity')}</span></th><th><span style="display:flex;align-items:center;gap:3px">${t('criteria.engagement')}${criteriaInfoIcon('Engagement')}</span></th><th><span style="display:flex;align-items:center;gap:3px">${t('criteria.fairness')}${criteriaInfoIcon('Fairness')}</span></th><th><span style="display:flex;align-items:center;gap:3px">${t('criteria.supportiveness')}${criteriaInfoIcon('Supportiveness')}</span></th><th><span style="display:flex;align-items:center;gap:3px">${t('criteria.preparation')}${criteriaInfoIcon('Preparation')}</span></th><th><span style="display:flex;align-items:center;gap:3px">${t('criteria.workload')}${criteriaInfoIcon('Workload')}</span></th><th>${t('head.final')}</th></tr>
          </thead>
          <tbody>
            ${data.teachers.map(tchr => {
              const s = tchr.scores;
              const cell = (val) => {
                const bg = !val ? 'var(--gray-100)' : val >= 4 ? 'var(--success-bg)' : val >= 3 ? 'var(--warning-bg)' : 'var(--danger-bg)';
                const color = !val ? 'var(--gray-400)' : val >= 4 ? '#047857' : val >= 3 ? '#92400e' : '#dc2626';
                return `<td style="background:${bg};color:${color};font-weight:600;text-align:center">${fmtScore(val)}</td>`;
              };
              return `<tr><td><strong>${tchr.full_name}</strong></td>${cell(s.avg_clarity)}${cell(s.avg_engagement)}${cell(s.avg_fairness)}${cell(s.avg_supportiveness)}${cell(s.avg_preparation)}${cell(s.avg_workload)}${cell(s.avg_overall)}</tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============ HEAD FORMS (ANNOUNCEMENTS) ============
async function renderHeadForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium);
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <p style="color:var(--gray-500)">${announcements.length} announcement${announcements.length !== 1 ? 's' : ''}</p>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      ${announcements.length === 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${t('ann.post_school_hint')}</p></div></div></div>`
        : announcements.map(a => announcementCardHTML(a, true)).join('')}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

// ============ ADMIN FORMS ============
async function renderAdminForms() {
  const el = document.getElementById('contentArea');
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const [forms, announcements] = await Promise.all([
      cachedGet('/forms', CACHE_TTL.medium),
      cachedGet('/announcements', CACHE_TTL.medium).catch(() => [])
    ]);

    const orgFilterHTML = '';
    const annHint = t('ann.post_classrooms_hint');

    el.innerHTML = `
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
      <div style="margin-top:40px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">${t('nav.announcements')}</h2>
          <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
        </div>
        ${announcements.length === 0
          ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${annHint}</p></div></div></div>`
          : announcements.map(a => announcementCardHTML(a, true)).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

function renderAdminFormCards(forms) {
  if (!forms.length) return `<div class="empty-state"><h3>${t('admin_forms.no_forms')}</h3><p>${t('admin_forms.no_forms_msg')}</p></div>`;
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
          backgroundColor: ['#c0392b', '#10b981', '#f59e0b', '#8b5cf6'],
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
          backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#c0392b'],
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
        if (i === 0 || s === null) return '#c0392b';
        return s > (scores[i-1] || 0) ? '#16a34a' : s < (scores[i-1] || 0) ? '#dc2626' : '#6b7280';
      });
      chartInstances.orgPeriod = new Chart(periodCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: t('admin.org_avg_label'),
            data: scores,
            borderColor: '#c0392b',
            backgroundColor: 'rgba(192,57,43,0.08)',
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
        if (i === 0 || s === null) return '#c0392b';
        return s > (scores[i-1] || 0) ? '#16a34a' : s < (scores[i-1] || 0) ? '#dc2626' : '#6b7280';
      });
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: periods.map(p => p.period_name),
          datasets: [{ label: t('admin.org_avg_label'), data: scores, borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,0.08)', fill: true, tension: 0.3, pointRadius: 6, pointBackgroundColor: pointColors, pointBorderColor: '#fff', pointBorderWidth: 2, spanGaps: true }]
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

function _buildUserRows(users) {
  if (users.length === 0) return `<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px">${t('admin.no_users')}</td></tr>`;
  return users.map(u => {
    const isSelf = u.id === currentUser.id;
    const canDelete = !isSelf && (
      (currentUser.role === 'admin' && u.role !== 'admin')
    );
    const safeName = u.full_name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
    <tr>
      <td><strong>${u.full_name}</strong></td>
      <td style="font-size:0.8rem;color:var(--gray-500)">${u.email}</td>
      <td><span class="badge ${u.role === 'super_admin' ? 'badge-flagged' : u.role === 'admin' ? 'badge-flagged' : u.role === 'teacher' ? 'badge-active' : u.role === 'head' ? 'badge-approved' : 'badge-pending'}">${{student: t('common.student'), teacher: t('common.teacher'), school_head: t('common.school_head'), admin: t('common.admin'), super_admin: t('common.super_admin')}[u.role] || u.role}</span></td>
      <td>${u.grade_or_position || '-'}</td>
      <td>${u.suspended ? `<span class="badge badge-rejected">${t('common.suspended')}</span>` : `<span class="badge badge-approved">${t('common.active')}</span>`}</td>
      <td>
        <div class="action-dropdown" id="dropdown-${u.id}">
          <button class="action-dropdown-trigger" onclick="toggleActionMenu(${u.id}, event)" title="${t('common.actions')}">⋮</button>
          <div class="action-dropdown-menu" id="dropdown-menu-${u.id}">
            <button class="action-dropdown-item" onclick="closeActionMenus();editUserById(${u.id})">${t('common.edit')}</button>
            <button class="action-dropdown-item" onclick="closeActionMenus();resetPassword(${u.id}, '${safeName}')">${t('admin.reset_password')}</button>
            ${!isSelf ? `<button class="action-dropdown-item" onclick="closeActionMenus();toggleSuspend(${u.id})">${u.suspended ? t('admin.unsuspend') : t('admin.suspend')}</button>` : ''}
            ${canDelete ? `<button class="action-dropdown-item danger" onclick="closeActionMenus();deleteUser(${u.id}, '${safeName}')">${t('admin.delete_account')}</button>` : ''}
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleActionMenu(userId, event) {
  event.stopPropagation();
  const menu = document.getElementById(`dropdown-menu-${userId}`);
  const isOpen = menu.classList.contains('open');
  closeActionMenus();
  if (!isOpen) menu.classList.add('open');
}

function closeActionMenus() {
  document.querySelectorAll('.action-dropdown-menu.open').forEach(m => m.classList.remove('open'));
}

// Close dropdowns when clicking anywhere outside
document.addEventListener('click', closeActionMenus);

// Close fixed announcement classroom popup when clicking outside
document.addEventListener('click', (e) => {
  const popup = document.getElementById('_annClsPopup');
  if (popup && popup.style.display !== 'none' && !popup.contains(e.target) && !e.target.closest('[data-ann-cls-btn]')) {
    popup.style.display = 'none';
  }
});

function _filterUserTable() {
  const search = (window._userSearch || '').toLowerCase();
  const filtered = (window._allUsers || []).filter(u => {
    const roleMatch = !window._userFilter || (window._userFilter === 'admin' ? u.role === 'admin' : u.role === window._userFilter);
    const searchMatch = !search || u.full_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
    return roleMatch && searchMatch;
  });
  const tbody = document.getElementById('userTableBody');
  if (tbody) tbody.innerHTML = _buildUserRows(filtered);
}

async function renderAdminUsers(refetch = true) {
  if (refetch) {
    window._allUsers = await API.get('/admin/users');
  }
  const el = document.getElementById('contentArea');
  const search = (window._userSearch || '').toLowerCase();
  const users = (window._allUsers || []).filter(u => {
    const roleMatch = !window._userFilter || (window._userFilter === 'admin' ? u.role === 'admin' : u.role === window._userFilter);
    const searchMatch = !search || u.full_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search);
    return roleMatch && searchMatch;
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm ${!window._userFilter ? 'btn-primary' : 'btn-outline'}" onclick="window._userFilter=null;renderAdminUsers()">${t('common.all')}</button>
        ${[{key: 'student', label: t('common.student')}, {key: 'teacher', label: t('common.teacher')}, {key: 'head', label: t('common.school_head')}, {key: 'admin', label: t('common.admin')}].map(r =>
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
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>${t('common.name')}</th><th>${t('common.email')}</th><th>${t('common.role')}</th><th>${t('admin.grade_position')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead>
          <tbody id="userTableBody">
            ${_buildUserRows(users)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function showCreateUser() {
  const orgOptions = '';

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
          <option value="school_head">${t('common.school_head')}</option>
          <option value="org_admin">${t('common.org_admin')}</option>
        </select>
      </div>
      <div id="orgFields" style="display:none">
        <div class="form-group">
          <label>${t('admin.organization')} <span style="color:var(--danger)">*</span></label>
          <select class="form-control" id="newUserOrgId">
            <option value="">${t('admin.select_org')}</option>
            ${orgOptions}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>${t('admin.grade_position_label')}</label>
        <input type="text" class="form-control" id="newUserGrade" placeholder="${t('admin.grade_position_placeholder')}">
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
}

function onNewUserRoleChange(role) {
  document.getElementById('teacherFields').style.display = role === 'teacher' ? 'block' : 'none';
  const orgFields = document.getElementById('orgFields');
  if (orgFields) {
    orgFields.style.display = (role === 'head' || role === 'admin') ? 'block' : 'none';
  }
}

async function createUser() {
  const body = {
    full_name: document.getElementById('newUserName').value,
    email: document.getElementById('newUserEmail').value,
    password: document.getElementById('newUserPassword').value,
    role: document.getElementById('newUserRole').value,
    grade_or_position: document.getElementById('newUserGrade').value
  };
  if (body.role === 'teacher') {
    body.subject = document.getElementById('newTeacherSubject').value;
    body.department = document.getElementById('newTeacherDept').value;
    body.experience_years = parseInt(document.getElementById('newTeacherExp').value) || 0;
  }
  const orgSelect = document.getElementById('newUserOrgId');
  if (orgSelect && orgSelect.value) {
    body.org_id = parseInt(orgSelect.value);
  }
  if ((body.role === 'head' || body.role === 'admin') && !body.org_id) {
    return toast(t('admin.org_required_for_role'), 'error');
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
  openModal(`
    <div class="modal-header"><h3>${t('admin.edit_user_title', {name: user.full_name})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>${t('account.full_name')}</label>
        <input type="text" class="form-control" id="editUserName" value="${user.full_name}">
      </div>
      <div class="form-group">
        <label>${t('account.email')}</label>
        <input type="email" class="form-control" id="editUserEmail" value="${user.email}">
      </div>
      <div class="form-group">
        <label>${t('admin.grade_position_label')}</label>
        <input type="text" class="form-control" id="editUserGrade" value="${user.grade_or_position || ''}">
      </div>
      <div class="form-group">
        <label>${t('account.role')}</label>
        <select class="form-control" id="editUserRole">
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

async function saveUserEdit(userId) {
  const body = {
    full_name: document.getElementById('editUserName').value,
    email: document.getElementById('editUserEmail').value,
    grade_or_position: document.getElementById('editUserGrade').value,
    role: document.getElementById('editUserRole').value
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
                    <span style="font-size:0.75rem;color:var(--gray-400)">${p.classroom_count || 0} classroom${(p.classroom_count || 0) !== 1 ? 's' : ''}</span>
                  </div>
                  <div style="font-size:0.75rem;color:var(--gray-500);margin-top:2px">${p.start_date || '—'} → ${p.end_date || '—'}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
                  ${p.active_status
                    ? `<button class="btn btn-sm btn-danger" onclick="togglePeriod(${p.id}, 0)">${t('common.closed')}</button>`
                    : `<button class="btn btn-sm btn-success" onclick="togglePeriod(${p.id}, 1)">${t('status.open')}</button>`}
                  <button class="btn btn-sm btn-outline" onclick="editPeriod(${p.id}, '${escAttr(p.name)}', '${p.start_date || ''}', '${p.end_date || ''}', ${JSON.stringify(p.classroom_ids || [])})">${t('common.edit')}</button>
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
    await API.post('/admin/feedback-periods', { term_id: termId, name, start_date, end_date, classroom_ids });
    toast(t('admin.period_added'));
    invalidateCache('/admin/terms', '/dashboard', '/reviews');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function editPeriod(periodId, name, startDate, endDate, currentClassroomIds) {
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
    await API.put(`/admin/feedback-periods/${periodId}`, { name, start_date, end_date, classroom_ids });
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
  const el = document.getElementById('contentArea');

  const isSuperAdmin = false;
  const orgColumnHeader = isSuperAdmin ? `<th>${t('admin.organization')}</th>` : '';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h2>${t('admin.classroom_management_count', {count: classrooms.length})}</h2>
      <button class="btn btn-primary" onclick="showCreateClassroom()">+ ${t('admin.create_classroom_title')}</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>${t('common.subject')}</th>${orgColumnHeader}<th>${t('common.teacher')}</th><th>${t('common.grade')}</th><th>${t('common.students')}</th><th>${t('admin.join_code')}</th><th>${t('common.actions')}</th></tr></thead>
          <tbody>
            ${classrooms.map(c => {
              const orgColumn = isSuperAdmin ? `<td>${c.org_name || '-'}</td>` : '';
              return `
              <tr>
                <td><strong>${c.subject}</strong></td>
                ${orgColumn}
                <td>${c.teacher_name || '-'}</td>
                <td>${c.grade_level}</td>
                <td><a href="#" onclick="event.preventDefault();viewClassroomMembers(${c.id}, '${c.subject.replace(/'/g, "\\'")}')" style="color:var(--primary);font-weight:600">${c.student_count || 0}</a></td>
                <td><code style="background:var(--gray-100);padding:2px 8px;border-radius:4px">${formatJoinCode(c.join_code)}</code></td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick="viewClassroomMembers(${c.id}, '${c.subject.replace(/'/g, "\\'")}')">${t('teacher.members')}</button>
                  <button class="btn btn-sm btn-outline" onclick='editClassroom(${JSON.stringify(c)})'>${t('common.edit')}</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteClassroom(${c.id}, '${c.subject}')">${t('common.delete')}</button>
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

function editClassroom(classroom) {
  cachedGet('/admin/teachers', CACHE_TTL.medium).then(teachers => {
    openModal(`
      <div class="modal-header"><h3>${t('admin.edit_classroom_title', {subject: classroom.subject})}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="form-group">
          <label>${t('common.subject')}</label>
          <input type="text" class="form-control" id="editClassroomSubject" value="${classroom.subject}">
        </div>
        <div class="form-group">
          <label>${t('admin.grade_level')}</label>
          <input type="text" class="form-control" id="editClassroomGrade" value="${classroom.grade_level}">
        </div>
        <div class="form-group">
          <label>${t('common.teacher')}</label>
          <select class="form-control" id="editClassroomTeacher">
            ${teachers.map(tchr => `<option value="${tchr.id}" ${tchr.id === classroom.teacher_id ? 'selected' : ''}>${tchr.full_name} - ${tchr.subject || t('admin.no_subject')}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
        <button class="btn btn-primary" onclick="saveClassroomEdit(${classroom.id})">${t('admin.save_changes')}</button>
      </div>
    `);
  });
}

async function saveClassroomEdit(classroomId) {
  const body = {
    subject: document.getElementById('editClassroomSubject').value,
    grade_level: document.getElementById('editClassroomGrade').value,
    teacher_id: parseInt(document.getElementById('editClassroomTeacher').value)
  };
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
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
              <div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:0.85rem;color:var(--gray-600)">${t('review.overall')}</span>
                <span style="font-weight:700;color:${scoreColor(r.overall_rating)}">${r.overall_rating}/5</span>
              </div>
              ${['clarity','engagement','fairness','supportiveness','preparation','workload'].map(cat => {
                const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
                const k = (cat === 'supportiveness' ? 'supportiveness' : cat) + '_rating';
                const v = r[k]; const val = v || 0;
                return `<div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:0.85rem;color:var(--gray-600);display:flex;align-items:center;gap:3px">${t('criteria.' + cat)}${criteriaInfoIcon(capName)}</span>
                  <span style="font-weight:700;color:${scoreColor(val)}">${v ? v + '/5' : '-'}</span>
                </div>`;
              }).join('')}
            </div>
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
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
              <div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:0.85rem;color:var(--gray-600)">${t('review.overall')}</span>
                <span style="font-weight:700;color:${scoreColor(r.overall_rating)}">${r.overall_rating}/5</span>
              </div>
              ${['clarity','engagement','fairness','supportiveness','preparation','workload'].map(cat => {
                const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
                const k = cat + '_rating';
                const v = r[k]; const val = v || 0;
                return `<div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:0.85rem;color:var(--gray-600);display:flex;align-items:center;gap:3px">${t('criteria.' + cat)}${criteriaInfoIcon(capName)}</span>
                  <span style="font-weight:700;color:${scoreColor(val)}">${v ? v + '/5' : '-'}</span>
                </div>`;
              }).join('')}
            </div>
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
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px">
              <div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:0.85rem;color:var(--gray-600)">${t('review.overall')}</span>
                <span style="font-weight:700;color:${scoreColor(r.overall_rating)}">${r.overall_rating}/5</span>
              </div>
              ${['clarity','engagement','fairness','supportiveness','preparation','workload'].map(cat => {
                const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
                const k = cat + '_rating';
                const v = r[k]; const val = v || 0;
                return `<div style="padding:10px 14px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:0.85rem;color:var(--gray-600);display:flex;align-items:center;gap:3px">${t('criteria.' + cat)}${criteriaInfoIcon(capName)}</span>
                  <span style="font-weight:700;color:${scoreColor(val)}">${v ? v + '/5' : '-'}</span>
                </div>`;
              }).join('')}
            </div>
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
      <div class="form-group">
        <label>${t('admin.bio')}</label>
        <textarea class="form-control" id="editTeacherBio" rows="3">${teacher.bio || ''}</textarea>
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
    experience_years: parseInt(document.getElementById('editTeacherExp').value) || 0,
    bio: document.getElementById('editTeacherBio').value
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
  const [teachers, inviteData, orgDepts] = await Promise.all([
    cachedGet('/admin/teachers', CACHE_TTL.medium),
    currentUser.role === 'admin' ? API.get('/admin/invite-code').catch(e => ({ error: e.message })) : Promise.resolve(null),
    currentUser.role === 'admin' ? API.get('/departments').catch(() => []) : Promise.resolve([])
  ]);
  const el = document.getElementById('contentArea');

  const inviteCodeHTML = inviteData ? `
    <div class="card" style="margin-bottom:20px;padding:18px 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-weight:600;color:var(--gray-800);margin-bottom:3px">${t('admin.invite_code_title')}</div>
          <div style="font-size:0.82rem;color:var(--gray-500)">${t('admin.invite_code_hint')}</div>
        </div>
        ${orgDepts.length === 0 ? `
          <div style="background:var(--warning-light);border-left:4px solid var(--warning);padding:10px 16px;border-radius:8px;font-size:0.85rem">
            <strong>Setup required:</strong> Add at least one department before sharing the invite code with teachers.
            <button class="btn btn-sm btn-primary" style="margin-left:8px;margin-top:4px" onclick="navigateTo('admin-departments')">Manage Departments →</button>
          </div>
        ` : `
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <code id="inviteCodeDisplay" style="font-size:1.2rem;font-weight:700;letter-spacing:4px;background:var(--gray-100);padding:7px 14px;border-radius:8px;color:var(--gray-800)">${inviteData.invite_code || (inviteData.error ? 'Error' : '—')}</code>
            ${inviteData.invite_code ? `
              <button class="btn btn-sm btn-outline" onclick="copyInviteCode()">${t('org.copy')}</button>
              <button class="btn btn-sm btn-outline" style="color:#ef4444" onclick="confirmRegenerateInviteCode()">${t('org.regenerate')}</button>
            ` : ''}
          </div>
        `}
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    ${inviteCodeHTML}
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
  openModal(`
    <div class="modal-header">
      <h2>${t('admin.feedback_for', {name: data.teacher.full_name})}</h2>
      <button onclick="closeModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer">&times;</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:var(--radius-md)">
        <div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:20px">
          <div>
            <div style="font-size:2rem;font-weight:700;color:${scoreColor(data.scores.avg_overall || 0)}">${fmtScore(data.scores.avg_overall)}</div>
            <div style="color:var(--gray-500);font-size:0.85rem">${t('profile.overall_rating')}</div>
          </div>
          <div>
            <div style="font-size:2rem;font-weight:700">${data.scores.review_count}</div>
            <div style="color:var(--gray-500);font-size:0.85rem">${t('profile.total_reviews')}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-top:16px;border-top:1px solid var(--gray-200)">
          ${['clarity', 'engagement', 'fairness', 'supportiveness', 'preparation', 'workload'].map(cat => {
            const capName = cat.charAt(0).toUpperCase() + cat.slice(1);
            const key = 'avg_' + cat;
            const val = data.scores[key] || 0;
            return `<div style="text-align:center">
              <div style="font-size:1.3rem;font-weight:600;color:${scoreColor(val)}">${fmtScore(data.scores[key])}</div>
              <div style="color:var(--gray-500);font-size:0.85rem;display:flex;align-items:center;justify-content:center;gap:3px">${t('criteria.' + cat)}${criteriaInfoIcon(capName)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div style="max-height:400px;overflow-y:auto">
        ${data.reviews.length === 0 ? `<div class="empty-state"><p>${t('admin.no_approved_reviews')}</p></div>` : data.reviews.map(r => `
          <div style="padding:12px;border:1px solid var(--gray-200);border-radius:var(--radius-md);margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <div style="font-size:0.85rem;color:var(--gray-500)">${new Date(r.created_at).toLocaleDateString()}</div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                <div style="font-weight:600;color:${scoreColor(r.overall_rating)}">${t('review.overall')}: ${r.overall_rating}/5</div>
                ${starsHTML(r.overall_rating, 'small')}
              </div>
            </div>
            <div style="font-size:0.85rem;color:var(--gray-500);margin-bottom:8px">
              ${r.classroom_subject} (${r.grade_level}) &middot; ${r.term_name} &middot; ${r.period_name}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;padding:8px;background:var(--gray-50);border-radius:var(--radius-sm)">
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:3px"><strong>${t('criteria.clarity')}</strong>${criteriaInfoIcon('Clarity')}: ${r.clarity_rating}/5 ${starsHTML(r.clarity_rating, 'small')}</div>
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:3px"><strong>${t('criteria.engagement')}</strong>${criteriaInfoIcon('Engagement')}: ${r.engagement_rating}/5 ${starsHTML(r.engagement_rating, 'small')}</div>
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:3px"><strong>${t('criteria.fairness')}</strong>${criteriaInfoIcon('Fairness')}: ${r.fairness_rating}/5 ${starsHTML(r.fairness_rating, 'small')}</div>
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:3px"><strong>${t('criteria.supportiveness')}</strong>${criteriaInfoIcon('Supportiveness')}: ${r.supportiveness_rating}/5 ${starsHTML(r.supportiveness_rating, 'small')}</div>
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:3px"><strong>${t('criteria.preparation')}</strong>${criteriaInfoIcon('Preparation')}: ${ratingText(r.preparation_rating)} ${starsHTML(r.preparation_rating, 'small')}</div>
              <div style="font-size:0.85rem;display:flex;align-items:center;gap:3px"><strong>${t('criteria.workload')}</strong>${criteriaInfoIcon('Workload')}: ${ratingText(r.workload_rating)} ${starsHTML(r.workload_rating, 'small')}</div>
            </div>
            ${r.feedback_text ? `<div style="padding:8px;background:var(--gray-50);border-radius:var(--radius-sm);font-size:0.9rem;margin-top:8px">${r.feedback_text}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `);
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
      color: #1c2340;
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
      background: #c0392b;
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
      border-left: 3px solid #c0392b;
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
    ${['clarity','engagement','fairness','supportiveness','preparation','workload'].map(cat => `
      <div class="crit">
        <div class="crit-n">${t('criteria.' + cat)}</div>
        ${bar(s['avg_' + cat])}
      </div>`).join('')}

    ${quotes.length ? `
      <div class="sec" style="margin-top:22px">${t('pdf.feedback_sample')}</div>
      ${quotes.map(r => `<div class="q">${r.feedback_text}</div>`).join('')}` : ''}
  </td>

</tr></table>

<div class="ftr">${t('pdf.footer', {date: now})} &nbsp;&bull;&nbsp; <strong style="color:#475569">EduRate</strong></div>
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
              <div class="form-group">
                <label>${t('account.bio')}</label>
                <textarea class="form-control" id="profileBio" rows="4" placeholder="${t('account.bio_placeholder')}">${data.teacher.bio || ''}</textarea>
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
      const bioEl = document.getElementById('profileBio');
      if (subjectEl) body.subject = subjectEl.value.trim();
      if (deptEl) body.department = deptEl.value.trim();
      if (bioEl) body.bio = bioEl.value.trim();
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
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--gray-200)">
        <div style="font-weight:600;font-size:0.9rem;margin-bottom:8px;color:var(--gray-700)">${t('admin.invite_code_title')}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <code id="superInviteCode" style="font-size:1.1rem;font-weight:700;letter-spacing:3px;background:var(--gray-100);padding:6px 14px;border-radius:8px;color:var(--gray-800)">Loading...</code>
          <button class="btn btn-sm btn-outline" onclick="copySuperInviteCode()">${t('org.copy')}</button>
          <button class="btn btn-sm btn-outline" style="color:#ef4444" onclick="regenerateSuperInviteCode(${org.id})">${t('org.regenerate')}</button>
        </div>
        <div style="font-size:0.75rem;color:var(--gray-400);margin-top:6px">${t('org.invite_hint')}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">${t('common.cancel')}</button>
      <button class="btn btn-primary" onclick="saveOrganizationEdit(${org.id})">${t('admin.save_changes')}</button>
    </div>
  `);

  // Fetch invite code fresh with explicit org_id
  fetch(`/api/admin/invite-code?org_id=${org.id}`, {
    headers: { 'Authorization': 'Bearer ' + (API.token || ''), 'Content-Type': 'application/json' },
    credentials: 'include'
  }).then(r => r.json()).then(data => {
    const el = document.getElementById('superInviteCode');
    if (el) el.textContent = data.invite_code || '—';
  }).catch(() => {
    const el = document.getElementById('superInviteCode');
    if (el) el.textContent = t('common.error');
  });
}

function copySuperInviteCode() {
  const code = document.getElementById('superInviteCode')?.textContent;
  if (!code || code === 'N/A' || code === 'Loading...' || code === 'Error' || code === '—') return;
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

function richTextToolbar(editorId) {
  return `<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
    ${[['Bold','B','bold'],['Italic','I','italic'],['Underline','U','underline']].map(([title, label, cmd]) =>
      `<button type="button" title="${title}" onclick="document.execCommand('${cmd}',false,null);document.getElementById('${editorId}').focus()"
        style="border:1px solid var(--gray-200);background:var(--gray-50);border-radius:4px;padding:3px 10px;font-weight:${cmd==='bold'?'700':'400'};font-style:${cmd==='italic'?'italic':'normal'};text-decoration:${cmd==='underline'?'underline':'none'};cursor:pointer;font-size:0.85rem">${label}</button>`
    ).join('')}
  </div>
  <div id="${editorId}" contenteditable="true" style="min-height:100px;padding:10px;border:1px solid var(--gray-200);border-radius:6px;font-size:0.92rem;line-height:1.6;outline:none" placeholder="${t('ann.write_placeholder')}"></div>`;
}

async function renderAdminAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium);
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <p style="color:var(--gray-500)">${announcements.length} announcement${announcements.length !== 1 ? 's' : ''}</p>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      ${announcements.length === 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${t('ann.post_updates_hint')}</p></div></div></div>`
        : announcements.map(a => announcementCardHTML(a, true)).join('')}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

async function renderTeacherAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium);
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <p style="color:var(--gray-500)">${announcements.length} announcement${announcements.length !== 1 ? 's' : ''}</p>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      ${announcements.length === 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${t('ann.post_classrooms_hint')}</p></div></div></div>`
        : announcements.map(a => announcementCardHTML(a, a.creator_id === (currentUser?.id))).join('')}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
}

async function renderHeadAnnouncements() {
  const el = document.getElementById('contentArea');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const announcements = await cachedGet('/announcements', CACHE_TTL.medium);
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <p style="color:var(--gray-500)">${announcements.length} announcement${announcements.length !== 1 ? 's' : ''}</p>
        <button class="btn btn-primary" onclick="showCreateAnnouncementModal()">${t('ann.new_btn')}</button>
      </div>
      ${announcements.length === 0
        ? `<div class="card"><div class="card-body"><div class="empty-state"><h3>${t('ann.no_announcements')}</h3><p>${t('ann.post_school_hint')}</p></div></div></div>`
        : announcements.map(a => announcementCardHTML(a, true)).join('')}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>${t('common.error')}</h3><p>${err.message}</p></div>`;
  }
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
            How to Use EduRate
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
          <div class="help-option-title">How to Use EduRate</div>
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
          How to Use EduRate
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
      { icon: '⭐', title: 'Writing Reviews', body: 'Navigate to <strong>Write a Review</strong>. Select a classroom, then rate your teacher across 6 criteria (Clarity, Engagement, Fairness, Supportiveness, Preparation, Workload). You can also add optional tags and written feedback.' },
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
    student: 'As a student on EduRate, your role is to provide honest, constructive feedback on your learning experience. Your reviews help teachers grow professionally and give your school the data it needs to improve education quality. Everything you do here — joining classrooms, writing reviews, responding to forms — contributes directly to that goal.',
    teacher: 'As a teacher on EduRate, you have a dedicated space to understand how your students experience your classes. The platform collects anonymous feedback, turns it into clear scores and summaries, and gives you tools to communicate back through forms, announcements, and exportable reports. Your performance data is visible to your school\'s management.',
    school_head: 'As a School Head on EduRate, you have analytical oversight of all teachers and departments in your organization. You can monitor performance trends, identify teachers who may need support, and track how each department evolves over time. Day-to-day settings and access control are managed by your Organization Admin.',
    admin: 'As an Admin, you manage the full operation of your school\'s EduRate account. You control who has access, when feedback periods open, and how reviews are moderated. You are the primary support contact for your teachers and students, and the person responsible for keeping the platform correctly configured for your organization.'
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
  const criteria = ['clarity', 'engagement', 'fairness', 'supportiveness', 'preparation', 'workload'];
  const criteriaLabels = ['Clarity', 'Engagement', 'Fairness', 'Supportiveness', 'Preparation', 'Workload'];

  // Dept averages per criterion
  const validTeachers = teachers.filter(t => t.review_count > 0);
  const deptCriteriaAvg = criteria.map(c => {
    const vals = validTeachers.map(t => t[`avg_${c}`]).filter(v => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : 0;
  });
  const orgCriteriaAvg = org_averages ? criteria.map(c => org_averages[`avg_${c}`] || 0) : [];

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
        <div class="stat-card"><div class="stat-label">Avg Score</div><div class="stat-value" style="color:${scoreColor(validTeachers.length ? deptCriteriaAvg.reduce((a,b)=>a+b,0)/6 : 0)}">${validTeachers.length ? fmtScore(deptCriteriaAvg.reduce((a,b)=>a+b,0)/6) : '—'}</div></div>
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
      borderColor: '#c0392b',
      borderWidth: 2,
      pointBackgroundColor: '#c0392b'
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
      data: { labels: criteriaLabels, datasets: radarDatasets },
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
          borderColor: '#c0392b',
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

/**
 * app.js — Main router & application shell controller for SZR
 *
 * Responsibilities:
 *   • Watch auth state → route to login / admin / employee views
 *   • Detect role (admin vs employee) from the Firestore profile
 *   • Run auto-checkout on load
 *   • Apply theme (light/dark) and font scale
 *   • Provide a global window.SZR API used by all view modules
 *   • Manage tab navigation
 */

import { onAuthChange, logout as authLogout, isEmployeeEmail } from './auth.js';
import { getEmployee, getSettings, watchSettings, runAutoCheckout } from './db.js';
import { el, toast, haptic } from './utils.js';

import { renderLogin } from './login.js';

// ──────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ──────────────────────────────────────────────────────────────────
const state = {
  user: null,          // Firebase user
  profile: null,       // Firestore employee/admin profile
  role: null,          // 'admin' | 'employee'
  settings: null,      // company settings
  currentRoute: null,  // active tab route
  settingsUnsub: null, // settings listener cleanup
  routeCleanup: null,  // cleanup fn for the current route's listeners
};

// Allow route modules to register a cleanup fn (e.g. Firestore listeners,
// intervals). Called automatically before navigating away. This is what
// prevents a previous page's live listeners from firing into a new page
// (which would mix screens together).
window.SZR_registerCleanup = (fn) => { state.routeCleanup = fn; };

// Local UI preferences (per-device, not synced)
const PREFS_KEY = 'szr-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
let prefs = loadPrefs();

// ──────────────────────────────────────────────────────────────────
// PAGE TITLES
// ──────────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  // employee
  'home':    'سەرەکی',
  'history': 'مێژووی من',
  'emp-settings': 'ڕێکخستنەکان',
  // admin
  'dashboard':  'سەرەکی',
  'employees':  'کارمەندان',
  'attendance': 'ژمێریاری',
  'reports':    'ڕاپۆرتەکان',
  'settings':   'ڕێکخستنەکان',
  'detail':     'وردەکاری کارمەند',
};

// ──────────────────────────────────────────────────────────────────
// THEME & FONT
// ──────────────────────────────────────────────────────────────────
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  // update theme-color meta
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#141B11' : '#2C3828');
}

function applyFontScale(scale) {
  document.documentElement.style.setProperty('--fs', String(scale));
}

function applyTopbarLogo(dark) {
  const logo = document.getElementById('topbar-logo');
  if (logo) logo.src = dark ? 'icons/icon-192-dark.png' : 'icons/icon-192.png';
}

/** Apply all local prefs (called early + after changes) */
function applyPrefs() {
  const dark = prefs.darkMode ?? false;
  applyTheme(dark);
  applyTopbarLogo(dark);
  applyFontScale(prefs.fontScale ?? 1);
}

// ──────────────────────────────────────────────────────────────────
// GLOBAL API — used by all view modules via window.SZR
// ──────────────────────────────────────────────────────────────────
window.SZR = {
  // state getters
  getUser: () => state.user,
  getProfile: () => state.profile,
  getRole: () => state.role,
  getSettings: () => state.settings,

  // prefs
  getPrefs: () => ({ ...prefs }),
  setPref: (key, value) => {
    prefs[key] = value;
    savePrefs(prefs);
    if (key === 'darkMode') { applyTheme(value); applyTopbarLogo(value); }
    if (key === 'fontScale') applyFontScale(value);
  },

  // settings update (admin)
  updateSettings: async (partial) => {
    const { saveSettings } = await import('./db.js');
    state.settings = await saveSettings(partial);
    return state.settings;
  },

  // navigation
  navigateTo: (route, params) => navigateTo(route, params),

  // auth
  logout: async () => {
    await authLogout();
    toast('چوویتە دەرەوە', 'info');
  },

  toast, haptic,
};

// ──────────────────────────────────────────────────────────────────
// ROUTING
// ──────────────────────────────────────────────────────────────────
const mainEl = () => document.getElementById('main');

async function navigateTo(route, params = {}) {
  // Clean up the previous route's listeners/intervals BEFORE switching,
  // so old live listeners don't fire into the new screen (prevents the
  // "screens mixing together" bug).
  if (state.routeCleanup) {
    try { state.routeCleanup(); } catch (e) { console.warn('[SZR] Cleanup error:', e); }
    state.routeCleanup = null;
  }

  state.currentRoute = route;
  haptic(8);

  // Update active tab
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.route === route);
  });

  // Update topbar page title
  const pageEl = document.getElementById('topbar-page');
  if (pageEl) pageEl.textContent = PAGE_TITLES[route] || '';

  // Clear & render
  const main = mainEl();
  main.innerHTML = '';
  main.scrollTop = 0;
  window.scrollTo(0, 0);

  try {
    if (state.role === 'admin') {
      await renderAdminRoute(route, main, params);
    } else {
      await renderEmployeeRoute(route, main, params);
    }
  } catch (err) {
    console.error('[SZR] Route render error:', err);
    main.appendChild(el('div.empty', {}, [
      el('div.empty__title', {}, 'کێشەیەک ڕوویدا'),
      el('div.empty__text', {}, 'تکایە دووبارە هەوڵ بدە'),
      el('button.btn.btn--primary', { onclick: () => navigateTo(route, params) }, 'هەوڵدانەوە'),
    ]));
  }
}

async function renderAdminRoute(route, main, params) {
  switch (route) {
    case 'dashboard': {
      const { renderDashboard } = await import('./admin-dashboard.js');
      return renderDashboard(main);
    }
    case 'employees': {
      const { renderEmployees } = await import('./admin-employees.js');
      return renderEmployees(main);
    }
    case 'attendance': {
      const { renderAttendance } = await import('./admin-attendance.js');
      return renderAttendance(main);
    }
    case 'detail': {
      const { renderEmployeeDetail } = await import('./admin-attendance.js');
      return renderEmployeeDetail(main, params.employeeId);
    }
    case 'reports': {
      const { renderReports } = await import('./admin-reports.js');
      return renderReports(main);
    }
    case 'settings': {
      const { renderSettings } = await import('./admin-settings.js');
      return renderSettings(main);
    }
    default:
      return renderAdminRoute('dashboard', main);
  }
}

async function renderEmployeeRoute(route, main) {
  switch (route) {
    case 'home': {
      const { renderEmployeeHome } = await import('./employee-home.js');
      return renderEmployeeHome(main);
    }
    case 'history': {
      const { renderEmployeeHistory } = await import('./employee-history.js');
      return renderEmployeeHistory(main);
    }
    case 'emp-settings': {
      const { renderEmployeeSettings } = await import('./employee-settings.js');
      return renderEmployeeSettings(main);
    }
    default:
      return renderEmployeeRoute('home', main);
  }
}

// ──────────────────────────────────────────────────────────────────
// TAB BAR BUILDERS
// ──────────────────────────────────────────────────────────────────
function buildTabbar(role) {
  const existing = document.getElementById('tabbar');
  if (existing) existing.remove();

  const tabs = role === 'admin'
    ? [
        { route: 'dashboard',  label: 'سەرەکی',      icon: iconHome() },
        { route: 'employees',  label: 'کارمەندان',   icon: iconUsers() },
        { route: 'attendance', label: 'ژمێریاری',    icon: iconCalendar() },
        { route: 'reports',    label: 'ڕاپۆرت',      icon: iconReport() },
        { route: 'settings',   label: 'ڕێکخستن',     icon: iconSettings() },
      ]
    : [
        { route: 'home',         label: 'سەرەکی',      icon: iconHome() },
        { route: 'history',      label: 'مێژووی من',   icon: iconCalendar() },
        { route: 'emp-settings', label: 'ڕێکخستنەکان', icon: iconSettings() },
      ];

  const tabbar = el('nav.tabbar' + (role === 'admin' ? '.tabbar--admin' : '.tabbar--employee'),
    { id: 'tabbar' },
    tabs.map((t) =>
      el('button.tab', { dataset: { route: t.route }, onclick: () => navigateTo(t.route) }, [
        t.icon,
        el('span.tab__label', {}, t.label),
      ])
    )
  );
  document.getElementById('app').appendChild(tabbar);
}

// ──────────────────────────────────────────────────────────────────
// SESSION SETUP — after login, determine role and build the shell
// ──────────────────────────────────────────────────────────────────
async function setupSession(user) {
  state.user = user;

  // Load profile from Firestore
  let profile = await getEmployee(user.uid);

  // If no profile but this is the admin email pattern, treat as admin
  // (first admin may not have a profile doc yet)
  if (!profile) {
    if (!isEmployeeEmail(user.email)) {
      // Admin without profile → create a minimal admin profile
      const { saveEmployeeProfile } = await import('./db.js');
      profile = await saveEmployeeProfile(user.uid, {
        name: 'بەڕێوەبەر',
        code: user.email.split('@')[0],
        role: 'admin',
      });
    } else {
      // Employee with no profile — shouldn't happen; sign out
      await authLogout();
      return;
    }
  }

  state.profile = profile;
  state.role = profile.role === 'admin' ? 'admin' : 'employee';

  // Load settings
  state.settings = await getSettings();

  // Merge dark mode: company has no global theme; use local pref
  applyPrefs();

  // Live-watch settings so changes reflect immediately
  if (state.settingsUnsub) state.settingsUnsub();
  state.settingsUnsub = watchSettings((s) => { state.settings = s; });

  // Run auto-checkout in background (don't block UI).
  // Admin scans ALL employees; an employee scans only THEIR OWN records
  // (scoped query, allowed by the security rules). Running it for employees
  // too means a forgotten checkout gets filled even if the admin doesn't log
  // in for a while.
  const autoScope = state.role === 'admin' ? undefined : state.user.uid;
  runAutoCheckout(state.settings, autoScope).then((n) => {
    if (n > 0) console.log(`[SZR] Auto-checkout filled ${n} record(s)`);
  }).catch((e) => console.warn('[SZR] Auto-checkout error:', e));

  // Build the app shell
  showAppShell();
  buildTabbar(state.role);

  // Initial route
  const initial = state.role === 'admin' ? 'dashboard' : 'home';
  navigateTo(initial);
}

function teardownSession() {
  state.user = null;
  state.profile = null;
  state.role = null;
  if (state.settingsUnsub) { state.settingsUnsub(); state.settingsUnsub = null; }
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.remove();
}

// ──────────────────────────────────────────────────────────────────
// SHELL VISIBILITY
// ──────────────────────────────────────────────────────────────────
function showAppShell() {
  document.getElementById('auth-screen')?.style.setProperty('display', 'none');
  const app = document.getElementById('app');
  app.style.display = 'flex';

  // Update topbar brand
  const nameEl = document.getElementById('topbar-name');
  if (nameEl) nameEl.textContent = 'SZR';
}

function showLoginScreen() {
  document.getElementById('app').style.display = 'none';
  const authScreen = document.getElementById('auth-screen');
  authScreen.style.display = 'block';
  authScreen.innerHTML = '';
  renderLogin(authScreen);
}

// ──────────────────────────────────────────────────────────────────
// CLOCK (topbar)
// ──────────────────────────────────────────────────────────────────
function startClock() {
  const clockEl = document.getElementById('topbar-clock');
  if (!clockEl) return;

  const tick = () => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    clockEl.textContent = `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };
  tick();
  // Align to the next minute boundary, then tick every minute
  const msToNextMinute = 60000 - (Date.now() % 60000);
  setTimeout(() => { tick(); setInterval(tick, 60000); }, msToNextMinute);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

// ──────────────────────────────────────────────────────────────────
// SERVICE WORKER
// ──────────────────────────────────────────────────────────────────
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Whether a SW already controlled this page when it loaded. If it did, a
  // later "controllerchange" means a NEW version was activated → reload once
  // so the fresh files take effect immediately (no second app re-open needed).
  // On the very FIRST install there's no prior controller, so we must NOT
  // reload — that would be a pointless refresh on initial launch.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return; // guard against loops & first-install
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        // Actively check for a new version on every launch so updates are
        // picked up promptly rather than waiting for the browser's own cycle.
        reg.update?.();
        // Also re-check whenever the app returns to the foreground (common on
        // mobile, where the page is resumed rather than fully reloaded).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update?.();
        });
      })
      .catch((e) => console.warn('[SZR] SW registration failed:', e));
  });
}

// ──────────────────────────────────────────────────────────────────
// INSTALL PROMPT
// ──────────────────────────────────────────────────────────────────
let deferredPrompt = null;
function setupInstallPrompt() {
  const banner = document.getElementById('install-banner');
  const btn = document.getElementById('install-btn');
  const close = document.getElementById('install-close');

  const installed = window.matchMedia('(display-mode: standalone)').matches ||
                    window.navigator.standalone === true;
  const dismissed = localStorage.getItem('szr-install-dismissed') === '1';

  // ── iOS hint (Safari doesn't fire beforeinstallprompt) ──
  const iosHint = document.getElementById('ios-install-hint');
  const iosClose = document.getElementById('ios-install-close');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const iosDismissed = localStorage.getItem('szr-ios-dismissed') === '1';

  const hideBanner = () => { if (banner) { banner.hidden = true; banner.style.display = 'none'; } };
  const hideIos = () => { if (iosHint) { iosHint.hidden = true; iosHint.style.display = 'none'; } };

  if (close) close.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    hideBanner(); localStorage.setItem('szr-install-dismissed', '1');
  });
  if (iosClose) iosClose.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    hideIos(); localStorage.setItem('szr-ios-dismissed', '1');
  });

  if (dismissed || installed) hideBanner();
  if (iosDismissed || installed || !isIOS) hideIos();

  // Show iOS hint after a short delay if applicable
  if (isIOS && !installed && !iosDismissed && iosHint) {
    setTimeout(() => { iosHint.hidden = false; iosHint.style.display = ''; }, 2000);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!dismissed && !installed && banner) { banner.hidden = false; banner.style.display = ''; }
  });

  if (btn) btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hideBanner();
  });

  window.addEventListener('appinstalled', () => { hideBanner(); hideIos(); deferredPrompt = null; });
}

// ──────────────────────────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────────────────────────
function boot() {
  // Apply prefs immediately (before auth) to avoid flash
  applyPrefs();
  startClock();
  registerServiceWorker();
  setupInstallPrompt();

  // Hide splash after a short delay
  const splash = document.getElementById('splash');

  // Watch auth state
  onAuthChange(async (user) => {
    if (user) {
      await setupSession(user);
    } else {
      teardownSession();
      showLoginScreen();
    }
    // Dismiss splash once we know the state
    if (splash && !splash.classList.contains('splash--out')) {
      setTimeout(() => {
        splash.classList.add('splash--out');
        setTimeout(() => splash.remove(), 500);
      }, 600);
    }
  });
}

// Expose navigateTo for inline use
window.SZR.navigateTo = navigateTo;

boot();

// ──────────────────────────────────────────────────────────────────
// TAB ICONS
// ──────────────────────────────────────────────────────────────────
function svg(paths, sw = 2) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'tab__icon');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', sw);
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths;
  return s;
}
function iconHome() { return svg('<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>'); }
function iconUsers() { return svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'); }
function iconCalendar() { return svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'); }
function iconReport() { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'); }
function iconSettings() { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'); }

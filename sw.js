/**
 * sw.js — Service Worker for SZR
 *
 * Strategy:
 *   • App shell (HTML/CSS/JS/icons) → cache-first, so the app loads
 *     instantly and works offline.
 *   • Firebase / network requests   → network-only (never cached); the
 *     Firestore SDK has its own offline persistence.
 *
 * IMPORTANT: bump CACHE_NAME on each release so browsers fetch fresh
 * files instead of serving stale cached versions.
 */

const CACHE_NAME = 'szr-v2.1.1';

// Core files that make up the app shell
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  // CSS
  './css/styles.css',
  // JavaScript modules
  './js/app.js',
  './js/login.js',
  './js/utils.js',
  './js/geo.js',
  './js/auth.js',
  './js/db.js',
  './js/firebase-config.js',
  './js/employee-home.js',
  './js/employee-history.js',
  './js/employee-settings.js',
  './js/admin-dashboard.js',
  './js/admin-employees.js',
  './js/admin-attendance.js',
  './js/admin-reports.js',
  './js/admin-settings.js',
  // Icons
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-dark.png',
  './icons/icon-512-dark.png',
  './icons/icon-maskable-512.png',
  './icons/icon-maskable-512-dark.png',
  './icons/apple-touch-icon.png',
  './icons/apple-touch-icon-dark.png',
  './icons/favicon-32.png',
  './icons/favicon-96.png',
];

// ──────────────────────────────────────────────────────────────────
// INSTALL — pre-cache the app shell
// ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // activate immediately
      .catch((err) => console.warn('[SW] Pre-cache error:', err))
  );
});

// ──────────────────────────────────────────────────────────────────
// ACTIVATE — clean up old caches
// ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // take control of open pages
  );
});

// ──────────────────────────────────────────────────────────────────
// FETCH
// ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET
  if (request.method !== 'GET') return;

  // NEVER cache Firebase / Google / external API traffic — let it hit
  // the network (Firestore handles its own offline persistence).
  const isExternal = url.origin !== self.location.origin;
  const isFirebase = /firebase|firestore|googleapis|gstatic|google/.test(url.hostname);
  if (isExternal || isFirebase) {
    return; // default browser network handling
  }

  // App shell: cache-first, fall back to network, then update cache
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve from cache, but refresh in background (stale-while-revalidate)
        fetchAndCache(request);
        return cached;
      }
      return fetchAndCache(request);
    }).catch(() => {
      // Offline fallback for navigation requests
      if (request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    // Only cache valid, basic responses
    if (response && response.status === 200 && response.type === 'basic') {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  });
}

// ──────────────────────────────────────────────────────────────────
// MESSAGE — allow the page to trigger an immediate update
// ──────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

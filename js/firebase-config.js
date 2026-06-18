/**
 * firebase-config.js — Firebase initialization for SZR Attendance
 *
 * Loads Firebase SDK (v10 modular, via CDN) and exports the initialized
 * services: auth, db. Uses long-polling-friendly Firestore with offline
 * persistence so the app keeps working when the network drops.
 */

// Firebase v10 modular SDK from the official CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ──────────────────────────────────────────────────────────────────
// PROJECT CONFIG — Shkoy Zawy Real Estate
// ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyCjstquIxX0TMSN3934p6YauqNstwEmBHA',
  authDomain: 'shkoy-zawy-real-estate.firebaseapp.com',
  projectId: 'shkoy-zawy-real-estate',
  storageBucket: 'shkoy-zawy-real-estate.firebasestorage.app',
  messagingSenderId: '953235726021',
  appId: '1:953235726021:web:fb4acb76072e9c3e3b5aac',
};

// ──────────────────────────────────────────────────────────────────
// INITIALIZE
// ──────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

// Auth — keep the user logged in across sessions (local persistence)
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.warn('[SZR] Auth persistence error:', err)
);

// Firestore — with offline cache enabled (multi-tab safe)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Company identifier — all data lives under this company namespace
export const COMPANY_ID = 'szr';

export { app };

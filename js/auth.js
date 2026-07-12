/**
 * auth.js — Authentication for SZR
 *
 * Two login types map to Firebase Email/Password under the hood:
 *   • Admin    → logs in with a real email + password
 *   • Employee → logs in with a CODE + password; the code is internally
 *                converted to a synthetic email: `${code}@szr.attendance`
 *
 * The employee never sees the email — only their code. This keeps the
 * employee login simple (just a short code), while Firebase Auth still
 * uses email/password under the hood.
 */

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { auth } from './firebase-config.js';

// Synthetic email domain for employee codes
const EMP_DOMAIN = '@szr.attendance';

/** Convert an employee code → synthetic email */
export function codeToEmail(code) {
  return `${code.trim().toLowerCase()}${EMP_DOMAIN}`;
}

/** Check whether an email is an employee (synthetic) or admin (real) */
export function isEmployeeEmail(email) {
  return email && email.endsWith(EMP_DOMAIN);
}

// ──────────────────────────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────────────────────────

/** Admin login with real email + password */
export async function loginAdmin(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

/** Employee login with code + password */
export async function loginEmployee(code, password) {
  const email = codeToEmail(code);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * Smart login — tries to detect whether the input is an email (admin)
 * or a code (employee), and logs in accordingly.
 */
export async function login(identifier, password) {
  const id = identifier.trim();
  const isEmail = id.includes('@');
  if (isEmail) {
    return loginAdmin(id, password);
  }
  return loginEmployee(id, password);
}

// ──────────────────────────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ──────────────────────────────────────────────────────────────────
// AUTH STATE
// ──────────────────────────────────────────────────────────────────

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/** Get the current Firebase user (or null) */
export function currentUser() {
  return auth.currentUser;
}

// ──────────────────────────────────────────────────────────────────
// CREATE EMPLOYEE ACCOUNT  (admin only)
// ──────────────────────────────────────────────────────────────────

/**
 * Create a Firebase Auth account for a new employee.
 *
 * NOTE: createUserWithEmailAndPassword signs in as the new user,
 * which would log the admin out. To avoid that, we use a SECONDARY
 * Firebase app instance for employee creation. This keeps the admin's
 * session intact.
 *
 * @returns {Promise<string>} the new user's UID
 */
export async function createEmployeeAuth(code, password) {
  const email = codeToEmail(code);

  // Lazy-load a secondary app so creating a user doesn't disturb the
  // admin's current session.
  const { initializeApp, deleteApp } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'
  );
  const {
    getAuth: getAuth2,
    createUserWithEmailAndPassword: createUser2,
    signInWithEmailAndPassword: signIn2,
    signOut: signOut2,
  } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');

  const { app } = await import('./firebase-config.js');
  const secondary = initializeApp(app.options, 'employee-creator-' + Date.now());
  const secondaryAuth = getAuth2(secondary);

  try {
    let uid;
    try {
      const cred = await createUser2(secondaryAuth, email, password);
      uid = cred.user.uid;
    } catch (err) {
      // The code may belong to a previously-deleted employee: the client SDK
      // can't delete other users' Auth accounts, so the account lingers. If
      // the admin reuses the same code with a password that matches the old
      // account, sign in and reuse its uid (a fresh profile is written over
      // it). If the password doesn't match, it's a genuine conflict.
      if (err.code === 'auth/email-already-in-use') {
        try {
          const cred = await signIn2(secondaryAuth, email, password);
          uid = cred.user.uid;
        } catch {
          throw err; // surfaces as "code already in use"
        }
      } else {
        throw err;
      }
    }
    await signOut2(secondaryAuth);
    return uid;
  } finally {
    // Clean up the secondary app
    await deleteApp(secondary).catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────
// CHANGE PASSWORD  (self)
// ──────────────────────────────────────────────────────────────────

/**
 * Change the current user's password. Requires their current password
 * for re-authentication (Firebase security requirement).
 */
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('هیچ بەکارهێنەرێک نەچووەتە ژوورەوە');

  // Re-authenticate first
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);

  // Then update
  await updatePassword(user, newPassword);
}

// ──────────────────────────────────────────────────────────────────
// FRIENDLY ERROR MESSAGES (Kurdish)
// ──────────────────────────────────────────────────────────────────

/** Translate Firebase auth error codes → Kurdish messages */
export function authErrorMessage(error) {
  const code = error?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'کۆد یاخود وشەی نهێنی هەڵەیە';
    case 'auth/invalid-email':
      return 'ئیمەیڵ یاخود کۆد دروست نییە';
    case 'auth/user-disabled':
      return 'ئەم هەژمارە لەکارخراوە. پەیوەندی بە بەڕێوەبەرەوە بکە';
    case 'auth/too-many-requests':
      return 'زۆر جار هەوڵت دا. تکایە کەمێک چاوەڕێ بکە و دووبارە هەوڵ بدە';
    case 'auth/network-request-failed':
      return 'کێشەی ئینتەرنێت. تکایە پەیوەندییەکەت بپشکنە';
    case 'auth/email-already-in-use':
      return 'ئەم کۆدە پێشتر بەکارهاتووە. کۆدێکی تر هەڵبژێرە';
    case 'auth/weak-password':
      return 'وشەی نهێنی لاوازە. دەبێت لانیکەم ٦ پیت بێت';
    case 'auth/requires-recent-login':
      return 'تکایە دووبارە بچۆرەوە ژوورەوە و هەوڵ بدەرەوە';
    default:
      return 'کێشەیەک ڕوویدا. تکایە دووبارە هەوڵ بدە';
  }
}

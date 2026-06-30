/**
 * db.js — Firestore data layer for SZR
 *
 * Collection structure (all under companies/szr):
 *   companies/szr/meta/settings      — work hours, grace, zone, etc.
 *   companies/szr/employees/{uid}    — name, code, role, createdAt
 *   companies/szr/attendance/{id}    — employeeId, date, checkIn, checkOut, ...
 *   companies/szr/dayStatus/{id}     — employeeId, date, type, note
 *   companies/szr/holidays/{id}      — date, name
 *
 * Provides real-time listeners (onSnapshot) for the admin's live dashboard.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db, COMPANY_ID } from './firebase-config.js';
import { uid, dateToKey, tsToTime } from './utils.js';

// ──────────────────────────────────────────────────────────────────
// PATH HELPERS
// ──────────────────────────────────────────────────────────────────
const base = `companies/${COMPANY_ID}`;
const col = (name) => collection(db, `${base}/${name}`);
const docRef = (name, id) => doc(db, `${base}/${name}/${id}`);
const settingsRef = () => doc(db, `${base}/meta/settings`);

// ──────────────────────────────────────────────────────────────────
// DEFAULT SETTINGS
// ──────────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  workStart: '09:30',
  workEnd: '17:30',
  gracePeriod: 5,
  // GPS Zone
  zone: {
    enabled: false,
    lat: null,
    lng: null,
    radius: 100, // meters
  },
  // Auto-checkout writes checkout = workEnd if employee forgot
  autoCheckout: true,
};

// ──────────────────────────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────────────────────────
export async function getSettings() {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) {
    // Initialize with defaults on first run
    await setDoc(settingsRef(), DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  // Merge with defaults so missing fields are filled
  return { ...DEFAULT_SETTINGS, ...snap.data() };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await setDoc(settingsRef(), updated, { merge: true });
  return updated;
}

/** Live listener for settings changes */
export function watchSettings(callback) {
  return onSnapshot(settingsRef(), (snap) => {
    callback(snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : { ...DEFAULT_SETTINGS });
  });
}

// ──────────────────────────────────────────────────────────────────
// EMPLOYEES
// ──────────────────────────────────────────────────────────────────

/** Create/update an employee profile doc (keyed by Auth uid) */
export async function saveEmployeeProfile(uidKey, data) {
  const profile = {
    name: data.name.trim(),
    code: data.code.trim().toLowerCase(),
    role: data.role || 'employee',
    photo: data.photo || null,
    createdAt: data.createdAt || Date.now(),
  };
  await setDoc(docRef('employees', uidKey), profile, { merge: true });
  return { id: uidKey, ...profile };
}

export async function getEmployee(uidKey) {
  const snap = await getDoc(docRef('employees', uidKey));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Find an employee profile by their login code */
export async function getEmployeeByCode(code) {
  const q = query(col('employees'), where('code', '==', code.trim().toLowerCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function listEmployees() {
  const snap = await getDocs(col('employees'));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Sort by name (Kurdish-aware), employees only (exclude admins from lists)
  return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
}

/** List only role=employee (exclude admins) */
export async function listEmployeesOnly() {
  const all = await listEmployees();
  return all.filter((e) => e.role !== 'admin');
}

/** Live listener for the employee list */
export function watchEmployees(callback) {
  return onSnapshot(col('employees'), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    callback(list.filter((e) => e.role !== 'admin'));
  });
}

export async function deleteEmployeeProfile(uidKey) {
  // Delete profile + all their attendance & dayStatus
  const batch = writeBatch(db);
  batch.delete(docRef('employees', uidKey));

  const attSnap = await getDocs(query(col('attendance'), where('employeeId', '==', uidKey)));
  attSnap.forEach((d) => batch.delete(d.ref));

  const dsSnap = await getDocs(query(col('dayStatus'), where('employeeId', '==', uidKey)));
  dsSnap.forEach((d) => batch.delete(d.ref));

  await batch.commit();
}

// ──────────────────────────────────────────────────────────────────
// ATTENDANCE
// ──────────────────────────────────────────────────────────────────

/** Deterministic doc id: one record per employee per day */
function attId(employeeId, date) {
  return `${employeeId}_${date}`;
}

/**
 * Normalize a raw attendance doc so that a server-recorded timestamp
 * (checkInTs/checkOutTs) wins over the device-supplied 'HH:MM' string.
 * This makes the times tamper-proof: even if an employee changes their
 * phone clock, the displayed/calculated time comes from the server.
 * Falls back to the plain string for older records or admin manual edits.
 */
function normalizeAtt(rec) {
  if (!rec) return rec;
  const ci = tsToTime(rec.checkInTs);
  const co = tsToTime(rec.checkOutTs);
  if (ci) rec.checkIn = ci;
  if (co) rec.checkOut = co;
  return rec;
}

export async function getAttendance(employeeId, date) {
  const snap = await getDoc(docRef('attendance', attId(employeeId, date)));
  return snap.exists() ? normalizeAtt({ id: snap.id, ...snap.data() }) : null;
}

/**
 * Set/merge attendance fields for one employee on one day.
 * @param {object} fields - { checkIn?, checkOut?, note?, autoCheckout?,
 *                            checkInLoc?, checkOutLoc?, serverTime? }
 *
 * When `serverTime: true` (employee self check-in/out), the authoritative
 * time is stored as a Firestore serverTimestamp (checkInTs/checkOutTs) and
 * the 'HH:MM' string is kept only as an instant-display fallback. When the
 * admin edits a time manually, `serverTime` is omitted and we CLEAR the
 * server timestamp for that field so the manual value is the source.
 */
export async function setAttendance(employeeId, date, fields) {
  const id = attId(employeeId, date);
  const existing = await getAttendance(employeeId, date);
  const useServer = fields.serverTime === true;

  const rec = {
    employeeId,
    date,
    checkIn:  fields.checkIn  !== undefined ? fields.checkIn  : existing?.checkIn  ?? null,
    checkOut: fields.checkOut !== undefined ? fields.checkOut : existing?.checkOut ?? null,
    note:     fields.note     !== undefined ? fields.note     : existing?.note     ?? '',
    autoCheckout: fields.autoCheckout !== undefined ? fields.autoCheckout : existing?.autoCheckout ?? false,
    checkInLoc: fields.checkInLoc !== undefined ? fields.checkInLoc : existing?.checkInLoc ?? null,
    checkOutLoc: fields.checkOutLoc !== undefined ? fields.checkOutLoc : existing?.checkOutLoc ?? null,
    updatedAt: Date.now(),
  };

  // Server-authoritative timestamps (employee self-service only).
  if (fields.checkIn !== undefined) {
    rec.checkInTs = useServer ? serverTimestamp() : null;
  }
  if (fields.checkOut !== undefined) {
    rec.checkOutTs = useServer ? serverTimestamp() : null;
  }

  await setDoc(docRef('attendance', id), rec, { merge: true });
  return { id, ...rec };
}

/** Clear a single field (checkIn or checkOut). Deletes doc if both empty. */
export async function clearAttendanceField(employeeId, date, field) {
  const existing = await getAttendance(employeeId, date);
  if (!existing) return;

  const other = field === 'checkIn' ? existing.checkOut : existing.checkIn;
  if (!other) {
    // Both would be empty → delete the doc
    await deleteDoc(docRef('attendance', attId(employeeId, date)));
    return;
  }
  await updateDoc(docRef('attendance', attId(employeeId, date)), {
    [field]: null,
    updatedAt: Date.now(),
  });
}

/** Delete an attendance record entirely */
export async function deleteAttendance(employeeId, date) {
  await deleteDoc(docRef('attendance', attId(employeeId, date)));
}

/** List attendance in a date range, optionally for one employee */
export async function listAttendance({ startDate, endDate, employeeId = null } = {}) {
  // To avoid needing composite Firestore indexes (which must be created
  // manually and can break queries if missing), we filter by a SINGLE
  // field server-side, then filter dates in-memory. This is fast for the
  // small data sizes of a single office and needs zero indexes.
  let snap;
  if (employeeId) {
    // Single where on employeeId — matches the security rule (own data).
    snap = await getDocs(query(col('attendance'), where('employeeId', '==', employeeId)));
  } else {
    // Admin: filter by date range (single-field range, no index needed).
    snap = await getDocs(query(
      col('attendance'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    ));
  }
  return snap.docs
    .map((d) => normalizeAtt({ id: d.id, ...d.data() }))
    .filter((r) => r.date >= startDate && r.date <= endDate);
}

/** Live listener for today's attendance (admin dashboard) */
export function watchAttendanceForDate(date, callback) {
  const q = query(col('attendance'), where('date', '==', date));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => normalizeAtt({ id: d.id, ...d.data() })));
  });
}

/**
 * Live-watch day-status (leave/sick/vacation) for a specific date.
 * Lets the admin dashboard update instantly when a status is set/changed,
 * without needing a manual refresh.
 */
export function watchDayStatusForDate(date, callback) {
  const q = query(col('dayStatus'), where('date', '==', date));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ──────────────────────────────────────────────────────────────────
// DAY STATUS (leave / sick / vacation)
// ──────────────────────────────────────────────────────────────────
function dsId(employeeId, date) {
  return `${employeeId}_${date}`;
}

export async function getDayStatus(employeeId, date) {
  const snap = await getDoc(docRef('dayStatus', dsId(employeeId, date)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setDayStatus(employeeId, date, type, note = '') {
  const id = dsId(employeeId, date);
  if (!type) {
    await deleteDoc(docRef('dayStatus', id)).catch(() => {});
    return null;
  }
  const rec = { employeeId, date, type, note };
  await setDoc(docRef('dayStatus', id), rec);
  return { id, ...rec };
}

export async function listDayStatus({ startDate, endDate, employeeId = null } = {}) {
  let snap;
  if (employeeId) {
    snap = await getDocs(query(col('dayStatus'), where('employeeId', '==', employeeId)));
  } else {
    snap = await getDocs(query(
      col('dayStatus'),
      where('date', '>=', startDate),
      where('date', '<=', endDate)
    ));
  }
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.date >= startDate && r.date <= endDate);
}

// ──────────────────────────────────────────────────────────────────
// HOLIDAYS
// ──────────────────────────────────────────────────────────────────
export async function listHolidays() {
  const snap = await getDocs(col('holidays'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function saveHoliday({ id, date, name }) {
  const recId = id || uid('hol');
  const rec = { date, name: name.trim() };
  await setDoc(docRef('holidays', recId), rec);
  return { id: recId, ...rec };
}

export async function deleteHoliday(id) {
  await deleteDoc(docRef('holidays', id));
}

export async function holidaysSet(startDate, endDate) {
  const all = await listHolidays();
  const set = new Set();
  for (const h of all) {
    if (h.date >= startDate && h.date <= endDate) set.add(h.date);
  }
  return set;
}

// ──────────────────────────────────────────────────────────────────
// AGGREGATION — build per-employee daily data for a date range
// ──────────────────────────────────────────────────────────────────
export async function buildRangeData({ startDate, endDate, employeeId = null }) {
  const [attendance, statuses, holidays, employees] = await Promise.all([
    listAttendance({ startDate, endDate, employeeId }),
    listDayStatus({ startDate, endDate, employeeId }),
    holidaysSet(startDate, endDate),
    employeeId
      ? getEmployee(employeeId).then((e) => (e ? [e] : []))
      : listEmployeesOnly(),
  ]);

  const result = {};
  for (const emp of employees) {
    result[emp.id] = { employee: emp, days: {} };
  }

  for (const a of attendance) {
    if (!result[a.employeeId]) continue;
    result[a.employeeId].days[a.date] = result[a.employeeId].days[a.date] || {};
    result[a.employeeId].days[a.date].attendance = a;
  }

  for (const s of statuses) {
    if (!result[s.employeeId]) continue;
    result[s.employeeId].days[s.date] = result[s.employeeId].days[s.date] || {};
    result[s.employeeId].days[s.date].dayStatus = s;
  }

  for (const empId of Object.keys(result)) {
    for (const date of holidays) {
      if (date < startDate || date > endDate) continue;
      result[empId].days[date] = result[empId].days[date] || {};
      if (!result[empId].days[date].dayStatus) {
        result[empId].days[date].isHoliday = true;
      }
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────
// AUTO-CHECKOUT — fill missing checkouts for past days
// ──────────────────────────────────────────────────────────────────

/**
 * Scan recent attendance and auto-fill checkOut = workEnd for any day
 * that has a checkIn but no checkOut AND is in the past (date < today
 * OR same day but now > workEnd). Marks them autoCheckout=true.
 *
 * Runs on app load (both admin and employee) so it's reliable without
 * a server. Idempotent — safe to run repeatedly.
 */
export async function runAutoCheckout(settings, employeeId = null) {
  if (!settings.autoCheckout) return 0;

  const today = dateToKey(new Date());
  const start = dateToKey(new Date(Date.now() - 14 * 86400000)); // last 14 days

  // If employeeId is given, only scan that employee's records (so an
  // employee can fix their own). Otherwise scan all (admin only).
  const records = await listAttendance({ startDate: start, endDate: today, employeeId });
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [endH, endM] = settings.workEnd.split(':').map(Number);
  const endMinutes = endH * 60 + endM;

  let fixed = 0;
  const batch = writeBatch(db);

  for (const rec of records) {
    if (rec.checkIn && !rec.checkOut) {
      const isPastDay = rec.date < today;
      const isTodayAfterEnd = rec.date === today && nowMinutes >= endMinutes;
      if (isPastDay || isTodayAfterEnd) {
        batch.update(docRef('attendance', rec.id), {
          checkOut: settings.workEnd,
          autoCheckout: true,
          updatedAt: Date.now(),
        });
        fixed++;
      }
    }
  }

  if (fixed > 0) await batch.commit();
  return fixed;
}

// ──────────────────────────────────────────────────────────────────
// BACKUP / RESTORE — export & import all company data
// ──────────────────────────────────────────────────────────────────

/**
 * Export every piece of company data into a single JSON-able object.
 * Reads employees, all attendance, all dayStatus, holidays, and settings.
 */
export async function exportAllData() {
  const [settings, employees, holidays] = await Promise.all([
    getSettings(),
    getDocs(col('employees')).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    listHolidays(),
  ]);

  // Pull ALL attendance + dayStatus (no date filter)
  const [attSnap, dsSnap] = await Promise.all([
    getDocs(col('attendance')),
    getDocs(col('dayStatus')),
  ]);
  const attendance = attSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const dayStatus = dsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    app: 'szr-attendance',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    company: COMPANY_ID,
    data: {
      settings,
      employees,
      attendance,
      dayStatus,
      holidays,
    },
  };
}

/**
 * Import data from a backup payload. MERGES into existing data
 * (overwrites docs with the same id). Does NOT delete existing docs
 * that aren't in the backup, to be safe.
 *
 * Note: employee AUTH accounts are NOT restored (only their profiles).
 * The Firebase Auth users still need to exist for login to work.
 *
 * @returns {object} counts of restored items
 */
export async function importAllData(payload) {
  if (!payload || payload.app !== 'szr-attendance') {
    throw new Error('فایلەکە بۆ سیستەمی SZR نییە');
  }
  const data = payload.data || {};
  const counts = { employees: 0, attendance: 0, dayStatus: 0, holidays: 0 };

  // Settings
  if (data.settings) {
    await setDoc(settingsRef(), data.settings, { merge: true });
  }

  // Employees (profiles only)
  if (Array.isArray(data.employees)) {
    for (const chunk of chunkArray(data.employees, 400)) {
      const batch = writeBatch(db);
      for (const emp of chunk) {
        const { id, ...rest } = emp;
        if (!id) continue;
        batch.set(docRef('employees', id), rest, { merge: true });
        counts.employees++;
      }
      await batch.commit();
    }
  }

  // Attendance
  if (Array.isArray(data.attendance)) {
    for (const chunk of chunkArray(data.attendance, 400)) {
      const batch = writeBatch(db);
      for (const rec of chunk) {
        const { id, ...rest } = rec;
        if (!id) continue;
        batch.set(docRef('attendance', id), rest, { merge: true });
        counts.attendance++;
      }
      await batch.commit();
    }
  }

  // Day status
  if (Array.isArray(data.dayStatus)) {
    for (const chunk of chunkArray(data.dayStatus, 400)) {
      const batch = writeBatch(db);
      for (const rec of chunk) {
        const { id, ...rest } = rec;
        if (!id) continue;
        batch.set(docRef('dayStatus', id), rest, { merge: true });
        counts.dayStatus++;
      }
      await batch.commit();
    }
  }

  // Holidays
  if (Array.isArray(data.holidays)) {
    for (const chunk of chunkArray(data.holidays, 400)) {
      const batch = writeBatch(db);
      for (const hol of chunk) {
        const { id, ...rest } = hol;
        if (!id) continue;
        batch.set(docRef('holidays', id), rest, { merge: true });
        counts.holidays++;
      }
      await batch.commit();
    }
  }

  return counts;
}

/** Split an array into chunks of size n (Firestore batch limit is 500) */
function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

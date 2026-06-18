/**
 * utils.js — Shared utilities for SZR
 *
 * Language policy:
 *   • Dates/times/numbers → ENGLISH (Latin numerals)
 *     e.g. "Saturday, 6 June 2026", "2:30 PM", "142"
 *   • All UI text/labels   → KURDISH SORANI
 *     e.g. "هاتنە دەوام", "ئامادەبوو"
 *   • Weekday/month names shown in Kurdish, but the numeric date is Latin.
 */

// ──────────────────────────────────────────────────────────────────
// ID GENERATION
// ──────────────────────────────────────────────────────────────────
export function uid(prefix = '') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`;
}

// ──────────────────────────────────────────────────────────────────
// KURDISH WEEKDAY NAMES (shown alongside Latin dates)
// ──────────────────────────────────────────────────────────────────
export const WEEKDAYS_KU = [
  'یەکشەممە',  // Sunday   (0)
  'دووشەممە',  // Monday   (1)
  'سێشەممە',   // Tuesday  (2)
  'چوارشەممە', // Wednesday(3)
  'پێنجشەممە', // Thursday (4)
  'هەینی',     // Friday   (5)
  'شەممە',     // Saturday (6)
];

// English month names (for the Latin date format)
export const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ──────────────────────────────────────────────────────────────────
// DATE HELPERS
// ──────────────────────────────────────────────────────────────────

/** Date → 'YYYY-MM-DD' (local) */
export function dateToKey(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → Date at local midnight */
export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return dateToKey(new Date());
}

export function daysAgoKey(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateToKey(d);
}

export function monthStartKey(d = new Date()) {
  return dateToKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function monthEndKey(d = new Date()) {
  return dateToKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Full date in mixed format: Kurdish weekday + Latin date.
 * e.g. "شەممە، 6 June 2026"
 */
export function formatDateFull(input) {
  const d = input instanceof Date ? input : keyToDate(input);
  const weekday = WEEKDAYS_KU[d.getDay()];
  const day = d.getDate();
  const month = MONTHS_EN[d.getMonth()];
  const year = d.getFullYear();
  return `${weekday}، ${day} ${month} ${year}`;
}

/** Latin date only: "6 June 2026" */
export function formatDateLatin(input) {
  const d = input instanceof Date ? input : keyToDate(input);
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
}

/** Compact numeric date: "06/06/2026" */
export function formatDateCompact(input) {
  const d = input instanceof Date ? input : keyToDate(input);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

/** Kurdish weekday name only */
export function weekdayKu(input) {
  const d = input instanceof Date ? input : keyToDate(input);
  return WEEKDAYS_KU[d.getDay()];
}

/** Iterate day keys between two YYYY-MM-DD (inclusive) */
export function* dayRange(startKey, endKey) {
  const start = keyToDate(startKey);
  const end = keyToDate(endKey);
  const cur = new Date(start);
  while (cur <= end) {
    yield dateToKey(cur);
    cur.setDate(cur.getDate() + 1);
  }
}

export function daysBetween(startKey, endKey) {
  return Math.round((keyToDate(endKey) - keyToDate(startKey)) / 86400000) + 1;
}

/** Friday = weekend (Iraq work week: Sat→Thu) */
export function isWeekend(input) {
  if (!input) return false;
  const d = input instanceof Date ? input : keyToDate(input);
  return d.getDay() === 5;
}

// ──────────────────────────────────────────────────────────────────
// TIME HELPERS  (internal 'HH:MM' 24h ; display 'h:mm AM/PM' Latin)
// ──────────────────────────────────────────────────────────────────

export function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return null;
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function minutesToTime(min) {
  if (min == null || isNaN(min)) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'HH:MM' → '2:30 PM' (Latin numerals) */
export function formatTime12(time) {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  // LTR isolate keeps "9:25 AM" intact next to RTL Kurdish labels.
  return `\u2066${h12}:${String(m).padStart(2, '0')} ${period}\u2069`;
}

/** Current time as 'HH:MM' */
export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Current time for display: '2:30 PM' */
export function nowTimeDisplay() {
  return formatTime12(nowTime());
}

/**
 * Format a duration in minutes → Kurdish words with Latin numbers.
 * e.g. "2 سەعات و 15 خولەک"   (short: "2س 15خ")
 */
export function formatDuration(minutes, opts = {}) {
  if (minutes == null || isNaN(minutes)) return '—';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const short = opts.short ?? false;

  // SHORT form uses a clock-style "H:MM" which never mixes RTL letters with
  // numbers (avoids the bidirectional-text scrambling like "1س 40خ" becoming
  // "40خ1س" beside other Kurdish words). We wrap it in an LTR isolate so it
  // always renders left-to-right even inside RTL UI.
  if (short) {
    if (h === 0 && m === 0) return '0:00';
    return '\u2066' + sign + h + ':' + String(m).padStart(2, '0') + '\u2069';
  }

  if (h === 0 && m === 0) return '0 خولەک';
  const parts = [];
  // Wrap each number in an LTR isolate so "1 سەعات" doesn't get reordered
  // to "سەعات 1" inside the RTL layout.
  if (h > 0) parts.push(`\u2066${h}\u2069 سەعات`);
  if (m > 0) parts.push(`\u2066${m}\u2069 خولەک`);
  return sign + parts.join(' و ');
}

/** Compact duration: "2:15" (wrapped in LTR isolate for safe RTL rendering) */
export function formatDurationCompact(minutes) {
  if (minutes == null || isNaN(minutes)) return '—';
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `\u2066${h}:${String(m).padStart(2, '0')}\u2069`;
}

// ──────────────────────────────────────────────────────────────────
// ATTENDANCE CALCULATIONS
// ──────────────────────────────────────────────────────────────────

/**
 * Calculate a single day's attendance.
 *
 * @param {object} cfg    - { workStart:'HH:MM', workEnd:'HH:MM', gracePeriod:min }
 * @param {object} record - { checkIn, checkOut, status?, autoCheckout? }
 * @param {string|Date} date - for Friday detection
 * @returns {object} { status, worked, late, early, lost, expected, autoCheckout }
 */
export function calcDay(cfg, record, date = null) {
  const startMin = timeToMinutes(cfg.workStart);
  const endMin = timeToMinutes(cfg.workEnd);
  const grace = cfg.gracePeriod ?? 0;
  const expected = endMin - startMin;

  // Explicit non-working statuses
  if (record?.status === 'leave')    return base('leave');
  if (record?.status === 'sick')     return base('sick');
  if (record?.status === 'vacation') return base('vacation');
  if (record?.status === 'holiday')  return base('holiday');

  function base(status) {
    return { status, worked: 0, late: 0, early: 0, lost: 0, expected: 0 };
  }

  // Friday → weekend
  if (date && isWeekend(date)) {
    const ci = timeToMinutes(record?.checkIn);
    const co = timeToMinutes(record?.checkOut);
    const worked = ci != null && co != null ? Math.max(0, co - ci) : 0;
    return { status: 'weekend', worked, late: 0, early: 0, lost: 0, expected: 0,
             checkIn: ci, checkOut: co };
  }

  const ci = timeToMinutes(record?.checkIn);
  const co = timeToMinutes(record?.checkOut);

  // Nothing recorded → absent
  if (ci == null && co == null) {
    return { status: 'absent', worked: 0, late: 0, early: 0, lost: expected, expected };
  }

  // Only check-in (still working today)
  if (ci != null && co == null) {
    const late = Math.max(0, ci - startMin - grace);
    return { status: 'in-progress', worked: 0, late, early: 0, lost: late, expected, checkIn: ci };
  }

  // Full day
  const late = Math.max(0, ci - startMin - grace);
  const early = Math.max(0, endMin - co);
  const worked = Math.max(0, co - ci);
  const lost = late + early;

  return {
    status: late === 0 && early === 0 ? 'present' : 'partial',
    worked, late, early, lost, expected,
    checkIn: ci, checkOut: co,
    autoCheckout: record?.autoCheckout || false,
  };
}

export function statusLabel(status) {
  switch (status) {
    case 'present':     return 'ئامادەبووە لە کاتی خۆیدا';
    case 'partial':     return 'ئامادەبووە';
    case 'in-progress': return 'لە دەوامدایە';
    case 'absent':      return 'ئامادەنەبووە';
    case 'leave':       return 'مۆڵەت';
    case 'sick':        return 'نەخۆشی';
    case 'vacation':    return 'پشوو';
    case 'holiday':     return 'پشووی فەرمی';
    case 'weekend':     return 'هەینی';
    default: return '—';
  }
}

export function statusBadgeClass(status) {
  switch (status) {
    case 'present':     return 'badge--success';
    case 'partial':     return 'badge--warning';
    case 'in-progress': return 'badge--info';
    case 'absent':      return 'badge--danger';
    case 'leave':       return 'badge--info';
    case 'sick':        return 'badge--warning';
    case 'vacation':    return 'badge--warning';
    case 'holiday':     return 'badge--navy';
    case 'weekend':     return 'badge--neutral';
    default: return 'badge--neutral';
  }
}

export function statusStripeClass(status) {
  switch (status) {
    case 'present':     return 'stripe--present';
    case 'partial':     return 'stripe--late';
    case 'in-progress': return 'stripe--present';
    case 'absent':      return 'stripe--absent';
    case 'leave':
    case 'sick':
    case 'vacation':
    case 'holiday':
    case 'weekend':     return 'stripe--off';
    default: return 'stripe--absent';
  }
}

// ──────────────────────────────────────────────────────────────────
// DOM / UI HELPERS
// ──────────────────────────────────────────────────────────────────

/** Element factory: el('div.foo#bar', {attrs}, [children]) */
export function el(tag, attrs = {}, children = []) {
  const idMatch = tag.match(/#([^.#]+)/);
  const classes = [...tag.matchAll(/\.([^.#]+)/g)].map((m) => m[1]);
  const tagName = tag.replace(/[.#].*$/, '') || 'div';

  const node = document.createElement(tagName);
  if (idMatch) node.id = idMatch[1];
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') {
      node.className = (node.className + ' ' + v).trim();
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign(node.dataset, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, v);
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    // A DOM node has a numeric nodeType; anything else is treated as text.
    // (Using nodeType instead of `instanceof Node` is safer across contexts.)
    if (c && typeof c === 'object' && typeof c.nodeType === 'number') {
      node.appendChild(c);
    } else {
      node.appendChild(document.createTextNode(String(c)));
    }
  }
  return node;
}

export function initial(name) {
  return (name || '?').trim().charAt(0);
}

/** Toast notification */
export function toast(message, type = 'info', duration = 2600) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  const node = el('div.toast.toast--' + type, {}, [
    el('span.toast__icon', {}, icon),
    el('span', {}, message),
  ]);
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('toast--out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, duration);
}

/** Haptic feedback */
export function haptic(pattern = 10) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {}
}

/** Confirmation modal → Promise<boolean> */
export function confirmModal({ title, message, confirmText = 'بەڵێ', cancelText = 'پاشگەزبوونەوە', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    if (!root) return resolve(false);

    const backdrop = el('div.modal-backdrop');
    const modal = el('div.modal');
    modal.append(
      el('div.modal__head', {}, [
        el('h3.modal__title', {}, title),
        el('button.modal__close', { onclick: () => close(false), 'aria-label': 'داخستن' }, '✕'),
      ]),
      el('div.modal__body', {}, [
        el('div' + (danger ? '.confirm-note' : '.info-note'), {}, message),
      ]),
      el('div.modal__footer', {}, [
        el('button.btn.btn--outline', { onclick: () => close(false) }, cancelText),
        el('button.btn' + (danger ? '.btn--danger' : '.btn--primary'), { onclick: () => close(true) }, confirmText),
      ])
    );
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });

    function close(result) {
      backdrop.style.animation = 'backdropIn 180ms reverse';
      modal.style.animation = 'modalIn 180ms reverse';
      setTimeout(() => { backdrop.remove(); resolve(!!result); }, 170);
    }
  });
}

/** Generic modal → { close, modal } */
export function openModal({ title, body, footer }) {
  const root = document.getElementById('modal-root');
  const backdrop = el('div.modal-backdrop');
  const modal = el('div.modal');
  modal.appendChild(el('div.modal__head', {}, [
    el('h3.modal__title', {}, title),
    el('button.modal__close', { onclick: () => close(), 'aria-label': 'داخستن' }, '✕'),
  ]));
  if (body) modal.appendChild(el('div.modal__body', {}, Array.isArray(body) ? body : [body]));
  if (footer) modal.appendChild(el('div.modal__footer', {}, Array.isArray(footer) ? footer : [footer]));
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  function close() {
    backdrop.style.animation = 'backdropIn 180ms reverse';
    modal.style.animation = 'modalIn 180ms reverse';
    setTimeout(() => backdrop.remove(), 170);
  }
  return { close, modal };
}

/** Resize an image File → base64 data URL */
export function fileToDataURL(file, maxDim = 400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function downloadFile(filename, content, mimeType = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ──────────────────────────────────────────────────────────────────
// GEO — Haversine distance (meters) between two lat/lng points
// ──────────────────────────────────────────────────────────────────
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

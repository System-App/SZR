/**
 * employee-home.js — Employee main screen
 *
 * Shows a greeting, live clock, and ONE big action button that cycles:
 *   • Not checked in  → "هاتنە دەوام" (green)
 *   • Checked in       → "چوونەوە"   (olive)
 *   • Done for the day → completed state
 *   • Friday/holiday   → rest message
 *
 * On check-in, GPS is verified against the work zone (if enabled).
 * Times are automatic (server/device now) — the employee cannot edit them.
 */

import {
  getAttendance, setAttendance, getDayStatus, holidaysSet,
} from './db.js';
import { verifyInZone, GeoError } from './geo.js';
import {
  el, toast, haptic, nowTime, formatTime12, formatDateFull,
  todayKey, isWeekend, calcDay, formatDuration,
} from './utils.js';

export async function renderEmployeeHome(main) {
  const profile = window.SZR.getProfile();
  const settings = window.SZR.getSettings();
  const today = todayKey();

  // ── Hero ───────────────────────────────────────────────────────
  const clockEl = el('div.emp-hero__clock');
  const hero = el('div.emp-hero', {}, [
    el('div.emp-hero__greeting', {}, 'بەخێرهاتیت'),
    el('div.emp-hero__name', {}, profile.name),
    el('div.emp-hero__date', {}, formatDateFull(today)),
    clockEl,
    el('div.emp-hero__hours', {},
      `${formatTime12(settings.workStart)} — ${formatTime12(settings.workEnd)}`),
  ]);
  main.appendChild(hero);

  // Live clock
  const updateClock = () => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    clockEl.textContent = `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };
  updateClock();
  const clockInterval = setInterval(updateClock, 1000);
  // Register cleanup so navigation reliably stops the clock (consistent
  // with the rest of the app; avoids a stray interval after leaving).
  if (window.SZR_registerCleanup) {
    window.SZR_registerCleanup(() => clearInterval(clockInterval));
  }

  // ── Action area (loading state first) ──────────────────────────
  const actionArea = el('div', { id: 'action-area' }, [
    el('div.loading-center', {}, [el('div.spinner.spinner--lg'), el('div', {}, 'بارکردن...')]),
  ]);
  main.appendChild(actionArea);

  // History shortcut
  main.appendChild(el('button.btn.btn--outline.btn--block', {
    style: { marginTop: '16px' },
    onclick: () => window.SZR.navigateTo('history'),
  }, 'مێژووی دەوامی من'));

  // ── Friday / Holiday check ──────────────────────────────────────
  const isFriday = isWeekend(today);
  const holidays = await holidaysSet(today, today);
  const dayStatus = await getDayStatus(profile.id, today);

  if (isFriday) {
    renderRestState(actionArea, '☕', 'ئەمڕۆ هەینییە', 'ڕۆژی پشووی فەرمییە');
    return;
  }
  if (holidays.has(today)) {
    renderRestState(actionArea, '🎉', 'پشووی فەرمی', 'ئەمڕۆ ڕۆژی پشووی فەرمییە');
    return;
  }
  if (dayStatus) {
    const labels = { leave: 'مۆڵەت', sick: 'نەخۆشی', vacation: 'پشوو' };
    renderRestState(actionArea, '📋', labels[dayStatus.type] || 'پشوو',
      dayStatus.note || 'ئەمڕۆت وەک ' + (labels[dayStatus.type] || 'پشوو') + ' تۆمارکراوە');
    return;
  }

  // ── Render the action button based on current attendance ────────
  await renderAction(actionArea, profile, settings, today);
}

// ──────────────────────────────────────────────────────────────────
// REST STATE (Friday / holiday / leave)
// ──────────────────────────────────────────────────────────────────
function renderRestState(container, emoji, title, subtitle) {
  container.innerHTML = '';
  container.appendChild(el('div', {
    style: { textAlign: 'center', padding: '40px 16px', background: 'var(--bg-elevated)',
             borderRadius: 'var(--r-lg)', border: '1px solid var(--border-soft)' },
  }, [
    el('div', { style: { fontSize: '48px', marginBottom: '12px' } }, emoji),
    el('div', { style: { fontSize: 'var(--text-lg)', fontWeight: '800', color: 'var(--ink)' } }, title),
    el('div', { style: { fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginTop: '6px' } }, subtitle),
  ]));
}

// ──────────────────────────────────────────────────────────────────
// ACTION RENDERER
// ──────────────────────────────────────────────────────────────────
async function renderAction(container, profile, settings, today) {
  const record = await getAttendance(profile.id, today);
  container.innerHTML = '';

  const checkedIn = record?.checkIn;
  const checkedOut = record?.checkOut;

  // ── State 3: Done for the day ──
  if (checkedIn && checkedOut) {
    const result = calcDay(settings, record, today);
    container.appendChild(el('button.checkin-btn.checkin-btn--done', { disabled: true }, [
      el('div', { style: { fontSize: '36px' } }, '✓'),
      el('div', {}, 'ڕۆژەکەت تەواوبوو'),
      el('div.checkin-btn__sub', {}, 'ماندوو نەبیت!'),
    ]));
    container.appendChild(buildStatusPanel(record, result));
    return;
  }

  // ── State 2: Checked in, can check out ──
  if (checkedIn && !checkedOut) {
    const btn = el('button.checkin-btn.checkin-btn--out', {}, [
      el('div.checkin-btn__icon', { html: outIcon() }),
      el('div', {}, 'چوونەوە'),
      el('div.checkin-btn__sub', {}, 'کاتی ڕۆیشتن تۆمار بکە'),
    ]);
    btn.addEventListener('click', () => handleCheckout(btn, container, profile, settings, today));
    container.appendChild(btn);

    const result = calcDay(settings, record, today);
    container.appendChild(buildStatusPanel(record, result));
    return;
  }

  // ── State 1: Not checked in yet ──
  const btn = el('button.checkin-btn.checkin-btn--in', {}, [
    el('div.checkin-btn__icon', { html: inIcon() }),
    el('div', {}, 'هاتنە دەوام'),
    el('div.checkin-btn__sub', {}, 'کاتی هاتنت تۆمار بکە'),
  ]);
  btn.addEventListener('click', () => handleCheckin(btn, container, profile, settings, today));
  container.appendChild(btn);

  // GPS hint (if zone enabled)
  if (settings.zone?.enabled) {
    container.appendChild(el('div.gps-status', {}, [
      el('span', { html: pinIcon() }),
      el('span', {}, 'پێویستە لە ناوچەی دەوام بیت بۆ تۆمارکردن'),
    ]));
  }
}

// ──────────────────────────────────────────────────────────────────
// CHECK-IN HANDLER (with GPS)
// ──────────────────────────────────────────────────────────────────
async function handleCheckin(btn, container, profile, settings, today) {
  haptic(15);
  setButtonBusy(btn, 'پشکنینی شوێن...');

  // GPS verification (if zone enabled)
  let checkInLoc = null;
  if (settings.zone?.enabled) {
    const gpsLine = el('div.gps-status.gps-status--checking', {}, [
      el('span.spinner'),
      el('span', {}, 'دۆزینەوەی شوێنەکەت...'),
    ]);
    // Replace any existing gps line
    const existing = container.querySelector('.gps-status');
    if (existing) existing.replaceWith(gpsLine);
    else container.appendChild(gpsLine);

    try {
      const res = await verifyInZone(settings.zone);
      if (!res.ok) {
        gpsLine.className = 'gps-status gps-status--error';
        gpsLine.innerHTML = '';
        gpsLine.append(
          el('span', { html: alertIcon() }),
          el('span', {}, `تۆ لە دەرەوەی ناوچەی دەوامیت (${res.distance}m دوور). تکایە نزیک ببەرەوە.`)
        );
        resetButton(btn, 'in');
        haptic([30, 50, 30]);
        return;
      }
      checkInLoc = { lat: res.lat, lng: res.lng, accuracy: res.accuracy, distance: res.distance };
    } catch (err) {
      gpsLine.className = 'gps-status gps-status--error';
      gpsLine.innerHTML = '';
      const msg = err instanceof GeoError ? err.userMessage : 'کێشەیەک ڕوویدا لە دۆزینەوەی شوێن';
      gpsLine.append(el('span', { html: alertIcon() }), el('span', {}, msg));
      resetButton(btn, 'in');
      haptic([30, 50, 30]);
      return;
    }
  }

  // Record check-in (automatic time)
  setButtonBusy(btn, 'تۆمارکردن...');
  try {
    const time = nowTime();
    await setAttendance(profile.id, today, { checkIn: time, checkInLoc });
    toast(`هاتنە دەوام تۆمارکرا: ${formatTime12(time)}`, 'success');
    haptic(20);
    await renderAction(container, profile, settings, today);
  } catch (err) {
    console.error('[SZR] Check-in error:', err);
    toast('کێشە لە تۆمارکردن. دووبارە هەوڵ بدە', 'error');
    resetButton(btn, 'in');
  }
}

// ──────────────────────────────────────────────────────────────────
// CHECK-OUT HANDLER
// ──────────────────────────────────────────────────────────────────
async function handleCheckout(btn, container, profile, settings, today) {
  haptic(15);
  setButtonBusy(btn, 'تۆمارکردن...');
  try {
    const time = nowTime();
    await setAttendance(profile.id, today, { checkOut: time, autoCheckout: false });
    toast(`چوونەوە تۆمارکرا: ${formatTime12(time)}`, 'success');
    haptic(20);
    await renderAction(container, profile, settings, today);
  } catch (err) {
    console.error('[SZR] Check-out error:', err);
    toast('کێشە لە تۆمارکردن. دووبارە هەوڵ بدە', 'error');
    resetButton(btn, 'out');
  }
}

// ──────────────────────────────────────────────────────────────────
// STATUS PANEL
// ──────────────────────────────────────────────────────────────────
function buildStatusPanel(record, result) {
  const rows = [];

  rows.push(el('div.status-panel__row', {}, [
    el('span.status-panel__label', {}, 'کاتی هاتن'),
    el('span.status-panel__value.status-panel__value--in', {}, formatTime12(record.checkIn)),
  ]));

  if (record.checkOut) {
    rows.push(el('div.status-panel__row', {}, [
      el('span.status-panel__label', {}, 'کاتی چوون'),
      el('span.status-panel__value.status-panel__value--out', {},
        formatTime12(record.checkOut) + (record.autoCheckout ? ' (خۆکار)' : '')),
    ]));
    rows.push(el('div.status-panel__row', {}, [
      el('span.status-panel__label', {}, 'کاتی کارکراو'),
      el('span.status-panel__value', {}, formatDuration(result.worked)),
    ]));
  }

  if (result.late > 0) {
    rows.push(el('div.status-panel__row', {}, [
      el('span.status-panel__label', {}, 'دواکەوتن'),
      el('span.status-panel__value', { style: { color: 'var(--warning)' } }, formatDuration(result.late)),
    ]));
  }

  return el('div.status-panel', {}, rows);
}

// ──────────────────────────────────────────────────────────────────
// BUTTON STATE HELPERS
// ──────────────────────────────────────────────────────────────────
function setButtonBusy(btn, label) {
  btn.classList.add('checkin-btn--busy');
  btn.disabled = true;
  btn.innerHTML = '';
  btn.append(el('span.spinner.spinner--white'), el('div', { style: { marginTop: '8px' } }, label));
}
function resetButton(btn, type) {
  btn.classList.remove('checkin-btn--busy');
  btn.disabled = false;
  btn.innerHTML = '';
  if (type === 'in') {
    btn.append(
      el('div.checkin-btn__icon', { html: inIcon() }),
      el('div', {}, 'هاتنە دەوام'),
      el('div.checkin-btn__sub', {}, 'کاتی هاتنت تۆمار بکە'),
    );
  } else {
    btn.append(
      el('div.checkin-btn__icon', { html: outIcon() }),
      el('div', {}, 'چوونەوە'),
      el('div.checkin-btn__sub', {}, 'کاتی ڕۆیشتن تۆمار بکە'),
    );
  }
}

// ── Icons ──
function inIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
}
function outIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
}
function pinIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
}
function alertIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
}

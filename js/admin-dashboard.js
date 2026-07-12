/**
 * admin-dashboard.js — Admin live dashboard
 *
 * The heart of the system. Shows TODAY's attendance for every employee,
 * updating in REAL TIME via Firestore onSnapshot. When an employee checks
 * in/out, the admin sees it instantly + a live toast notification.
 *
 * Layout:
 *   • Date hero with integrated present/late/absent stats
 *   • Search bar
 *   • Live employee rows (each shows status + times + a stripe)
 */

import {
  watchAttendanceForDate, watchEmployees, watchDayStatusForDate,
  holidaysSet, getAttendance, getDayStatus,
} from './db.js';
import { openEditDay } from './admin-attendance.js';
import {
  el, toast, haptic, formatTime12, formatDateFull,
  todayKey, isWeekend, calcDay, initial, formatDuration,
} from './utils.js';

// Module-level cleanup handles
let unsubAttendance = null;
let unsubEmployees = null;
let unsubDayStatus = null;
let clockInterval = null;
let lastSeen = {}; // track last check-in/out to detect NEW events for toasts

export async function renderDashboard(main) {
  const settings = window.SZR.getSettings();
  const today = todayKey();
  const isFriday = isWeekend(today);

  // Clean any prior listeners (navigation safety)
  cleanup();

  // ── Date hero (with integrated stats) ──
  const heroStats = { present: 0, late: 0, absent: 0 };
  const hero = buildDateHero(today, settings, heroStats);
  main.appendChild(hero.node);

  // ── Friday note ──
  if (isFriday) {
    main.appendChild(el('div', {
      style: { textAlign: 'center', padding: '28px 16px', color: 'var(--ink-soft)' },
    }, [
      el('div', { style: { fontSize: '32px', marginBottom: '8px' } }, '☕'),
      el('div', { style: { fontSize: 'var(--text-md)', fontWeight: '700' } }, 'ئەمڕۆ هەینییە'),
      el('div', { style: { fontSize: 'var(--text-sm)', marginTop: '4px', color: 'var(--ink-faint)' } },
        'دەوام لە شەممە تا پێنجشەممە ئیش دەکات'),
    ]));
    // Still show employees below for reference (no check-in expected)
  }

  // ── Search ──
  const searchInput = el('input', { type: 'search', placeholder: 'گەڕان لە کارمەندان...', 'aria-label': 'گەڕان' });
  main.appendChild(el('div.searchbar', { style: { margin: '16px 0 10px' } }, [searchInput]));

  main.appendChild(el('div.section-head', {}, [el('h3.section-head__title', {}, 'کارمەندان')]));

  // ── List container ──
  const listEl = el('div', { id: 'dash-list' }, [
    el('div.loading-center', {}, [el('div.spinner.spinner--lg'), el('div', {}, 'بارکردن...')]),
  ]);
  main.appendChild(listEl);

  // ── State for live data ──
  let employees = [];
  let attendanceMap = {}; // employeeId → record
  let dayStatusMap = {};  // employeeId → status
  let holidays = new Set();
  let searchFilter = '';
  let firstLoad = true;

  // Load holidays once (rarely change during a session)
  holidays = await holidaysSet(today, today);
  // dayStatusMap is now populated by a LIVE listener below (real-time).

  // ── Render function ──
  const rerender = () => {
    // Compute stats
    let present = 0, late = 0, absent = 0;
    for (const emp of employees) {
      const record = {
        checkIn: attendanceMap[emp.id]?.checkIn,
        checkOut: attendanceMap[emp.id]?.checkOut,
        status: dayStatusMap[emp.id]?.type || (holidays.has(today) ? 'holiday' : null),
        autoCheckout: attendanceMap[emp.id]?.autoCheckout,
      };
      const r = calcDay(settings, record, today);
      if (r.status === 'present') present++;
      else if (r.status === 'in-progress') { present++; if (r.late > 0) late++; }
      else if (r.status === 'partial') { present++; if (r.late > 0) late++; }
      else if (r.status === 'absent') absent++;
    }
    hero.updateStats({ present, late, absent });

    // Render list
    listEl.innerHTML = '';
    if (employees.length === 0) {
      listEl.appendChild(el('div.empty', {}, [
        el('div.empty__icon', { html: usersIcon() }),
        el('div.empty__title', {}, 'هیچ کارمەندێک نییە'),
        el('div.empty__text', {}, 'سەرەتا کارمەندان زیاد بکە لە بەشی ڕێکخستنەکان.'),
        el('button.btn.btn--primary', { onclick: () => window.SZR.navigateTo('settings') }, 'چوون بۆ ڕێکخستنەکان'),
      ]));
      return;
    }

    const filtered = employees.filter((e) =>
      !searchFilter || e.name.toLowerCase().includes(searchFilter.toLowerCase()));

    if (filtered.length === 0) {
      listEl.appendChild(el('div.empty', { style: { padding: '24px' } }, [
        el('div.empty__title', {}, 'هیچ ئەنجامێک نییە'),
      ]));
      return;
    }

    for (const emp of filtered) {
      listEl.appendChild(buildEmpRow(emp, attendanceMap[emp.id], dayStatusMap[emp.id], holidays.has(today), settings, today));
    }
  };

  searchInput.addEventListener('input', (e) => { searchFilter = e.target.value; rerender(); });

  // ── Live listeners ──
  unsubEmployees = watchEmployees((emps) => {
    employees = emps;
    rerender();
  });

  unsubAttendance = watchAttendanceForDate(today, (records) => {
    const newMap = {};
    for (const r of records) newMap[r.employeeId] = r;

    // Detect NEW check-ins/outs for live toast (skip first load)
    if (!firstLoad) {
      for (const r of records) {
        const prev = lastSeen[r.employeeId] || {};
        if (r.checkIn && !prev.checkIn) {
          notifyLive(employees.find((e) => e.id === r.employeeId), 'هاتنە دەوام', r.checkIn);
        } else if (r.checkOut && !prev.checkOut && !r.autoCheckout) {
          notifyLive(employees.find((e) => e.id === r.employeeId), 'چوونەوە', r.checkOut);
        }
      }
    }
    lastSeen = {};
    for (const r of records) lastSeen[r.employeeId] = { checkIn: r.checkIn, checkOut: r.checkOut };

    attendanceMap = newMap;
    firstLoad = false;
    rerender();
  });

  // Live-watch day statuses (leave/sick/vacation) so admin changes show
  // up instantly without a manual refresh.
  unsubDayStatus = watchDayStatusForDate(today, (statuses) => {
    const newMap = {};
    for (const s of statuses) newMap[s.employeeId] = s;
    dayStatusMap = newMap;
    rerender();
  });

  // Cleanup when navigating away
  // Register cleanup so navigation closes these live listeners.
  window.SZR_registerCleanup(cleanup);
}

// ──────────────────────────────────────────────────────────────────
// DATE HERO with live stats
// ──────────────────────────────────────────────────────────────────
function buildDateHero(date, settings, stats) {
  if (clockInterval) clearInterval(clockInterval);

  const clockEl = el('div.date-hero__clock');
  const updateClock = () => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    clockEl.textContent = `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };
  updateClock();
  clockInterval = setInterval(updateClock, 1000);

  const presentVal = el('div.date-hero__stat-value', {}, String(stats?.present ?? 0));
  const lateVal = el('div.date-hero__stat-value', {}, String(stats?.late ?? 0));
  const absentVal = el('div.date-hero__stat-value', {}, String(stats?.absent ?? 0));

  const node = el('div.date-hero', {}, [
    el('div.date-hero__row', {}, [
      el('div.date-hero__main', {}, [
        el('div.date-hero__label', {}, 'ئەمڕۆ'),
        el('div.date-hero__date', {}, formatDateFull(date)),
      ]),
      el('div', { style: { textAlign: 'left', flexShrink: '0' } }, [
        clockEl,
        el('div.date-hero__hours', {}, `${formatTime12(settings.workStart)} — ${formatTime12(settings.workEnd)}`),
      ]),
    ]),
    el('div.date-hero__divider'),
    el('div.date-hero__stats', {}, [
      el('div.date-hero__stat.date-hero__stat--present', {}, [presentVal, el('div.date-hero__stat-label', {}, 'ئامادەبوو')]),
      el('div.date-hero__stat.date-hero__stat--late', {}, [lateVal, el('div.date-hero__stat-label', {}, 'دواکەوتوو')]),
      el('div.date-hero__stat.date-hero__stat--absent', {}, [absentVal, el('div.date-hero__stat-label', {}, 'ئامادەنەبوو')]),
    ]),
  ]);

  return {
    node,
    updateStats: ({ present, late, absent }) => {
      presentVal.textContent = String(present);
      lateVal.textContent = String(late);
      absentVal.textContent = String(absent);
    },
  };
}

// ──────────────────────────────────────────────────────────────────
// EMPLOYEE ROW (live)
// ──────────────────────────────────────────────────────────────────
function buildEmpRow(emp, record, dayStatus, isHoliday, settings, today) {
  const result = calcDay(settings, {
    checkIn: record?.checkIn,
    checkOut: record?.checkOut,
    status: dayStatus?.type || (isHoliday ? 'holiday' : null),
    autoCheckout: record?.autoCheckout,
  }, today);

  // Avatar
  const avatar = el('div.avatar', {}, emp.photo ? [el('img', { src: emp.photo, alt: emp.name })] : [initial(emp.name)]);

  // Status content
  const statusEl = el('div.emp-row__status');

  if (result.status === 'weekend') {
    statusEl.appendChild(el('span.badge.badge--neutral', {}, 'هەینی'));
  } else if (result.status === 'holiday') {
    statusEl.appendChild(el('span.badge.badge--navy', {}, 'پشووی فەرمی'));
  } else if (['leave', 'sick', 'vacation'].includes(result.status)) {
    const labels = { leave: 'مۆڵەت', sick: 'نەخۆشی', vacation: 'پشوو' };
    statusEl.appendChild(el('span.badge.badge--info', {}, labels[result.status]));
  } else if (record?.checkIn) {
    const times = el('div.emp-row__times');
    times.appendChild(el('span.time-pill.time-pill--in', {}, 'هاتن ' + formatTime12(record.checkIn)));
    if (record.checkOut) {
      times.appendChild(el('span.time-pill.time-pill--out', {},
        'چوون ' + formatTime12(record.checkOut) + (record.autoCheckout ? ' •' : '')));
    }
    statusEl.appendChild(times);

    if (result.status === 'in-progress') {
      statusEl.appendChild(el('span.badge.badge--info.badge--dot', {}, 'لە دەوامدایە'));
      if (result.late > 0) {
        statusEl.appendChild(el('span.badge.badge--warning', {}, formatDuration(result.late, { short: true }) + ' دواکەوتن'));
      }
    } else if (result.late > 0) {
      statusEl.appendChild(el('span.badge.badge--warning', {}, formatDuration(result.late, { short: true }) + ' دواکەوتن'));
    }
    if (record.autoCheckout) {
      statusEl.appendChild(el('span.badge.badge--auto', {}, 'چوونەوەی خۆکار'));
    }
  } else {
    statusEl.appendChild(el('span.badge.badge--neutral', {}, 'هێشتا ئامادەنەبووە'));
  }

  // GPS indicator if checked in with location
  const stripe = el('div.emp-row__stripe', { class: 'emp-row__stripe ' + stripeClass(result.status) });

  // Chevron hint (clickable → opens employee detail for editing)
  const chevron = el('div', { style: { color: 'var(--ink-faint)', flexShrink: '0', display: 'flex', alignItems: 'center' },
    html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' });

  return el('div.emp-row', {
    style: { cursor: 'pointer' },
    onclick: () => { haptic(8); openTodayEdit(emp, settings, today); },
  }, [
    avatar,
    el('div.emp-row__info', {}, [
      el('div.emp-row__name', {}, emp.name),
      statusEl,
    ]),
    chevron,
    stripe,
  ]);
}

// Open the edit modal for an employee's TODAY record directly from the dashboard
async function openTodayEdit(emp, settings, today) {
  try {
    const [attendance, dayStatus] = await Promise.all([
      getAttendance(emp.id, today),
      getDayStatus(emp.id, today),
    ]);
    const day = { attendance, dayStatus };
    openEditDay(emp, today, day, settings, () => {
      // The live listener will refresh the dashboard automatically.
    });
  } catch (err) {
    console.error('[SZR] Open today edit error:', err);
    toast('کێشە لە کردنەوەی دەستکاری', 'error');
  }
}

function stripeClass(status) {
  switch (status) {
    case 'present': case 'in-progress': return 'stripe--present';
    case 'partial': return 'stripe--late';
    case 'absent': return 'stripe--absent';
    default: return 'stripe--off';
  }
}

// ──────────────────────────────────────────────────────────────────
// LIVE TOAST — employee just checked in/out
// ──────────────────────────────────────────────────────────────────
function notifyLive(emp, action, time) {
  if (!emp) return;
  haptic(20);
  const root = document.getElementById('toast-root');
  if (!root) return;

  const node = el('div.toast.live-toast', {}, [
    el('div.live-toast__avatar', {}, initial(emp.name)),
    el('div.live-toast__text', {}, [
      el('div.live-toast__name', {}, emp.name),
      el('div.live-toast__action', {}, `${action} • ${formatTime12(time)}`),
    ]),
  ]);
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('toast--out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, 4000);
}

// ──────────────────────────────────────────────────────────────────
// CLEANUP
// ──────────────────────────────────────────────────────────────────
function cleanup() {
  if (unsubAttendance) { unsubAttendance(); unsubAttendance = null; }
  if (unsubEmployees) { unsubEmployees(); unsubEmployees = null; }
  if (unsubDayStatus) { unsubDayStatus(); unsubDayStatus = null; }
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  lastSeen = {};
}

// ── Icons ──
function usersIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
}

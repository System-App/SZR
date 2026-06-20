/**
 * admin-attendance.js — Attendance history & editing (admin)
 *
 * Two views:
 *   renderAttendance()      → list of employees with per-range summaries
 *   renderEmployeeDetail()  → one employee's daily records + monthly chart,
 *                             with the ability to EDIT each day (times,
 *                             leave/sick/vacation status). Admin CAN edit.
 *
 * Times remain Latin; labels Kurdish; Friday excluded from absence.
 */

import {
  buildRangeData, setAttendance, deleteAttendance,
  setDayStatus, getEmployee,
} from './db.js';
import {
  el, toast, haptic, openModal,
  formatTime12, formatDuration, formatDurationCompact, formatDateLatin,
  todayKey, monthStartKey, monthEndKey, daysAgoKey, dateToKey, keyToDate,
  dayRange, calcDay, statusLabel, statusBadgeClass, initial,
  MONTHS_EN, weekdayKu, isWeekend,
} from './utils.js';

// ══════════════════════════════════════════════════════════════════
// VIEW A — ATTENDANCE LIST (all employees, per range)
// ══════════════════════════════════════════════════════════════════
export async function renderAttendance(main) {
  const settings = window.SZR.getSettings();

  main.appendChild(el('div.page-head', {}, [
    el('h2.page-head__title', {}, 'ژمێریاری دەوام'),
    el('p.page-head__sub', {}, 'بینینی کۆی کاتی کارکراو و لەدەستچوو بۆ هەر کارمەندێک. کلیک لە کارمەند بکە بۆ وردەکاری و دەستکاری.'),
  ]));

  let startDate = monthStartKey();
  let endDate = monthEndKey();

  const { rangeEl, getStart, getEnd, onChange } = buildDateRange(startDate, endDate);
  main.appendChild(rangeEl);

  const content = el('div', { id: 'att-content' });
  main.appendChild(content);

  async function load() {
    content.innerHTML = '';
    content.appendChild(el('div.loading-center', {}, [el('div.spinner.spinner--lg'), el('div', {}, 'بارکردن...')]));
    try {
      const data = await buildRangeData({ startDate: getStart(), endDate: getEnd() });
      const summaries = computeSummaries(data, settings, getStart(), getEnd());
      content.innerHTML = '';

      if (summaries.length === 0) {
        content.appendChild(el('div.empty', {}, [
          el('div.empty__title', {}, 'هیچ کارمەندێک نییە'),
          el('div.empty__text', {}, 'سەرەتا کارمەندان زیاد بکە.'),
        ]));
        return;
      }

      // Grand total
      const totalWorked = summaries.reduce((s, x) => s + x.totalWorked, 0);
      content.appendChild(el('div.card.card--padded', { style: { marginBottom: '12px', textAlign: 'center' } }, [
        el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', fontWeight: '600' } }, 'کۆی گشتی کاتی کارکراو'),
        el('div', { style: { fontSize: 'var(--text-2xl)', fontWeight: '800', color: 'var(--olive)', direction: 'ltr', marginTop: '2px' } }, formatDurationCompact(totalWorked)),
      ]));

      for (const s of summaries) {
        content.appendChild(buildSummaryCard(s));
      }
    } catch (err) {
      console.error('[SZR] Attendance load error:', err);
      content.innerHTML = '';
      content.appendChild(el('div.empty', {}, [el('div.empty__title', {}, 'کێشەیەک ڕوویدا')]));
    }
  }

  onChange(load);
  load();
}

function buildSummaryCard(s) {
  return el('div.summary-card', {
    onclick: () => { haptic(8); window.SZR.navigateTo('detail', { employeeId: s.employee.id }); },
  }, [
    el('div.avatar', {}, s.employee.photo ? [el('img', { src: s.employee.photo, alt: '' })] : [initial(s.employee.name)]),
    el('div.summary-card__info', {}, [
      el('div.summary-card__name', {}, s.employee.name),
      el('div.summary-card__stats', {}, [
        el('span', {}, [el('b', {}, String(s.daysPresent)), ' ئامادەبوو']),
        el('span', {}, [el('b', {}, String(s.daysAbsent)), ' ئامادەنەبوو']),
        el('span', {}, [el('b', {}, formatDurationCompact(s.totalWorked)), ' کارکراو']),
      ]),
    ]),
    el('div.summary-card__lost', {}, [
      el('div.summary-card__lost-val', {}, formatDuration(s.totalLost, { short: true })),
      el('div.summary-card__lost-lbl', {}, 'لەدەستچوو'),
    ]),
  ]);
}

function computeSummaries(data, settings, startDate, endDate) {
  const summaries = [];
  for (const empId of Object.keys(data)) {
    const { employee, days } = data[empId];
    let totalWorked = 0, totalLost = 0, daysPresent = 0, daysAbsent = 0, daysOff = 0;

    for (const date of dayRange(startDate, endDate)) {
      if (date > todayKey()) continue;
      const day = days[date] || {};
      const record = {
        checkIn: day.attendance?.checkIn,
        checkOut: day.attendance?.checkOut,
        status: day.dayStatus?.type || (day.isHoliday ? 'holiday' : null),
      };
      const result = calcDay(settings, record, date);

      if (result.status === 'weekend') continue;
      if (['holiday', 'leave', 'sick', 'vacation'].includes(result.status)) { daysOff++; continue; }
      if (result.status === 'absent') { daysAbsent++; totalLost += result.lost; }
      else { daysPresent++; totalWorked += result.worked; totalLost += result.lost; }
    }
    summaries.push({ employee, totalWorked, totalLost, daysPresent, daysAbsent, daysOff });
  }
  return summaries.sort((a, b) => (a.employee.name || '').localeCompare(b.employee.name || '', 'ar'));
}

// ══════════════════════════════════════════════════════════════════
// VIEW B — EMPLOYEE DETAIL (daily records + chart + EDIT)
// ══════════════════════════════════════════════════════════════════
export async function renderEmployeeDetail(main, employeeId) {
  const settings = window.SZR.getSettings();

  const employee = await getEmployee(employeeId);
  if (!employee) {
    main.appendChild(el('div.empty', {}, [el('div.empty__title', {}, 'کارمەند نەدۆزرایەوە')]));
    return;
  }

  let startDate = monthStartKey();
  let endDate = monthEndKey();

  // Header
  const headEl = el('div', { id: 'detail-head' });
  main.appendChild(headEl);

  // Date range
  const { rangeEl, getStart, getEnd, onChange } = buildDateRange(startDate, endDate);
  main.appendChild(rangeEl);

  // Chart
  const chartEl = el('div', { id: 'detail-chart' });
  main.appendChild(chartEl);

  // Daily entries
  main.appendChild(el('div.section-head', {}, [el('h3.section-head__title', {}, 'وردەکاری ڕۆژانە')]));
  const entriesEl = el('div', { id: 'detail-entries' });
  main.appendChild(entriesEl);

  async function load() {
    entriesEl.innerHTML = '';
    entriesEl.appendChild(el('div.loading-center', {}, [el('div.spinner.spinner--lg')]));

    const data = await buildRangeData({ startDate: getStart(), endDate: getEnd(), employeeId });
    const empData = data[employeeId] || { days: {} };

    // Compute totals
    let totalWorked = 0, totalLost = 0, daysPresent = 0, daysAbsent = 0;
    const entries = [];
    const chartData = [];

    for (const date of dayRange(getStart(), getEnd())) {
      if (date > todayKey()) continue;
      const day = empData.days[date] || {};
      const record = {
        checkIn: day.attendance?.checkIn,
        checkOut: day.attendance?.checkOut,
        status: day.dayStatus?.type || (day.isHoliday ? 'holiday' : null),
        autoCheckout: day.attendance?.autoCheckout,
      };
      const result = calcDay(settings, record, date);

      if (result.status === 'present' || result.status === 'partial' || result.status === 'in-progress') {
        daysPresent++; totalWorked += result.worked; totalLost += result.lost;
      } else if (result.status === 'absent') {
        daysAbsent++; totalLost += result.lost;
      }
      entries.push({ date, day, result });
      chartData.push({ date, result });
    }

    // Header
    headEl.innerHTML = '';
    headEl.appendChild(buildDetailHead(employee, getStart(), getEnd(), { totalWorked, totalLost, daysPresent, daysAbsent }));

    // Chart
    chartEl.innerHTML = '';
    chartEl.appendChild(buildMonthlyChart(chartData, settings));

    // Entries (newest first)
    entriesEl.innerHTML = '';
    entries.reverse();
    if (entries.length === 0) {
      entriesEl.appendChild(el('div.empty', { style: { padding: '24px' } }, [el('div.empty__title', {}, 'هیچ تۆمارێک نییە')]));
      return;
    }
    for (const e of entries) {
      entriesEl.appendChild(buildDayEntry(employee, e.date, e.day, e.result, settings, load));
    }
  }

  onChange(load);
  load();
}

function buildDetailHead(employee, startDate, endDate, totals) {
  return el('div.detail-head', {}, [
    el('div.detail-head__top', {}, [
      el('button.detail-head__back', { onclick: () => window.SZR.navigateTo('attendance'), 'aria-label': 'گەڕانەوە',
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' }),
      el('div.avatar', {}, employee.photo ? [el('img', { src: employee.photo, alt: '' })] : [initial(employee.name)]),
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div.detail-head__name', {}, employee.name),
        el('div.detail-head__range', {}, `${formatDateLatin(startDate)} — ${formatDateLatin(endDate)}`),
      ]),
    ]),
    el('div.detail-head__grid', {}, [
      el('div.detail-stat', {}, [
        el('div.detail-stat__lbl', {}, 'کاتی کارکراو'),
        el('div.detail-stat__val', {}, formatDurationCompact(totals.totalWorked)),
      ]),
      el('div.detail-stat.detail-stat--lost', {}, [
        el('div.detail-stat__lbl', {}, 'کاتی لەدەستچوو'),
        el('div.detail-stat__val', {}, formatDurationCompact(totals.totalLost)),
      ]),
      el('div.detail-stat', {}, [
        el('div.detail-stat__lbl', {}, 'ڕۆژانی ئامادەبوو'),
        el('div.detail-stat__val', {}, String(totals.daysPresent)),
      ]),
      el('div.detail-stat', {}, [
        el('div.detail-stat__lbl', {}, 'ڕۆژانی ئامادەنەبوو'),
        el('div.detail-stat__val', {}, String(totals.daysAbsent)),
      ]),
    ]),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// MONTHLY CHART (worked minutes per day)
// ──────────────────────────────────────────────────────────────────
function buildMonthlyChart(chartData, settings) {
  if (chartData.length === 0) return el('div');

  const expected = (typeof settings.workEnd === 'string')
    ? (parseInt(settings.workEnd.split(':')[0]) * 60 + parseInt(settings.workEnd.split(':')[1])) -
      (parseInt(settings.workStart.split(':')[0]) * 60 + parseInt(settings.workStart.split(':')[1]))
    : 480;

  const bars = chartData.map(({ date, result }) => {
    let pct = 0, cls = 'absent';
    if (result.status === 'weekend' || result.status === 'holiday' ||
        ['leave', 'sick', 'vacation'].includes(result.status)) {
      pct = 12; cls = 'off';
    } else if (result.status === 'absent') {
      pct = 4; cls = 'absent';
    } else {
      pct = Math.max(8, Math.min(100, (result.worked / expected) * 100));
      cls = result.late > 0 ? 'late' : 'present';
    }
    const d = keyToDate(date);
    return el('div.chart-bar', {}, [
      el('div.chart-bar__fill.chart-bar__fill--' + cls, { style: { height: pct + '%' } }),
      el('div.chart-bar__label', {}, String(d.getDate())),
    ]);
  });

  return el('div.chart-card', {}, [
    el('div.chart-card__title', {}, 'گرافی دەوامی مانگانە'),
    el('div.chart-bars', {}, bars),
    el('div.chart-legend', {}, [
      legendItem('var(--success)', 'لە کاتی خۆیدا'),
      legendItem('var(--warning)', 'دواکەوتوو'),
      legendItem('var(--ink-ghost)', 'ئامادەنەبوو'),
      legendItem('var(--sage)', 'پشوو'),
    ]),
  ]);
}
function legendItem(color, label) {
  return el('span', {}, [el('i', { style: { background: color } }), label]);
}

// ──────────────────────────────────────────────────────────────────
// DAY ENTRY (with EDIT)
// ──────────────────────────────────────────────────────────────────
function buildDayEntry(employee, date, day, result, settings, reload) {
  const d = keyToDate(date);
  const checkIn = day.attendance?.checkIn;
  const checkOut = day.attendance?.checkOut;
  const autoCheckout = day.attendance?.autoCheckout;

  const dateBlock = el('div.day-entry__date', {}, [
    el('div.day-entry__day', {}, String(d.getDate())),
    el('div.day-entry__month', {}, MONTHS_EN[d.getMonth()].slice(0, 3)),
    el('div.day-entry__weekday', {}, weekdayKu(date)),
  ]);

  const info = el('div.day-entry__info');

  if (result.status === 'weekend') {
    info.appendChild(el('span.badge.badge--neutral', {}, 'هەینی — پشوو'));
  } else if (result.status === 'holiday') {
    info.appendChild(el('span.badge.badge--navy', {}, 'پشووی فەرمی'));
  } else if (['leave', 'sick', 'vacation'].includes(result.status)) {
    info.appendChild(el('span.badge.' + statusBadgeClass(result.status), {}, statusLabel(result.status)));
    if (day.dayStatus?.note) {
      info.appendChild(el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', marginTop: '4px' } }, day.dayStatus.note));
    }
  } else if (checkIn || checkOut) {
    const times = el('div.day-entry__times');
    if (checkIn) times.appendChild(timeBlock('هاتن', formatTime12(checkIn)));
    if (checkOut) times.appendChild(timeBlock('چوون', formatTime12(checkOut) + (autoCheckout ? ' •' : '')));
    info.appendChild(times);
    const meta = el('div.day-entry__meta');
    if (result.lost > 0) meta.appendChild(el('span.badge.badge--warning', {}, formatDuration(result.lost, { short: true }) + ' لەدەستچوو'));
    if (result.worked > 0) meta.appendChild(el('span.badge.badge--success', {}, formatDuration(result.worked, { short: true })));
    if (result.status === 'in-progress') meta.appendChild(el('span.badge.badge--info.badge--dot', {}, 'لە دەوامدایە'));
    if (autoCheckout) meta.appendChild(el('span.badge.badge--auto', {}, 'چوونەوەی خۆکار'));
    info.appendChild(meta);
  } else {
    info.appendChild(el('span.badge.badge--neutral', {}, 'ئامادەنەبووە'));
  }

  const editBtn = el('button.day-entry__edit', {
    'aria-label': 'دەستکاری',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    onclick: () => openEditDay(employee, date, day, settings, reload),
  });

  return el('div.day-entry', {}, [dateBlock, info, editBtn]);
}

function timeBlock(label, value) {
  return el('div.day-entry__time-block', {}, [
    el('div.day-entry__time-lbl', {}, label),
    el('div.day-entry__time-val', {}, value),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// EDIT DAY MODAL (admin can edit times + set leave/sick/vacation)
// ──────────────────────────────────────────────────────────────────
export function openEditDay(employee, date, day, settings, reload) {
  const isFriday = isWeekend(date);
  const currentStatus = day.dayStatus?.type || null;

  // Tabs: times vs status
  let mode = currentStatus ? 'status' : 'times';

  const checkInInput = el('input', { type: 'time', step: '60', value: day.attendance?.checkIn || '' });
  const checkOutInput = el('input', { type: 'time', step: '60', value: day.attendance?.checkOut || '' });

  // Status options
  let selectedStatus = currentStatus;
  const noteInput = el('input', { type: 'text', placeholder: 'تێبینی (ئیختیاری)', value: day.dayStatus?.note || '' });

  const statusGrid = el('div.status-grid');
  const statuses = [
    { type: 'leave', label: 'مۆڵەت', icon: '📋', cls: 'leave' },
    { type: 'sick', label: 'نەخۆشی', icon: '🤒', cls: 'sick' },
    { type: 'vacation', label: 'پشوو', icon: '🏖️', cls: 'vacation' },
    { type: null, label: 'ڕۆژی ئاسایی', icon: '💼', cls: 'present' },
  ];
  const renderStatusGrid = () => {
    statusGrid.innerHTML = '';
    for (const s of statuses) {
      const selected = selectedStatus === s.type;
      statusGrid.appendChild(el('button.status-option' + (selected ? '.is-selected' : ''), {
        onclick: () => { selectedStatus = s.type; renderStatusGrid(); },
      }, [
        el('div.status-option__icon.status-option__icon--' + s.cls, {}, s.icon),
        el('div.status-option__label', {}, s.label),
      ]));
    }
  };
  renderStatusGrid();

  // Mode toggle
  const timesTab = el('button', { class: 'btn btn--sm' }, 'کات');
  const statusTab = el('button', { class: 'btn btn--sm' }, 'دۆخی ڕۆژ');
  const timesPanel = el('div', {}, [
    el('div.field__hint', { style: { marginBottom: '8px' } }, 'کاتی هاتن و چوون دەستکاری بکە. بەتاڵکردنیان تۆمارەکە دەسڕێتەوە.'),
    el('div.times-row', {}, [
      el('div.field', {}, [el('span.field__label', {}, 'کاتی هاتن'), checkInInput]),
      el('div.field', {}, [el('span.field__label', {}, 'کاتی چوون'), checkOutInput]),
    ]),
  ]);
  const statusPanel = el('div', {}, [
    el('div.field__hint', { style: { marginBottom: '8px' } }, 'دۆخی ئەم ڕۆژە دیاری بکە بۆ ئەم کارمەندە.'),
    statusGrid,
    el('div.field', { style: { marginTop: '12px' } }, [el('span.field__label', {}, 'تێبینی'), noteInput]),
  ]);

  const panelHost = el('div');
  const setMode = (m) => {
    mode = m;
    timesTab.className = 'btn btn--sm ' + (m === 'times' ? 'btn--primary' : 'btn--ghost');
    statusTab.className = 'btn btn--sm ' + (m === 'status' ? 'btn--primary' : 'btn--ghost');
    panelHost.innerHTML = '';
    panelHost.appendChild(m === 'times' ? timesPanel : statusPanel);
  };
  timesTab.addEventListener('click', () => setMode('times'));
  statusTab.addEventListener('click', () => setMode('status'));

  const saveBtn = el('button.btn.btn--primary', {}, 'پاشەکەوتکردن');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '';
    saveBtn.appendChild(el('span.spinner.spinner--white'));
    try {
      if (mode === 'status') {
        // Setting a status clears attendance times for clarity
        await setDayStatus(employee.id, date, selectedStatus, noteInput.value.trim());
        if (selectedStatus) {
          // Remove attendance record if exists
          await deleteAttendance(employee.id, date).catch(() => {});
        }
      } else {
        // Times mode — clear any day status, set times
        if (currentStatus) await setDayStatus(employee.id, date, null);
        const ci = checkInInput.value || null;
        const co = checkOutInput.value || null;
        if (!ci && !co) {
          await deleteAttendance(employee.id, date).catch(() => {});
        } else {
          await setAttendance(employee.id, date, { checkIn: ci, checkOut: co, autoCheckout: false });
        }
      }
      toast('تۆمار نوێکرایەوە', 'success');
      haptic(15);
      modal.close();
      reload();
    } catch (err) {
      console.error('[SZR] Edit day error:', err);
      toast('کێشە لە پاشەکەوتکردن', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'پاشەکەوتکردن';
    }
  });

  const body = [
    el('div', { style: { fontSize: 'var(--text-sm)', fontWeight: '700', textAlign: 'center', color: 'var(--ink-soft)', direction: 'ltr' } },
      formatDateLatin(date) + ' — ' + weekdayKu(date)),
  ];

  if (isFriday) {
    body.push(el('div.info-note', {}, 'ئەمڕۆ هەینییە (ڕۆژی پشوو). دەتوانیت بە دەستی کات تۆمار بکەیت ئەگەر کارمەند هاتبێت.'));
  }

  body.push(
    el('div.row', { style: { gap: '8px' } }, [timesTab, statusTab]),
    panelHost,
  );

  const modal = openModal({
    title: 'دەستکاری ' + employee.name,
    body,
    footer: [
      el('button.btn.btn--outline', { onclick: () => modal.close() }, 'پاشگەزبوونەوە'),
      saveBtn,
    ],
  });
  setMode(mode);
}

// ══════════════════════════════════════════════════════════════════
// SHARED — DATE RANGE PICKER
// ══════════════════════════════════════════════════════════════════
function buildDateRange(initialStart, initialEnd) {
  let start = initialStart, end = initialEnd;
  let changeCallback = null;

  const startInput = el('input', { type: 'date', value: start });
  const endInput = el('input', { type: 'date', value: end });

  const chips = [
    { key: 'month', label: 'ئەم مانگ', s: monthStartKey, e: monthEndKey },
    { key: 'week', label: 'ئەم هەفتە', s: () => daysAgoKey(6), e: todayKey },
    { key: 'today', label: 'ئەمڕۆ', s: todayKey, e: todayKey },
    { key: 'prev', label: 'مانگی ڕابردوو', s: prevMonthStart, e: prevMonthEnd },
  ];

  const chipRow = el('div.date-range__quick');
  const setActive = (key) => chipRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.key === key));

  chips.forEach((ch) => {
    chipRow.appendChild(el('button.chip', {
      dataset: { key: ch.key },
      onclick: () => {
        start = ch.s(); end = ch.e();
        startInput.value = start; endInput.value = end;
        setActive(ch.key);
        changeCallback && changeCallback();
      },
    }, ch.label));
  });

  startInput.addEventListener('change', () => { start = startInput.value; setActive(null); changeCallback && changeCallback(); });
  endInput.addEventListener('change', () => { end = endInput.value; setActive(null); changeCallback && changeCallback(); });

  setActive('month');

  const rangeEl = el('div.date-range', {}, [
    chipRow,
    el('div.date-range__inputs', {}, [
      el('label', {}, [el('span', {}, 'لە ڕۆژی'), startInput]),
      el('label', {}, [el('span', {}, 'تا ڕۆژی'), endInput]),
    ]),
  ]);

  return {
    rangeEl,
    getStart: () => start,
    getEnd: () => end,
    onChange: (cb) => { changeCallback = cb; },
  };
}

function prevMonthStart() { const d = new Date(); return dateToKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
function prevMonthEnd() { const d = new Date(); return dateToKey(new Date(d.getFullYear(), d.getMonth(), 0)); }

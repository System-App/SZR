/**
 * employee-history.js — Employee's own attendance history
 *
 * Read-only view. The employee can pick a date range (this month default)
 * and see their daily records + a summary of total worked time.
 * They CANNOT edit anything.
 */

import { buildRangeData } from './db.js';
import {
  el, formatTime12, formatDuration, formatDurationCompact,
  todayKey, monthStartKey, monthEndKey, daysAgoKey, dateToKey, keyToDate,
  dayRange, calcDay, statusLabel, statusBadgeClass, MONTHS_EN, weekdayKu,
} from './utils.js';

export async function renderEmployeeHistory(main) {
  const profile = window.SZR.getProfile();
  const settings = window.SZR.getSettings();

  main.appendChild(el('div.page-head', {}, [
    el('h2.page-head__title', {}, 'مێژووی دەوامی من'),
    el('p.page-head__sub', {}, 'بینینی تۆمارەکانی هاتن و چوونی خۆت بۆ ماوەی دیاریکراو.'),
  ]));

  // ── Date range state ──
  let startDate = monthStartKey();
  let endDate = monthEndKey();

  // Quick range chips
  const chips = [
    { key: 'month', label: 'ئەم مانگ', start: monthStartKey, end: monthEndKey },
    { key: 'week',  label: 'ئەم هەفتە', start: () => daysAgoKey(6), end: todayKey },
    { key: 'prev',  label: 'مانگی ڕابردوو', start: prevMonthStart, end: prevMonthEnd },
  ];

  const chipRow = el('div.date-range__quick');
  const startInput = el('input', { type: 'date', value: startDate });
  const endInput = el('input', { type: 'date', value: endDate });
  const content = el('div', { id: 'history-content' });

  function setChipActive(key) {
    chipRow.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-active', c.dataset.key === key);
    });
  }

  chips.forEach((ch) => {
    chipRow.appendChild(el('button.chip', {
      dataset: { key: ch.key },
      onclick: () => {
        startDate = ch.start(); endDate = ch.end();
        startInput.value = startDate; endInput.value = endDate;
        setChipActive(ch.key);
        load();
      },
    }, ch.label));
  });

  startInput.addEventListener('change', () => { startDate = startInput.value; setChipActive(null); load(); });
  endInput.addEventListener('change', () => { endDate = endInput.value; setChipActive(null); load(); });

  main.appendChild(el('div.date-range', {}, [
    chipRow,
    el('div.date-range__inputs', {}, [
      el('label', {}, [el('span', {}, 'لە ڕۆژی'), startInput]),
      el('label', {}, [el('span', {}, 'تا ڕۆژی'), endInput]),
    ]),
  ]));
  main.appendChild(content);

  setChipActive('month');

  async function load() {
    content.innerHTML = '';
    content.appendChild(el('div.loading-center', {}, [el('div.spinner.spinner--lg'), el('div', {}, 'بارکردن...')]));

    try {
      const data = await buildRangeData({ startDate, endDate, employeeId: profile.id });
      const empData = data[profile.id];
      content.innerHTML = '';

      if (!empData) {
        content.appendChild(emptyState());
        return;
      }

      // Summary
      let totalWorked = 0, totalLost = 0, daysPresent = 0;
      const entries = [];

      for (const date of dayRange(startDate, endDate)) {
        // Only show up to today
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
          daysPresent++;
          totalWorked += result.worked;
          totalLost += result.lost;
        }
        entries.push({ date, day, result });
      }

      // Summary card
      content.appendChild(el('div.card.card--padded', { style: { marginBottom: '16px' } }, [
        el('div', { style: { display: 'flex', justifyContent: 'space-around', textAlign: 'center' } }, [
          el('div', {}, [
            el('div', { style: { fontSize: 'var(--text-2xl)', fontWeight: '800', color: 'var(--olive)', direction: 'ltr' } },
              formatDurationCompact(totalWorked)),
            el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', marginTop: '2px' } }, 'کۆی کاتی کارکراو'),
          ]),
          el('div', {}, [
            el('div', { style: { fontSize: 'var(--text-2xl)', fontWeight: '800', color: 'var(--ink)', direction: 'ltr' } },
              String(daysPresent)),
            el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', marginTop: '2px' } }, 'ڕۆژی ئامادەبوو'),
          ]),
          el('div', {}, [
            el('div', { style: { fontSize: 'var(--text-2xl)', fontWeight: '800', color: totalLost > 0 ? 'var(--danger)' : 'var(--ink-faint)', direction: 'ltr' } },
              formatDurationCompact(totalLost)),
            el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', marginTop: '2px' } }, 'کۆی لەدەستچوو'),
          ]),
        ]),
      ]));

      // Entries (newest first)
      entries.reverse();
      if (entries.length === 0) {
        content.appendChild(emptyState());
        return;
      }

      for (const { date, day, result } of entries) {
        content.appendChild(buildEntry(date, day, result));
      }
    } catch (err) {
      console.error('[SZR] History load error:', err);
      content.innerHTML = '';
      content.appendChild(el('div.empty', {}, [
        el('div.empty__title', {}, 'کێشەیەک ڕوویدا'),
        el('div.empty__text', {}, 'تکایە دووبارە هەوڵ بدە'),
      ]));
    }
  }

  load();
}

// ──────────────────────────────────────────────────────────────────
// DAY ENTRY
// ──────────────────────────────────────────────────────────────────
function buildEntry(date, day, result) {
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
  } else if (checkIn || checkOut) {
    const times = el('div.day-entry__times');
    if (checkIn) {
      times.appendChild(el('div.day-entry__time-block', {}, [
        el('div.day-entry__time-lbl', {}, 'هاتن'),
        el('div.day-entry__time-val', {}, formatTime12(checkIn)),
      ]));
    }
    if (checkOut) {
      times.appendChild(el('div.day-entry__time-block', {}, [
        el('div.day-entry__time-lbl', {}, 'چوون'),
        el('div.day-entry__time-val', {}, formatTime12(checkOut) + (autoCheckout ? ' •' : '')),
      ]));
    }
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

  return el('div.day-entry', {}, [dateBlock, info]);
}

function emptyState() {
  return el('div.empty', {}, [
    el('div.empty__title', {}, 'هیچ تۆمارێک نییە'),
    el('div.empty__text', {}, 'بۆ ئەم ماوەیە هیچ تۆمارێکی دەوام نییە.'),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────
function prevMonthStart() {
  const d = new Date();
  return dateToKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}
function prevMonthEnd() {
  const d = new Date();
  return dateToKey(new Date(d.getFullYear(), d.getMonth(), 0));
}

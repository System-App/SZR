/**
 * admin-reports.js — Reports (admin)
 *
 * Generate attendance reports for a date range, filtered by all employees
 * or a single one. Three outputs:
 *   • Print  → opens the browser print dialog (print.css handles layout)
 *   • PDF    → same dialog, user picks "Save as PDF"
 *   • Excel  → downloads a CSV file (opens in Excel)
 *
 * Dates/numbers Latin, labels Kurdish.
 */

import { buildRangeData, listEmployeesOnly } from './db.js';
import {
  el, toast, downloadFile, formatDuration, formatDurationCompact,
  formatDateLatin, formatDateFull, todayKey, monthStartKey, monthEndKey,
  daysAgoKey, dateToKey, dayRange, calcDay, escapeHtml,
} from './utils.js';

export async function renderReports(main) {
  const settings = window.SZR.getSettings();

  main.appendChild(el('div.page-head', {}, [
    el('h2.page-head__title', {}, 'ڕاپۆرتەکان'),
    el('p.page-head__sub', {}, 'دروستکردنی ڕاپۆرتی دەوام بۆ پرینت، داگرتنی PDF، یاخود Excel.'),
  ]));

  let startDate = monthStartKey();
  let endDate = monthEndKey();
  let employeeFilter = 'all';

  // ── Date range ──
  const startInput = el('input', { type: 'date', value: startDate });
  const endInput = el('input', { type: 'date', value: endDate });

  const chips = [
    { key: 'month', label: 'ئەم مانگ', s: monthStartKey, e: monthEndKey },
    { key: 'week', label: 'ئەم هەفتە', s: () => daysAgoKey(6), e: todayKey },
    { key: 'today', label: 'ئەمڕۆ', s: todayKey, e: todayKey },
    { key: 'prev', label: 'مانگی ڕابردوو', s: prevMonthStart, e: prevMonthEnd },
  ];
  const chipRow = el('div.date-range__quick');
  const setActive = (k) => chipRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.key === k));
  chips.forEach((ch) => {
    chipRow.appendChild(el('button.chip', {
      dataset: { key: ch.key },
      onclick: () => { startDate = ch.s(); endDate = ch.e(); startInput.value = startDate; endInput.value = endDate; setActive(ch.key); refresh(); },
    }, ch.label));
  });
  startInput.addEventListener('change', () => { startDate = startInput.value; setActive(null); refresh(); });
  endInput.addEventListener('change', () => { endDate = endInput.value; setActive(null); refresh(); });
  setActive('month');

  // ── Employee filter ──
  const empSelect = el('select', {}, [el('option', { value: 'all' }, 'هەموو کارمەندان')]);
  const employees = await listEmployeesOnly();
  for (const e of employees) {
    empSelect.appendChild(el('option', { value: e.id }, e.name));
  }
  empSelect.addEventListener('change', () => { employeeFilter = empSelect.value; refresh(); });

  main.appendChild(el('div.date-range', {}, [
    chipRow,
    el('div.date-range__inputs', {}, [
      el('label', {}, [el('span', {}, 'لە ڕۆژی'), startInput]),
      el('label', {}, [el('span', {}, 'تا ڕۆژی'), endInput]),
    ]),
    el('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px' } }, [
      el('span', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', fontWeight: '600' } }, 'بەڵاوەی کارمەند'),
      empSelect,
    ]),
  ]));

  // ── Action buttons ──
  main.appendChild(el('div.report-actions', {}, [
    el('button.btn.btn--ghost', { onclick: () => handleExcel() }, [excelIcon(), el('span', {}, 'Excel')]),
    el('button.btn.btn--primary', { onclick: () => handlePDF() }, [pdfIcon(), el('span', {}, 'PDF')]),
    el('button.btn.btn--accent', { onclick: () => handlePrint() }, [printIcon(), el('span', {}, 'پرینت')]),
  ]));

  // ── Preview ──
  const preview = el('div', { id: 'report-preview' });
  main.appendChild(preview);

  async function refresh() {
    preview.innerHTML = '';
    preview.appendChild(el('div.loading-center', {}, [el('div.spinner.spinner--lg'), el('div', {}, 'بارکردن...')]));
    try {
      const summaries = await computeReport(settings, startDate, endDate, employeeFilter);
      preview.innerHTML = '';
      preview.appendChild(buildPreview(summaries, startDate, endDate));
    } catch (err) {
      console.error('[SZR] Report error:', err);
      preview.innerHTML = '';
      preview.appendChild(el('div.empty', {}, [el('div.empty__title', {}, 'کێشەیەک ڕوویدا')]));
    }
  }

  async function handlePrint() {
    const summaries = await computeReport(settings, startDate, endDate, employeeFilter);
    openPrintWindow(summaries, startDate, endDate, false);
  }
  async function handlePDF() {
    const summaries = await computeReport(settings, startDate, endDate, employeeFilter);
    openPrintWindow(summaries, startDate, endDate, true);
  }
  async function handleExcel() {
    const summaries = await computeReport(settings, startDate, endDate, employeeFilter);
    exportCSV(summaries, startDate, endDate);
  }

  refresh();
}

// ──────────────────────────────────────────────────────────────────
// COMPUTE REPORT
// ──────────────────────────────────────────────────────────────────
async function computeReport(settings, startDate, endDate, employeeFilter) {
  const employeeId = employeeFilter === 'all' ? null : employeeFilter;
  const data = await buildRangeData({ startDate, endDate, employeeId });

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

// ──────────────────────────────────────────────────────────────────
// PREVIEW (in-app)
// ──────────────────────────────────────────────────────────────────
function buildPreview(summaries, startDate, endDate) {
  if (summaries.length === 0) {
    return el('div.empty', {}, [el('div.empty__title', {}, 'هیچ داتایەک نییە')]);
  }

  const totalWorked = summaries.reduce((s, x) => s + x.totalWorked, 0);
  const totalPresent = summaries.reduce((s, x) => s + x.daysPresent, 0);
  const totalAbsent = summaries.reduce((s, x) => s + x.daysAbsent, 0);

  const rows = summaries.map((s) =>
    el('tr', {}, [
      el('td.name-cell', {}, s.employee.name),
      el('td', {}, String(s.daysPresent)),
      el('td', {}, String(s.daysAbsent)),
      el('td', {}, String(s.daysOff)),
      el('td.worked', {}, formatDurationCompact(s.totalWorked)),
      el('td.lost', {}, formatDuration(s.totalLost, { short: true })),
    ])
  );

  // Total row
  rows.push(el('tr', { style: { fontWeight: '800', background: 'var(--bg-sunken)' } }, [
    el('td.name-cell', {}, 'کۆی گشتی'),
    el('td', {}, String(totalPresent)),
    el('td', {}, String(totalAbsent)),
    el('td', {}, '—'),
    el('td.worked', {}, formatDurationCompact(totalWorked)),
    el('td', {}, '—'),
  ]));

  return el('div.report-preview', {}, [
    el('div.report-preview__head', {}, [
      el('div.report-preview__logo', {}, [el('img', { src: 'icons/icon-192.png', alt: 'SZR' })]),
      el('div.report-preview__title', {}, 'SZR — ڕاپۆرتی دەوام'),
      el('div.report-preview__sub', {}, `${formatDateLatin(startDate)} — ${formatDateLatin(endDate)}`),
    ]),
    el('table.report-table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, 'ناوی کارمەند'),
        el('th', {}, 'ئامادەبوو'),
        el('th', {}, 'ئامادەنەبوو'),
        el('th', {}, 'پشوو'),
        el('th', {}, 'کاتی کارکراو'),
        el('th', {}, 'لەدەستچوو'),
      ])]),
      el('tbody', {}, rows),
    ]),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// PRINT / PDF — open a clean print window
// ──────────────────────────────────────────────────────────────────
function openPrintWindow(summaries, startDate, endDate, isPdf) {
  if (summaries.length === 0) { toast('هیچ داتایەک نییە بۆ ڕاپۆرت', 'error'); return; }

  const totalWorked = summaries.reduce((s, x) => s + x.totalWorked, 0);
  const totalPresent = summaries.reduce((s, x) => s + x.daysPresent, 0);
  const totalAbsent = summaries.reduce((s, x) => s + x.daysAbsent, 0);

  const rowsHtml = summaries.map((s) => `
    <tr>
      <td class="name">${escapeHtml(s.employee.name)}</td>
      <td>${s.daysPresent}</td>
      <td>${s.daysAbsent}</td>
      <td>${s.daysOff}</td>
      <td class="worked">${escapeHtml(formatDurationCompact(s.totalWorked))}</td>
      <td class="lost">${escapeHtml(formatDuration(s.totalLost, { short: true }))}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ckb" dir="rtl">
<head>
<meta charset="UTF-8">
<title>SZR — ڕاپۆرتی دەوام</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Vazirmatn',sans-serif; color:#232B20; padding:32px; direction:rtl; }
  .header { text-align:center; border-bottom:3px solid #2C3828; padding-bottom:16px; margin-bottom:24px; }
  .header h1 { font-size:24px; color:#2C3828; }
  .header .range { font-size:14px; color:#5C6B53; margin-top:4px; direction:ltr; }
  .header .meta { font-size:12px; color:#94A089; margin-top:8px; direction:ltr; }
  .summary { display:flex; justify-content:center; gap:32px; margin-bottom:24px; }
  .summary div { text-align:center; }
  .summary .v { font-size:22px; font-weight:800; color:#2C3828; direction:ltr; }
  .summary .l { font-size:12px; color:#5C6B53; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { padding:10px 8px; text-align:right; border-bottom:1px solid #E7E0D4; }
  th { background:#2C3828; color:#FBEBDA; font-weight:700; font-size:12px; }
  td { direction:ltr; text-align:right; }
  td.name { direction:rtl; font-weight:600; }
  td.worked { color:#2F7440; font-weight:700; }
  td.lost { color:#C8893C; font-weight:700; }
  tr.total { background:#FAF6F0; font-weight:800; }
  tr.total td { border-top:2px solid #2C3828; }
  .footer { margin-top:32px; text-align:center; font-size:11px; color:#94A089; direction:ltr; }
  @media print { body { padding:16px; } @page { margin:1.5cm; } }
</style>
</head>
<body>
  <div class="header">
    <h1>SZR — ڕاپۆرتی دەوامی کارمەندان</h1>
    <div class="range">${formatDateLatin(startDate)} — ${formatDateLatin(endDate)}</div>
    <div class="meta">Generated: ${formatDateFull(todayKey())}</div>
  </div>
  <div class="summary">
    <div><div class="v">${totalPresent}</div><div class="l">کۆی ئامادەبوون</div></div>
    <div><div class="v">${totalAbsent}</div><div class="l">کۆی ئامادەنەبوون</div></div>
    <div><div class="v">${escapeHtml(formatDurationCompact(totalWorked))}</div><div class="l">کۆی کاتی کارکراو</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>ناوی کارمەند</th><th>ئامادەبوو</th><th>ئامادەنەبوو</th>
        <th>پشوو</th><th>کاتی کارکراو</th><th>لەدەستچوو</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total">
        <td class="name">کۆی گشتی</td>
        <td>${totalPresent}</td>
        <td>${totalAbsent}</td>
        <td>—</td>
        <td class="worked">${escapeHtml(formatDurationCompact(totalWorked))}</td>
        <td>—</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">Shkoy Zawy Real Estate © 2026 — SZR Attendance System</div>
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (!printWindow) { toast('تکایە ڕێگە بە popup بدە', 'error'); return; }
  printWindow.document.write(html);
  printWindow.document.close();

  // Wait for fonts/images, then trigger print
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 600);
  };

  toast(isPdf ? 'لە دیالۆگی پرینت، "Save as PDF" هەڵبژێرە' : 'ئامادەکردنی پرینت...', 'info', 3500);
}

// ──────────────────────────────────────────────────────────────────
// CSV EXPORT (Excel)
// ──────────────────────────────────────────────────────────────────
function exportCSV(summaries, startDate, endDate) {
  if (summaries.length === 0) { toast('هیچ داتایەک نییە', 'error'); return; }

  const headers = ['ناوی کارمەند', 'کۆد', 'ڕۆژانی ئامادەبوو', 'ڕۆژانی ئامادەنەبوو', 'ڕۆژانی پشوو', 'کاتی کارکراو (خولەک)', 'کاتی لەدەستچوو (خولەک)'];
  const rows = summaries.map((s) => [
    s.employee.name,
    s.employee.code,
    s.daysPresent,
    s.daysAbsent,
    s.daysOff,
    s.totalWorked,
    s.totalLost,
  ]);

  // BOM for Excel UTF-8 + RTL friendliness
  const csv = '\uFEFF' + [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const filename = `szr-report-${startDate}_to_${endDate}.csv`;
  downloadFile(filename, csv, 'text/csv;charset=utf-8');
  toast('فایلی Excel داگیرا', 'success');
}

// ── Helpers ──
function prevMonthStart() { const d = new Date(); return dateToKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
function prevMonthEnd() { const d = new Date(); return dateToKey(new Date(d.getFullYear(), d.getMonth(), 0)); }

// ── Icons ──
function excelIcon() { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>'); }
function pdfIcon() { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/>'); }
function printIcon() { return svg('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'); }
function svg(paths) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths;
  return s;
}

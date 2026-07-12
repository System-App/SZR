/**
 * employee-settings.js — Employee's personal settings
 *
 * Limited scope (employee can ONLY change their own preferences):
 *   • Dark mode toggle (local, per-device)
 *   • Font size (local, per-device)
 *   • Change own password
 *   • Logout
 *
 * Employees CANNOT change company settings (work hours, zone, etc.) —
 * those live only in the admin's settings.
 */

import { changePassword, authErrorMessage } from './auth.js';
import { el, toast, haptic, confirmModal, openModal } from './utils.js';

export function renderEmployeeSettings(main) {
  const profile = window.SZR.getProfile();
  const prefs = window.SZR.getPrefs();

  main.appendChild(el('div.page-head', {}, [
    el('h2.page-head__title', {}, 'ڕێکخستنەکان'),
    el('p.page-head__sub', {}, 'ڕووکار، قەبارەی فۆنت و گۆڕینی وشەی نهێنی.'),
  ]));

  const wrap = el('div.settings');

  // ── Profile card ────────────────────────────────────────────────
  wrap.appendChild(el('div.settings-section', {}, [
    el('div.settings-section__body', {}, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } }, [
        el('div.avatar.avatar--lg', {}, profile.photo
          ? [el('img', { src: profile.photo, alt: profile.name })]
          : [(profile.name || '?').charAt(0)]),
        el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('div', { style: { fontSize: 'var(--text-md)', fontWeight: '800', color: 'var(--ink)' } }, profile.name),
          el('div', { style: { marginTop: '4px' } }, [
            el('span.cred-badge', {}, 'کۆد: ' + profile.code),
          ]),
        ]),
      ]),
    ]),
  ]));

  // ── Appearance ──────────────────────────────────────────────────
  wrap.appendChild(buildSection(svgPalette(), 'ڕووکار', [
    buildToggle('ڕووکاری تاریک', 'گۆڕینی ڕووکار بۆ ڕەنگی تاریک — باشترە بۆ شەو.',
      prefs.darkMode ?? false,
      (checked) => window.SZR.setPref('darkMode', checked)),
  ]));

  // ── Font size ───────────────────────────────────────────────────
  wrap.appendChild(buildSection(svgType(), 'قەبارەی فۆنت', [buildFontControl(prefs)]));

  // ── Password ────────────────────────────────────────────────────
  wrap.appendChild(buildSection(svgKey(), 'وشەی نهێنی', [
    el('button.btn.btn--outline.btn--block', {
      onclick: () => openChangePassword(),
    }, [svgKey(16), ' گۆڕینی وشەی نهێنی']),
  ]));

  // ── Logout ──────────────────────────────────────────────────────
  wrap.appendChild(buildSection(svgLogout(), 'هەژمار', [
    el('button.btn.btn--danger.btn--block', {
      onclick: async () => {
        const ok = await confirmModal({
          title: 'چوونەدەرەوە',
          message: 'دڵنیایت لە چوونەدەرەوە؟ پێویستە دووبارە بچیتەوە ژوورەوە.',
          confirmText: 'چوونەدەرەوە',
          danger: true,
        });
        if (ok) await window.SZR.logout();
      },
    }, [svgLogout(16), ' چوونەدەرەوە']),
  ]));

  // ── About ───────────────────────────────────────────────────────
  wrap.appendChild(el('div', {
    style: { textAlign: 'center', padding: '12px', color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' },
  }, [
    el('div', { style: { fontWeight: '700', color: 'var(--ink-soft)' } }, 'SZR'),
    el('div', { style: { marginTop: '2px' } }, 'وەشانی 2.1.3'),
  ]));

  main.appendChild(wrap);
}

// ──────────────────────────────────────────────────────────────────
// SECTION BUILDERS
// ──────────────────────────────────────────────────────────────────
function buildSection(icon, title, body) {
  return el('section.settings-section', {}, [
    el('div.settings-section__head', {}, [icon, el('h3.settings-section__title', {}, title)]),
    el('div.settings-section__body', {}, body),
  ]);
}

function buildToggle(label, hint, checked, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => { haptic(10); onChange(input.checked); });
  return el('div.setting-row', {}, [
    el('div.setting-row__text', {}, [
      el('div.setting-row__label', {}, label),
      hint ? el('div.setting-row__hint', {}, hint) : null,
    ].filter(Boolean)),
    el('label.toggle', {}, [input, el('span.toggle__track')]),
  ]);
}

function buildFontControl(prefs) {
  const presets = [
    { key: 0.85, label: 'بچووک', sample: '14' },
    { key: 1.0, label: 'ستاندارد', sample: '16' },
    { key: 1.15, label: 'گەورە', sample: '18' },
    { key: 1.3, label: 'زۆر گەورە', sample: '20' },
  ];

  const grid = el('div.font-sizes');
  const slider = el('input', { type: 'range', min: '70', max: '160', step: '5',
    value: Math.round((prefs.fontScale ?? 1) * 100) });
  const valueLabel = el('div.font-slider-wrap__value');

  const render = (scale) => {
    valueLabel.textContent = `${Math.round(scale * 100)}%`;
    slider.value = Math.round(scale * 100);
    grid.innerHTML = '';
    for (const p of presets) {
      const active = Math.abs(scale - p.key) < 0.01;
      grid.appendChild(el('button.font-size-btn' + (active ? '.is-active' : ''), {
        onclick: () => apply(p.key),
      }, [
        el('div.font-size-btn__sample', { style: { fontSize: `${p.sample}px` } }, 'ئا'),
        el('div.font-size-btn__label', {}, p.label),
      ]));
    }
  };

  const apply = (scale) => { window.SZR.setPref('fontScale', scale); render(scale); };

  let timer;
  slider.addEventListener('input', () => {
    const scale = parseInt(slider.value, 10) / 100;
    window.SZR.setPref('fontScale', scale);
    valueLabel.textContent = `${slider.value}%`;
    clearTimeout(timer);
    timer = setTimeout(() => render(scale), 150);
  });

  render(prefs.fontScale ?? 1);

  return el('div', {}, [
    el('div.field__hint', { style: { marginBottom: '8px' } }, 'قەبارەی فۆنتی هەموو ئەپ دیاری بکە.'),
    grid,
    el('div', { style: { marginTop: '12px' } }, [
      el('div', { style: { fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', fontWeight: '600', marginBottom: '6px' } }, 'قەبارەی تایبەت'),
      el('div.font-slider-wrap', {}, [slider, valueLabel]),
    ]),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// CHANGE PASSWORD MODAL
// ──────────────────────────────────────────────────────────────────
function openChangePassword() {
  const currentInput = el('input', { type: 'password', placeholder: 'وشەی نهێنی ئێستا', autocomplete: 'current-password' });
  const newInput = el('input', { type: 'password', placeholder: 'وشەی نهێنی نوێ', autocomplete: 'new-password' });
  const confirmInput = el('input', { type: 'password', placeholder: 'دووبارەکردنەوەی وشەی نهێنی نوێ', autocomplete: 'new-password' });
  const errorBox = el('div.auth__error', { style: { marginBottom: '0' } });

  const saveBtn = el('button.btn.btn--primary', {}, 'گۆڕین');

  const showError = (msg) => { errorBox.textContent = msg; errorBox.classList.add('show'); };
  const hideError = () => errorBox.classList.remove('show');

  saveBtn.addEventListener('click', async () => {
    hideError();
    const cur = currentInput.value;
    const nw = newInput.value;
    const cf = confirmInput.value;

    if (!cur || !nw || !cf) { showError('تکایە هەموو خانەکان پڕ بکەرەوە'); return; }
    if (nw.length < 6) { showError('وشەی نهێنی نوێ دەبێت لانیکەم ٦ پیت بێت'); return; }
    if (nw !== cf) { showError('وشە نهێنییە نوێیەکان وەک یەک نین'); return; }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '';
    saveBtn.appendChild(el('span.spinner.spinner--white'));

    try {
      await changePassword(cur, nw);
      toast('وشەی نهێنی گۆڕدرا', 'success');
      modal.close();
    } catch (err) {
      console.error('[SZR] Change password error:', err);
      showError(authErrorMessage(err));
      saveBtn.disabled = false;
      saveBtn.textContent = 'گۆڕین';
    }
  });

  const modal = openModal({
    title: 'گۆڕینی وشەی نهێنی',
    body: [
      errorBox,
      el('div.field', {}, [el('span.field__label', {}, 'وشەی نهێنی ئێستا'), currentInput]),
      el('div.field', {}, [el('span.field__label', {}, 'وشەی نهێنی نوێ'), newInput]),
      el('div.field', {}, [el('span.field__label', {}, 'دووبارەکردنەوە'), confirmInput]),
    ],
    footer: [
      el('button.btn.btn--outline', { onclick: () => modal.close() }, 'پاشگەزبوونەوە'),
      saveBtn,
    ],
  });
}

// ──────────────────────────────────────────────────────────────────
// ICONS
// ──────────────────────────────────────────────────────────────────
function makeSvg(paths, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths;
  return s;
}
function svgPalette(s) { return makeSvg('<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>', s); }
function svgType(s) { return makeSvg('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>', s); }
function svgKey(s) { return makeSvg('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>', s); }
function svgLogout(s) { return makeSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>', s); }

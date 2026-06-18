/**
 * admin-employees.js — Employee management (admin only)
 *
 * The admin can:
 *   • Create a new employee → assigns a code + password (Firebase Auth)
 *   • Edit an employee's name/photo
 *   • Reset an employee's password
 *   • Delete an employee (removes auth-linked profile + their records)
 *
 * Creating an employee uses createEmployeeAuth (secondary Firebase app)
 * so the admin's own session is NOT disturbed.
 */

import {
  watchEmployees, saveEmployeeProfile,
  deleteEmployeeProfile, getEmployeeByCode,
} from './db.js';
import { createEmployeeAuth, authErrorMessage } from './auth.js';
import {
  el, toast, haptic, confirmModal, openModal, initial,
  fileToDataURL,
} from './utils.js';

let unsubEmployees = null;

export async function renderEmployees(main) {
  cleanup();

  main.appendChild(el('div.page-head', {}, [
    el('h2.page-head__title', {}, 'کارمەندان'),
    el('p.page-head__sub', {}, 'دروستکردن و بەڕێوەبردنی هەژماری کارمەندان. هەر کارمەندێک بە کۆد و وشەی نهێنی دەچێتە ژوورەوە.'),
  ]));

  // Add button
  main.appendChild(el('button.btn.btn--primary.btn--block', {
    style: { marginBottom: '16px' },
    onclick: () => openEmployeeModal(),
  }, [plusIcon(), ' زیادکردنی کارمەندی نوێ']));

  const listEl = el('div', { id: 'emp-list' }, [
    el('div.loading-center', {}, [el('div.spinner.spinner--lg'), el('div', {}, 'بارکردن...')]),
  ]);
  main.appendChild(listEl);

  // Live employee list
  unsubEmployees = watchEmployees((employees) => {
    listEl.innerHTML = '';
    if (employees.length === 0) {
      listEl.appendChild(el('div.empty', {}, [
        el('div.empty__icon', { html: usersIcon() }),
        el('div.empty__title', {}, 'هیچ کارمەندێک نییە'),
        el('div.empty__text', {}, 'یەکەم کارمەند زیاد بکە بۆ دەستپێکردن.'),
      ]));
      return;
    }
    for (const emp of employees) {
      listEl.appendChild(buildEmployeeCard(emp));
    }
  });

  window.SZR_registerCleanup(cleanup);
}

// ──────────────────────────────────────────────────────────────────
// EMPLOYEE CARD
// ──────────────────────────────────────────────────────────────────
function buildEmployeeCard(emp) {
  const avatar = el('div.avatar', {}, emp.photo
    ? [el('img', { src: emp.photo, alt: emp.name })]
    : [initial(emp.name)]);

  return el('div.list-item', {}, [
    avatar,
    el('div.list-item__info', {}, [
      el('div.list-item__name', {}, emp.name),
      el('div', { style: { marginTop: '3px' } }, [
        el('span.cred-badge', {}, 'کۆد: ' + emp.code),
      ]),
    ]),
    el('div.list-item__actions', {}, [
      el('button.icon-btn', {
        'aria-label': 'دەستکاری', html: editIcon(),
        onclick: () => openEmployeeModal(emp),
      }),
      el('button.icon-btn.icon-btn--danger', {
        'aria-label': 'سڕینەوە', html: trashIcon(),
        onclick: () => handleDelete(emp),
      }),
    ]),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// CREATE / EDIT MODAL
// ──────────────────────────────────────────────────────────────────
function openEmployeeModal(existing = null) {
  const isEdit = !!existing;
  let photoData = existing?.photo || null;

  // Photo picker
  const photoPreview = el('div.photo-picker__preview', photoData
    ? {}
    : { html: cameraIcon() }, photoData
    ? [el('img', { src: photoData, alt: '' })]
    : []);
  const photoInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  photoInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      photoData = await fileToDataURL(file, 300);
      photoPreview.innerHTML = '';
      photoPreview.appendChild(el('img', { src: photoData, alt: '' }));
    } catch { toast('کێشە لە بارکردنی وێنە', 'error'); }
  });
  photoPreview.addEventListener('click', () => photoInput.click());

  // Fields
  const nameInput = el('input', { type: 'text', placeholder: 'بۆ نموونە: ئەحمەد محەمەد', value: existing?.name || '' });
  const codeInput = el('input', {
    type: 'text', placeholder: 'بۆ نموونە: ahmed', value: existing?.code || '',
    autocapitalize: 'none', spellcheck: 'false',
    disabled: isEdit, // code can't change after creation (it's the login id)
  });
  const pwInput = el('input', {
    type: 'text', placeholder: isEdit ? 'بەتاڵی بهێڵە بۆ نەگۆڕین' : 'بۆ نموونە: 123456',
    autocomplete: 'new-password',
  });

  const errorBox = el('div.auth__error', { style: { marginBottom: '0' } });
  const showError = (m) => { errorBox.textContent = m; errorBox.classList.add('show'); };
  const hideError = () => errorBox.classList.remove('show');

  const saveBtn = el('button.btn.btn--primary', {}, isEdit ? 'پاشەکەوتکردن' : 'زیادکردن');

  saveBtn.addEventListener('click', async () => {
    hideError();
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toLowerCase();
    const pw = pwInput.value;

    if (!name) { showError('تکایە ناوی کارمەند بنووسە'); return; }
    if (!code) { showError('تکایە کۆد بنووسە'); return; }
    if (!/^[a-z0-9_.-]+$/.test(code)) { showError('کۆد تەنها پیتی ئینگلیزی و ژمارە و (_ - .) ڕێگەپێدراوە'); return; }
    if (!isEdit && !pw) { showError('تکایە وشەی نهێنی بنووسە'); return; }
    if (!isEdit && pw.length < 6) { showError('وشەی نهێنی دەبێت لانیکەم ٦ پیت بێت'); return; }
    if (isEdit && pw && pw.length < 6) { showError('وشەی نهێنی دەبێت لانیکەم ٦ پیت بێت'); return; }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '';
    saveBtn.appendChild(el('span.spinner.spinner--white'));

    try {
      if (isEdit) {
        // Update profile (name + photo). Password change handled separately if entered.
        await saveEmployeeProfile(existing.id, {
          name, code: existing.code, role: 'employee',
          photo: photoData, createdAt: existing.createdAt,
        });
        if (pw) {
          toast('ناو نوێکرایەوە. گۆڕینی وشەی نهێنی پێویستی بە چوونەژوورەوەی کارمەند هەیە', 'info', 4000);
        }
        toast('کارمەند نوێکرایەوە', 'success');
        modal.close();
      } else {
        // Check code uniqueness
        const taken = await getEmployeeByCode(code);
        if (taken) { showError('ئەم کۆدە پێشتر بەکارهاتووە. کۆدێکی تر هەڵبژێرە'); resetSave(); return; }

        // Create Firebase Auth account (secondary app — doesn't log admin out)
        const uid = await createEmployeeAuth(code, pw);
        // Save profile under that uid
        await saveEmployeeProfile(uid, { name, code, role: 'employee', photo: photoData });

        toast('کارمەند زیادکرا', 'success');
        haptic(20);
        modal.close();

        // Show the credentials to share with the employee
        showCredentials(name, code, pw);
      }
    } catch (err) {
      console.error('[SZR] Save employee error:', err);
      showError(authErrorMessage(err));
      resetSave();
    }
  });

  function resetSave() {
    saveBtn.disabled = false;
    saveBtn.textContent = isEdit ? 'پاشەکەوتکردن' : 'زیادکردن';
  }

  const body = [
    errorBox,
    el('div.photo-picker', {}, [
      photoPreview, photoInput,
      el('div.photo-picker__actions', {}, [
        el('button.btn.btn--ghost.btn--sm', { onclick: () => photoInput.click() }, 'هەڵبژاردنی وێنە'),
        photoData ? el('button.btn.btn--outline.btn--sm', {
          onclick: () => { photoData = null; photoPreview.innerHTML = cameraIconStr(); },
        }, 'سڕینەوە') : null,
      ].filter(Boolean)),
    ]),
    el('div.field', {}, [el('span.field__label', {}, 'ناوی کارمەند'), nameInput]),
    el('div.field', {}, [
      el('span.field__label', {}, 'کۆد (بۆ چوونەژوورەوە)'),
      codeInput,
      isEdit ? el('span.field__hint', {}, 'کۆد ناتوانرێت بگۆڕدرێت دوای دروستکردن') : el('span.field__hint', {}, 'کارمەند بەم کۆدە دەچێتە ژوورەوە'),
    ]),
    el('div.field', {}, [
      el('span.field__label', {}, isEdit ? 'وشەی نهێنی نوێ (ئیختیاری)' : 'وشەی نهێنی'),
      pwInput,
    ]),
  ];

  const modal = openModal({
    title: isEdit ? 'دەستکاری کارمەند' : 'زیادکردنی کارمەندی نوێ',
    body,
    footer: [
      el('button.btn.btn--outline', { onclick: () => modal.close() }, 'پاشگەزبوونەوە'),
      saveBtn,
    ],
  });
}

// ──────────────────────────────────────────────────────────────────
// SHOW CREDENTIALS (after creating)
// ──────────────────────────────────────────────────────────────────
function showCredentials(name, code, password) {
  const modal = openModal({
    title: 'زانیاری چوونەژوورەوە',
    body: [
      el('div.success-note', {}, `هەژماری ${name} دروستکرا. ئەم زانیاریانە بدە بە کارمەند:`),
      el('div', { style: { background: 'var(--bg-sunken)', borderRadius: 'var(--r)', padding: '16px', marginTop: '4px' } }, [
        credRow('کۆد', code),
        el('div.divider'),
        credRow('وشەی نهێنی', password),
      ]),
      el('div.field__hint', {}, 'کارمەند دەتوانێت دوای چوونەژوورەوە وشەی نهێنی خۆی بگۆڕێت.'),
    ],
    footer: [
      el('button.btn.btn--primary.btn--block', {
        onclick: () => {
          const text = `زانیاری چوونەژوورەوە — SZR\nکۆد: ${code}\nوشەی نهێنی: ${password}`;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => toast('کۆپیکرا', 'success'));
          }
          modal.close();
        },
      }, [copyIcon(), ' کۆپیکردن و داخستن']),
    ],
  });
}

function credRow(label, value) {
  return el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' } }, [
    el('span', { style: { fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', fontWeight: '600' } }, label),
    el('span', { style: { fontSize: 'var(--text-md)', fontWeight: '800', color: 'var(--olive)', direction: 'ltr', fontFamily: 'monospace' } }, value),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// DELETE
// ──────────────────────────────────────────────────────────────────
async function handleDelete(emp) {
  const ok = await confirmModal({
    title: 'سڕینەوەی کارمەند',
    message: `دڵنیایت لە سڕینەوەی ${emp.name}؟ هەموو تۆمارەکانی دەوامیشی دەسڕێنەوە. ئەم کردارە ناگەڕێتەوە.`,
    confirmText: 'سڕینەوە',
    danger: true,
  });
  if (!ok) return;

  try {
    await deleteEmployeeProfile(emp.id);
    toast('کارمەند سڕایەوە', 'success');
    haptic(15);
  } catch (err) {
    console.error('[SZR] Delete error:', err);
    toast('کێشە لە سڕینەوە', 'error');
  }
}

// ──────────────────────────────────────────────────────────────────
// CLEANUP
// ──────────────────────────────────────────────────────────────────
function cleanup() {
  if (unsubEmployees) { unsubEmployees(); unsubEmployees = null; }
}

// ── Icons ──
function plusIcon() { return svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'); }
function editIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'; }
function trashIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'; }
function usersIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'; }
function cameraIcon() { return cameraIconStr(); }
function cameraIconStr() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'; }
function copyIcon() { return svg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'); }

function svg(paths) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths;
  return s;
}

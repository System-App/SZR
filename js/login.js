/**
 * login.js — Login screen for SZR
 *
 * Two tabs:
 *   • کارمەند (employee) → code + password
 *   • بەڕێوەبەر (admin)   → email + password
 *
 * On first run (no admin exists), allows creating the first admin account.
 */

import { login, loginAdmin, authErrorMessage } from './auth.js';
import { el } from './utils.js';

export function renderLogin(container) {
  let mode = 'employee'; // 'employee' | 'admin'

  const errorBox = el('div.auth__error', { id: 'login-error' });

  // ── Identifier field (code or email) ──
  const idLabel = el('label', { for: 'login-id' }, 'کۆد');
  const idInput = el('input', {
    type: 'text', id: 'login-id',
    placeholder: 'کۆدی کارمەند',
    autocomplete: 'username',
    autocapitalize: 'none', spellcheck: 'false',
  });

  // ── Password field ──
  const pwInput = el('input', {
    type: 'password', id: 'login-pw',
    placeholder: 'وشەی نهێنی',
    autocomplete: 'current-password',
  });
  const pwToggle = el('button.password-toggle', {
    type: 'button', 'aria-label': 'پیشاندانی وشەی نهێنی',
    onclick: () => {
      const showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      pwToggle.innerHTML = showing ? eyeIcon() : eyeOffIcon();
    },
  });
  pwToggle.innerHTML = eyeIcon();

  // ── Submit button ──
  const submitBtn = el('button.btn.btn--primary.btn--block.btn--lg', {
    type: 'button',
    style: { marginTop: '8px' },
  }, 'چوونەژوورەوە');

  // ── Mode toggle ──
  const empTab = el('button', { type: 'button' }, 'کارمەند');
  const adminTab = el('button', { type: 'button' }, 'بەڕێوەبەر');

  function setMode(m) {
    mode = m;
    empTab.classList.toggle('active', m === 'employee');
    adminTab.classList.toggle('active', m === 'admin');
    if (m === 'employee') {
      idLabel.textContent = 'کۆد';
      idInput.placeholder = 'کۆدی کارمەند';
      idInput.type = 'text';
    } else {
      idLabel.textContent = 'ئیمەیڵ';
      idInput.placeholder = 'admin@example.com';
      idInput.type = 'email';
    }
    hideError();
    idInput.value = '';
    pwInput.value = '';
  }

  empTab.addEventListener('click', () => setMode('employee'));
  adminTab.addEventListener('click', () => setMode('admin'));

  // ── Submit handler ──
  async function handleSubmit() {
    const id = idInput.value.trim();
    const pw = pwInput.value;

    if (!id) { showError('تکایە ' + (mode === 'employee' ? 'کۆد' : 'ئیمەیڵ') + ' بنووسە'); return; }
    if (!pw) { showError('تکایە وشەی نهێنی بنووسە'); return; }

    setLoading(true);
    hideError();
    try {
      if (mode === 'admin') {
        await loginAdmin(id, pw);
      } else {
        await login(id, pw); // smart: detects code
      }
      // onAuthChange in app.js handles the rest
    } catch (err) {
      console.error('[SZR] Login error:', err);
      showError(authErrorMessage(err));
      setLoading(false);
    }
  }

  submitBtn.addEventListener('click', handleSubmit);
  pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });
  idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pwInput.focus(); });

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = '';
    if (loading) {
      submitBtn.appendChild(el('span.spinner.spinner--white'));
    } else {
      submitBtn.textContent = 'چوونەژوورەوە';
    }
  }
  function showError(msg) { errorBox.textContent = msg; errorBox.classList.add('show'); }
  function hideError() { errorBox.classList.remove('show'); }

  // ── Build the screen ──
  const screen = el('div.auth', {}, [
    el('div.auth__brand', {}, [
      el('div.auth__logo', {}, [el('img', { src: 'icons/icon-512-dark.png', alt: 'SZR' })]),
      el('div.auth__title', {}, 'SZR'),
      el('div.auth__subtitle', {}, 'سیستەمی بەڕێوەبردنی دەوام'),
    ]),
    el('div.auth__card', {}, [
      el('div.auth__toggle', {}, [empTab, adminTab]),
      errorBox,
      el('div.auth__field', {}, [idLabel, idInput]),
      el('div.auth__field', {}, [
        el('label', { for: 'login-pw' }, 'وشەی نهێنی'),
        el('div.password-field', {}, [pwInput, pwToggle]),
      ]),
      submitBtn,
    ]),
    el('div', { style: { textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--ink-faint)' } },
      'Shkoy Zawy Real Estate © 2026'),
  ]);

  setMode('employee');
  container.appendChild(screen);
}

// ── Icons ──
function eyeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
}
function eyeOffIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
}

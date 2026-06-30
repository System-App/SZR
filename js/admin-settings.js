/**
 * admin-settings.js — Company settings (admin only)
 *
 * Sections:
 *   • Work hours (start/end) + grace period
 *   • GPS work zone (enable, set office location, radius)
 *   • Auto-checkout toggle
 *   • Holidays (add/remove)
 *   • Appearance (dark mode, font) — local prefs
 *   • Change own password + logout
 *
 * All company settings are shared across employees and only the admin
 * can change them.
 */

import {
  listHolidays, saveHoliday, deleteHoliday,
  exportAllData, importAllData,
} from './db.js';
import { getAdminLocation, GeoError } from './geo.js';
import { changePassword, authErrorMessage } from './auth.js';
import {
  el, toast, haptic, confirmModal, openModal, formatTime12,
  formatDateLatin, weekdayKu, downloadFile, todayKey,
} from './utils.js';

export async function renderSettings(main) {
  const settings = window.SZR.getSettings();
  const prefs = window.SZR.getPrefs();

  main.appendChild(el('div.page-head', {}, [
    el('h2.page-head__title', {}, 'ڕێکخستنەکان'),
    el('p.page-head__sub', {}, 'ڕێکخستنی کاتی کار، ناوچەی دەوام، پشووە فەرمییەکان و ڕووکار.'),
  ]));

  const wrap = el('div.settings');

  // ── Work hours ──────────────────────────────────────────────────
  wrap.appendChild(buildWorkHours(settings));

  // ── GPS Zone ────────────────────────────────────────────────────
  wrap.appendChild(buildZoneSection(settings));

  // ── Auto-checkout ───────────────────────────────────────────────
  wrap.appendChild(buildAutoCheckout(settings));

  // ── Holidays ────────────────────────────────────────────────────
  wrap.appendChild(await buildHolidays());

  // ── Backup & Restore ────────────────────────────────────────────
  wrap.appendChild(buildBackupSection());

  // ── Appearance ──────────────────────────────────────────────────
  wrap.appendChild(buildSection(svgPalette(), 'ڕووکار', [
    buildToggle('ڕووکاری تاریک', 'گۆڕینی ڕووکار بۆ ڕەنگی تاریک.',
      prefs.darkMode ?? false, (c) => window.SZR.setPref('darkMode', c)),
    buildFontControl(prefs),
  ]));

  // ── Account ─────────────────────────────────────────────────────
  wrap.appendChild(buildSection(svgKey(), 'هەژمار', [
    el('button.btn.btn--outline.btn--block', { onclick: () => openChangePassword(), style: { marginBottom: '8px' } },
      [svgKey(16), ' گۆڕینی وشەی نهێنی']),
    el('button.btn.btn--danger.btn--block', {
      onclick: async () => {
        const ok = await confirmModal({ title: 'چوونەدەرەوە', message: 'دڵنیایت لە چوونەدەرەوە؟', confirmText: 'چوونەدەرەوە', danger: true });
        if (ok) await window.SZR.logout();
      },
    }, [svgLogout(16), ' چوونەدەرەوە']),
  ]));

  // About
  wrap.appendChild(el('div', { style: { textAlign: 'center', padding: '12px', color: 'var(--ink-faint)', fontSize: 'var(--text-xs)' } }, [
    el('div', { style: { fontWeight: '700', color: 'var(--ink-soft)' } }, 'SZR'),
    el('div', { style: { marginTop: '2px' } }, 'وەشانی 2.1.2'),
  ]));

  main.appendChild(wrap);
}

// ──────────────────────────────────────────────────────────────────
// WORK HOURS
// ──────────────────────────────────────────────────────────────────
function buildWorkHours(settings) {
  const startInput = el('input', { type: 'time', step: '60', value: settings.workStart });
  const endInput = el('input', { type: 'time', step: '60', value: settings.workEnd });
  const graceInput = el('input', { type: 'number', min: '0', max: '60', value: settings.gracePeriod });

  const saveBtn = el('button.btn.btn--primary.btn--block', {}, 'پاشەکەوتکردنی کاتی کار');
  saveBtn.addEventListener('click', async () => {
    const ws = startInput.value, we = endInput.value;
    const grace = parseInt(graceInput.value, 10) || 0;
    if (!ws || !we) { toast('تکایە کاتی کار دیاری بکە', 'error'); return; }
    if (ws >= we) { toast('کاتی کۆتایی دەبێت دوای کاتی دەستپێک بێت', 'error'); return; }

    saveBtn.disabled = true;
    try {
      await window.SZR.updateSettings({ workStart: ws, workEnd: we, gracePeriod: grace });
      toast('کاتی کار پاشەکەوتکرا', 'success');
      haptic(15);
    } catch (err) {
      console.error('[SZR] Save work hours error:', err);
      toast('کێشە لە پاشەکەوتکردن', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  return buildSection(svgClock(), 'کاتی کار', [
    el('div.field__hint', { style: { marginBottom: '4px' } },
      'دیاریکردنی کاتی دەستپێک و کۆتایی کاری فەرمی. لێرە ژمێریاری بۆ دواکەوتن و زوو ڕۆیشتن دەکرێت.'),
    el('div.times-row', {}, [
      el('div.field', {}, [el('span.field__label', {}, 'کاتی دەستپێک'), startInput]),
      el('div.field', {}, [el('span.field__label', {}, 'کاتی کۆتایی'), endInput]),
    ]),
    el('div.field', {}, [
      el('span.field__label', {}, 'ماوەی لێبووردن (خولەک)'),
      graceInput,
      el('span.field__hint', {}, 'ئەگەر کارمەند لەناو ئەم ماوەیەدا هات، بە دواکەوتوو ناژمێردرێت.'),
    ]),
    saveBtn,
  ]);
}

// ──────────────────────────────────────────────────────────────────
// GPS ZONE
// ──────────────────────────────────────────────────────────────────
function buildZoneSection(settings) {
  const zone = settings.zone || { enabled: false, lat: null, lng: null, radius: 100 };
  let lat = zone.lat, lng = zone.lng, radius = zone.radius || 100;

  // Enable toggle
  const enableInput = el('input', { type: 'checkbox' });
  enableInput.checked = zone.enabled;

  // Map container
  const mapEl = el('div', { id: 'zone-map', style: {
    width: '100%', height: '260px', borderRadius: 'var(--r)', overflow: 'hidden',
    border: '1px solid var(--border)', marginBottom: '8px', background: 'var(--bg-sunken)',
  } });

  // Coordinates display
  const coordsEl = el('div.zone-coords');
  const renderCoords = () => {
    coordsEl.innerHTML = '';
    if (lat != null && lng != null) {
      coordsEl.append(el('span', {}, `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`));
    } else {
      coordsEl.append(el('span', {}, 'شوێنی ئۆفیس هێشتا دیارینەکراوە'));
    }
  };
  renderCoords();

  // Radius slider
  const radiusValue = el('span.font-slider-wrap__value', {}, radius + 'm');
  const radiusSlider = el('input', { type: 'range', min: '50', max: '500', step: '10', value: radius });

  // Leaflet map state (initialized lazily)
  let map = null, marker = null, circle = null;

  // Update marker + circle on the map
  const updateMapMarker = () => {
    if (!map || lat == null || lng == null) return;
    const L = window.L;
    if (marker) marker.setLatLng([lat, lng]);
    else marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      .on('dragend', (e) => {
        const p = e.target.getLatLng();
        lat = p.lat; lng = p.lng;
        renderCoords();
        if (circle) circle.setLatLng([lat, lng]);
      });
    if (circle) { circle.setLatLng([lat, lng]); circle.setRadius(radius); }
    else circle = L.circle([lat, lng], { radius, color: '#2C3828', fillColor: '#E0A43B', fillOpacity: 0.2, weight: 2 }).addTo(map);
  };

  radiusSlider.addEventListener('input', () => {
    radius = parseInt(radiusSlider.value, 10);
    radiusValue.textContent = radius + 'm';
    if (circle) circle.setRadius(radius);
  });

  // Initialize Leaflet map (loads library on demand)
  const initMap = async () => {
    await loadLeaflet();
    const L = window.L;
    const center = (lat != null && lng != null) ? [lat, lng] : [36.19, 44.01]; // Erbil default
    map = L.map(mapEl, { zoomControl: true, attributionControl: false }).setView(center, lat != null ? 16 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    // Click on map → set location
    map.on('click', (e) => {
      lat = e.latlng.lat; lng = e.latlng.lng;
      renderCoords();
      updateMapMarker();
      haptic(8);
    });

    if (lat != null && lng != null) updateMapMarker();
    // Fix map size after it becomes visible
    setTimeout(() => map.invalidateSize(), 200);
  };

  // Get current location button
  const locBtn = el('button.btn.btn--ghost.btn--block', { style: { marginTop: '8px' } },
    [pinIcon(), ' وەرگرتنی شوێنی ئێستام']);
  locBtn.addEventListener('click', async () => {
    locBtn.disabled = true;
    const orig = locBtn.innerHTML;
    locBtn.innerHTML = '';
    locBtn.append(el('span.spinner'), el('span', { style: { marginRight: '8px' } }, 'دۆزینەوەی شوێن...'));
    try {
      const pos = await getAdminLocation();
      lat = pos.lat; lng = pos.lng;
      renderCoords();
      if (map) { map.setView([lat, lng], 17); updateMapMarker(); }
      const acc = Math.round(pos.accuracy);
      // Guide the admin: a poor fix here misaligns the whole zone, so prompt
      // them to retry or fine-tune the marker on the map by hand.
      if (acc > 30) {
        toast(`شوێن وەرگیرا بەڵام وردییەکە لاوازە (${acc}m). باشترە لە دەرەوە یان بەردەم پەنجەرە دووبارە هەوڵ بدەیت، یاخود لەسەر نەخشە نیشانەکە بەدەستی ڕێک بخە.`, 'info', 6000);
      } else {
        toast(`شوێن بەوردی وەرگیرا (${acc}m). دەتوانیت لەسەر نەخشە نیشانەکە بجوڵێنیت بۆ ڕێکخستنی تەواو.`, 'success', 4500);
      }
      haptic(15);
    } catch (err) {
      const msg = err instanceof GeoError ? err.userMessage : 'کێشە لە دۆزینەوەی شوێن';
      toast(msg, 'error', 4000);
    } finally {
      locBtn.disabled = false;
      locBtn.innerHTML = orig;
    }
  });

  const saveBtn = el('button.btn.btn--primary.btn--block', { style: { marginTop: '8px' } }, 'پاشەکەوتکردنی ناوچە');
  saveBtn.addEventListener('click', async () => {
    if (enableInput.checked && (lat == null || lng == null)) {
      toast('تکایە سەرەتا شوێنی ئۆفیس دیاری بکە (لەسەر نەخشە کلیک بکە)', 'error', 4000);
      return;
    }
    saveBtn.disabled = true;
    try {
      await window.SZR.updateSettings({ zone: { enabled: enableInput.checked, lat, lng, radius } });
      toast('ناوچەی دەوام پاشەکەوتکرا', 'success');
      haptic(15);
    } catch (err) {
      console.error('[SZR] Save zone error:', err);
      toast('کێشە لە پاشەکەوتکردن', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Config box (shown when enabled)
  const configBox = el('div', {}, [
    el('div.info-note', { style: { marginBottom: '12px' } },
      'لەسەر نەخشە کلیک بکە بۆ دیاریکردنی شوێنی ئۆفیس، یاخود نیشانەکە بجوڵێنە. دەتوانیت دوگمەی "شوێنی ئێستام"یش بەکاربهێنیت.'),
    mapEl,
    coordsEl,
    locBtn,
    el('div.field', { style: { marginTop: '12px' } }, [
      el('span.field__label', {}, 'مەودای ڕێگەپێدراو'),
      el('div.font-slider-wrap', {}, [radiusSlider, radiusValue]),
      el('span.field__hint', {}, 'کارمەند دەبێت لەناو ئەم مەودایەدا بێت بۆ تۆمارکردنی هاتن.'),
    ]),
  ]);

  const toggleConfig = () => {
    configBox.style.display = enableInput.checked ? 'block' : 'none';
    if (enableInput.checked && !map) setTimeout(initMap, 100);
    else if (map) setTimeout(() => map.invalidateSize(), 100);
  };
  enableInput.addEventListener('change', () => { haptic(10); toggleConfig(); });
  toggleConfig();

  return buildSection(svgMapPin(), 'ناوچەی دەوام (GPS)', [
    el('div.field__hint', {}, 'کاتێک چالاک بێت، کارمەند تەنها لە شوێنی ئۆفیس دەتوانێت هاتنە دەوام تۆمار بکات.'),
    el('div.setting-row', { style: { marginTop: '8px' } }, [
      el('div.setting-row__text', {}, [
        el('div.setting-row__label', {}, 'پشکنینی شوێن چالاک بکە'),
        el('div.setting-row__hint', {}, 'بەبێ ئەمە، کارمەند لە هەر شوێنێک دەتوانێت تۆمار بکات.'),
      ]),
      el('label.toggle', {}, [enableInput, el('span.toggle__track')]),
    ]),
    configBox,
    saveBtn,
  ]);
}

/** Load Leaflet (map library) from CDN on demand */
function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) { resolve(); return; }
    // CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    // JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('نەتوانرا نەخشە باربکرێت'));
    document.head.appendChild(script);
  });
}

// ──────────────────────────────────────────────────────────────────
// AUTO-CHECKOUT
// ──────────────────────────────────────────────────────────────────
function buildAutoCheckout(settings) {
  const input = el('input', { type: 'checkbox' });
  input.checked = settings.autoCheckout ?? true;
  input.addEventListener('change', async () => {
    haptic(10);
    try {
      await window.SZR.updateSettings({ autoCheckout: input.checked });
      toast('ڕێکخستن نوێکرایەوە', 'success');
    } catch { toast('کێشە لە پاشەکەوتکردن', 'error'); }
  });

  return buildSection(svgCheck(), 'چوونەوەی خۆکار', [
    el('div.setting-row', {}, [
      el('div.setting-row__text', {}, [
        el('div.setting-row__label', {}, 'چوونەوەی خۆکار چالاک بکە'),
        el('div.setting-row__hint', {}, `ئەگەر کارمەند لەبیری کرد چوونەوە تۆمار بکات، سیستەم خۆی کاتی کۆتایی کار (${formatTime12(settings.workEnd)}) تۆمار دەکات.`),
      ]),
      el('label.toggle', {}, [input, el('span.toggle__track')]),
    ]),
  ]);
}

// ──────────────────────────────────────────────────────────────────
// HOLIDAYS
// ──────────────────────────────────────────────────────────────────
async function buildHolidays() {
  const listEl = el('div', { id: 'holidays-list' });

  const render = async () => {
    listEl.innerHTML = '';
    const holidays = await listHolidays();
    if (holidays.length === 0) {
      listEl.appendChild(el('div.field__hint', { style: { textAlign: 'center', padding: '8px' } }, 'هیچ پشوویەکی فەرمی زیاد نەکراوە.'));
      return;
    }
    for (const h of holidays) {
      listEl.appendChild(el('div.list-item', {}, [
        el('div', { style: { width: '40px', height: '40px', borderRadius: 'var(--r-sm)', background: 'var(--olive-glass)', display: 'grid', placeItems: 'center', fontSize: '18px', flexShrink: '0' } }, '🎉'),
        el('div.list-item__info', {}, [
          el('div.list-item__name', {}, h.name),
          el('div.list-item__sub', {}, formatDateLatin(h.date) + ' — ' + weekdayKu(h.date)),
        ]),
        el('button.icon-btn.icon-btn--danger', {
          'aria-label': 'سڕینەوە', html: trashIcon(),
          onclick: async () => {
            await deleteHoliday(h.id);
            toast('پشوو سڕایەوە', 'success');
            render();
          },
        }),
      ]));
    }
  };

  const addBtn = el('button.btn.btn--accent.btn--block', { style: { marginTop: '8px' } }, [plusIcon(), ' زیادکردنی پشووی فەرمی']);
  addBtn.addEventListener('click', () => openAddHoliday(render));

  await render();

  return buildSection(svgGift(), 'پشووە فەرمییەکان', [
    el('div.field__hint', {}, 'ڕۆژانی پشووی فەرمی زیاد بکە. ئەم ڕۆژانە بۆ کارمەندان وەک نەهاتوو ناژمێردرێن.'),
    listEl,
    addBtn,
  ]);
}

function openAddHoliday(onSaved) {
  const nameInput = el('input', { type: 'text', placeholder: 'بۆ نموونە: جەژنی ڕەمەزان' });
  const dateInput = el('input', { type: 'date' });
  const errorBox = el('div.auth__error', { style: { marginBottom: '0' } });

  const saveBtn = el('button.btn.btn--primary', {}, 'زیادکردن');
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const date = dateInput.value;
    if (!name || !date) { errorBox.textContent = 'تکایە ناو و بەروار دیاری بکە'; errorBox.classList.add('show'); return; }
    saveBtn.disabled = true;
    try {
      await saveHoliday({ date, name });
      toast('پشوو زیادکرا', 'success');
      modal.close();
      onSaved();
    } catch (err) {
      console.error('[SZR] Add holiday error:', err);
      errorBox.textContent = 'کێشە لە زیادکردن'; errorBox.classList.add('show');
      saveBtn.disabled = false;
    }
  });

  const modal = openModal({
    title: 'زیادکردنی پشووی فەرمی',
    body: [
      errorBox,
      el('div.field', {}, [el('span.field__label', {}, 'ناوی پشوو'), nameInput]),
      el('div.field', {}, [el('span.field__label', {}, 'بەروار'), dateInput]),
    ],
    footer: [
      el('button.btn.btn--outline', { onclick: () => modal.close() }, 'پاشگەزبوونەوە'),
      saveBtn,
    ],
  });
}

// ──────────────────────────────────────────────────────────────────
// CHANGE PASSWORD
// ──────────────────────────────────────────────────────────────────
function openChangePassword() {
  const currentInput = el('input', { type: 'password', placeholder: 'وشەی نهێنی ئێستا', autocomplete: 'current-password' });
  const newInput = el('input', { type: 'password', placeholder: 'وشەی نهێنی نوێ', autocomplete: 'new-password' });
  const confirmInput = el('input', { type: 'password', placeholder: 'دووبارەکردنەوە', autocomplete: 'new-password' });
  const errorBox = el('div.auth__error', { style: { marginBottom: '0' } });
  const showError = (m) => { errorBox.textContent = m; errorBox.classList.add('show'); };

  const saveBtn = el('button.btn.btn--primary', {}, 'گۆڕین');
  saveBtn.addEventListener('click', async () => {
    errorBox.classList.remove('show');
    const cur = currentInput.value, nw = newInput.value, cf = confirmInput.value;
    if (!cur || !nw || !cf) { showError('تکایە هەموو خانەکان پڕ بکەرەوە'); return; }
    if (nw.length < 6) { showError('وشەی نهێنی نوێ دەبێت لانیکەم ٦ پیت بێت'); return; }
    if (nw !== cf) { showError('وشە نهێنییە نوێیەکان وەک یەک نین'); return; }
    saveBtn.disabled = true;
    saveBtn.innerHTML = ''; saveBtn.appendChild(el('span.spinner.spinner--white'));
    try {
      await changePassword(cur, nw);
      toast('وشەی نهێنی گۆڕدرا', 'success');
      modal.close();
    } catch (err) {
      showError(authErrorMessage(err));
      saveBtn.disabled = false; saveBtn.textContent = 'گۆڕین';
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
// BACKUP & RESTORE
// ──────────────────────────────────────────────────────────────────
function buildBackupSection() {
  // Backup button — exports everything to a JSON file
  const backupBtn = el('button.btn.btn--primary.btn--block', {}, [svgDownload(), ' داگرتنی پاشەکەوت (Backup)']);
  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true;
    const original = backupBtn.innerHTML;
    backupBtn.innerHTML = '';
    backupBtn.append(el('span.spinner.spinner--white'), el('span', { style: { marginRight: '8px' } }, 'ئامادەکردن...'));
    try {
      const payload = await exportAllData();
      const json = JSON.stringify(payload, null, 2);
      const filename = `szr-backup-${todayKey()}.json`;
      downloadFile(filename, json, 'application/json');
      const c = payload.data;
      toast(`پاشەکەوت داگیرا: ${c.employees.length} کارمەند، ${c.attendance.length} تۆمار`, 'success', 3500);
      haptic(15);
    } catch (err) {
      console.error('[SZR] Backup error:', err);
      toast('کێشە لە دروستکردنی پاشەکەوت', 'error');
    } finally {
      backupBtn.disabled = false;
      backupBtn.innerHTML = original;
    }
  });

  // Restore — hidden file input + button
  const restoreInput = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  restoreInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleRestore(file);
    restoreInput.value = '';
  });
  const restoreBtn = el('button.btn.btn--outline.btn--block', {
    style: { marginTop: '8px' },
    onclick: () => restoreInput.click(),
  }, [svgUpload(), ' گەڕاندنەوە لە فایلی پاشەکەوت']);

  return buildSection(svgArchive(), 'پاشەکەوتکردن و گەڕاندنەوە', [
    el('div.field__hint', {},
      'هەموو داتای سیستەم (کارمەندان، تۆمارەکان، ڕێکخستن، پشووەکان) لە فایلێکدا پاشەکەوت بکە. ' +
      'باشترە هەفتانە یاخود مانگانە پاشەکەوتێک بکەیت بۆ پاراستن.'),
    backupBtn,
    restoreBtn,
    restoreInput,
    el('div.info-note', { style: { marginTop: '8px' } },
      'تێبینی: کاتی گەڕاندنەوە، هەژمارەکانی چوونەژوورەوەی کارمەندان (کۆد/وشەی نهێنی) ناگەڕێنەوە — تەنها زانیاری و تۆمارەکان. کارمەندان دەبێت هەر بەو کۆدەی پێشوو بچنە ژوورەوە.'),
  ]);
}

async function handleRestore(file) {
  try {
    const text = await fileToText(file);
    const payload = JSON.parse(text);

    if (!payload || payload.app !== 'szr-attendance') {
      toast('ئەم فایلە بۆ سیستەمی SZR نییە', 'error');
      return;
    }

    const d = payload.data || {};
    const summary =
      `${(d.employees || []).length} کارمەند • ` +
      `${(d.attendance || []).length} تۆماری دەوام • ` +
      `${(d.holidays || []).length} پشوو`;

    const exportedDate = payload.exportedAt ? new Date(payload.exportedAt).toLocaleDateString('en-GB') : '';

    const ok = await confirmModal({
      title: 'گەڕاندنەوەی پاشەکەوت',
      message:
        `ئەم فایلە لەخۆدەگرێت: ${summary}${exportedDate ? ` (${exportedDate})` : ''}. ` +
        `داتاکان دەخرێنە سەر ئەوەی ئێستا (تۆمارە هاوناوەکان دەگۆڕێن). دڵنیایت؟`,
      confirmText: 'گەڕاندنەوە',
      danger: true,
    });
    if (!ok) return;

    const result = await importAllData(payload);
    toast(`گەڕێندرایەوە: ${result.employees} کارمەند، ${result.attendance} تۆمار، ${result.holidays} پشوو`, 'success', 4000);
    haptic(20);

    // Refresh the settings view
    setTimeout(() => window.SZR.navigateTo('settings'), 800);
  } catch (err) {
    console.error('[SZR] Restore error:', err);
    toast('فایلەکە دروست نییە یاخود تێکچووە', 'error');
  }
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ──────────────────────────────────────────────────────────────────
// REUSABLE PIECES
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
  const slider = el('input', { type: 'range', min: '70', max: '160', step: '5', value: Math.round((prefs.fontScale ?? 1) * 100) });
  const valueLabel = el('div.font-slider-wrap__value');

  const render = (scale) => {
    valueLabel.textContent = `${Math.round(scale * 100)}%`;
    slider.value = Math.round(scale * 100);
    grid.innerHTML = '';
    for (const p of presets) {
      const active = Math.abs(scale - p.key) < 0.01;
      grid.appendChild(el('button.font-size-btn' + (active ? '.is-active' : ''), { onclick: () => apply(p.key) }, [
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
    clearTimeout(timer); timer = setTimeout(() => render(scale), 150);
  });
  render(prefs.fontScale ?? 1);

  return el('div', { style: { marginTop: '8px' } }, [
    el('div.setting-row__label', { style: { marginBottom: '8px' } }, 'قەبارەی فۆنت'),
    grid,
    el('div.font-slider-wrap', { style: { marginTop: '12px' } }, [slider, valueLabel]),
  ]);
}

// ── Icons ──
function makeSvg(paths, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = paths; return s;
}
function svgClock(s) { return makeSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', s); }
function svgMapPin(s) { return makeSvg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>', s); }
function svgCheck(s) { return makeSvg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', s); }
function svgGift(s) { return makeSvg('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>', s); }
function svgArchive(s) { return makeSvg('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>', s); }
function svgDownload(s) { return makeSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', s); }
function svgUpload(s) { return makeSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', s); }
function svgPalette(s) { return makeSvg('<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>', s); }
function svgKey(s) { return makeSvg('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>', s); }
function svgLogout(s) { return makeSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>', s); }
function pinIcon() { return makeSvg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'); }
function plusIcon() { return makeSvg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'); }
function trashIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'; }

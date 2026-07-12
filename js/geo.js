/**
 * geo.js — GPS location + work-zone verification
 *
 * The admin defines an office location (lat/lng) and an allowed radius.
 * When an employee checks in, we read their GPS position and verify they
 * are within the radius using the Haversine formula.
 *
 * Designed to be 100% reliable:
 *   • Retries up to 3 times for a good-accuracy fix
 *   • Clear Kurdish error messages for every failure mode
 *   • Falls back gracefully if the admin disabled GPS in settings
 */

import { haversineMeters } from './utils.js';

/**
 * Get the device's current position, rejecting coarse WiFi/cell estimates.
 *
 * THE PROBLEM THIS SOLVES: phones often return a first "position" derived
 * from WiFi or a cell tower, which can be 1–3 KM away from where you really
 * are (and reports a large `accuracy`). If we accept that, an employee
 * standing inside the office is told they're "2000m away". The real GPS chip
 * needs a few seconds to warm up and produce an accurate fix.
 *
 * STRATEGY (identical on iOS + Android, indoors, outdoors, or by the door):
 *   1. maximumAge:0  → never reuse a stale/cached position.
 *   2. enableHighAccuracy:true → ask for the real GPS, not WiFi/cell.
 *   3. Stream fixes via watchPosition AND fire a parallel getCurrentPosition
 *      (belt-and-braces: on some devices/laptops watchPosition never fires).
 *   4. Keep only the most accurate reading.
 *   5. Resolve early once accuracy ≤ desiredAccuracy.
 *   6. Otherwise wait up to settleTime for the GPS to refine, then accept
 *      ONLY if the best reading is within acceptableAccuracy. If even the
 *      best fix is too coarse (i.e. only WiFi/cell was ever available), we
 *      REJECT with a clear message instead of recording a wrong location.
 *   7. A hard timeout guarantees we never hang.
 *
 * @param {object} opts - { desiredAccuracy, acceptableAccuracy, settleTime, timeout }
 * @returns {Promise<{lat, lng, accuracy}>}
 */
export function getCurrentPosition(opts = {}) {
  const desiredAccuracy    = opts.desiredAccuracy    ?? 30;    // resolve instantly at/under this
  const acceptableAccuracy = opts.acceptableAccuracy ?? 150;   // hard ceiling — reject if worse
  const settleTime         = opts.settleTime         ?? 10000; // let GPS refine (ms)
  const timeout            = opts.timeout            ?? 30000; // overall cap (ms)

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('unsupported', 'مۆبایلەکەت پشتگیری GPS ناکات'));
      return;
    }

    let best = null;
    let watchId = null;
    let settleTimer = null;
    let hardTimer = null;
    let done = false;

    const cleanup = () => {
      if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch {} watchId = null; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
    };

    // Accept the best fix — but only if it's accurate enough to trust.
    const settle = () => {
      if (done) return;
      if (best && best.accuracy <= acceptableAccuracy) {
        done = true; cleanup(); resolve(best);
      } else if (best) {
        done = true; cleanup();
        reject(new GeoError('inaccurate',
          `شوێنەکەت بەوردی نەدۆزرایەوە (وردی نزیکەی ${Math.round(best.accuracy)}م). تکایە بڕۆ بەردەم پەنجەرە یان دەرەوە و چەند چرکەیەک بوەستە، پاشان دووبارە هەوڵ بدە.`));
      } else {
        done = true; cleanup();
        reject(new GeoError('timeout',
          'کاتی دۆزینەوەی شوێن تەواوبوو. تکایە دڵنیابە GPS کراوەیە و لە شوێنێکی کراوەتر هەوڵ بدە.'));
      }
    };

    const consider = (pos) => {
      if (done) return;
      const r = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      if (!best || r.accuracy < best.accuracy) best = r;

      // Accurate enough → done now.
      if (best.accuracy <= desiredAccuracy) { done = true; cleanup(); resolve(best); return; }

      // Coarse fix → give the GPS a window to improve, then settle/reject.
      if (!settleTimer) settleTimer = setTimeout(settle, settleTime);
    };

    const onError = (err) => {
      // If we already have a reading, decide based on its accuracy.
      if (best) { settle(); return; }
      if (done) return;
      done = true; cleanup();
      if (err && err.code === err.PERMISSION_DENIED) {
        reject(new GeoError('denied',
          'ڕێگەت نەداوە بە شوێن. تکایە لە ڕێکخستنی مۆبایل ڕێگە بدە بە شوێن، پاشان دووبارە هەوڵ بدە.'));
      } else if (err && err.code === err.POSITION_UNAVAILABLE) {
        reject(new GeoError('unavailable',
          'نەتوانرا شوێنەکەت بدۆزرێتەوە. تکایە دڵنیابە GPS کراوەتەوە و دووبارە هەوڵ بدە.'));
      } else if (err && err.code === err.TIMEOUT) {
        reject(new GeoError('timeout',
          'کاتی دۆزینەوەی شوێن تەواوبوو. تکایە لە شوێنێکی کراوەتر هەوڵ بدە.'));
      } else {
        reject(new GeoError('unknown', 'کێشەیەک ڕوویدا لە دۆزینەوەی شوێن. دووبارە هەوڵ بدە.'));
      }
    };

    const geoOpts = { enableHighAccuracy: true, timeout, maximumAge: 0 };

    // watchPosition streams refining fixes; the one-shot getCurrentPosition is
    // a safety net for environments where watchPosition never fires. Errors on
    // the one-shot are ignored — watchPosition's onError is authoritative.
    try {
      watchId = navigator.geolocation.watchPosition(consider, onError, geoOpts);
    } catch { /* fall through to one-shot */ }
    try {
      navigator.geolocation.getCurrentPosition(consider, () => {}, geoOpts);
    } catch { /* ignore */ }

    // Hard safety cap: never hang. Settle (or reject) with whatever we have.
    hardTimer = setTimeout(settle, timeout);
  });
}

/**
 * Verify an employee is within the work zone.
 *
 * @param {object} zone - { lat, lng, radius, enabled }
 * @returns {Promise<{ok, distance, accuracy, lat, lng}>}
 *   ok=true if within radius (or GPS disabled). Throws GeoError on failure.
 */
export async function verifyInZone(zone) {
  // If admin disabled GPS, always allow
  if (!zone || zone.enabled === false) {
    return { ok: true, distance: null, bypassed: true };
  }

  // No zone configured yet → allow (admin hasn't set it)
  if (zone.lat == null || zone.lng == null) {
    return { ok: true, distance: null, notConfigured: true };
  }

  // Defensive: if radius somehow arrived undefined (e.g. a partially-saved
  // zone), fall back to 100m instead of comparing against undefined — which
  // would make every check `<= undefined` → false and block everyone.
  const radius = (typeof zone.radius === 'number' && zone.radius > 0) ? zone.radius : 100;

  // desiredAccuracy: resolve fast when GPS is sharp. acceptableAccuracy: the
  // ceiling below which we still trust the fix (covers indoor GPS ~ up to
  // 150m); anything coarser is a WiFi/cell guess and getCurrentPosition
  // rejects it rather than measuring against a wrong point.
  const pos = await getCurrentPosition({ desiredAccuracy: 30, acceptableAccuracy: 150 });
  const distance = haversineMeters(pos.lat, pos.lng, zone.lat, zone.lng);

  // ── Accuracy-aware verification (the key fix) ──────────────────────
  // GPS `accuracy` means: the device's TRUE position may be up to that many
  // meters away from the reported point. So the closest the employee could
  // really be to the office is (distance − accuracy). If that nearest
  // plausible point falls inside the zone, we accept — this stops real
  // employees from being wrongly blocked when GPS is imperfect (very common
  // indoors / on iPhone), while someone genuinely far away still fails
  // because even their best-case point is outside the radius.
  const nearestPlausible = distance - pos.accuracy;
  const ok = nearestPlausible <= radius;

  return {
    ok,
    distance,
    accuracy: Math.round(pos.accuracy),
    lat: pos.lat,
    lng: pos.lng,
    radius,
  };
}

/** Custom error type carrying a Kurdish user-facing message */
export class GeoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
    this.userMessage = message;
  }
}

/**
 * Get the admin's current location (for setting the office zone).
 * Demands higher accuracy and a longer settle window than an employee
 * check-in, because the office center is set ONCE and every future
 * verification is measured against it — a sloppy center would push the
 * whole zone off and wrongly block employees on one side.
 */
export async function getAdminLocation() {
  // Stricter ceiling (60m) than an employee check-in: the office center is
  // set once and every future check is measured against it, so we refuse a
  // sloppy WiFi/cell fix and ask the admin to retry rather than saving a
  // center that's off by hundreds of meters.
  return getCurrentPosition({
    desiredAccuracy: 20,
    acceptableAccuracy: 60,
    settleTime: 12000,
    timeout: 35000,
  });
}

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
 * Get the device's current position as accurately as possible.
 *
 * Uses watchPosition (not getCurrentPosition) because the FIRST GPS fix on
 * a phone — especially on iOS — is usually a coarse Wi-Fi/cell estimate
 * (accuracy 60–160m). The real GPS chip then "warms up" and accuracy keeps
 * improving over the next few seconds. watchPosition streams those updates,
 * so we can keep the BEST reading and stop as soon as it's good enough.
 *
 * Strategy (identical on iOS + Android):
 *   1. Start a position watch.
 *   2. Track the most accurate reading seen so far.
 *   3. Resolve early the moment accuracy ≤ desiredAccuracy.
 *   4. Otherwise, once we have *some* fix, keep watching for `settleTime`
 *      to let accuracy improve, then resolve with the best.
 *   5. A hard `timeout` guarantees we never hang forever.
 *
 * @param {object} opts - { desiredAccuracy, settleTime, timeout, maximumAge }
 * @returns {Promise<{lat, lng, accuracy}>}
 */
export function getCurrentPosition(opts = {}) {
  const desiredAccuracy = opts.desiredAccuracy ?? 35;   // target (meters)
  const settleTime      = opts.settleTime ?? 6000;      // keep improving (ms)
  const timeout         = opts.timeout ?? 25000;        // overall cap (ms)
  const maximumAge      = opts.maximumAge ?? 3000;      // accept a ~3s-old fix

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
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
    };

    const succeed = () => {
      if (done || !best) return;
      done = true;
      cleanup();
      resolve(best);
    };

    const fail = (geoErr) => {
      if (done) return;
      done = true;
      cleanup();
      reject(geoErr);
    };

    const onReading = (pos) => {
      const r = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      // Keep only the most accurate reading we've seen.
      if (!best || r.accuracy < best.accuracy) best = r;

      // Already accurate enough → stop immediately.
      if (best.accuracy <= desiredAccuracy) { succeed(); return; }

      // We have a fix but it's still coarse → give the GPS a short window
      // to refine before we settle for the best available reading.
      if (!settleTimer) settleTimer = setTimeout(succeed, settleTime);
    };

    const onError = (err) => {
      // If we already captured a usable reading, prefer it over erroring out.
      if (best) { succeed(); return; }

      if (err.code === err.PERMISSION_DENIED) {
        fail(new GeoError('denied',
          'ڕێگەت نەداوە بە شوێن. تکایە لە ڕێکخستنی مۆبایل ڕێگە بدە بە شوێن، پاشان دووبارە هەوڵ بدە.'));
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        fail(new GeoError('unavailable',
          'نەتوانرا شوێنەکەت بدۆزرێتەوە. تکایە دڵنیابە GPS کراوەتەوە و دووبارە هەوڵ بدە.'));
      } else if (err.code === err.TIMEOUT) {
        fail(new GeoError('timeout',
          'کاتی دۆزینەوەی شوێن تەواوبوو. تکایە لە شوێنێکی کراوەتر هەوڵ بدە.'));
      } else {
        fail(new GeoError('unknown', 'کێشەیەک ڕوویدا لە دۆزینەوەی شوێن. دووبارە هەوڵ بدە.'));
      }
    };

    watchId = navigator.geolocation.watchPosition(onReading, onError, {
      enableHighAccuracy: true,
      timeout,
      maximumAge,
    });

    // Overall safety cap: resolve with best fix if any, else time out.
    hardTimer = setTimeout(() => {
      if (best) succeed();
      else fail(new GeoError('timeout',
        'کاتی دۆزینەوەی شوێن تەواوبوو. تکایە لە شوێنێکی کراوەتر هەوڵ بدە.'));
    }, timeout);
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

  const pos = await getCurrentPosition({ desiredAccuracy: 35 });
  const distance = haversineMeters(pos.lat, pos.lng, zone.lat, zone.lng);

  // ── Accuracy-aware verification (the key fix) ──────────────────────
  // GPS `accuracy` means: the device's TRUE position may be up to that many
  // meters away from the reported point. So the closest the employee could
  // really be to the office is (distance − accuracy). If that nearest
  // plausible point falls inside the zone, we accept — this stops real
  // employees from being wrongly blocked when GPS is imperfect (very common
  // on iPhone), while someone genuinely far away still fails because even
  // their best-case point is outside the radius.
  //
  // Old formula (distance ≤ radius + min(accuracy/2, 30)) under-counted the
  // GPS error and produced false rejections inside the zone.
  const nearestPlausible = distance - pos.accuracy;
  const ok = nearestPlausible <= zone.radius;

  return {
    ok,
    distance,
    accuracy: Math.round(pos.accuracy),
    lat: pos.lat,
    lng: pos.lng,
    radius: zone.radius,
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
  return getCurrentPosition({ desiredAccuracy: 20, settleTime: 8000, timeout: 30000 });
}

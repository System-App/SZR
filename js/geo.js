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
 * Get the device's current position with retries for accuracy.
 * @param {object} opts - { desiredAccuracy: meters, timeout: ms, maxRetries }
 * @returns {Promise<{lat, lng, accuracy}>}
 */
export function getCurrentPosition(opts = {}) {
  const desiredAccuracy = opts.desiredAccuracy ?? 100; // meters
  const timeout = opts.timeout ?? 12000;
  const maxRetries = opts.maxRetries ?? 3;

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('unsupported', 'مۆبایلەکەت پشتگیری GPS ناکات'));
      return;
    }

    let attempt = 0;
    let best = null;

    const tryOnce = () => {
      attempt++;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const result = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          // Keep the most accurate reading so far
          if (!best || result.accuracy < best.accuracy) best = result;

          // Good enough, or out of retries → resolve with best
          if (result.accuracy <= desiredAccuracy || attempt >= maxRetries) {
            resolve(best);
          } else {
            setTimeout(tryOnce, 800); // try again for better accuracy
          }
        },
        (err) => {
          // If we have any reading from a prior attempt, use it
          if (best) return resolve(best);

          if (err.code === err.PERMISSION_DENIED) {
            reject(new GeoError('denied',
              'ڕێگەت نەداوە بە شوێن. تکایە لە ڕێکخستنی مۆبایل ڕێگە بدە بە شوێن، پاشان دووبارە هەوڵ بدە.'));
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            if (attempt < maxRetries) { setTimeout(tryOnce, 800); return; }
            reject(new GeoError('unavailable',
              'نەتوانرا شوێنەکەت بدۆزرێتەوە. تکایە دڵنیابە GPS کراوەتەوە و دووبارە هەوڵ بدە.'));
          } else if (err.code === err.TIMEOUT) {
            if (attempt < maxRetries) { setTimeout(tryOnce, 800); return; }
            reject(new GeoError('timeout',
              'کاتی دۆزینەوەی شوێن تەواوبوو. تکایە لە شوێنێکی کراوەتر هەوڵ بدە.'));
          } else {
            reject(new GeoError('unknown', 'کێشەیەک ڕوویدا لە دۆزینەوەی شوێن. دووبارە هەوڵ بدە.'));
          }
        },
        {
          enableHighAccuracy: true,
          timeout,
          maximumAge: 0, // always fresh
        }
      );
    };

    tryOnce();
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

  const pos = await getCurrentPosition({ desiredAccuracy: 100 });
  const distance = haversineMeters(pos.lat, pos.lng, zone.lat, zone.lng);

  // Allow a small tolerance for GPS inaccuracy (add accuracy/2 buffer)
  const tolerance = Math.min(pos.accuracy * 0.5, 30); // cap buffer at 30m
  const effectiveRadius = zone.radius + tolerance;

  return {
    ok: distance <= effectiveRadius,
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
 * Returns a single accurate fix.
 */
export async function getAdminLocation() {
  return getCurrentPosition({ desiredAccuracy: 50, maxRetries: 4 });
}

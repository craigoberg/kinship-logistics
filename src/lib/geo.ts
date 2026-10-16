// Haversine distance between two lat/lng coords, in kilometers.
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeoFailReason = "denied" | "unavailable" | "timeout" | "unsupported";

export type GeoAttempt =
  | { ok: true; pos: LatLng }
  | { ok: false; reason: GeoFailReason; message: string };

function failReasonFromCode(code: number): GeoFailReason {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/** Attempt GPS. Never throws — Manifest must still depart/arrive if the phone says no. */
export function tryGetCurrentPosition(options?: PositionOptions): Promise<GeoAttempt> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({
        ok: false,
        reason: "unsupported",
        message: "Geolocation is not available on this device.",
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          pos: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }),
      (err) =>
        resolve({
          ok: false,
          reason: failReasonFromCode(err.code),
          message: err.message || "Unable to read GPS location.",
        }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0, ...options },
    );
  });
}

export function getCurrentPosition(options?: PositionOptions): Promise<LatLng> {
  return tryGetCurrentPosition(options).then((attempt) => {
    if (attempt.ok) return attempt.pos;
    throw new Error(attempt.message);
  });
}

function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function iosBrowserName(): "Chrome" | "Safari" {
  if (typeof navigator !== "undefined" && /CriOS/.test(navigator.userAgent)) return "Chrome";
  return "Safari";
}

/** Operator copy when Manifest continues without a GPS stamp (GUARDRAILS §1.1). */
export function manifestGpsFallbackToast(
  fail: Extract<GeoAttempt, { ok: false }>,
  mode: "start" | "end",
): { title: string; description: string } {
  const title = mode === "start" ? "Departed without GPS" : "Arrived without GPS";
  const ios = isIosBrowser();
  const app = iosBrowserName();
  const iphoneAllow = `On iPhone: Settings → Privacy & Security → Location Services (On) → ${app} → While Using. Then reload this page.`;

  if (fail.reason === "denied") {
    return {
      title,
      description: ios
        ? `${iphoneAllow} If you tapped Don’t Allow, the phone will not ask again. You can keep driving — GPS stays blank until then.`
        : "This browser blocked location. Allow location for this site, then reload. You can keep driving — GPS stays blank until then.",
    };
  }
  if (fail.reason === "timeout") {
    return {
      title,
      description: ios
        ? "No fix in time. You can keep driving. Check Location Services is On, or try again with a clearer sky at the next stop."
        : "No GPS fix in time. You can keep driving. Try again at the next stop.",
    };
  }
  return {
    title,
    description: ios
      ? `Location is not available. You can keep driving. ${iphoneAllow}`
      : "Location is not available. You can keep driving. Allow location and reload if you want GPS on the next stop.",
  };
}

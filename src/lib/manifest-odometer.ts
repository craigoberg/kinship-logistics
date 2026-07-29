/**
 * Manifest odometer helpers (BL-096).
 * Legs stay as distance km; Close Run suggests start + Σ logged.
 */

/** Suggested ending absolute odometer (whole km). */
export function suggestedEndOdometer(
  startKm: number,
  totalLoggedKm: number,
): number {
  if (!Number.isFinite(startKm) || !Number.isFinite(totalLoggedKm)) return startKm;
  return Math.round(startKm + Math.max(0, totalLoggedKm));
}

/** True when |a − b| ≥ threshold (threshold ≤ 0 disables). */
export function absDiffExceeds(
  a: number,
  b: number,
  thresholdKm: number,
): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (!Number.isFinite(thresholdKm) || thresholdKm <= 0) return false;
  return Math.abs(a - b) >= thresholdKm;
}

export const ODO_PARAM_KEYS = {
  legGpsWarn: "manifest.odo_leg_gps_warn_km",
  closeSuggestWarn: "manifest.odo_close_suggest_warn_km",
  startVsLastWarn: "manifest.odo_start_vs_last_warn_km",
} as const;

export const ODO_PARAM_DEFAULTS = {
  legGpsWarnKm: 3,
  closeSuggestWarnKm: 5,
  startVsLastWarnKm: 20,
} as const;

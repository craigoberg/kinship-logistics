/**
 * Manifest odometer helpers.
 * The driver records the dash reading at the start of the trip and again
 * at Close Run. Stops do not store kilometres. Travelled km = end − start.
 */

/** Kilometres travelled from two odometer readings. Null when end is below start. */
export function tripDistanceKm(startKm: number, endKm: number): number | null {
  if (!Number.isFinite(startKm) || !Number.isFinite(endKm)) return null;
  if (endKm < startKm) return null;
  return Math.round((endKm - startKm) * 10) / 10;
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
  /** Retained in system_parameters. Close Run no longer suggests an ending reading. */
  closeSuggestWarn: "manifest.odo_close_suggest_warn_km",
  startVsLastWarn: "manifest.odo_start_vs_last_warn_km",
} as const;

export const ODO_PARAM_DEFAULTS = {
  closeSuggestWarnKm: 5,
  startVsLastWarnKm: 20,
} as const;

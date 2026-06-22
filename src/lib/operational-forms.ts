// Schema-driven operational form definitions.
// A single source of truth for the dynamic operational forms (pre-trip
// walkaround, post-event handover, etc.) consumed by
// `DynamicOperationalForm`.

export interface CriticalGate {
  /** Stable id — also used as the `gate_id` on any escalation row. */
  id: string;
  /** Descriptive check text displayed inside the wide tap-banner. */
  label: string;
}

export interface OperationalSchema {
  /** e.g. 'pre-trip', 'post-event' */
  id: string;
  /** Main header text */
  title: string;
  /** Sub-header text */
  description: string;
  /** Context block above the issue accumulator */
  infoBannerText: string;
  /** Optional array of critical human checks (gate banners). */
  criticalGates?: CriticalGate[];
  /** Text on the big primary footer action button */
  primaryActionText: string;
}

/** Canonical pre-trip schema mounted by `manifest.tsx`.
 *
 * NOTE: the passenger-manifest critical gate has been intentionally removed.
 * At walkaround time the driver does NOT yet know the manifest — manifest
 * verification happens later, after trip selection, via `EventPickAndStart`
 * and `getTodayManifestSummary`. Pre-trip is a pure vehicle safety inspection
 * using the Green / Yellow / Red issue framework. */
export const PRE_TRIP_SCHEMA: OperationalSchema = {
  id: "pre-trip",
  title: "Pre-Trip Vehicle Safety Inspection",
  description:
    "Visually inspect the vehicle. Log any faults below as Green (note), Yellow (workaround) or Red (manager escalation) before you accept the bus.",
  infoBannerText:
    "Inspect the bus you are checking out. Raise anything you see — Green is a logged note, Yellow is a workaround you are happy to proceed with, Red requires Manager dual sign-off before dispatch.",
  criticalGates: [],
  primaryActionText: "Accept Bus & Continue to Trip Selection",
};

/** Human-friendly translation of the `gate_id` column on `operational_escalations`. */
export function prettyGateLabel(gateId: string): string {
  const map: Record<string, string> = {
    "passenger-manifest":
      "Passenger Manifest Audit Failure — Missing Passengers",
    "manifest_accounting":
      "Passenger Manifest Audit Failure — Missing Passengers",
    "site_day_red": "Day Centre — Red Anomaly",
  };
  if (map[gateId]) return map[gateId];
  return gateId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

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

/** Canonical pre-trip schema mounted by `manifest.tsx`. */
export const PRE_TRIP_SCHEMA: OperationalSchema = {
  id: "pre-trip",
  title: "Pre-Trip Driver Declaration",
  description:
    "Walk the vehicle, log any faults below, then confirm the critical human checks before you roll.",
  infoBannerText:
    "These critical gates are the human checks the office relies on. Tap each banner once you have personally verified it.",
  criticalGates: [
    {
      id: "passenger-manifest",
      label:
        "I have sighted today's passenger manifest and confirmed every booked passenger is accounted for.",
    },
  ],
  primaryActionText: "Safety Check Complete, Ready to Roll",
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

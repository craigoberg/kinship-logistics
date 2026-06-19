/**
 * Notification Router
 *
 * Central utility for routing vehicle inspection failure events to the
 * correct downstream channel based on severity. In dev/preview builds
 * this also fans out to the `NotificationSimulator` overlay so the
 * operations team can visually inspect what would be sent in production.
 *
 * Severity mapping (sourced from `asset_checkpoints.impact_level`):
 *   - 'critical_no_go'      → Sev 1 → Urgent SMS to Operations Manager
 *   - 'conditional_warning' → Sev 2 → Maintenance email to Fleet team
 *   - 'minor_log_only'      → Sev 3 → Silent dashboard log entry
 */

import { useEffect } from "react";

export type InspectionSeverity =
  | "critical_no_go"
  | "conditional_warning"
  | "minor_log_only";

export interface InspectionAlertInput {
  assetName: string;
  driverName: string;
  checkpointText: string;
  severity: InspectionSeverity;
  notes?: string | null;
}

export type InspectionChannel = "sms" | "email" | "log";

export interface InspectionAlertPayload extends InspectionAlertInput {
  channel: InspectionChannel;
  recipient: string;
  subject?: string;
  body: string;
  dispatchedAt: string;
}

const OPS_MANAGER_PHONE = "0400 000 000";
const FLEET_EMAIL = "maintenance@yadaconnect.org";

/** Normalises arbitrary impact strings into our 3-tier severity enum. */
export function toSeverity(raw: string | null | undefined): InspectionSeverity {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "critical_no_go" || v === "critical" || v === "sev1") return "critical_no_go";
  if (v === "conditional_warning" || v === "warning" || v === "sev2")
    return "conditional_warning";
  return "minor_log_only";
}

function buildPayload(input: InspectionAlertInput): InspectionAlertPayload {
  const notes = (input.notes ?? "").trim() || "(no driver notes)";
  const dispatchedAt = new Date().toISOString();

  if (input.severity === "critical_no_go") {
    const body =
      `[🚨 CRITICAL FAULT - ${input.assetName}] Driver ${input.driverName} reports ` +
      `critical failure: ${input.checkpointText}. Driver Notes: ${notes}. ` +
      `VEHICLE UNTIL OVERRIDDEN.`;
    return {
      ...input,
      channel: "sms",
      recipient: `Operations Manager (${OPS_MANAGER_PHONE})`,
      body,
      dispatchedAt,
    };
  }

  if (input.severity === "conditional_warning") {
    const subject = `Urgent Asset Repair Required - ${input.assetName}`;
    const body =
      `A dynamic capability mismatch was recorded. ${input.checkpointText} failed ` +
      `inspection while hoist-dependent passengers are actively booked on today's ` +
      `manifest. Driver: ${input.driverName}. Notes: ${notes}.`;
    return {
      ...input,
      channel: "email",
      recipient: FLEET_EMAIL,
      subject,
      body,
      dispatchedAt,
    };
  }

  return {
    ...input,
    channel: "log",
    recipient: "dashboard",
    body:
      `Minor checklist exception: ${input.checkpointText} on ${input.assetName} ` +
      `(driver ${input.driverName}). Notes: ${notes}.`,
    dispatchedAt,
  };
}

// ---------------------------------------------------------------------------
// Browser-side event bus — keeps the router decoupled from the simulator UI.
// ---------------------------------------------------------------------------

const EVENT_NAME = "lovable:inspection-alert";

export function triggerInspectionAlert(
  assetName: string,
  driverName: string,
  checkpointText: string,
  severity: InspectionSeverity,
  notes?: string | null,
): InspectionAlertPayload {
  const payload = buildPayload({
    assetName,
    driverName,
    checkpointText,
    severity,
    notes,
  });

  if (payload.channel === "log") {
    // Silent background dashboard log. No UI interruption.
    // eslint-disable-next-line no-console
    console.info("[inspection-alert][sev3]", payload);
  } else {
    // eslint-disable-next-line no-console
    console.info(`[inspection-alert][${payload.channel}]`, payload);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  }
  return payload;
}

export function useInspectionAlertListener(
  handler: (payload: InspectionAlertPayload) => void,
) {
  useEffect(() => {
    const onEvt = (e: Event) => {
      const ce = e as CustomEvent<InspectionAlertPayload>;
      handler(ce.detail);
    };
    window.addEventListener(EVENT_NAME, onEvt);
    return () => window.removeEventListener(EVENT_NAME, onEvt);
  }, [handler]);
}

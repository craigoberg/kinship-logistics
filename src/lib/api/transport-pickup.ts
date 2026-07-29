// Pickup cancellation — RED manager verbal confirmation + Hub + SMS.
// After skip, rebuild remaining pickup from→to so cancelled stops never
// teleport the bus (GUARDRAILS §11 chain rule).
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { createIssue } from "@/lib/api/site-issues";
import { getTodaySession } from "@/lib/api/site-day-sessions";
import {
  patchTripLeg,
  rebuildTripPickupChain,
  resolveStaffIdWithFallback,
} from "@/lib/data-store";
import type { VerbalContactOutcome } from "@/components/issue-engine/verbal-consultation-dialog";

export interface CancelTripPickupVerbal {
  managerStaffId: string;
  managerName: string;
  contactOutcome: VerbalContactOutcome;
  /** Free-text plan / confirmation notes (≥20 chars) from VerbalConsultationDialog. */
  notes: string;
  /** Full Hub description including [VERBAL WORKAROUND] prefix. */
  hubDescription: string;
}

export interface CancelTripPickupArgs {
  legId: string;
  participantName: string;
  tripId: string;
  eventId?: string | null;
  /** Required — manager-confirmed reason (from verbal notes). */
  reason: string;
  verbal: CancelTripPickupVerbal;
}

export interface CancelTripPickupResult {
  issueId: string | null;
  incidentId: string | null;
  smsDispatched: boolean;
}

/**
 * Skip a pending pickup after RED verbal manager confirmation:
 * complete leg as not boarded, rebuild chain, RED Hub ticket, SMS managers.
 */
export async function cancelTripPickupLeg(
  args: CancelTripPickupArgs,
): Promise<CancelTripPickupResult> {
  const reason = args.reason.trim();
  if (reason.length < 20) {
    throw new Error(
      "Manager confirmation notes are required (at least 20 characters).",
    );
  }
  if (!args.verbal?.managerStaffId || !args.verbal.hubDescription?.trim()) {
    throw new Error("Manager verbal confirmation is required to cancel a pickup.");
  }

  const { data: legRow, error: legErr } = await supabase
    .from("trip_legs")
    .select("id, trip_id, status, to_participant_id, to_label, leg_index")
    .eq("id", args.legId)
    .eq("trip_id", args.tripId)
    .maybeSingle();
  if (legErr) throw legErr;
  if (!legRow) throw new Error("Pickup leg not found on this trip.");
  const leg = legRow as {
    status: string;
    to_participant_id: string | null;
    to_label: string;
    leg_index: number;
  };
  if (!leg.to_participant_id) {
    throw new Error("Only passenger pickup stops can be cancelled.");
  }
  if (leg.status === "completed") {
    throw new Error("This pickup is already completed.");
  }

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  const participantName = args.participantName.trim() || leg.to_label;
  const hubDescription = args.verbal.hubDescription.trim();

  // Operational cancel receipt (verbal consultation already wrote its own RED ledger).
  await writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "RED",
    action_type: "TRANSPORT_PICKUP_CANCELLED",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      trip_id: args.tripId,
      leg_id: args.legId,
      leg_index: leg.leg_index,
      participant_name: participantName,
      reason,
      manager_staff_id: args.verbal.managerStaffId,
      manager_name: args.verbal.managerName,
      contact_outcome: args.verbal.contactOutcome,
      hub_description: hubDescription,
    },
  });

  await patchTripLeg(args.legId, {
    status: "completed",
    passengerPresent: false,
    medicationHandoverStatus: "not_required",
    medicationHandoverConfirmed: false,
    completedAt: new Date().toISOString(),
  });

  try {
    await rebuildTripPickupChain(args.tripId);
  } catch (err) {
    console.error("[cancelTripPickupLeg] chain rebuild failed", err);
    throw err instanceof Error
      ? err
      : new Error("Pickup cancelled but route chain could not be rebuilt.");
  }

  let incidentId: string | null = null;
  try {
    const { data: incidentRow, error: incidentErr } = await supabase
      .from("operational_incidents")
      .insert({
        incident_type: "human_operational",
        severity: "sev1",
        description: hubDescription,
        event_id: args.eventId ?? null,
        reported_by: staffId,
        status: "pending",
      })
      .select("id")
      .single();
    if (incidentErr) throw incidentErr;
    incidentId = String((incidentRow as { id: string }).id);
  } catch (err) {
    console.error("[cancelTripPickupLeg] Hub incident failed", err);
  }

  let issueId: string | null = null;
  try {
    const sess = await getTodaySession();
    if (sess?.id) {
      const issue = await createIssue({
        sessionId: sess.id,
        eventId: args.eventId ?? null,
        severity: "red",
        issueDescription: hubDescription,
        workaroundPlan: reason,
        owner: "internal",
      });
      issueId = issue.id;
    }
  } catch (err) {
    console.error("[cancelTripPickupLeg] Hub site issue failed", err);
  }

  let smsDispatched = false;
  const { emitMockSms } = await import("@/lib/notifications/mock-sms");
  try {
    const res = await fetch("/api/internal/transport-pickup-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legId: args.legId,
        tripId: args.tripId,
        participantName,
        reason,
        issueId,
        severity: "red",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      sent?: number;
      reason?: string;
      recipients?: string[];
      message?: string;
      reference?: string;
    };
    if (!res.ok) {
      console.error("[cancelTripPickupLeg] SMS pipeline non-OK", res.status, body);
      emitMockSms({
        recipient: "unknown",
        body: `[RED PICKUP CANCELLED] ${participantName} — server route returned ${res.status}.`,
        source: "transport_pickup_cancel",
        reason: "pipeline_non_ok",
        reference: `pickup-cancel-${args.legId}`,
      });
      return { issueId, incidentId, smsDispatched: false };
    }

    const recipients = body.recipients ?? [];
    const message =
      body.message ??
      `[RED PICKUP CANCELLED] Driver skipped ${participantName} after manager confirmation. ${reason}`;
    const smsReason = body.reason ?? "unknown";
    const reference = body.reference ?? `pickup-cancel-${args.legId}`;

    if (recipients.length === 0) {
      emitMockSms({
        recipient: "(no recipients resolved)",
        body: message,
        source: "transport_pickup_cancel",
        reason: smsReason,
        reference,
      });
    } else {
      for (const to of recipients) {
        emitMockSms({
          recipient: to,
          body: message,
          source: "transport_pickup_cancel",
          reason: smsReason,
          reference,
        });
      }
    }
    smsDispatched = (body.sent ?? 0) > 0 || recipients.length > 0;
  } catch (err) {
    console.error("[cancelTripPickupLeg] SMS dispatch failed", err);
    emitMockSms({
      recipient: "unknown",
      body: `[RED PICKUP CANCELLED] ${participantName} — pipeline threw before send.`,
      source: "transport_pickup_cancel",
      reason: "pipeline_error",
      reference: `pickup-cancel-${args.legId}`,
    });
  }

  return { issueId, incidentId, smsDispatched };
}

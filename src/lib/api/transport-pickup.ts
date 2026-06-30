// Driver-initiated pickup cancellation — YELLOW Hub issue + manager SMS.
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { createIssue } from "@/lib/api/site-issues";
import { getTodaySession } from "@/lib/api/site-day-sessions";
import { patchTripLeg, resolveStaffIdWithFallback } from "@/lib/data-store";

export interface CancelTripPickupArgs {
  legId: string;
  participantName: string;
  tripId: string;
  reason?: string | null;
}

export interface CancelTripPickupResult {
  issueId: string | null;
  smsDispatched: boolean;
}

/**
 * Skip a pending pickup: complete the leg as not boarded, raise a YELLOW Hub
 * issue for manager follow-up, and SMS the manager recipient list.
 */
export async function cancelTripPickupLeg(
  args: CancelTripPickupArgs,
): Promise<CancelTripPickupResult> {
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
  const reason =
    args.reason?.trim() ||
    "Office advised passenger is not travelling today.";
  const participantName = args.participantName.trim() || leg.to_label;

  await writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "YELLOW",
    action_type: "TRANSPORT_PICKUP_CANCELLED",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      trip_id: args.tripId,
      leg_id: args.legId,
      leg_index: leg.leg_index,
      participant_name: participantName,
      reason,
    },
  });

  await patchTripLeg(args.legId, {
    status: "completed",
    passengerPresent: false,
    medicationHandoverStatus: "not_required",
    medicationHandoverConfirmed: false,
    completedAt: new Date().toISOString(),
  });

  let issueId: string | null = null;
  try {
    const sess = await getTodaySession();
    if (sess?.id) {
      const description =
        `[TRANSPORT PICKUP CANCELLED] ${participantName} — leg ${leg.leg_index}. ` +
        `${reason} Driver proceeding to next stop.`;
      const workaround =
        "Manager to confirm absence with family/office and update attendance schedule if needed.";
      const issue = await createIssue({
        sessionId: sess.id,
        severity: "yellow",
        issueDescription: description,
        workaroundPlan: workaround,
        owner: "internal",
      });
      issueId = issue.id;
    }
  } catch (err) {
    console.error("[cancelTripPickupLeg] Hub issue failed", err);
  }

  let smsDispatched = false;
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
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { sent?: number };
      smsDispatched = (body.sent ?? 0) > 0;
    }
  } catch (err) {
    console.error("[cancelTripPickupLeg] SMS dispatch failed", err);
  }

  return { issueId, smsDispatched };
}

/**
 * BL-073 — meal service roll on trip Programme meal stops.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { operationalNowIso } from "@/lib/operational-clock";
import {
  mealSourceNeedsPrepChecks,
  validateMealOpenPayload,
  type MealOpenPayload,
} from "@/lib/meal-open";
import { fetchMealPrepCheckLabels } from "@/lib/api/meal-prep-checks";
import {
  assertMealPrepAttestationPin,
  mealPrepAttestationPatch,
} from "@/lib/api/meal-prep-attestation";
import { writeToLedger } from "@/lib/api/ledger";
import {
  lookupParticipantName,
  withAuditActorMeta,
} from "@/lib/api/office-change-log";

export type MealServiceStatus =
  | "expected"
  | "served"
  | "modified"
  | "own_order"
  | "declined"
  | "na";

export type MealServiceRow = {
  id: string;
  venueStopId: string;
  participantId: string;
  status: MealServiceStatus;
  notes: string | null;
};

/**
 * Seed meal recipients from people checked in on the trip day
 * (parity with Day Centre — not the full roster).
 */
export async function seedMealServiceRoll(
  venueStopId: string,
  eventId: string,
  eventDaySessionId: string,
): Promise<number> {
  void eventId;
  const { data: attendance, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "checked_in");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw error;
  }
  const ids = [
    ...new Set(
      (attendance ?? [])
        .map((r) => (r as { participant_id: string | null }).participant_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return 0;
  const payload = ids.map((participant_id) => ({
    venue_stop_id: venueStopId,
    participant_id,
    status: "expected",
  }));
  const { data, error: insErr } = await supabase
    .from("event_meal_service_rolls")
    .upsert(payload, {
      onConflict: "venue_stop_id,participant_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insErr) {
    if (isSchemaMismatchError(insErr)) return 0;
    throw insErr;
  }
  return data?.length ?? 0;
}

export async function listMealServiceRoll(
  venueStopId: string,
): Promise<MealServiceRow[]> {
  const { data, error } = await supabase
    .from("event_meal_service_rolls")
    .select("*")
    .eq("venue_stop_id", venueStopId);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      venue_stop_id: string;
      participant_id: string;
      status: string;
      notes: string | null;
    };
    return {
      id: row.id,
      venueStopId: row.venue_stop_id,
      participantId: row.participant_id,
      status: row.status as MealServiceStatus,
      notes: row.notes,
    };
  });
}

export async function setMealServiceStatus(
  rowId: string,
  status: MealServiceStatus,
  notes?: string | null,
): Promise<void> {
  const staffId = await resolveStaffIdWithFallback();
  const patch: Record<string, unknown> = {
    status,
    updated_at: operationalNowIso(),
    updated_by_id: staffId || null,
  };
  if (notes !== undefined) patch.notes = notes?.trim() || null;
  const { data, error } = await supabase
    .from("event_meal_service_rolls")
    .update(patch)
    .eq("id", rowId)
    .select("id, venue_stop_id, participant_id, status, notes")
    .single();
  if (error) throw error;
  if (status === "expected" || !data) return;
  const row = data as {
    id: string;
    venue_stop_id: string;
    participant_id: string;
    status: string;
    notes: string | null;
  };
  const personName = await lookupParticipantName(row.participant_id);
  const { data: stop } = await supabase
    .from("event_venue_stops")
    .select("venue_name, meal_slot")
    .eq("id", row.venue_stop_id)
    .maybeSingle();
  const meal =
    (stop as { venue_name?: string } | null)?.venue_name?.trim() ||
    ((stop as { meal_slot?: string } | null)?.meal_slot ?? "meal").replace(/_/g, " ");
  const who = personName ?? "client";
  const note = (row.notes ?? "").trim();
  const verb =
    status === "served"
      ? "Served"
      : status === "modified"
        ? "Served modified"
        : status === "own_order"
          ? "Own-order"
          : status === "declined"
            ? "Declined"
            : "N/A";
  const summary =
    status === "declined" || status === "na"
      ? `${verb} ${meal} for ${who} on trip`
      : `${verb} ${meal} to ${who} on trip`;
  await writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "EVENT_MEAL_SERVED",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      meal_row_id: row.id,
      venue_stop_id: row.venue_stop_id,
      participant_id: row.participant_id,
      person_name: who,
      location: "trip",
      meal_title: meal,
      meal_status: status,
      notes: note || null,
      summary: note ? `${summary} — ${note}` : summary,
    }),
  });
}

/** Open a Programme meal stop with live source/menu/preparer capture. */
export async function openMealVenueStop(args: {
  stopId: string;
  eventId: string;
  sessionDate: string;
  eventDaySessionId: string;
  mealOpen: MealOpenPayload;
}): Promise<void> {
  const requiredPrep = mealSourceNeedsPrepChecks(args.mealOpen.mealSource)
    ? await fetchMealPrepCheckLabels()
    : [];
  const err = validateMealOpenPayload(args.mealOpen, requiredPrep);
  if (err) throw new Error(err);
  await assertMealPrepAttestationPin(args.mealOpen);

  const { openVenueStop } = await import("@/lib/api/event-activity-roll");
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const p = args.mealOpen;
  const prepChecksCompleted = mealSourceNeedsPrepChecks(p.mealSource)
    ? p.prepChecksCompleted ?? []
    : [];
  const attPatch = mealPrepAttestationPatch(p);

  const { error: prepErr } = await supabase
    .from("event_venue_stops")
    .update({
      meal_source: p.mealSource,
      menu_notes:
        p.mealSource === "own_food"
          ? p.menuNotes?.trim() || null
          : p.menuNotes?.trim() || null,
      prepared_by_staff_id: p.preparedByStaffId,
      preparer_cert_status: p.preparerCertStatus,
      preparer_ack_note: p.preparerAckNote?.trim() || null,
      prep_checks_completed: prepChecksCompleted,
      ...attPatch,
      updated_at: now,
    })
    .eq("id", args.stopId);
  if (prepErr) throw prepErr;

  await openVenueStop(
    {
      id: args.stopId,
      eventId: args.eventId,
      sessionDate: args.sessionDate,
      venueName: null,
      movementMethod: "on_site",
    },
    args.eventDaySessionId,
  );

  await seedMealServiceRoll(
    args.stopId,
    args.eventId,
    args.eventDaySessionId,
  );

  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "EVENT_MEAL_OPENED",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      venue_stop_id: args.stopId,
      event_id: args.eventId,
      meal_source: p.mealSource,
      location: "trip",
      prepared_by_staff_id: p.preparedByStaffId,
      preparer_cert_status: p.preparerCertStatus,
      prep_checks_completed: prepChecksCompleted,
      prep_attestation_mode: attPatch.prep_attestation_mode,
      prep_attested_by_staff_id: attPatch.prep_attested_by_staff_id,
      guest_preparer_name: attPatch.guest_preparer_name,
      prep_attestation_note: attPatch.prep_attestation_note,
      sfh_approved_by_staff_id: attPatch.sfh_approved_by_staff_id,
      summary: `Opened trip meal (${p.mealSource.replace(/_/g, " ")})`,
    }),
  });
}

export async function countOutstandingMealServes(
  venueStopId: string,
): Promise<number> {
  const rows = await listMealServiceRoll(venueStopId);
  return rows.filter((r) => r.status === "expected").length;
}

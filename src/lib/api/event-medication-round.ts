/**
 * BL-077 — Trip Programme medication round + alternate med plans.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback, verifyStaffPin } from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger } from "@/lib/api/ledger";
import { operationalNowIso } from "@/lib/operational-clock";
import {
  isMedicationStop,
  listEventVenueStops,
  upsertEventVenueStop,
  type EventVenueStop,
} from "@/lib/api/event-outing";

/** Ensure one Medication round stop exists for the trip day (Day Centre parity). */
export async function ensureEventDayMedicationRound(
  eventId: string,
  sessionDate: string,
): Promise<EventVenueStop | null> {
  const stops = await listEventVenueStops(eventId);
  const existing = stops.find(
    (s) => s.session_date === sessionDate && isMedicationStop(s),
  );
  if (existing) return existing;

  const dayStops = stops.filter((s) => s.session_date === sessionDate);
  const maxOrder = dayStops.reduce((m, s) => Math.max(m, s.stop_order), 0);

  try {
    // Seed uses manager path via upsert — field open may lack manager rights.
    // Fall back to direct insert for PIN terminals (anon RLS).
    const { data, error } = await supabase
      .from("event_venue_stops")
      .insert({
        event_id: eventId,
        session_date: sessionDate,
        venue_id: null,
        stop_order: maxOrder + 1,
        label_override: "Medication round",
        activity_kind: "medication_round",
        movement_method: "on_site",
        phase: "pending",
      })
      .select("*")
      .single();
    if (error) {
      // Manager path as fallback when insert blocked.
      if (isSchemaMismatchError(error)) return null;
      try {
        return await upsertEventVenueStop({
          event_id: eventId,
          session_date: sessionDate,
          stop_order: maxOrder + 1,
          activity_kind: "medication_round",
          label_override: "Medication round",
        });
      } catch {
        console.warn("[ensureEventDayMedicationRound]", error.message);
        return null;
      }
    }
    return data as EventVenueStop;
  } catch (e) {
    console.warn("[ensureEventDayMedicationRound]", e);
    return null;
  }
}

/** Checked-in on the trip day (with the group), excluding Left trip / absent. */
export async function listTripMedicationPresenceIds(
  eventDaySessionId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id, status")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "checked_in");
  if (error) {
    if (isSchemaMismatchError(error)) return new Set();
    throw error;
  }
  const alternate = await listAlternateMedPlanParticipantIds(eventDaySessionId);
  const ids = new Set<string>();
  for (const r of data ?? []) {
    const id = (r as { participant_id: string }).participant_id;
    if (id && !alternate.has(id)) ids.add(id);
  }
  return ids;
}

export async function listAlternateMedPlanParticipantIds(
  eventDaySessionId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("event_day_med_alternate_plans")
    .select("participant_id")
    .eq("event_day_session_id", eventDaySessionId);
  if (error) {
    if (isSchemaMismatchError(error)) return new Set();
    throw error;
  }
  return new Set(
    (data ?? []).map((r) => (r as { participant_id: string }).participant_id),
  );
}

export type AlternateMedPlan = {
  id: string;
  eventDaySessionId: string;
  participantId: string;
  planNote: string;
  attestedByStaffId: string;
  createdAt: string;
};

export async function listAlternateMedPlans(
  eventDaySessionId: string,
): Promise<AlternateMedPlan[]> {
  const { data, error } = await supabase
    .from("event_day_med_alternate_plans")
    .select("*")
    .eq("event_day_session_id", eventDaySessionId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      event_day_session_id: string;
      participant_id: string;
      plan_note: string;
      attested_by_staff_id: string;
      created_at: string;
    };
    return {
      id: row.id,
      eventDaySessionId: row.event_day_session_id,
      participantId: row.participant_id,
      planNote: row.plan_note,
      attestedByStaffId: row.attested_by_staff_id,
      createdAt: row.created_at,
    };
  });
}

/** PIN-signed alternate med cover — participant off the trip med board. */
export async function recordAlternateMedPlan(args: {
  eventDaySessionId: string;
  eventId: string;
  participantId: string;
  planNote: string;
  attestedByStaffId: string;
  pin: string;
}): Promise<void> {
  const note = args.planNote.trim();
  if (note.length < 10) {
    throw new Error("Alternate plan needs at least 10 characters.");
  }
  const ok = await verifyStaffPin(args.attestedByStaffId, args.pin);
  if (!ok) throw new Error("Incorrect PIN.");

  const { error } = await supabase.from("event_day_med_alternate_plans").upsert(
    {
      event_day_session_id: args.eventDaySessionId,
      participant_id: args.participantId,
      plan_note: note,
      attested_by_staff_id: args.attestedByStaffId,
      created_at: operationalNowIso(),
    },
    { onConflict: "event_day_session_id,participant_id" },
  );
  if (error) throw error;

  const staffId = await resolveStaffIdWithFallback();
  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "EVENT_MED_ALTERNATE_PLAN",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      event_id: args.eventId,
      event_day_session_id: args.eventDaySessionId,
      participant_id: args.participantId,
      plan_note: note,
      attested_by_staff_id: args.attestedByStaffId,
    },
  });
}

export async function clearAlternateMedPlan(
  eventDaySessionId: string,
  participantId: string,
): Promise<void> {
  const { error } = await supabase
    .from("event_day_med_alternate_plans")
    .delete()
    .eq("event_day_session_id", eventDaySessionId)
    .eq("participant_id", participantId);
  if (error) throw error;
}

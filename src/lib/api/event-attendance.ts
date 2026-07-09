/**
 * event_attendance_log — event-floor arrival/departure roll (§12.4.2 / Phase 8)
 *
 * Mirrors client_attendance_log for the temporary centre at the venue.
 * Seeded from event_roster_bookings when trip leader opens location.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { listParticipants, resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";

export type EventArrivalMethod = "bus" | "private" | "walk_in" | "other";
export type EventAttendanceStatus = "expected" | "checked_in" | "checked_out" | "absent";
export type ReturnTransport = "bus" | "self";

export interface EventAttendanceRow {
  id: string;
  eventDaySessionId: string;
  participantId: string;
  expectedArrivalAt: string;
  arrivalMethod: EventArrivalMethod;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  status: EventAttendanceStatus;
  returnTransport: ReturnTransport | null;
  notes: string | null;
  participantName?: string | null;
}

interface DbRow {
  id: string;
  event_day_session_id: string;
  participant_id: string;
  expected_arrival_at: string;
  arrival_method: EventArrivalMethod;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  status: EventAttendanceStatus;
  return_transport: ReturnTransport | null;
  notes: string | null;
}

function toRow(r: DbRow): EventAttendanceRow {
  return {
    id: r.id,
    eventDaySessionId: r.event_day_session_id,
    participantId: r.participant_id,
    expectedArrivalAt: r.expected_arrival_at,
    arrivalMethod: r.arrival_method,
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
    checkedOutAt: r.checked_out_at,
    checkedOutBy: r.checked_out_by,
    status: r.status,
    returnTransport: r.return_transport,
    notes: r.notes,
  };
}

function mapTransportMode(mode: string | null): EventArrivalMethod {
  if (mode === "self") return "private";
  if (mode === "bus") return "bus";
  return "other";
}

/** Default expected arrival: session date 09:00 Sydney (+10). */
function defaultExpectedArrival(sessionDate: string): string {
  return `${sessionDate}T09:00:00+10:00`;
}

export async function listEventAttendanceRoll(
  eventDaySessionId: string,
): Promise<EventAttendanceRow[]> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("*")
    .eq("event_day_session_id", eventDaySessionId)
    .order("expected_arrival_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as DbRow));
}

/** Seed from confirmed event roster bookings. Idempotent upsert. */
export async function seedEventAttendanceRoll(
  eventDaySessionId: string,
  eventId: string,
  sessionDate: string,
): Promise<number> {
  const withModes = "participant_id, outbound_transport_mode, return_transport_mode";
  let result = await supabase
    .from("event_roster_bookings")
    .select(withModes)
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");

  if (result.error && isSchemaMismatchError(result.error)) {
    result = await supabase
      .from("event_roster_bookings")
      .select("participant_id")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error) throw result.error;

  const bookings = result.data ?? [];

  const expectedAt = defaultExpectedArrival(sessionDate);
  const payload = (bookings ?? []).map((b) => ({
    event_day_session_id: eventDaySessionId,
    participant_id: (b as { participant_id: string }).participant_id,
    expected_arrival_at: expectedAt,
    arrival_method: mapTransportMode(
      (b as { outbound_transport_mode: string | null }).outbound_transport_mode,
    ),
    return_transport: ((b as { return_transport_mode: string | null }).return_transport_mode ??
      "bus") as ReturnTransport,
  }));

  if (payload.length === 0) return 0;

  const { data: inserted, error: insErr } = await supabase
    .from("event_attendance_log")
    .upsert(payload, {
      onConflict: "event_day_session_id,participant_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insErr) throw insErr;
  return inserted?.length ?? 0;
}

/** Tap toggle: expected ↔ checked_in (§4.4 fat-finger cards). */
export async function toggleEventCheckIn(
  row: EventAttendanceRow,
): Promise<EventAttendanceRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();
  const isIn = row.status === "checked_in";
  const patch = isIn
    ? {
        status: "expected" as EventAttendanceStatus,
        checked_in_at: null,
        checked_in_by: null,
      }
    : {
        status: "checked_in" as EventAttendanceStatus,
        checked_in_at: nowIso,
        checked_in_by: staffId,
      };

  const { data, error } = await supabase
    .from("event_attendance_log")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: isIn ? "EVENT_FLOOR_CHECKIN_UNDO" : "EVENT_FLOOR_CHECKIN",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      attendance_id: row.id,
    },
  });

  return toRow(data as DbRow);
}

/** Departure handover — assign return transport and check out. */
export async function checkoutEventParticipant(
  row: EventAttendanceRow,
  returnTransport: ReturnTransport,
): Promise<EventAttendanceRow> {
  if (row.status !== "checked_in") {
    throw new Error("Participant must be checked in before departure handover.");
  }
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("event_attendance_log")
    .update({
      status: "checked_out",
      checked_out_at: nowIso,
      checked_out_by: staffId,
      return_transport: returnTransport,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CLIENT",
    severity: "GREEN",
    action_type: "EVENT_FLOOR_CHECKOUT",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      return_transport: returnTransport,
    },
  });

  return toRow(data as DbRow);
}

/** Returns names still checked in (blocks close location). */
export async function listStillCheckedIn(
  eventDaySessionId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "checked_in");
  if (error) throw error;
  const ids = (data ?? []).map((r) => (r as { participant_id: string }).participant_id);
  if (ids.length === 0) return [];

  const participants = await listParticipants();
  const nameById = Object.fromEntries(
    participants.map((p) => [p.id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Participant"]),
  );
  return ids.map((id) => nameById[id] ?? "Participant");
}

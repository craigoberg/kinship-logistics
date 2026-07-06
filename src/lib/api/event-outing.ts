/**
 * Outing-specific event API — GUARDRAILS §12.3 / §12.4
 *
 * Covers:
 *   - event_venue_stops  (ordered itinerary hops per day, §12.3.3)
 *   - event_day_sessions (trip manager assignment + phase, §12.4.1)
 *   - Booking outbound/return transport mode patches (§12.3.2)
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { parseIsoDateLocal, toIsoDateString } from "@/lib/utils";

// ============================================================================
// Event kind inference (§12.3.1 — derived from dates + outing event type)
// ============================================================================

export type EventKind = "legacy" | "single_day_outing" | "multi_day_tour";

const OUTING_EVENT_TYPE_RE =
  /excursion|outing|tour|\btrip\b|single[\s_.-]*day|multi[\s_.-]*day|sde|sdt|mdt/i;

export function isOutingEventKind(kind: string | null | undefined): kind is EventKind {
  return kind === "single_day_outing" || kind === "multi_day_tour";
}

/** True when the lookup code or display label indicates an §12 outing type. */
export function isOutingEventType(
  eventTypeCode?: string | null,
  eventTypeDisplayName?: string | null,
): boolean {
  const haystack = `${eventTypeCode ?? ""} ${eventTypeDisplayName ?? ""}`.toLowerCase();
  return OUTING_EVENT_TYPE_RE.test(haystack);
}

/** Derive §12 scope from start/end dates and event type — not a separate manual pick for excursions. */
export function inferEventKind(input: {
  startDate: string;
  endDate?: string | null;
  eventTypeCode?: string | null;
  /** Lookup display_name — required when code alone is opaque (e.g. SDE). */
  eventTypeDisplayName?: string | null;
  primaryVenueId?: string | null;
  /** Persisted event_manifest.event_kind — honoured when dates still fit. */
  storedEventKind?: string | null;
}): EventKind {
  const start = input.startDate.slice(0, 10);
  const end = (input.endDate || input.startDate || start).slice(0, 10);

  const stored = input.storedEventKind;
  if (stored === "multi_day_tour" && end > start) return "multi_day_tour";
  if (stored === "single_day_outing" && end <= start) return "single_day_outing";

  const isOutingType =
    isOutingEventType(input.eventTypeCode, input.eventTypeDisplayName) ||
    !!input.primaryVenueId;
  if (!isOutingType) return "legacy";
  return end > start ? "multi_day_tour" : "single_day_outing";
}

// ============================================================================
// event_venue_stops — itinerary
// ============================================================================

export interface EventVenueStop {
  id: string;
  event_id: string;
  session_date: string;
  venue_id: string;
  stop_order: number;
  label_override: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined from venues table (not always present). */
  venue_name?: string | null;
  venue_type?: string | null;
  venue_street_address?: string | null;
}

export async function listEventVenueStops(eventId: string): Promise<EventVenueStop[]> {
  const { data, error } = await supabase
    .from("event_venue_stops")
    .select("*, venues(name, venue_type, street_address)")
    .eq("event_id", eventId)
    .order("session_date", { ascending: true })
    .order("stop_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    venue_name: (r as { venues?: { name?: string } | null }).venues?.name ?? null,
    venue_type: (r as { venues?: { venue_type?: string } | null }).venues?.venue_type ?? null,
    venue_street_address:
      (r as { venues?: { street_address?: string | null } | null }).venues?.street_address ?? null,
  })) as EventVenueStop[];
}

export interface ItineraryStopAnchor {
  id: string;
  label: string;
  streetAddress: string | null;
  sessionDate: string;
}

/** Last ordered stop on a trip day — default return-run departure (§12.4.3a). */
export async function getLastItineraryStopForDate(
  eventId: string,
  sessionDate: string,
): Promise<ItineraryStopAnchor | null> {
  const stops = await listEventVenueStops(eventId);
  const dayStops = stops
    .filter((s) => s.session_date === sessionDate)
    .sort((a, b) => a.stop_order - b.stop_order);
  const last = dayStops[dayStops.length - 1];
  if (!last) return null;
  return {
    id: last.id,
    label: last.label_override ?? last.venue_name ?? "Last stop",
    streetAddress: last.venue_street_address ?? null,
    sessionDate: last.session_date,
  };
}

export interface UpsertEventVenueStopInput {
  id?: string | null;
  event_id: string;
  session_date: string;
  venue_id: string;
  stop_order: number;
  label_override?: string | null;
  notes?: string | null;
}

export async function upsertEventVenueStop(
  input: UpsertEventVenueStopInput,
): Promise<EventVenueStop> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can edit the event itinerary.");

  const payload = {
    event_id: input.event_id,
    session_date: input.session_date,
    venue_id: input.venue_id,
    stop_order: input.stop_order,
    label_override: input.label_override?.trim() || null,
    notes: input.notes?.trim() || null,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("event_venue_stops")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as EventVenueStop;
  }

  const { data, error } = await supabase
    .from("event_venue_stops")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as EventVenueStop;
}

export async function deleteEventVenueStop(id: string): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can remove itinerary stops.");

  const { error } = await supabase
    .from("event_venue_stops")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/** Reorder stops for one session date by providing the new ordered list of IDs. */
export async function reorderEventVenueStops(
  eventId: string,
  sessionDate: string,
  orderedIds: string[],
): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can reorder itinerary stops.");

  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase
        .from("event_venue_stops")
        .update({ stop_order: idx })
        .eq("id", id)
        .eq("event_id", eventId)
        .eq("session_date", sessionDate),
    ),
  );
}

/** Inclusive calendar dates between start and end (local timezone — §5.3). */
function calendarDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cur = parseIsoDateLocal(startDate.slice(0, 10));
  const last = parseIsoDateLocal((endDate || startDate).slice(0, 10));
  if (!cur || !last) return dates;
  while (cur <= last) {
    dates.push(toIsoDateString(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return dates;
}

/**
 * Auto-seed `event_venue_stops` from the event's primary venue when a day has
 * no itinerary rows yet (§12.3.3). Resolves `primary_venue_id` from the manifest
 * row, or matches `venue_name` against the venue registry.
 */
export async function ensureEventItineraryStops(eventId: string): Promise<number> {
  const { data: ev, error: evErr } = await supabase
    .from("event_manifest")
    .select("primary_venue_id, venue_name, start_date, end_date")
    .eq("id", eventId)
    .single();
  if (evErr || !ev) return 0;

  const row = ev as {
    primary_venue_id: string | null;
    venue_name: string | null;
    start_date: string;
    end_date: string | null;
  };

  let venueId = row.primary_venue_id;
  const venueLabel = (row.venue_name ?? "").trim();
  if (!venueId && venueLabel.length > 0) {
    const { data: matched } = await supabase
      .from("venues")
      .select("id")
      .ilike("name", venueLabel)
      .limit(1)
      .maybeSingle();
    if (matched) {
      venueId = (matched as { id: string }).id;
      await supabase
        .from("event_manifest")
        .update({ primary_venue_id: venueId })
        .eq("id", eventId);
    }
  }
  if (!venueId) return 0;

  const dates = calendarDateRange(row.start_date, row.end_date ?? row.start_date);
  let inserted = 0;

  for (const sessionDate of dates) {
    const { count } = await supabase
      .from("event_venue_stops")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("session_date", sessionDate);
    if ((count ?? 0) > 0) continue;

    const { error } = await supabase.from("event_venue_stops").insert({
      event_id: eventId,
      session_date: sessionDate,
      venue_id: venueId,
      stop_order: 0,
    });
    if (!error) inserted += 1;
  }

  return inserted;
}

// ============================================================================
// event_day_sessions — §12.4.1
// ============================================================================

export type EventDayPhase =
  | "planning"
  | "pre_departure"
  | "active"
  | "in_transit"
  | "at_base"
  | "closed_orderly"
  | "closed_incident";

export interface EventDaySession {
  id: string;
  event_id: string;
  session_date: string;
  phase: EventDayPhase;
  manager_staff_id: string | null;
  curfew_time: string | null;
  morning_roll_time: string | null;
  opened_by_id: string | null;
  open_declared_at: string | null;
  open_leader_notes: string | null;
  closed_by_id: string | null;
  close_declared_at: string | null;
  close_leader_notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined name of assigned manager (not always present). */
  manager_name?: string | null;
}

export async function listEventDaySessions(eventId: string): Promise<EventDaySession[]> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("*")
    .eq("event_id", eventId)
    .order("session_date", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as EventDaySession[];
  const managerIds = [
    ...new Set(rows.map((r) => r.manager_staff_id).filter((id): id is string => !!id)),
  ];
  if (managerIds.length === 0) return rows;

  const { data: staffRows, error: staffErr } = await supabase
    .from("staff_registry")
    .select("id, full_name")
    .in("id", managerIds);
  if (staffErr) {
    console.warn("[listEventDaySessions:staff]", staffErr);
    return rows;
  }

  const nameById = new Map(
    (staffRows ?? []).map((s) => {
      const row = s as { id: string; full_name?: string | null };
      const name = (row.full_name ?? "").trim() || null;
      return [row.id, name] as const;
    }),
  );

  return rows.map((r) => ({
    ...r,
    manager_name: r.manager_staff_id ? nameById.get(r.manager_staff_id) ?? null : null,
  }));
}

export async function getOrCreateEventDaySession(
  eventId: string,
  sessionDate: string,
): Promise<EventDaySession> {
  const { data: existing } = await supabase
    .from("event_day_sessions")
    .select("*")
    .eq("event_id", eventId)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (existing) return existing as EventDaySession;

  const { data, error } = await supabase
    .from("event_day_sessions")
    .insert({ event_id: eventId, session_date: sessionDate, phase: "planning" })
    .select("*")
    .single();
  if (error) throw error;
  return data as EventDaySession;
}

export interface UpdateEventDaySessionInput {
  id: string;
  manager_staff_id?: string | null;
  curfew_time?: string | null;
  morning_roll_time?: string | null;
}

export async function updateEventDaySession(
  input: UpdateEventDaySessionInput,
): Promise<EventDaySession> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can configure event day sessions.");

  const actor = await resolveStaffIdWithFallback();
  const patch: Record<string, unknown> = {};
  if ("manager_staff_id" in input) patch.manager_staff_id = input.manager_staff_id ?? null;
  if ("curfew_time" in input) patch.curfew_time = input.curfew_time ?? null;
  if ("morning_roll_time" in input) patch.morning_roll_time = input.morning_roll_time ?? null;

  const { data, error } = await supabase
    .from("event_day_sessions")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;

  if ("manager_staff_id" in input) {
    await writeToLedger({
      staff_id: actor,
      category: "CENTRE",
      severity: "INFO",
      action_type: "EVENT_DAY_MANAGER_ASSIGNED",
      gps_lat: null,
      gps_lng: null,
      metadata: {
        session_id: input.id,
        manager_staff_id: input.manager_staff_id ?? null,
      },
    });
  }

  return data as EventDaySession;
}

/** Seed one `event_day_sessions` row per calendar day between start_date and end_date. */
async function pruneTripArtifactsOutsideRange(
  eventId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const validDates = new Set(calendarDateRange(startDate, endDate));
  const existing = await listEventDaySessions(eventId);

  const staleSessions = existing.filter((s) => !validDates.has(s.session_date));
  const blocked = staleSessions.filter((s) => s.phase !== "planning");
  if (blocked.length > 0) {
    const dates = blocked.map((s) => s.session_date).join(", ");
    throw new Error(
      `Cannot change event dates — trip day(s) ${dates} already have floor activity. Revert the dates or close those days first.`,
    );
  }

  if (staleSessions.length > 0) {
    const { error } = await supabase
      .from("event_day_sessions")
      .delete()
      .eq("event_id", eventId)
      .in(
        "session_date",
        staleSessions.map((s) => s.session_date),
      );
    if (error) {
      console.error("[pruneTripArtifacts] DELETE blocked — missing RLS DELETE policy:", error);
      throw new Error(
        `Could not remove stale trip days: ${error.message}. Run docs/sql/2026-07-06_event_day_sessions_delete_policy.sql in Supabase.`,
      );
    }
  }

  const stops = await listEventVenueStops(eventId);
  const staleStopIds = stops
    .filter((s) => !validDates.has(s.session_date))
    .map((s) => s.id);
  if (staleStopIds.length > 0) {
    const { error } = await supabase.from("event_venue_stops").delete().in("id", staleStopIds);
    if (error) console.warn("[pruneTripArtifacts] Could not remove stale venue stops:", error);
  }
}

/**
 * Hard-reset trip days for an event.
 * Accepts explicit IDs of sessions to remove (planning-phase only — caller
 * must not pass sessions with floor activity). After removing them it
 * reseeds from the current event manifest dates.
 */
export async function resetEventDaySessions(
  eventId: string,
  /** IDs of planning-phase sessions to delete. */
  sessionIdsToDelete: string[],
): Promise<EventDaySession[]> {
  const { data: evRow, error: evErr } = await supabase
    .from("event_manifest")
    .select("start_date, end_date")
    .eq("id", eventId)
    .single();
  if (evErr || !evRow) throw new Error("Could not load event dates for reset.");

  const row = evRow as { start_date: string; end_date: string | null };
  const startDate = row.start_date;
  const endDate = row.end_date ?? row.start_date;

  // Delete by explicit IDs — avoids any phase-filter ambiguity.
  if (sessionIdsToDelete.length > 0) {
    const { error: delErr, count } = await supabase
      .from("event_day_sessions")
      .delete({ count: "exact" })
      .in("id", sessionIdsToDelete);
    if (delErr) {
      console.error("[resetEventDaySessions] DELETE failed:", delErr);
      throw new Error(`Could not remove trip days: ${delErr.message}`);
    }
    console.info(`[resetEventDaySessions] deleted ${count ?? "?"} session(s)`);
  }

  // Remove orphaned itinerary stops.
  const validDates = new Set(calendarDateRange(startDate, endDate));
  const stops = await listEventVenueStops(eventId);
  const staleStopIds = stops.filter((s) => !validDates.has(s.session_date)).map((s) => s.id);
  if (staleStopIds.length > 0) {
    const { error: stopErr } = await supabase
      .from("event_venue_stops")
      .delete()
      .in("id", staleStopIds);
    if (stopErr) console.warn("[resetEventDaySessions] stale stop delete failed:", stopErr);
  }

  // Reseed without the prune step (rows are already gone).
  const dates = calendarDateRange(startDate, endDate);
  if (dates.length === 0) throw new Error(`No valid dates for ${startDate} → ${endDate}.`);

  const rows = dates.map((d) => ({
    event_id: eventId,
    session_date: d,
    phase: "planning" as EventDayPhase,
  }));

  const { error: seedErr } = await supabase
    .from("event_day_sessions")
    .upsert(rows, { onConflict: "event_id,session_date", ignoreDuplicates: true });
  if (seedErr) throw seedErr;

  return listEventDaySessions(eventId);
}

/** Seed one `event_day_sessions` row per calendar day between start_date and end_date. */
export async function seedEventDaySessions(
  eventId: string,
  startDate: string,
  endDate: string,
): Promise<EventDaySession[]> {
  await pruneTripArtifactsOutsideRange(eventId, startDate, endDate);

  const dates = calendarDateRange(startDate, endDate);
  if (dates.length === 0) {
    throw new Error(
      `Could not build trip days from dates ${startDate} → ${endDate}. Check start/end on Details & Config.`,
    );
  }

  const rows = dates.map((d) => ({
    event_id: eventId,
    session_date: d,
    phase: "planning" as EventDayPhase,
  }));

  const { error } = await supabase
    .from("event_day_sessions")
    .upsert(rows, { onConflict: "event_id,session_date", ignoreDuplicates: true });
  if (error) throw error;

  // ignoreDuplicates returns no rows — always re-list so the UI sees existing trip days.
  return listEventDaySessions(eventId);
}

// ============================================================================
// Booking transport mode patch (§12.3.2)
// ============================================================================

export interface UpdateBookingTransportModeInput {
  booking_id: string;
  outbound_transport_mode: "bus" | "self";
  return_transport_mode: "bus" | "self";
}

export async function updateBookingTransportModes(
  input: UpdateBookingTransportModeInput,
): Promise<void> {
  const { error } = await supabase
    .from("event_roster_bookings")
    .update({
      outbound_transport_mode: input.outbound_transport_mode,
      return_transport_mode: input.return_transport_mode,
    })
    .eq("id", input.booking_id);
  if (error) throw error;
}

// ============================================================================
// Event manifest outing-specific patch (event_kind, primary_venue_id, etc.)
// ============================================================================

export interface PatchEventOutingFieldsInput {
  id: string;
  event_kind?: "legacy" | "single_day_outing" | "multi_day_tour";
  primary_venue_id?: string | null;
  base_hotel_venue_id?: string | null;
  curfew_time?: string | null;
  morning_roll_time?: string | null;
}

export async function patchEventOutingFields(
  input: PatchEventOutingFieldsInput,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.event_kind !== undefined) patch.event_kind = input.event_kind;
  if ("primary_venue_id" in input) patch.primary_venue_id = input.primary_venue_id ?? null;
  if ("base_hotel_venue_id" in input) patch.base_hotel_venue_id = input.base_hotel_venue_id ?? null;
  if ("curfew_time" in input) patch.curfew_time = input.curfew_time ?? null;
  if ("morning_roll_time" in input) patch.morning_roll_time = input.morning_roll_time ?? null;

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("event_manifest")
    .update(patch)
    .eq("id", input.id);
  if (error) throw error;
}

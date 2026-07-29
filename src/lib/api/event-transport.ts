/**
 * Event outing transport — actual floor ops from event_attendance_log (§12.4.2)
 * and shared badge styling aligned with Participants directory (bus = blue, self = slate).
 */
import { supabase } from "@/integrations/supabase/client";
import { listEventDaySessions } from "@/lib/api/event-outing";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

export type EventTransportMode = "bus" | "self";

export interface ParticipantActualTransport {
  outbound: EventTransportMode | null;
  return: EventTransportMode | null;
}

/** Tailwind classes — mirror participant-table TRANSPORT_CLASS for bus/private. */
export const EVENT_TRANSPORT_BADGE_CLASS: Record<EventTransportMode, string> = {
  bus: "bg-blue-600 text-white",
  self: "bg-slate-500 text-white",
};

export function normalizeEventTransportMode(
  mode: string | null | undefined,
): EventTransportMode {
  return mode === "self" ? "self" : "bus";
}

export function eventTransportLabel(mode: string): string {
  return normalizeEventTransportMode(mode) === "self" ? "Self" : "Bus";
}

function mapArrivalMethodToTransportMode(method: string): EventTransportMode {
  return method === "bus" ? "bus" : "self";
}

/** Collapse per-day attendance rows into one actual outbound/return per participant. */
export function buildParticipantActualTransport(
  sessions: Array<{ id: string; session_date: string }>,
  attendanceRows: Array<{
    event_day_session_id: string;
    participant_id: string;
    arrival_method: string;
    return_transport: string | null;
    status: string;
  }>,
): Map<string, ParticipantActualTransport> {
  const dateBySession = Object.fromEntries(sessions.map((s) => [s.id, s.session_date]));
  const byParticipant = new Map<string, typeof attendanceRows>();
  for (const row of attendanceRows) {
    const list = byParticipant.get(row.participant_id) ?? [];
    list.push(row);
    byParticipant.set(row.participant_id, list);
  }

  const result = new Map<string, ParticipantActualTransport>();

  for (const [participantId, rows] of byParticipant) {
    const sorted = [...rows].sort(
      (a, b) =>
        (dateBySession[a.event_day_session_id] ?? "").localeCompare(
          dateBySession[b.event_day_session_id] ?? "",
        ),
    );
    const firstArrived = sorted.find(
      (r) => r.status === "checked_in" || r.status === "checked_out",
    );
    const lastCheckout = [...sorted].reverse().find(
      (r) => r.status === "checked_out" && r.return_transport,
    );
    result.set(participantId, {
      outbound: firstArrived
        ? mapArrivalMethodToTransportMode(firstArrived.arrival_method)
        : null,
      return:
        lastCheckout?.return_transport === "bus" ||
        lastCheckout?.return_transport === "self"
          ? (lastCheckout.return_transport as EventTransportMode)
          : null,
    });
  }

  return result;
}

export async function fetchActualTransportForSessions(
  sessions: Array<{ id: string; session_date: string }>,
): Promise<Map<string, ParticipantActualTransport>> {
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("event_attendance_log")
    .select(
      "event_day_session_id, participant_id, arrival_method, return_transport, status",
    )
    .in("event_day_session_id", sessionIds);
  if (error) throw error;

  return buildParticipantActualTransport(sessions, (data ?? []) as Array<{
    event_day_session_id: string;
    participant_id: string;
    arrival_method: string;
    return_transport: string | null;
    status: string;
  }>);
}

/** Load actual outbound/return per participant for an outing event. */
export async function fetchEventActualTransport(
  eventId: string,
): Promise<Map<string, ParticipantActualTransport>> {
  const sessions = await listEventDaySessions(eventId);
  return fetchActualTransportForSessions(sessions);
}

export const eventActualTransportKey = (eventId: string) =>
  ["event-actual-transport", eventId] as const;

// ============================================================================
// Return-home bus eligibility (floor attendance — not roster alone)
// ============================================================================

/**
 * Who may board the return-home bus for this trip day.
 * - checked_out + return_transport=bus (handed over at Check-Out)
 * - checked_in (still on floor; not yet handed over)
 * Never: absent (Left trip / no-show) or expected (never arrived).
 */
export function isEligibleForReturnHomeBus(row: {
  status: string;
  return_transport?: string | null;
}): boolean {
  const status = (row.status ?? "").toLowerCase();
  if (status === "checked_out") {
    return (row.return_transport ?? "").toLowerCase() === "bus";
  }
  return status === "checked_in";
}

export type ReturnHomeBusEligible = {
  ids: Set<string>;
  /**
   * Floor return_bus_run_code when checked_out + bus.
   * For checked_in (not yet handed over), entry is omitted — callers use roster.
   */
  runs: Map<string, string | null>;
};

/** Eligible return-bus passengers for a session; null when no floor rows yet. */
export async function listReturnHomeBusEligibleParticipantIds(
  sessionId: string,
): Promise<ReturnHomeBusEligible | null> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id, status, return_transport, return_bus_run_code")
    .eq("event_day_session_id", sessionId);
  if (error) {
    // Pre-migration: column missing — retry without run code.
    if (isSchemaMismatchError(error) || String(error.message ?? "").includes("return_bus_run_code")) {
      const retry = await supabase
        .from("event_attendance_log")
        .select("participant_id, status, return_transport")
        .eq("event_day_session_id", sessionId);
      if (retry.error) throw retry.error;
      if (!retry.data?.length) return null;
      const ids = new Set<string>();
      for (const row of retry.data) {
        const r = row as { participant_id: string; status: string; return_transport: string | null };
        if (isEligibleForReturnHomeBus(r)) ids.add(r.participant_id);
      }
      return { ids, runs: new Map() };
    }
    throw error;
  }
  if (!data?.length) return null;

  const ids = new Set<string>();
  const runs = new Map<string, string | null>();
  for (const row of data) {
    const r = row as {
      participant_id: string;
      status: string;
      return_transport: string | null;
      return_bus_run_code?: string | null;
    };
    if (!isEligibleForReturnHomeBus(r)) continue;
    ids.add(r.participant_id);
    if ((r.status ?? "").toLowerCase() === "checked_out") {
      runs.set(r.participant_id, (r.return_bus_run_code ?? "").trim() || null);
    }
  }
  return { ids, runs };
}

/** Resolve session by event + date, then floor-eligible return bus set. */
export async function resolveReturnHomeBusEligibleIds(opts: {
  eventId: string;
  sessionDate?: string | null;
  sessionId?: string | null;
}): Promise<ReturnHomeBusEligible | null> {
  if (opts.sessionId?.trim()) {
    const byId = await listReturnHomeBusEligibleParticipantIds(opts.sessionId.trim());
    if (byId) return byId;
  }

  const date = opts.sessionDate?.slice(0, 10) || null;
  if (date) {
    const { data, error } = await supabase
      .from("event_day_sessions")
      .select("id")
      .eq("event_id", opts.eventId)
      .eq("session_date", date)
      .maybeSingle();
    if (error) throw error;
    const sessionId = (data as { id?: string } | null)?.id ?? null;
    if (sessionId) {
      const byDate = await listReturnHomeBusEligibleParticipantIds(sessionId);
      if (byDate) return byDate;
    }
  }

  // Fallback: latest trip day with floor rows (stale trip_date / missing session link).
  const sessions = await listEventDaySessions(opts.eventId);
  for (const s of [...sessions].sort((a, b) =>
    b.session_date.localeCompare(a.session_date),
  )) {
    const set = await listReturnHomeBusEligibleParticipantIds(s.id);
    if (set) return set;
  }
  return null;
}

// ============================================================================
// Return transport assessment (§12.4.3a / §12.4.4)
// ============================================================================

export interface EventReturnTransportAssessment {
  /** Outing split: completed depot → venue run (`trip_return = none`). */
  hasCompletedOutbound: boolean;
  /** Completed venue → depot run (`trip_return ≠ none`). */
  hasCompletedReturn: boolean;
  /** Active trip still open for this event. */
  hasActiveTrip: boolean;
  /** Bus passengers expected on the return manifest. */
  busReturnPassengerCount: number;
  /** Return home manifest still required before the event may close. */
  needsReturnRun: boolean;
}

type TransportTripRow = { status: string; trip_return: string | null };

function isOutboundSplitTrip(t: TransportTripRow): boolean {
  return (t.trip_return ?? "depot") === "none";
}

function isReturnSplitTrip(t: TransportTripRow): boolean {
  return (t.trip_return ?? "depot") !== "none";
}

/** §12.4.4 — detect whether a separate return manifest is still outstanding. */
export async function assessEventReturnTransport(
  eventId: string,
): Promise<EventReturnTransportAssessment> {
  const { data: trips, error: tripErr } = await supabase
    .from("transport_trips")
    .select("status, trip_return, trip_kind")
    .eq("event_id", eventId);
  if (tripErr) throw tripErr;

  const tripRows = (trips ?? []) as Array<
    TransportTripRow & { trip_kind?: string | null }
  >;
  const hasCompletedOutbound = tripRows.some(
    (t) => t.status === "completed" && isOutboundSplitTrip(t),
  );
  // Multi-day final day may only have venue hops (no classic Depot→venue outbound).
  const hasCompletedVenueHop = tripRows.some(
    (t) => t.status === "completed" && t.trip_kind === "event_venue_hop",
  );
  const hasCompletedReturn = tripRows.some(
    (t) => t.status === "completed" && isReturnSplitTrip(t),
  );
  const hasActiveTrip = tripRows.some((t) => t.status === "active");

  const sessions = await listEventDaySessions(eventId);
  const lastSession = [...sessions].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  ).at(-1);

  let busReturnPassengerCount = 0;
  const floorEligible = lastSession
    ? await listReturnHomeBusEligibleParticipantIds(lastSession.id)
    : null;

  if (floorEligible) {
    busReturnPassengerCount = floorEligible.ids.size;
  } else {
    const actualTransport = await fetchEventActualTransport(eventId);
    const { data: bookings, error: bookErr } = await supabase
      .from("event_roster_bookings")
      .select("participant_id, return_transport_mode")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
    if (bookErr) throw bookErr;

    for (const b of bookings ?? []) {
      const row = b as { participant_id: string; return_transport_mode: string | null };
      const planned = normalizeEventTransportMode(row.return_transport_mode);
      const actual = actualTransport.get(row.participant_id)?.return;
      if ((actual ?? planned) === "bus") busReturnPassengerCount++;
    }
  }

  const inboundSatisfied = hasCompletedOutbound || hasCompletedVenueHop;
  const needsReturnRun =
    inboundSatisfied && !hasCompletedReturn && busReturnPassengerCount > 0;

  return {
    hasCompletedOutbound,
    hasCompletedReturn,
    hasActiveTrip,
    busReturnPassengerCount,
    needsReturnRun,
  };
}

export const eventReturnTransportKey = (eventId: string) =>
  ["event-return-transport", eventId] as const;

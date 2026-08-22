/**
 * Office Event Manage Live tab — read-only projection of field state (BL-120).
 * Composes existing list APIs. Does not write (no accountability placeholder upsert).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { listEventAttendanceRoll, type EventAttendanceRow } from "@/lib/api/event-attendance";
import { listBusManifest } from "@/lib/api/event-day-ops";
import {
  sessionRequiresEveningRoll,
  sessionRequiresMorningRoll,
} from "@/lib/api/event-deliver-status";
import {
  listEventTransportRuns,
  pickTripForRun,
  type EventTransportRunCard,
  type EventTransportRunKind,
  type EventTransportRunStatus,
} from "@/lib/api/event-hop-transport";
import {
  isMealStop,
  isMedicationStop,
  listEventDaySessions,
  listEventVenueStops,
  type EventDayPhase,
  type EventDaySession,
  type EventMealSlot,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import { listEventDayIssues, sortByRygeNewestFirst, type RygeSeverity } from "@/lib/api/site-issues";
import { matchesEventBusRun } from "@/lib/event-bus-runs";
import {
  isCancelledPickupLeg,
  isPassengerPickupLeg,
  mapTripLegFromDb,
  type TripLeg,
} from "@/lib/data-store";
import { sortByParticipantSurname, type SurnameSortable } from "@/lib/ui/sort-participants";

const MEAL_SLOT_LABELS: Record<EventMealSlot, string> = {
  breakfast: "Breakfast",
  morning_tea: "Morning tea",
  lunch: "Lunch",
  dinner: "Dinner",
};

export type EventWatchPickupState =
  | "waiting"
  | "picked_up"
  | "on_bus"
  | "cancelled"
  | "self_arriving";

export type EventWatchAttendanceState = "expected" | "checked_in" | "absent" | "checked_out";

export type EventWatchBoardState = "expected" | "on_bus" | "not_travelling";

export type EventWatchRollState = "expected" | "accounted" | "absent";

export type EventWatchPersonState =
  | EventWatchPickupState
  | EventWatchAttendanceState
  | EventWatchBoardState
  | EventWatchRollState;

export interface EventWatchPerson {
  participantId: string;
  name: string;
  state: EventWatchPersonState;
  stamp: string | null;
  detail?: string;
}

export interface EventWatchTransportGroup {
  key: string;
  kind: EventTransportRunKind | "self";
  label: string;
  runStatus: EventTransportRunStatus | "n_a";
  busRunShortLabel?: string | null;
  people: EventWatchPerson[];
}

export interface EventWatchProgrammeStop {
  id: string;
  label: string;
  kind: "venue" | "meal" | "medication_round";
  phase: string;
  openedAt: string | null;
  closedAt: string | null;
  movementMethod: string | null;
  current: boolean;
}

export interface EventWatchRoll {
  kind: "morning" | "evening";
  required: boolean;
  complete: boolean;
  total: number;
  resolved: number;
  pending: number;
  people: EventWatchPerson[];
}

export interface EventWatchIssue {
  id: string;
  title: string;
  severity: RygeSeverity;
  status: string;
  createdAt: string;
}

export interface EventWatchSnapshot {
  sessionId: string;
  sessionDate: string;
  sessionPhase: EventDayPhase;
  /** True when the field has written any floor / run / programme data. */
  floorStarted: boolean;
  inbound: EventWatchTransportGroup[];
  hops: EventWatchTransportGroup[];
  home: EventWatchTransportGroup[];
  attendance: EventWatchPerson[];
  programme: EventWatchProgrammeStop[];
  morningRoll: EventWatchRoll | null;
  eveningRoll: EventWatchRoll | null;
  openIssues: EventWatchIssue[];
}

export const eventWatchKey = (eventId: string, sessionId: string) =>
  ["event-watch", eventId, sessionId] as const;

export function pickEventWatchSession(
  sessions: EventDaySession[],
  todayIso: string,
): EventDaySession | null {
  if (sessions.length === 0) return null;
  const today = sessions.find((s) => s.session_date === todayIso);
  if (today) return today;
  const live = [...sessions].reverse().find((s) =>
    s.phase === "active" ||
    s.phase === "in_transit" ||
    s.phase === "at_base" ||
    s.phase === "pre_departure",
  );
  if (live) return live;
  return sessions[sessions.length - 1] ?? null;
}

interface RosterBooking {
  participant_id: string;
  outbound_transport_mode: string | null;
  return_transport_mode: string | null;
  outbound_bus_run_code: string | null;
  return_bus_run_code: string | null;
}

function displayName(id: string, names: Map<string, SurnameSortable>): string {
  const p = names.get(id);
  const full = `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim();
  return full || "Unknown";
}

function sortPeople(
  people: EventWatchPerson[],
  names: Map<string, SurnameSortable>,
): EventWatchPerson[] {
  return sortByParticipantSurname(people, (p) => p.participantId, names);
}

function pickupStateFromLeg(leg: TripLeg): EventWatchPickupState {
  if (isCancelledPickupLeg(leg)) return "cancelled";
  if (leg.status === "completed") return "on_bus";
  if (leg.status === "en_route" || leg.status === "arrived") return "picked_up";
  return "waiting";
}

function pickupStamp(leg: TripLeg): string | null {
  if (leg.status === "completed") return leg.completedAt ?? leg.endAt;
  if (leg.status === "arrived") return leg.endAt ?? leg.startAt;
  if (leg.status === "en_route") return leg.startAt;
  return null;
}

function arrivalMethodLabel(method: string | null | undefined, runCode: string | null): string {
  const run = runCode?.trim();
  if (method === "bus") return run ? `Bus ${run}` : "Bus";
  if (method === "private") return "Self";
  if (method === "walk_in") return "Walk-in";
  if (method === "other") return "Other";
  return method?.trim() || "";
}

function stopLabel(stop: EventVenueStop): string {
  if (isMealStop(stop) && stop.meal_slot) {
    return MEAL_SLOT_LABELS[stop.meal_slot] ?? "Meal";
  }
  if (isMedicationStop(stop)) return "Medication round";
  return stop.label_override?.trim() || stop.venue_name?.trim() || "Venue";
}

function isLocationLive(phase: EventDayPhase): boolean {
  return (
    phase === "pre_departure" ||
    phase === "active" ||
    phase === "in_transit" ||
    phase === "at_base" ||
    phase === "closed_orderly" ||
    phase === "closed_incident"
  );
}

async function fetchRosterBookings(eventId: string): Promise<RosterBooking[]> {
  const withRuns =
    "participant_id, outbound_transport_mode, return_transport_mode, outbound_bus_run_code, return_bus_run_code";
  let result = await supabase
    .from("event_roster_bookings")
    .select(withRuns)
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");
  if (result.error && isSchemaMismatchError(result.error)) {
    result = await supabase
      .from("event_roster_bookings")
      .select("participant_id, outbound_transport_mode, return_transport_mode")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error && isSchemaMismatchError(result.error)) {
    result = await supabase
      .from("event_roster_bookings")
      .select("participant_id")
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error) throw result.error;
  return ((result.data ?? []) as Array<Partial<RosterBooking>>).map((b) => ({
    participant_id: String(b.participant_id ?? ""),
    outbound_transport_mode: b.outbound_transport_mode ?? null,
    return_transport_mode: b.return_transport_mode ?? null,
    outbound_bus_run_code: b.outbound_bus_run_code ?? null,
    return_bus_run_code: b.return_bus_run_code ?? null,
  })).filter((b) => b.participant_id);
}

async function fetchTripLegs(tripId: string): Promise<TripLeg[]> {
  const { data, error } = await supabase
    .from("trip_legs")
    .select("*")
    .eq("trip_id", tripId)
    .order("leg_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapTripLegFromDb(row));
}

async function fetchEventSessionTrips(
  eventId: string,
  sessionId: string,
  sessionDate: string,
): Promise<Record<string, unknown>[]> {
  const [sessionRes, dateRes] = await Promise.all([
    supabase.from("transport_trips").select("*").eq("event_day_session_id", sessionId),
    supabase
      .from("transport_trips")
      .select("*")
      .eq("event_id", eventId)
      .eq("trip_date", sessionDate),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (dateRes.error) throw dateRes.error;
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of [...(sessionRes.data ?? []), ...(dateRes.data ?? [])]) {
    byId.set((row as { id: string }).id, row as Record<string, unknown>);
  }
  return [...byId.values()];
}

function isWatchOutboundTrip(row: Record<string, unknown>): boolean {
  if (row.trip_kind === "event_venue_hop" || row.hop_index != null) return false;
  if (String(row.status ?? "").toLowerCase() === "cancelled") return false;
  const ret = row.trip_return as string | null | undefined;
  return ret === "none" || ret == null;
}

function pickupStateRank(state: EventWatchPersonState): number {
  switch (state) {
    case "on_bus":
      return 4;
    case "picked_up":
      return 3;
    case "cancelled":
    case "not_travelling":
      return 2;
    default:
      return 0;
  }
}

function mergeWatchPeople(people: EventWatchPerson[]): EventWatchPerson[] {
  const byId = new Map<string, EventWatchPerson>();
  for (const person of people) {
    const prev = byId.get(person.participantId);
    if (!prev) {
      byId.set(person.participantId, person);
      continue;
    }
    const nextRank = pickupStateRank(person.state);
    const prevRank = pickupStateRank(prev.state);
    if (nextRank > prevRank) {
      byId.set(person.participantId, {
        ...person,
        stamp: person.stamp ?? prev.stamp,
      });
    } else if (!prev.stamp && person.stamp) {
      byId.set(person.participantId, { ...prev, stamp: person.stamp });
    }
  }
  return [...byId.values()];
}

async function loadNameParts(ids: string[]): Promise<Map<string, SurnameSortable>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, SurnameSortable>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase
    .from("participants")
    .select("id, first_name, last_name")
    .in("id", unique);
  if (error) throw error;
  for (const p of data ?? []) {
    const row = p as { id: string; first_name?: string; last_name?: string };
    map.set(row.id, {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
    });
  }
  return map;
}

/** Read-only merge of checked-in floor + existing log rows. No placeholder upsert. */
async function listRollReadOnly(
  table: "event_morning_log" | "event_curfew_log",
  sessionId: string,
): Promise<Array<{ participantId: string; status: EventWatchRollState; stamp: string | null }>> {
  const [{ data: attendees, error: attErr }, { data: logRows, error: logErr }] =
    await Promise.all([
      supabase
        .from("event_attendance_log")
        .select("participant_id")
        .eq("event_day_session_id", sessionId)
        .eq("status", "checked_in"),
      supabase
        .from(table)
        .select("participant_id, status, accounted_at")
        .eq("event_day_session_id", sessionId),
    ]);
  if (attErr) throw attErr;
  if (logErr) throw logErr;

  const logMap = new Map<
    string,
    { status: EventWatchRollState; stamp: string | null }
  >();
  for (const r of logRows ?? []) {
    const pid = String((r as { participant_id: string }).participant_id);
    const status = ((r as { status?: string }).status ?? "expected") as EventWatchRollState;
    logMap.set(pid, {
      status: status === "accounted" || status === "absent" ? status : "expected",
      stamp: (r as { accounted_at?: string | null }).accounted_at ?? null,
    });
  }

  const checkedIn = (attendees ?? []).map((a) => String(a.participant_id));
  const seen = new Set<string>();
  const out: Array<{ participantId: string; status: EventWatchRollState; stamp: string | null }> = [];
  for (const pid of checkedIn) {
    seen.add(pid);
    const existing = logMap.get(pid);
    out.push({
      participantId: pid,
      status: existing?.status ?? "expected",
      stamp: existing?.stamp ?? null,
    });
  }
  for (const [pid, row] of logMap) {
    if (seen.has(pid)) continue;
    out.push({ participantId: pid, status: row.status, stamp: row.stamp });
  }
  return out;
}

function peopleFromPickupLegs(
  legs: TripLeg[],
  names: Map<string, SurnameSortable>,
): EventWatchPerson[] {
  const people: EventWatchPerson[] = [];
  for (const leg of legs.filter(isPassengerPickupLeg)) {
    const pid = leg.toParticipantId;
    if (!pid) continue;
    people.push({
      participantId: pid,
      name: displayName(pid, names),
      state: pickupStateFromLeg(leg),
      stamp: pickupStamp(leg),
    });
  }
  return people;
}

function peopleFromManifest(
  rows: Awaited<ReturnType<typeof listBusManifest>>,
  names: Map<string, SurnameSortable>,
): EventWatchPerson[] {
  const people: EventWatchPerson[] = [];
  for (const row of rows) {
    const pid = row.participant_id;
    if (!pid) continue;
    people.push({
      participantId: pid,
      name: row.participant_name?.trim() || displayName(pid, names),
      state: row.status,
      stamp: row.checked_on_at,
    });
  }
  return people;
}

function buildInboundGroup(
  card: EventTransportRunCard,
  legs: TripLeg[],
  manifest: Awaited<ReturnType<typeof listBusManifest>>,
  bookings: RosterBooking[],
  names: Map<string, SurnameSortable>,
): EventWatchTransportGroup {
  const fromLegs = peopleFromPickupLegs(legs, names);
  const fromManifest = peopleFromManifest(manifest, names).map((p) => ({
    ...p,
    state:
      p.state === "on_bus"
        ? ("on_bus" as const)
        : p.state === "not_travelling"
          ? ("cancelled" as const)
          : p.state,
  }));
  const extras: EventWatchPerson[] = [];
  for (const b of bookings) {
    if ((b.outbound_transport_mode ?? "bus") !== "bus") continue;
    if (!matchesEventBusRun(b.outbound_bus_run_code, card.busRunCode)) continue;
    extras.push({
      participantId: b.participant_id,
      name: displayName(b.participant_id, names),
      state: "waiting",
      stamp: null,
    });
  }
  return {
    key: card.key,
    kind: "outbound",
    label: card.label,
    runStatus: card.status,
    busRunShortLabel: card.busRunShortLabel,
    people: sortPeople(mergeWatchPeople([...fromLegs, ...fromManifest, ...extras]), names),
  };
}

function buildBoardedGroup(
  card: EventTransportRunCard,
  manifest: Awaited<ReturnType<typeof listBusManifest>>,
  legs: TripLeg[],
  fallbackPeople: EventWatchPerson[],
  names: Map<string, SurnameSortable>,
): EventWatchTransportGroup {
  let people = peopleFromManifest(manifest, names);
  if (people.length === 0 && legs.length > 0) {
    people = peopleFromPickupLegs(legs, names);
  }
  if (people.length === 0) {
    people = fallbackPeople;
  }
  return {
    key: card.key,
    kind: card.kind,
    label: card.label,
    runStatus: card.status,
    busRunShortLabel: card.busRunShortLabel,
    people: sortPeople(people, names),
  };
}

export async function fetchEventWatchSnapshot(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<EventWatchSnapshot> {
  const [
    sessions,
    transportRuns,
    attendance,
    allStops,
    issues,
    bookings,
    showMorning,
    showEvening,
  ] = await Promise.all([
    listEventDaySessions(opts.eventId),
    listEventTransportRuns(opts),
    listEventAttendanceRoll(opts.sessionId),
    listEventVenueStops(opts.eventId),
    listEventDayIssues(opts.sessionId),
    fetchRosterBookings(opts.eventId),
    sessionRequiresMorningRoll(opts.eventId, opts.sessionDate),
    sessionRequiresEveningRoll(opts.eventId, opts.sessionDate),
  ]);

  const session = sessions.find((s) => s.id === opts.sessionId);
  const sessionPhase = (session?.phase ?? "planning") as EventDayPhase;

  const sessionTrips = await fetchEventSessionTrips(
    opts.eventId,
    opts.sessionId,
    opts.sessionDate,
  );

  const tripIds = [
    ...new Set([
      ...transportRuns.map((r) => r.tripId).filter((id): id is string => !!id),
      ...sessionTrips
        .map((t) => String(t.id ?? ""))
        .filter(Boolean),
    ]),
  ];

  const [legsEntries, manifestEntries, morningRows, eveningRows] = await Promise.all([
    Promise.all(tripIds.map(async (id) => [id, await fetchTripLegs(id)] as const)),
    Promise.all(tripIds.map(async (id) => [id, await listBusManifest(id)] as const)),
    showMorning ? listRollReadOnly("event_morning_log", opts.sessionId) : Promise.resolve([]),
    showEvening ? listRollReadOnly("event_curfew_log", opts.sessionId) : Promise.resolve([]),
  ]);

  const legsByTrip = new Map(legsEntries);
  const manifestByTrip = new Map(manifestEntries);

  const nameIds = [
    ...bookings.map((b) => b.participant_id),
    ...attendance.map((a) => a.participantId),
    ...morningRows.map((r) => r.participantId),
    ...eveningRows.map((r) => r.participantId),
    ...[...legsByTrip.values()].flatMap((legs) =>
      legs.map((l) => l.toParticipantId).filter((id): id is string => !!id),
    ),
    ...[...manifestByTrip.values()].flatMap((rows) =>
      rows.map((r) => r.participant_id).filter((id): id is string => !!id),
    ),
  ];
  const names = await loadNameParts(nameIds);

  const inboundCards = transportRuns.filter((c) => c.kind === "outbound");
  const outboundTrips = sessionTrips.filter(isWatchOutboundTrip);
  const inbound: EventWatchTransportGroup[] = inboundCards.map((card) => {
    const matching = outboundTrips.filter((t) =>
      matchesEventBusRun(
        String(t.bus_run_code ?? "").trim() || null,
        card.busRunCode,
      ),
    );
    const preferred = pickTripForRun(matching, card.busRunCode ?? null);
    const tripIdsForRun = [
      ...new Set(
        [preferred?.id, ...matching.map((t) => t.id), card.tripId]
          .map((id) => (id ? String(id) : ""))
          .filter(Boolean),
      ),
    ];
    const legs = tripIdsForRun.flatMap((id) => legsByTrip.get(id) ?? []);
    const manifest = tripIdsForRun.flatMap((id) => manifestByTrip.get(id) ?? []);
    return buildInboundGroup(card, legs, manifest, bookings, names);
  });

  const selfBookings = bookings.filter(
    (b) => (b.outbound_transport_mode ?? "bus") === "self",
  );
  if (selfBookings.length > 0) {
    const attById = new Map(attendance.map((a) => [a.participantId, a]));
    inbound.push({
      key: "outbound:self",
      kind: "self",
      label: "Self-arriving",
      runStatus: "n_a",
      people: sortPeople(
        selfBookings.map((b) => {
          const att = attById.get(b.participant_id);
          return {
            participantId: b.participant_id,
            name: displayName(b.participant_id, names),
            state: "self_arriving" as const,
            stamp: att?.checkedInAt ?? null,
            detail: att?.status === "checked_in" ? "At venue" : undefined,
          };
        }),
        names,
      ),
    });
  }

  const hops = transportRuns
    .filter((c) => c.kind === "venue_hop")
    .map((card) =>
      buildBoardedGroup(
        card,
        card.tripId ? manifestByTrip.get(card.tripId) ?? [] : [],
        card.tripId ? legsByTrip.get(card.tripId) ?? [] : [],
        [],
        names,
      ),
    );

  const home = transportRuns
    .filter((c) => c.kind === "return")
    .map((card) => {
      const fallback = bookings
        .filter((b) => (b.return_transport_mode ?? "bus") === "bus")
        .filter((b) => matchesEventBusRun(b.return_bus_run_code, card.busRunCode))
        .map((b) => ({
          participantId: b.participant_id,
          name: displayName(b.participant_id, names),
          state: "expected" as const,
          stamp: null,
        }));
      const boarded = attendance
        .filter(
          (a) =>
            a.status === "checked_out" &&
            a.returnTransport === "bus" &&
            matchesEventBusRun(a.returnBusRunCode, card.busRunCode),
        )
        .map((a) => ({
          participantId: a.participantId,
          name: displayName(a.participantId, names),
          state: "expected" as const,
          stamp: a.checkedOutAt,
          detail: "Handed to bus",
        }));
      const fallbackPeople =
        (card.tripId ? manifestByTrip.get(card.tripId)?.length : 0) ||
        (card.tripId ? (legsByTrip.get(card.tripId) ?? []).some(isPassengerPickupLeg) : false)
          ? []
          : boarded.length > 0
            ? boarded
            : fallback;
      return buildBoardedGroup(
        card,
        card.tripId ? manifestByTrip.get(card.tripId) ?? [] : [],
        card.tripId ? legsByTrip.get(card.tripId) ?? [] : [],
        fallbackPeople,
        names,
      );
    });

  const attendancePeople = sortPeople(
    attendance.map((a: EventAttendanceRow) => ({
      participantId: a.participantId,
      name: a.participantName?.trim() || displayName(a.participantId, names),
      state: a.status,
      stamp:
        a.status === "checked_out"
          ? a.checkedOutAt
          : a.status === "checked_in"
            ? a.checkedInAt
            : null,
      detail: arrivalMethodLabel(a.arrivalMethod, a.arrivalBusRunCode),
    })),
    names,
  );

  const todayStops = allStops
    .filter((s) => s.session_date === opts.sessionDate)
    .sort((a, b) => a.stop_order - b.stop_order);
  const currentStopId =
    todayStops.find((s) => (s.phase ?? "pending") === "active")?.id ??
    todayStops.find((s) => (s.phase ?? "pending") === "pending")?.id ??
    null;

  const programme: EventWatchProgrammeStop[] = todayStops.map((s) => {
    const kind = isMealStop(s)
      ? "meal"
      : isMedicationStop(s)
        ? "medication_round"
        : "venue";
    return {
      id: s.id,
      label: stopLabel(s),
      kind,
      phase: s.phase ?? "pending",
      openedAt: s.opened_at ?? null,
      closedAt: s.closed_at ?? null,
      movementMethod: s.movement_method ?? null,
      current: s.id === currentStopId && (s.phase ?? "pending") !== "completed",
    };
  });

  const toRoll = (
    kind: "morning" | "evening",
    rows: Array<{ participantId: string; status: EventWatchRollState; stamp: string | null }>,
  ): EventWatchRoll => {
    const people = sortPeople(
      rows.map((r) => ({
        participantId: r.participantId,
        name: displayName(r.participantId, names),
        state: r.status,
        stamp: r.stamp,
      })),
      names,
    );
    const resolved = rows.filter((r) => r.status === "accounted" || r.status === "absent").length;
    return {
      kind,
      required: true,
      complete: rows.length > 0 && resolved === rows.length,
      total: rows.length,
      resolved,
      pending: rows.length - resolved,
      people,
    };
  };

  const openIssues = sortByRygeNewestFirst(
    issues
      .filter((i) => i.status !== "resolved")
      .map((i) => ({
        id: i.id,
        title: i.issueDescription,
        severity: i.severity,
        status: i.status,
        createdAt: i.createdAt,
      })),
  );

  const hasAttendanceProgress = attendance.some((a) => a.status !== "expected");
  const hasStopProgress = todayStops.some(
    (s) => s.phase === "active" || s.phase === "completed",
  );
  const hasTrip = transportRuns.some((r) => !!r.tripId);
  const floorStarted =
    isLocationLive(sessionPhase) || hasAttendanceProgress || hasStopProgress || hasTrip;

  return {
    sessionId: opts.sessionId,
    sessionDate: opts.sessionDate,
    sessionPhase,
    floorStarted,
    inbound,
    hops,
    home,
    attendance: attendancePeople,
    programme,
    morningRoll: showMorning ? toRoll("morning", morningRows) : null,
    eveningRoll: showEvening ? toRoll("evening", eveningRows) : null,
    openIssues,
  };
}

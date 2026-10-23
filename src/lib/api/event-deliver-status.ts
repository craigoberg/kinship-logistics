/**
 * Event Deliver — group journey status (GUARDRAILS §12.13.8)
 *
 * Derives a read-only timeline for trip leaders: arrival roll, morning roll
 * (multi-day day 2+), bus hops (§11 Manifest + event_bus_manifest), activities,
 * and evening roll (multi-day non-final nights).
 */
import { supabase } from "@/integrations/supabase/client";
import { listEventAttendanceRoll } from "@/lib/api/event-attendance";
import { listEventSupportAttendance, listEventSupportBookings } from "@/lib/api/event-support";
import {
  listAccountabilityRoll,
  listBusManifest,
  type EventAccountabilityRow,
} from "@/lib/api/event-day-ops";
import {
  listEventVenueStops,
  listEventDaySessions,
  isMealStop,
  isMedicationStop,
  isPassengerStop,
  isVenueTransportStop,
  type EventDayPhase,
  type EventMealSlot,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import { laterPickupIds, listPassengerAssignments, type PassengerAssignment } from "@/lib/api/passenger-stops";
import { addressKey, joinsOnTheWay } from "@/lib/passenger-stops";
import type { StopPhase } from "@/lib/api/event-activity-roll";

const MEAL_SLOT_LABELS: Record<EventMealSlot, string> = {
  breakfast: "Breakfast",
  morning_tea: "Morning tea",
  lunch: "Lunch",
  dinner: "Dinner",
};

export type StatusStepState = "complete" | "current" | "upcoming";

/** When a group-status step opened, closed, left, or arrived. ISO instants. */
export interface StatusStamp {
  label: string;
  at: string;
}

export interface EventDeliverStatusStep {
  id: string;
  label: string;
  detail?: string;
  state: StatusStepState;
  /** Open / close / left / arrived clocks already stored on the floor tables. */
  stamps?: StatusStamp[];
}

export type EventDeliverSuggestedTab =
  | "morning-roll"
  | "checkin"
  | "activities"
  | "curfew-roll"
  | "checkout";

export interface EventDeliverGroupStatus {
  headline: string;
  subline?: string;
  tone: "planning" | "arrival" | "roll" | "transit" | "activity" | "base" | "closed";
  steps: EventDeliverStatusStep[];
  /** True when morning roll is required on this day and not yet complete. */
  morningRollBlocksProgramme: boolean;
}

/**
 * Field tab to open from Group Status — wake → Morning Roll, back at hotel →
 * Evening Roll, programme done on final day → Check-Out.
 */
export function deriveEventDeliverSuggestedTab(
  status: EventDeliverGroupStatus,
  opts: {
    showMorningRoll: boolean;
    showEveningRoll: boolean;
    showCheckOut: boolean;
    hasProgramme: boolean;
  },
): EventDeliverSuggestedTab {
  const current = status.steps.find((s) => s.state === "current");
  if (current?.id === "morning-roll") return "morning-roll";
  if (current?.id === "evening-roll") return "curfew-roll";
  if (current?.id === "arrival") return "checkin";
  if (current?.id === "base-end") {
    return opts.showCheckOut ? "checkout" : "activities";
  }
  if (
    current &&
    (current.id.startsWith("onsite-") ||
      current.id.includes("depart") ||
      current.id.includes("-at") ||
      current.id.startsWith("hop"))
  ) {
    return opts.hasProgramme ? "activities" : opts.showCheckOut ? "checkout" : "checkin";
  }

  if (status.tone === "roll") {
    if (opts.showEveningRoll && status.headline.toLowerCase().includes("evening")) {
      return "curfew-roll";
    }
    if (opts.showMorningRoll) return "morning-roll";
  }
  if (status.tone === "base" && opts.showCheckOut) return "checkout";
  if (status.tone === "base" && opts.showEveningRoll) return "curfew-roll";
  if (status.tone === "transit" || status.tone === "activity") {
    return opts.hasProgramme ? "activities" : opts.showCheckOut ? "checkout" : "checkin";
  }
  if (status.tone === "arrival") return "checkin";
  if (opts.showMorningRoll) return "morning-roll";
  return "checkin";
}

/** Day 2+ overnight: hide arrival Check-In once the wake roll is already complete. */
export function shouldHideEventDeliverCheckIn(
  status: EventDeliverGroupStatus,
  showMorningRoll: boolean,
): boolean {
  if (!showMorningRoll) return false;
  const arrival = status.steps.find((s) => s.id === "arrival");
  return arrival?.state === "complete";
}

export const eventDeliverStatusKey = (sessionId: string) =>
  ["event-deliver-group-status", sessionId] as const;

export interface AccountabilityProgress {
  total: number;
  resolved: number;
  pending: number;
  /** Count of left-trip Absent placeholders on this roll. */
  absent: number;
  /** All roll rows resolved (accounted/absent). Empty roll is not complete unless vacuous. */
  complete: boolean;
  /** First person marked on this roll. */
  openedAt: string | null;
  /** Last person marked — set only once the roll is complete. */
  closedAt: string | null;
}

type VenueStopRow = EventVenueStop & {
  phase?: StopPhase | null;
  movement_method?: string | null;
};

function stopLabel(stop: VenueStopRow | undefined, fallback = "Venue"): string {
  if (!stop) return fallback;
  return stop.label_override ?? stop.venue_name ?? fallback;
}

export interface OvernightWakeBase {
  label: string;
  /** Today's stop row for the overnight venue, if listed on the itinerary. */
  todayStop: VenueStopRow | null;
  priorVenueId: string | null;
  /** Prior day's last stop — boarding origin when the hotel is omitted today. */
  priorLastStop: VenueStopRow | null;
  /**
   * True when Day 2+ wakes at last night's venue but today's itinerary starts
   * elsewhere (e.g. Venue 3 overnight → only Joes listed for the final day).
   */
  hotelOmitted: boolean;
}

/**
 * Day 2+ wake location = prior calendar day's last itinerary stop (overnight venue).
 * Prefer today's stop with the same venue_id; otherwise label from the prior stop
 * (itinerary may omit the hotel on the final day).
 */
export function resolveOvernightWakeBase(
  allStops: EventVenueStop[],
  sessionDate: string,
  todayStops: EventVenueStop[],
): OvernightWakeBase {
  const allRows = allStops as VenueStopRow[];
  const todayRows = todayStops as VenueStopRow[];
  // Meals / meds are not overnight hotels or hop origins.
  const todayVenues = todayRows.filter((s) => isVenueTransportStop(s));
  const priorDates = [
    ...new Set(
      allRows
        .map((s) => s.session_date)
        .filter((d): d is string => !!d && d < sessionDate),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const priorDate = priorDates[priorDates.length - 1];
  if (!priorDate) {
    const first = todayVenues[0] ?? null;
    return {
      label: stopLabel(first),
      todayStop: first,
      priorVenueId: first?.venue_id ?? null,
      priorLastStop: null,
      hotelOmitted: false,
    };
  }

  const priorVenues = allRows
    .filter((s) => s.session_date === priorDate)
    .filter((s) => isVenueTransportStop(s))
    .sort((a, b) => a.stop_order - b.stop_order);
  const priorLast = priorVenues[priorVenues.length - 1] ?? null;
  const priorVenueId = priorLast?.venue_id ?? null;
  const matchToday =
    priorVenueId != null
      ? (todayVenues.find((s) => s.venue_id === priorVenueId) ?? null)
      : null;
  const firstToday = todayVenues[0] ?? null;
  const hotelOmitted =
    matchToday == null &&
    priorVenueId != null &&
    firstToday != null &&
    firstToday.venue_id !== priorVenueId;

  return {
    label: stopLabel(matchToday ?? priorLast, stopLabel(firstToday)),
    todayStop: matchToday,
    priorVenueId,
    priorLastStop: priorLast,
    hotelOmitted,
  };
}

function placesDiffer(a: VenueStopRow, b: VenueStopRow): boolean {
  if (a.venue_id && b.venue_id) return a.venue_id !== b.venue_id;
  return stopLabel(a) !== stopLabel(b);
}

/**
 * Consecutive place-to-place hops.
 * A meeting-point meal at a different place starts the chain.
 * Later meals and medication rounds stay on-site at the current place.
 */
export function buildProgrammeHops(
  todayStops: EventVenueStop[],
  overnightWake: OvernightWakeBase | null,
): Array<{ from: VenueStopRow; to: VenueStopRow; hopIndex: number }> {
  const ordered = [...(todayStops as VenueStopRow[])].sort((a, b) => a.stop_order - b.stop_order);
  const venues = ordered.filter((s) => isVenueTransportStop(s));
  const hops: Array<{ from: VenueStopRow; to: VenueStopRow; hopIndex: number }> = [];
  let hopIndex = 0;

  if (
    overnightWake?.hotelOmitted &&
    overnightWake.priorLastStop &&
    venues[0]
  ) {
    hops.push({
      from: overnightWake.priorLastStop,
      to: venues[0],
      hopIndex: hopIndex++,
    });
  }

  const first = ordered[0];
  const firstVenue = venues[0];
  if (
    !overnightWake?.hotelOmitted &&
    first &&
    firstVenue &&
    first.id !== firstVenue.id &&
    isOnSiteProgrammeStop(first) &&
    placesDiffer(first, firstVenue)
  ) {
    hops.push({
      from: first,
      to: firstVenue,
      hopIndex: hopIndex++,
    });
  }

  for (let i = 0; i < venues.length - 1; i++) {
    hops.push({
      from: venues[i]!,
      to: venues[i + 1]!,
      hopIndex: hopIndex++,
    });
  }

  return hops;
}

function isOnSiteProgrammeStop(stop: VenueStopRow): boolean {
  return isMealStop(stop) || isMedicationStop(stop);
}

/** Activities scheduled after `venue` and before `nextVenue` (or end of day). */
function onSiteActivitiesAtVenue(
  todayStops: VenueStopRow[],
  venue: VenueStopRow,
  nextVenue: VenueStopRow | null,
): VenueStopRow[] {
  return todayStops.filter((s) => {
    if (!isOnSiteProgrammeStop(s)) return false;
    if (s.stop_order <= venue.stop_order) return false;
    if (nextVenue && s.stop_order >= nextVenue.stop_order) return false;
    return true;
  });
}

function onSiteBeforeFirstVenue(
  todayStops: VenueStopRow[],
  firstVenue: VenueStopRow | null,
): VenueStopRow[] {
  if (!firstVenue) {
    return todayStops.filter((s) => isOnSiteProgrammeStop(s));
  }
  return todayStops.filter(
    (s) => isOnSiteProgrammeStop(s) && s.stop_order < firstVenue.stop_order,
  );
}

function onSiteStepLabel(stop: VenueStopRow, atVenue: VenueStopRow): string {
  const at = stopLabel(atVenue);
  const here = stop.id === atVenue.id || stopLabel(stop) === at;
  if (isMealStop(stop)) {
    const slot = stop.meal_slot;
    const mealName =
      stop.label_override?.trim() ||
      (slot ? MEAL_SLOT_LABELS[slot] : null) ||
      "Meal";
    return here ? mealName : `${mealName} at ${at}`;
  }
  if (isMedicationStop(stop)) {
    const name = stop.label_override?.trim() || "Medication round";
    return here ? name : `${name} at ${at}`;
  }
  return here ? stopLabel(stop) : `${stopLabel(stop)} at ${at}`;
}

function onSiteStepDetail(stop: VenueStopRow, phase: StopPhase): string {
  if (phase === "completed") return "Complete";
  if (isMealStop(stop)) {
    return phase === "active"
      ? "Meal open — serve and complete in Programme"
      : "Open meal in Programme (stay where you are — no bus)";
  }
  if (isMedicationStop(stop)) {
    return phase === "active"
      ? "Medication round open — Programme tab"
      : "Open medication round in Programme";
  }
  return "Open in Programme";
}

type ProgrammeTimelineItem =
  | { kind: "onsite"; stop: VenueStopRow; atVenue: VenueStopRow }
  | { kind: "hop"; from: VenueStopRow; to: VenueStopRow; hopIndex: number };

/**
 * Ordered Group Status programme: on-site meals/meds at the current venue,
 * then bus/walk hops to the next venue (never meal-as-destination).
 */
export function buildProgrammeTimeline(
  todayStops: VenueStopRow[],
  overnightWake: OvernightWakeBase | null,
): ProgrammeTimelineItem[] {
  const venues = todayStops.filter((s) => isVenueTransportStop(s));
  const hops = buildProgrammeHops(todayStops, overnightWake);
  const items: ProgrammeTimelineItem[] = [];
  const firstVenue = venues[0] ?? null;
  const nextAfterFirst = venues[1] ?? null;
  // Day 2+ can wake at last night's hotel while the office list starts somewhere else.
  // That first place is its own step, before "Leave for" the place after it.
  const wakeStop = overnightWake?.todayStop ?? overnightWake?.priorLastStop ?? null;
  const opensAwayFromWake =
    !!overnightWake &&
    !overnightWake.hotelOmitted &&
    !!firstVenue &&
    !!wakeStop &&
    wakeStop.id !== firstVenue.id &&
    placesDiffer(wakeStop, firstVenue);

  if (overnightWake?.hotelOmitted && overnightWake.priorLastStop && firstVenue) {
    for (const act of onSiteBeforeFirstVenue(todayStops, firstVenue)) {
      items.push({
        kind: "onsite",
        stop: act,
        atVenue: overnightWake.priorLastStop,
      });
    }
  } else if (firstVenue) {
    for (const act of onSiteBeforeFirstVenue(todayStops, firstVenue)) {
      items.push({
        kind: "onsite",
        stop: act,
        atVenue: placesDiffer(act, firstVenue) ? act : firstVenue,
      });
    }
    if (!opensAwayFromWake) {
      for (const act of onSiteActivitiesAtVenue(todayStops, firstVenue, nextAfterFirst)) {
        items.push({ kind: "onsite", stop: act, atVenue: firstVenue });
      }
    }
  } else {
    for (const act of todayStops.filter((s) => isOnSiteProgrammeStop(s))) {
      items.push({ kind: "onsite", stop: act, atVenue: act });
    }
  }

  const displayHops = [...hops];
  if (opensAwayFromWake && wakeStop && firstVenue) {
    displayHops.unshift({ from: wakeStop, to: firstVenue, hopIndex: -1 });
  }

  for (const hop of displayHops) {
    items.push({
      kind: "hop",
      from: hop.from,
      to: hop.to,
      hopIndex: hop.hopIndex,
    });
    const toIdx = venues.findIndex((v) => v.id === hop.to.id);
    const nextVenue = toIdx >= 0 ? (venues[toIdx + 1] ?? null) : null;
    for (const act of onSiteActivitiesAtVenue(todayStops, hop.to, nextVenue)) {
      items.push({ kind: "onsite", stop: act, atVenue: hop.to });
    }
  }

  return items;
}

function formatClock(clock: string | null | undefined): string | null {
  if (!clock?.trim()) return null;
  return clock.trim().slice(0, 5);
}

function rollProgress(rows: EventAccountabilityRow[]): AccountabilityProgress {
  const pending = rows.filter((r) => r.status === "expected").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const resolved = rows.length - pending;
  const complete = rows.length > 0 && pending === 0;
  const times = rows
    .map((r) => r.accounted_at)
    .filter((t): t is string => !!t)
    .sort();
  return {
    total: rows.length,
    resolved,
    pending,
    absent,
    complete,
    openedAt: times[0] ?? null,
    closedAt: complete ? (times[times.length - 1] ?? null) : null,
  };
}

const VACUOUS_ROLL: AccountabilityProgress = {
  total: 0,
  resolved: 0,
  pending: 0,
  absent: 0,
  complete: true,
  openedAt: null,
  closedAt: null,
};

function latestIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!best || value > best) best = value;
  }
  return best;
}

function stampsFrom(
  pairs: Array<[label: string, at: string | null | undefined]>,
): StatusStamp[] | undefined {
  const stamps = pairs
    .filter((pair): pair is [string, string] => !!pair[1])
    .map(([label, at]) => ({ label, at }));
  return stamps.length > 0 ? stamps : undefined;
}

function activityStamps(stop: VenueStopRow): StatusStamp[] | undefined {
  const phase = stop.phase ?? "pending";
  return stampsFrom([
    ["Opened", phase === "active" || phase === "completed" ? stop.opened_at : null],
    ["Closed", phase === "completed" ? stop.closed_at : null],
  ]);
}

function rollStamps(progress: AccountabilityProgress): StatusStamp[] | undefined {
  return stampsFrom([
    ["Opened", progress.openedAt],
    ["Closed", progress.closedAt],
  ]);
}

type BusCheckState = "none" | "passed" | "held";

/** Today's vehicle walkaround — passed, held for a manager, or not done. */
async function fetchBusCheckState(sessionDate: string): Promise<BusCheckState> {
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .select("status")
    .eq("clearance_date", sessionDate);
  if (error || !data?.length) return "none";
  const statuses = data.map((row) => String((row as { status?: string }).status ?? ""));
  if (statuses.some((s) => s === "passed" || s === "authorized_override")) return "passed";
  if (statuses.some((s) => s === "awaiting_manager_review" || s === "failed")) return "held";
  return "none";
}

/**
 * Office wording for the live "Board bus" row.
 * Release seeds the list (status planned). The driver opens the run after bus checks.
 */
function busStageDetail(opts: {
  tripStatus: string | null;
  onBoard: number;
  busTotal: number;
  inTransit: boolean;
  busCheck: BusCheckState;
}): string {
  const count =
    opts.busTotal > 0 ? `${opts.onBoard} of ${opts.busTotal}` : null;
  if (opts.inTransit) {
    return count ? `In transit · ${count} on the bus` : "In transit";
  }
  const runOpen = opts.tripStatus === "active";
  if (!runOpen) {
    if (!opts.tripStatus) return "Mark who is on the bus";
    if (opts.busCheck === "held") {
      return count
        ? `Bus checks waiting on a manager · ${count} on the bus`
        : "Bus checks waiting on a manager";
    }
    if (opts.busCheck === "passed") {
      return count
        ? `Bus checks done · waiting for the driver to open this run · ${count} on the bus`
        : "Bus checks done · waiting for the driver to open this run";
    }
    return count
      ? `Waiting for bus checks · ${count} on the bus`
      : "Waiting for bus checks";
  }
  if (!count) return "Run open · boarding list not ready";
  if (opts.onBoard <= 0) return `Run open · boarding ${count}`;
  if (opts.onBoard < opts.busTotal) return `Boarding ${count}`;
  return `All aboard · waiting to depart · ${count}`;
}

/** Someone the bus collects or drops between two venues. */
type HopWaypoint = {
  name: string;
  kind: "pickup" | "dropoff";
  status: string;
  present: boolean | null;
  leftAt: string | null;
  doneAt: string | null;
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function waypointLabel(w: HopWaypoint): string {
  return w.kind === "pickup" ? `Collect ${w.name}` : `Drop off ${w.name}`;
}

function waypointDetail(w: HopWaypoint, next: boolean, runOpen: boolean): string | undefined {
  if (w.status === "completed") {
    if (w.present === false) return "Not travelling";
    return undefined;
  }
  if (w.status === "en_route") {
    return w.kind === "pickup" ? "On the way to collect" : "On the way to drop off";
  }
  if (w.status === "arrived") {
    return w.kind === "pickup" ? "At the pickup" : "At the drop-off";
  }
  if (!runOpen) return w.kind === "pickup" ? "Collect on this run" : "Drop off on this run";
  if (next) {
    return w.kind === "pickup" ? "Next stop — not collected yet" : "Next stop — not dropped off yet";
  }
  return "Later on this run";
}

function waypointStamps(w: HopWaypoint): StatusStamp[] | undefined {
  if (w.status === "completed" && w.present === false) return undefined;
  const doneLabel = w.kind === "pickup" ? "Collected" : "Dropped off";
  return stampsFrom([
    ["Left", w.status === "en_route" || w.status === "arrived" ? w.leftAt : null],
    [doneLabel, w.status === "completed" ? w.doneAt : null],
  ]);
}

function dropoffAddresses(stops: VenueStopRow[]): Set<string> {
  return new Set(
    stops
      .filter((stop) => stop.activity_kind === "passenger_dropoff")
      .map((stop) => addressKey(stop.street_address)),
  );
}

/** Person stops already on the Manifest for this hop. */
async function fetchHopWaypoints(tripId: string, stops: VenueStopRow[]): Promise<HopWaypoint[]> {
  const { data, error } = await supabase
    .from("trip_legs")
    .select(
      "leg_index, leg_kind, status, to_label, to_participant_id, to_staff_id, to_carer_id, passenger_present, target_address, start_at, end_at, completed_at",
    )
    .eq("trip_id", tripId)
    .order("leg_index", { ascending: true });
  if (error) throw error;
  const drops = dropoffAddresses(stops);
  const rows = (data ?? []) as Array<{
    leg_kind?: string | null;
    status?: string | null;
    to_label?: string | null;
    to_participant_id?: string | null;
    to_staff_id?: string | null;
    to_carer_id?: string | null;
    passenger_present?: boolean | null;
    target_address?: string | null;
    start_at?: string | null;
    completed_at?: string | null;
  }>;
  return rows
    .filter((leg) => {
      const person = leg.to_participant_id || leg.to_staff_id || leg.to_carer_id;
      return (
        !!person &&
        (leg.leg_kind === "client_to_client" || leg.leg_kind === "depot_to_client")
      );
    })
    .map((leg) => ({
      name: (leg.to_label ?? "").trim() || "Passenger",
      kind: drops.has(addressKey(leg.target_address)) ? "dropoff" : "pickup",
      status: leg.status ?? "pending",
      present: leg.passenger_present ?? null,
      leftAt: leg.start_at ?? null,
      doneAt: leg.completed_at ?? null,
    }));
}

/** Planned collects and drop-offs before the driver has opened the run. */
function plannedHopWaypoints(
  from: VenueStopRow,
  to: VenueStopRow,
  todayStops: VenueStopRow[],
  assignments: PassengerAssignment[],
): HopWaypoint[] {
  const between = todayStops
    .filter(
      (stop) =>
        isPassengerStop(stop) &&
        stop.stop_order > from.stop_order &&
        stop.stop_order < to.stop_order,
    )
    .sort((a, b) => a.stop_order - b.stop_order);
  const rank = (order: number) => (order > 0 ? order : Number.MAX_SAFE_INTEGER);
  const out: HopWaypoint[] = [];
  for (const stop of between) {
    const pickup = stop.activity_kind === "passenger_pickup";
    const people = assignments
      .filter(
        (person) =>
          addressKey(pickup ? person.pickupAddress : person.dropoffAddress) ===
          addressKey(stop.street_address),
      )
      .sort((a, b) => rank(a.pickupOrder) - rank(b.pickupOrder) || a.name.localeCompare(b.name));
    const names = people.length
      ? people.map((person) => person.name)
      : [(stop.label_override ?? "").trim() || "Passenger"];
    for (const name of names) {
      out.push({
        name,
        kind: pickup ? "pickup" : "dropoff",
        status: "pending",
        present: null,
        leftAt: null,
        doneAt: null,
      });
    }
  }
  return out;
}

/** Group Status step label — never “all accounted” when anyone is Absent. */
function rollCompleteLabel(
  kind: "Morning" | "Evening",
  progress: AccountabilityProgress,
): string {
  if (!progress.complete) return `${kind} roll call`;
  if (progress.absent > 0) return `${kind} roll complete`;
  return `${kind} roll — all accounted`;
}

export async function getAccountabilityProgress(
  table: "event_morning_log" | "event_curfew_log",
  sessionId: string,
): Promise<AccountabilityProgress> {
  const rows = await listAccountabilityRoll(table, sessionId);
  return rollProgress(rows);
}

/** Multi-day and not the first calendar day of the trip. */
export async function sessionRequiresMorningRoll(
  eventId: string,
  sessionDate: string,
): Promise<boolean> {
  const sessions = await listEventDaySessions(eventId);
  if (sessions.length <= 1) return false;
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date));
  return sorted[0]?.session_date !== sessionDate;
}

/** Multi-day and not the final calendar day of the trip. */
export async function sessionRequiresEveningRoll(
  eventId: string,
  sessionDate: string,
): Promise<boolean> {
  const sessions = await listEventDaySessions(eventId);
  if (sessions.length <= 1) return false;
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date));
  return sorted[sorted.length - 1]?.session_date !== sessionDate;
}

/**
 * Hard gate before opening a programme stop or releasing a bus hop.
 * Vacuous OK when arrival is fully reconciled and nobody is checked in (all absent).
 */
export async function assertMorningRollCompleteBeforeProgramme(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<void> {
  const required = await sessionRequiresMorningRoll(opts.eventId, opts.sessionDate);
  if (!required) return;

  const progress = await getAccountabilityProgress("event_morning_log", opts.sessionId);
  if (progress.complete) return;

  if (progress.total === 0) {
    const [attendance, support] = await Promise.all([
      listEventAttendanceRoll(opts.sessionId),
      listEventSupportAttendance(opts.sessionId).catch(() => []),
    ]);
    const pendingArrival =
      attendance.filter((r) => r.status === "expected").length +
      support.filter((r) => r.status === "expected").length;
    const checkedIn =
      attendance.filter((r) => r.status === "checked_in").length +
      support.filter((r) => r.status === "checked_in").length;
    if (pendingArrival === 0 && checkedIn === 0) return;
    throw new Error(
      "Complete Morning Roll Call before starting the programme (Morning Roll tab).",
    );
  }

  throw new Error(
    `Morning roll incomplete — ${progress.pending} still to account (Morning Roll tab).`,
  );
}

type HopTripRow = {
  id: string;
  hop_index: number | null;
  status: string;
  venue_stop_from_id: string | null;
  venue_stop_to_id: string | null;
  completed_at: string | null;
};

type HopMoveClock = { leftAt: string | null; arrivedAt: string | null };

const NO_MOVE: HopMoveClock = { leftAt: null, arrivedAt: null };

async function fetchHopTrips(sessionId: string) {
  const { data, error } = await supabase
    .from("transport_trips")
    .select("id, hop_index, status, venue_stop_from_id, venue_stop_to_id, completed_at")
    .eq("event_day_session_id", sessionId)
    .order("hop_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HopTripRow[];
}

/**
 * Depart / arrive for a venue hop.
 * `trip_legs.start_at` is the Manifest "All aboard — Depart" tap.
 * `end_at` is Arrive. Trip `started_at` is row creation, not departure.
 */
async function fetchHopMoveClocks(trips: HopTripRow[]): Promise<Map<string, HopMoveClock>> {
  const clocks = new Map<string, HopMoveClock>();
  const liveTrips = trips.filter((trip) => trip.status !== "cancelled");
  if (liveTrips.length === 0) return clocks;
  const { data, error } = await supabase
    .from("trip_legs")
    .select(
      "trip_id, status, start_at, end_at, completed_at, leg_kind, to_participant_id, to_staff_id, to_carer_id",
    )
    .in(
      "trip_id",
      liveTrips.map((t) => t.id),
    );
  if (error) throw error;

  const byTrip = new Map<
    string,
    Array<{
      status: string;
      start_at: string | null;
      end_at: string | null;
      completed_at: string | null;
      person: boolean;
    }>
  >();
  for (const leg of data ?? []) {
    const row = leg as {
      trip_id: string;
      status?: string | null;
      start_at?: string | null;
      end_at?: string | null;
      completed_at?: string | null;
      leg_kind?: string | null;
      to_participant_id?: string | null;
      to_staff_id?: string | null;
      to_carer_id?: string | null;
    };
    const list = byTrip.get(row.trip_id) ?? [];
    const person =
      !!row.to_participant_id ||
      !!row.to_staff_id ||
      !!row.to_carer_id ||
      row.leg_kind === "client_to_client" ||
      row.leg_kind === "depot_to_client";
    list.push({
      status: row.status ?? "",
      start_at: row.start_at ?? null,
      end_at: row.end_at ?? null,
      completed_at: row.completed_at ?? null,
      person,
    });
    byTrip.set(row.trip_id, list);
  }

  for (const trip of liveTrips) {
    const legs = byTrip.get(trip.id) ?? [];
    const leftAt = legs
      .filter((l) => l.start_at && l.status !== "pending")
      .map((l) => l.start_at as string)
      .sort()[0] ?? null;
    // A person collected on the way is not arrival at the venue.
    const venueLegs = legs.filter((l) => !l.person);
    const legArrivals = venueLegs
      .filter((l) => l.status === "arrived" || l.status === "completed")
      .map((l) => l.end_at || l.completed_at)
      .filter((t): t is string => !!t)
      .sort();
    const arrivedAt =
      legArrivals[legArrivals.length - 1] ??
      (trip.status === "completed" ? trip.completed_at : null);
    clocks.set(trip.id, { leftAt, arrivedAt });
  }
  return clocks;
}

function hopClockFor(
  trips: HopTripRow[],
  clocks: Map<string, HopMoveClock>,
  hopIndex: number,
  fromId: string,
  toId: string,
): HopMoveClock {
  const trip =
    trips.find((t) => t.hop_index === hopIndex) ??
    trips.find((t) => t.venue_stop_from_id === fromId && t.venue_stop_to_id === toId);
  if (!trip) return NO_MOVE;
  return clocks.get(trip.id) ?? NO_MOVE;
}

/**
 * Bus left/arrived come from the Manifest leg.
 * Walk / other / on-site leave and arrive are one confirmation, stamped on the
 * origin `closed_at` (destination `opened_at` can be an earlier "ready" tap).
 */
function hopStamps(opts: {
  movement: string | null;
  toPhase: string;
  fromClosedAt: string | null | undefined;
  clock: HopMoveClock;
}): { leave?: StatusStamp[]; arrive?: StatusStamp[] } {
  if (opts.movement == null) return {};
  if (opts.movement === "bus") {
    return {
      leave: stampsFrom([["Left", opts.clock.leftAt]]),
      // While still moving, the current "in transit" row carries the depart time.
      arrive: stampsFrom([
        ["Left", opts.clock.arrivedAt ? null : opts.clock.leftAt],
        ["Arrived", opts.clock.arrivedAt],
      ]),
    };
  }
  const atDest = opts.toPhase === "active" || opts.toPhase === "completed";
  const when = atDest ? opts.fromClosedAt ?? null : null;
  return {
    arrive: when ? [{ label: "Left and arrived", at: when }] : undefined,
  };
}

async function fetchActiveTripLegSummary(tripId: string) {
  const { data, error } = await supabase
    .from("trip_legs")
    .select("status, to_label, from_label, passenger_present, to_participant_id")
    .eq("trip_id", tripId)
    .order("leg_index", { ascending: true });
  if (error) throw error;
  const legs = data ?? [];
  const pickupLegs = legs.filter(
    (l) =>
      l.to_participant_id != null ||
      (l as { to_staff_id?: string | null }).to_staff_id != null ||
      (l as { to_carer_id?: string | null }).to_carer_id != null,
  );
  const onBoard = pickupLegs.filter(
    (l) =>
      l.status === "en_route" ||
      l.status === "arrived" ||
      (l.status === "completed" && l.passenger_present !== false),
  ).length;
  const activeLeg = legs.find((l) => l.status !== "completed") ?? null;
  return { onBoard, pickupTotal: pickupLegs.length, activeLeg, legCount: legs.length };
}

function morningUnlocked(
  showMorning: boolean,
  morning: AccountabilityProgress,
  allCheckedIn: boolean,
  checkedInCount: number,
): boolean {
  if (!showMorning) return true;
  if (morning.complete) return true;
  // All reconciled, nobody present (all absent) — nothing to muster
  if (allCheckedIn && checkedInCount === 0 && morning.total === 0) return true;
  return false;
}

/**
 * The rest of today's office list, still ahead.
 * Used while check-in or Morning Roll is the current step, including when that
 * status was saved before the link dropped and the day's places are already on the tablet.
 */
export function plannedDayStatusSteps(
  allStops: EventVenueStop[],
  sessionDate: string,
): EventDeliverStatusStep[] {
  const todayKey = sessionDate.slice(0, 10);
  const day = (allStops as VenueStopRow[])
    .filter((stop) => stop.session_date.slice(0, 10) === todayKey)
    .sort((a, b) => a.stop_order - b.stop_order);
  let keptMed = false;
  const todayStops = day.filter((stop) => {
    if (!isMedicationStop(stop)) return true;
    if (keptMed) return false;
    keptMed = true;
    return true;
  });
  if (todayStops.length === 0) return [];

  const hasPriorDay = allStops.some((stop) => stop.session_date.slice(0, 10) < todayKey);
  const hasLaterDay = allStops.some((stop) => stop.session_date.slice(0, 10) > todayKey);
  const overnightWake = hasPriorDay
    ? resolveOvernightWakeBase(allStops as VenueStopRow[], sessionDate, todayStops)
    : null;
  const todayVenues = todayStops.filter((stop) => isVenueTransportStop(stop));
  const overnightEndName = stopLabel(todayVenues[todayVenues.length - 1], "Venue");
  const timeline = buildProgrammeTimeline(todayStops, overnightWake);
  const steps: EventDeliverStatusStep[] = [];

  for (const item of timeline) {
    if (item.kind === "onsite") {
      const phase = (item.stop.phase ?? "pending") as StopPhase;
      steps.push({
        id: `onsite-${item.stop.id}`,
        label: onSiteStepLabel(item.stop, item.atVenue),
        detail: onSiteStepDetail(item.stop, phase),
        state: "upcoming",
      });
      continue;
    }
    const toName = stopLabel(item.to);
    const fromName = stopLabel(item.from);
    const movement = item.to.movement_method ?? null;
    if (movement == null) {
      steps.push({
        id: `hop-${item.hopIndex}-leave`,
        label: `Leave for ${toName}`,
        detail: "Choose Bus / Walk / Other / On-site on Programme",
        state: "upcoming",
      });
    } else if (movement === "bus") {
      steps.push({
        id: `hop-${item.hopIndex}-depart`,
        label: `Board bus — depart ${fromName} for ${toName}`,
        detail: "Mark who is on the bus",
        state: "upcoming",
      });
    }
    steps.push({
      id: `hop-${item.hopIndex}-at`,
      label: movement === "bus" || movement == null ? `At ${toName}` : `Activity at ${toName}`,
      detail:
        movement === "walk"
          ? "Individual activity check-in"
          : movement === "on_site"
            ? "On-site activity check-in"
            : movement === "other"
              ? "Other transport — individual activity check-in"
              : undefined,
      state: "upcoming",
    });
  }

  if (hasLaterDay) {
    steps.push({
      id: "evening-roll",
      label: "Evening roll call",
      detail: `At ${overnightEndName} — evening accountability`,
      state: "upcoming",
    });
  } else if (todayVenues.length > 0) {
    steps.push({
      id: "base-end",
      label: `At ${overnightEndName} — end of programme`,
      detail: "Ready for check-out when the day is done",
      state: "upcoming",
    });
  }

  return steps;
}

function withPlannedDay(
  steps: EventDeliverStatusStep[],
  allStops: EventVenueStop[],
  sessionDate: string,
): EventDeliverStatusStep[] {
  const hasProgramme = steps.some(
    (step) =>
      step.id.startsWith("hop-") ||
      step.id.startsWith("onsite-") ||
      step.id === "evening-roll" ||
      step.id === "base-end",
  );
  if (hasProgramme) return steps;
  return [...steps, ...plannedDayStatusSteps(allStops, sessionDate)];
}

export async function fetchEventDeliverGroupStatus(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<EventDeliverGroupStatus> {
  const [
    { data: sessionRow, error: sessionErr },
    attendance,
    allStops,
    hopTrips,
    showMorningRoll,
    showEveningRoll,
  ] = await Promise.all([
    supabase
      .from("event_day_sessions")
      .select("phase, curfew_time, morning_roll_time, open_declared_at")
      .eq("id", opts.sessionId)
      .single(),
    listEventAttendanceRoll(opts.sessionId),
    listEventVenueStops(opts.eventId),
    fetchHopTrips(opts.sessionId),
    sessionRequiresMorningRoll(opts.eventId, opts.sessionDate),
    sessionRequiresEveningRoll(opts.eventId, opts.sessionDate),
  ]);

  if (sessionErr) throw sessionErr;

  const phase = (sessionRow?.phase ?? "planning") as EventDayPhase;
  const curfewClock = formatClock(sessionRow?.curfew_time as string | null);
  const morningClock = formatClock(sessionRow?.morning_roll_time as string | null);
  const openDeclaredAt =
    (sessionRow as { open_declared_at?: string | null } | null)?.open_declared_at ?? null;

  const todayStops = (allStops as VenueStopRow[])
    .filter((s) => s.session_date === opts.sessionDate)
    .sort((a, b) => a.stop_order - b.stop_order);
  const todayVenues = todayStops.filter((s) => isVenueTransportStop(s));

  // Day 2+: wake / morning base is where the group slept (prior day's last stop),
  // not necessarily today's first itinerary stop (e.g. Day 4 only lists Joes).
  const overnightWake = showMorningRoll
    ? resolveOvernightWakeBase(allStops as VenueStopRow[], opts.sessionDate, todayStops)
    : null;
  /** Day 1 arrival is the meeting point (first stop). Day 2+ wakes at the hotel. */
  const baseStop = overnightWake?.todayStop ?? todayStops[0] ?? todayVenues[0];
  const baseName = overnightWake?.label ?? stopLabel(baseStop);
  /**
   * Where the group sleeps tonight (last venue today — not a meal/med row).
   * Day 1: Mounties (arrive) → Hotel 1 (overnight) — do not reuse arrival name for evening.
   */
  const overnightEndStop =
    todayVenues[todayVenues.length - 1] ?? baseStop;
  const overnightEndName = stopLabel(overnightEndStop, baseName);

  const support = await listEventSupportAttendance(opts.sessionId).catch(() => []);
  const [pickupAssignments, supportBookings] = await Promise.all([
    listPassengerAssignments(opts.eventId).catch(() => []),
    listEventSupportBookings(opts.eventId).catch(() => []),
  ]);
  const later = laterPickupIds(pickupAssignments);
  for (const booking of supportBookings) {
    if (!joinsOnTheWay(booking.pickupJoin)) continue;
    if (booking.staffId) later.staffIds.add(booking.staffId);
    if (booking.carerId) later.carerIds.add(booking.carerId);
  }
  const joinsHere = attendance.filter((row) => !later.participantIds.has(row.participantId));
  const supportHere = support.filter((row) => {
    if (row.staffId && later.staffIds.has(row.staffId)) return false;
    if (row.carerId && later.carerIds.has(row.carerId)) return false;
    return true;
  });
  // Day 2+ arrival is the participants who woke at the hotel. Staff, volunteers,
  // and carers joined at the meeting point and are not checked in again.
  const supportOnArrival = showMorningRoll ? [] : supportHere;
  const totalOnTrip = joinsHere.length + supportOnArrival.length;
  const checkedInCount =
    joinsHere.filter((r) => r.status === "checked_in").length +
    supportOnArrival.filter((r) => r.status === "checked_in").length;
  const checkedInOrOut =
    joinsHere.filter((r) => r.status === "checked_in" || r.status === "checked_out").length +
    supportOnArrival.filter((r) => r.status === "checked_in" || r.status === "checked_out").length;
  const pendingArrival =
    joinsHere.filter((r) => r.status === "expected").length +
    supportOnArrival.filter((r) => r.status === "expected").length;
  const allCheckedIn = totalOnTrip > 0 && pendingArrival === 0;

  const [morning, evening, hopClocks, busCheck] = await Promise.all([
    showMorningRoll
      ? getAccountabilityProgress("event_morning_log", opts.sessionId)
      : Promise.resolve(VACUOUS_ROLL),
    showEveningRoll
      ? getAccountabilityProgress("event_curfew_log", opts.sessionId)
      : Promise.resolve(VACUOUS_ROLL),
    fetchHopMoveClocks(hopTrips),
    fetchBusCheckState(opts.sessionDate),
  ]);

  const checkInClosedAt = allCheckedIn
    ? latestIso([
        ...joinsHere.map((r) =>
          r.status === "checked_in" || r.status === "checked_out" ? r.checkedInAt : null,
        ),
        ...supportOnArrival.map((r) =>
          r.status === "checked_in" || r.status === "checked_out" ? r.checkedInAt : null,
        ),
      ])
    : null;
  const arrivalStamps = stampsFrom([
    ["Opened", openDeclaredAt],
    ["Closed", checkInClosedAt],
  ]);

  const programmeUnlocked = morningUnlocked(
    showMorningRoll,
    morning,
    allCheckedIn,
    checkedInCount,
  );
  const morningRollBlocksProgramme = showMorningRoll && allCheckedIn && !programmeUnlocked;

  const steps: EventDeliverStatusStep[] = [];

  // ── 1. Arrival at base (Day 1) or overnight wake (Day 2+) ───────────────
  steps.push({
    id: "arrival",
    label: showMorningRoll
      ? allCheckedIn
        ? `Overnight at ${baseName}`
        : `Wake at ${baseName}`
      : allCheckedIn
        ? `All checked in at ${baseName}`
        : `Check in at ${baseName}`,
    detail: totalOnTrip > 0 ? `${checkedInOrOut} of ${totalOnTrip} checked in` : undefined,
    stamps: arrivalStamps,
    state: "upcoming",
  });

  if (phase === "planning" || phase === "pre_departure") {
    steps[0]!.state = "current";
    return {
      headline: "Open location to begin check-in",
      subline: baseName,
      tone: "planning",
      steps: withPlannedDay(steps, allStops, opts.sessionDate),
      morningRollBlocksProgramme: false,
    };
  }

  if (phase === "closed_orderly" || phase === "closed_incident") {
    steps[0]!.state = "complete";
    if (showMorningRoll) {
      steps.push({
        id: "morning-roll",
        label: rollCompleteLabel("Morning", morning),
        stamps: rollStamps(morning),
        state: morning.complete ? "complete" : "upcoming",
      });
    }
    // Show completed programme (meals on-site + venue hops) — not meal-as-bus.
    for (const item of buildProgrammeTimeline(todayStops, overnightWake)) {
      if (item.kind === "onsite") {
        steps.push({
          id: `onsite-${item.stop.id}`,
          label: onSiteStepLabel(item.stop, item.atVenue),
          detail: "Complete",
          stamps: activityStamps(item.stop),
          state: "complete",
        });
        continue;
      }
      const fromName = stopLabel(item.from);
      const toName = stopLabel(item.to);
      const movement = item.to.movement_method ?? "bus";
      const isBus = movement === "bus";
      const closedHop = hopStamps({
        movement,
        toPhase: "completed",
        fromClosedAt: item.from.closed_at,
        clock: hopClockFor(hopTrips, hopClocks, item.hopIndex, item.from.id, item.to.id),
      });
      if (isBus) {
        steps.push({
          id: `hop-${item.hopIndex}-depart`,
          label: `Board bus — depart ${fromName} for ${toName}`,
          detail: "Delivered · hop complete",
          stamps: closedHop.leave,
          state: "complete",
        });
      }
      steps.push({
        id: `hop-${item.hopIndex}-at`,
        label: isBus ? `At ${toName}` : `Activity at ${toName}`,
        stamps: closedHop.arrive,
        state: "complete",
      });
    }
    if (showEveningRoll) {
      steps.push({
        id: "evening-roll",
        label: rollCompleteLabel("Evening", evening),
        detail: `Overnight at ${overnightEndName}`,
        stamps: rollStamps(evening),
        state: evening.complete ? "complete" : "upcoming",
      });
    } else {
      steps.push({
        id: "base-end",
        label: `At ${overnightEndName} — end of programme`,
        state: "complete",
      });
    }
    return {
      headline: "Trip day closed",
      subline: showEveningRoll
        ? `Overnight at ${overnightEndName}`
        : `Ended at ${overnightEndName}`,
      tone: "closed",
      steps,
      morningRollBlocksProgramme: false,
    };
  }

  if (!allCheckedIn) {
    steps[0]!.state = "current";
    if (showMorningRoll) {
      steps.push({
        id: "morning-roll",
        label: "Morning roll call",
        detail: morningClock ? `Deadline ${morningClock}` : "After check-in",
        state: "upcoming",
      });
    }
    return {
      headline: showMorningRoll ? `Wake at ${baseName}` : `Checking in at ${baseName}`,
      subline: showMorningRoll
        ? "Open location to start Morning Roll — no arrival check-in needed"
        : pendingArrival > 0
          ? `${pendingArrival} still expected — use the Check-In tab`
          : undefined,
      tone: showMorningRoll ? "roll" : "arrival",
      steps: withPlannedDay(steps, allStops, opts.sessionDate),
      morningRollBlocksProgramme: false,
    };
  }

  steps[0]!.state = "complete";

  // ── 2. Morning roll (multi-day day 2+) ────────────────────────────────────
  if (showMorningRoll) {
    const morningComplete = programmeUnlocked;
    steps.push({
      id: "morning-roll",
      label: morningComplete
        ? rollCompleteLabel("Morning", morning)
        : "Morning roll call",
      detail: morningComplete
        ? morning.total > 0
          ? morning.absent > 0
            ? `${morning.resolved} / ${morning.total} resolved · ${morning.absent} absent`
            : `${morning.resolved} / ${morning.total} accounted`
          : undefined
        : morning.total > 0
          ? `${morning.resolved} / ${morning.total} · ${morning.pending} remaining`
          : morningClock
            ? `Deadline ${morningClock} · use Morning Roll tab`
            : "Use Morning Roll tab",
      stamps: rollStamps(morning),
      state: morningComplete ? "complete" : "current",
    });

    if (!morningComplete) {
      return {
        headline: "Morning roll call",
        subline:
          morning.pending > 0
            ? `${morning.pending} still to account — complete before programme`
            : "Account for everyone before the first activity",
        tone: "roll",
        steps: withPlannedDay(steps, allStops, opts.sessionDate),
        morningRollBlocksProgramme: true,
      };
    }
  }

  // ── 3. Programme: on-site meals/meds at venue, then venue→venue hops ──
  const passengerAssignments = todayStops.some((stop) => isPassengerStop(stop))
    ? await listPassengerAssignments(opts.eventId)
    : [];
  const timeline = buildProgrammeTimeline(todayStops, overnightWake);
  const hops = timeline
    .filter((item): item is Extract<ProgrammeTimelineItem, { kind: "hop" }> => item.kind === "hop")
    .map((h) => ({ from: h.from, to: h.to, hopIndex: h.hopIndex }));

  let currentAssigned = false;

  for (const item of timeline) {
    if (item.kind === "onsite") {
      const phase = (item.stop.phase ?? "pending") as StopPhase;
      const stepId = `onsite-${item.stop.id}`;
      steps.push({
        id: stepId,
        label: onSiteStepLabel(item.stop, item.atVenue),
        detail: onSiteStepDetail(item.stop, phase),
        stamps: activityStamps(item.stop),
        state: "upcoming",
      });
      if (phase === "completed") {
        const step = steps.find((s) => s.id === stepId);
        if (step) {
          step.state = "complete";
          step.detail = "Complete";
        }
        continue;
      }
      if (currentAssigned) continue;
      currentAssigned = true;
      const step = steps.find((s) => s.id === stepId);
      if (step) step.state = "current";
      continue;
    }

    const fromName = stopLabel(item.from);
    const toName = stopLabel(item.to);
    const toPhase = (item.to.phase ?? "pending") as StopPhase;
    const movement = item.to.movement_method ?? null;
    const methodUnset = movement == null;
    const isBus = movement === "bus";

    const matchedTrip =
      hopTrips.find((t) => t.hop_index === item.hopIndex) ??
      hopTrips.find(
        (t) =>
          t.venue_stop_from_id === item.from.id && t.venue_stop_to_id === item.to.id,
      );
    // A cancelled run is not progress. The collect stays on the itinerary.
    const trip = matchedTrip?.status === "cancelled" ? undefined : matchedTrip;

    let onBoard = 0;
    let busTotal = 0;
    let inTransit = false;
    let waypoints: HopWaypoint[] = [];

    if (isBus && trip) {
      const manifest = await listBusManifest(trip.id);
      onBoard = manifest.filter((r) => r.status === "on_bus").length;
      busTotal = manifest.filter((r) => r.status !== "not_travelling").length;
      waypoints = await fetchHopWaypoints(trip.id, todayStops);

      if (busTotal === 0) {
        const legSummary = await fetchActiveTripLegSummary(trip.id);
        if (legSummary.pickupTotal > 0) {
          onBoard = legSummary.onBoard;
          busTotal = legSummary.pickupTotal;
        }
      }

      if (trip.status === "active") {
        const legSummary = await fetchActiveTripLegSummary(trip.id);
        const personMoving = waypoints.some(
          (w) => w.status === "en_route" || w.status === "arrived",
        );
        inTransit = !personMoving && legSummary.activeLeg?.status === "en_route";
      }
    } else if (isBus) {
      waypoints = plannedHopWaypoints(item.from, item.to, todayStops, passengerAssignments);
    }

    if (isBus && trip && waypoints.length === 0) {
      waypoints = plannedHopWaypoints(item.from, item.to, todayStops, passengerAssignments);
    }

    const stageNote = !isBus
      ? undefined
      : matchedTrip?.status === "cancelled"
        ? "This run was cancelled · open it again on Manifest"
        : busStageDetail({
            tripStatus: trip?.status ?? null,
            onBoard,
            busTotal,
            inTransit,
            busCheck,
          });

    const leaveStepId = `hop-${item.hopIndex}-leave`;
    const departStepId = `hop-${item.hopIndex}-depart`;
    const atStepId = `hop-${item.hopIndex}-at`;
    const moveStamps = hopStamps({
      movement,
      toPhase,
      fromClosedAt: item.from.closed_at,
      clock: trip ? (hopClocks.get(trip.id) ?? NO_MOVE) : NO_MOVE,
    });

    if (methodUnset) {
      steps.push({
        id: leaveStepId,
        label: `Leave for ${toName}`,
        detail: "Choose Bus / Walk / Other / On-site on Programme",
        state: "upcoming",
      });
    } else if (isBus) {
      const pendingCollects = waypoints.filter(
        (w) => w.kind === "pickup" && w.status !== "completed",
      );
      const thenCollect = pendingCollects.length
        ? `Then collect ${joinNames(pendingCollects.map((w) => w.name))}`
        : null;
      steps.push({
        id: departStepId,
        label: `Board bus — depart ${fromName} for ${toName}`,
        detail: thenCollect && stageNote ? `${stageNote} · ${thenCollect}` : stageNote ?? thenCollect ?? undefined,
        stamps: moveStamps.leave,
        state: "upcoming",
      });
      const runOpen = trip?.status === "active";
      waypoints.forEach((w, index) => {
        const next = waypoints.find((row) => row.status !== "completed") === w;
        steps.push({
          id: `hop-${item.hopIndex}-collect-${index}`,
          label: waypointLabel(w),
          detail: waypointDetail(w, next, runOpen),
          stamps: waypointStamps(w),
          state: "upcoming",
        });
      });
    }

    steps.push({
      id: atStepId,
      label: isBus || methodUnset ? `At ${toName}` : `Activity at ${toName}`,
      detail:
        movement === "walk"
          ? "Individual activity check-in"
          : movement === "on_site"
            ? "On-site activity check-in"
            : movement === "other"
              ? "Other transport — individual activity check-in"
              : undefined,
      stamps: moveStamps.arrive,
      state: "upcoming",
    });

    const hopComplete = toPhase === "completed";
    const hopActive = toPhase === "active";
    const tripDone = trip?.status === "completed";
    // A driver Manifest hop arrives only when that run is completed.
    // A leader headcount opens the destination with no trip.
    const arrivedAtDest = isBus ? tripDone || (hopActive && !trip) : hopActive;

    if (hopComplete) {
      if (isBus) {
        const departStep = steps.find((s) => s.id === departStepId);
        if (departStep) {
          departStep.state = "complete";
          // Don't keep stale "4/4 on bus" after the venue is closed out.
          departStep.detail = "Delivered · hop complete";
        }
        waypoints.forEach((w, index) => {
          const step = steps.find((s) => s.id === `hop-${item.hopIndex}-collect-${index}`);
          if (!step) return;
          step.state = "complete";
          step.detail = waypointDetail(w, false, true);
        });
      }
      const leaveStep = steps.find((s) => s.id === leaveStepId);
      if (leaveStep) leaveStep.state = "complete";
      const atStep = steps.find((s) => s.id === atStepId);
      if (atStep) atStep.state = "complete";
      continue;
    }

    // First incomplete hop is current (boarding, transit, or at venue).
    if (currentAssigned) continue;

    currentAssigned = true;
    if (methodUnset) {
      const leaveStep = steps.find((s) => s.id === leaveStepId)!;
      leaveStep.state = "current";
    } else if (isBus) {
      const departStep = steps.find((s) => s.id === departStepId)!;
      const atStep = steps.find((s) => s.id === atStepId)!;
      const runOpen = trip?.status === "active";
      const nextWp = waypoints.find((w) => w.status !== "completed");
      const stillBoarding =
        runOpen &&
        busTotal > 0 &&
        onBoard < busTotal &&
        waypoints.every((w) => w.status === "pending");
      const markWaypoint = (w: HopWaypoint, index: number, state: StatusStepState) => {
        const step = steps.find((s) => s.id === `hop-${item.hopIndex}-collect-${index}`);
        if (!step) return;
        step.state = state;
        step.detail = waypointDetail(w, w === nextWp, runOpen);
        step.stamps = waypointStamps(w);
      };
      if (arrivedAtDest || (tripDone && hopActive)) {
        departStep.state = "complete";
        departStep.detail = trip ? "Boarded · hop arrived" : "On the bus";
        waypoints.forEach((w, index) =>
          markWaypoint(
            w,
            index,
            tripDone || w.status === "completed" ? "complete" : "upcoming",
          ),
        );
        atStep.state = "current";
        atStep.label = `At ${toName}`;
        atStep.detail = "Hop arrived";
      } else if (nextWp && runOpen && !stillBoarding) {
        departStep.state = "complete";
        departStep.detail =
          nextWp.status === "pending"
            ? `Boarded · collect on the way before ${toName}`
            : "On the way";
        waypoints.forEach((w, index) =>
          markWaypoint(w, index, w === nextWp ? "current" : w.status === "completed" ? "complete" : "upcoming"),
        );
      } else if (inTransit) {
        departStep.state = "complete";
        departStep.detail = stageNote ?? "In transit";
        waypoints.forEach((w, index) => markWaypoint(w, index, "complete"));
        atStep.state = "current";
        atStep.label = `In transit to ${toName}`;
        atStep.detail = "On the way — arrival time shows when the driver taps Arrive";
      } else if (runOpen && !nextWp) {
        departStep.state = "complete";
        departStep.detail = "Boarded";
        waypoints.forEach((w, index) => markWaypoint(w, index, "complete"));
        const collected = waypoints.filter((w) => w.kind === "pickup" && w.present !== false);
        atStep.state = "current";
        atStep.label = `In transit to ${toName}`;
        atStep.stamps = undefined;
        atStep.detail = collected.length
          ? `Collected ${joinNames(collected.map((w) => w.name))} · waiting to depart for ${toName}`
          : `Waiting to depart for ${toName}`;
      } else {
        // Not released, or still boarding the group at the origin.
        departStep.state = "current";
        waypoints.forEach((w, index) =>
          markWaypoint(w, index, w.status === "completed" ? "complete" : "upcoming"),
        );
      }
    } else {
      const atStep = steps.find((s) => s.id === atStepId)!;
      atStep.state = "current";
    }
  }

  // ── 4. Evening roll (multi-day non-final) OR base-until note ──────────────
  // Destinations = hop targets (includes first venue when hotel omitted today).
  const destinations = hops.map((h) => h.to);
  const finalDest = destinations[destinations.length - 1];
  const allDestinationsDone =
    hops.length === 0 ||
    destinations.every((s) => (s.phase ?? "pending") === "completed");
  const finalOpen =
    finalDest != null &&
    ((finalDest.phase ?? "pending") === "active" ||
      (finalDest.phase ?? "pending") === "completed");
  const stillOpenToday = destinations.some(
    (stop) => stop.id !== finalDest?.id && (stop.phase ?? "pending") === "active",
  );
  const activeOffDay = (allStops as VenueStopRow[]).some(
    (stop) =>
      stop.session_date !== opts.sessionDate &&
      (stop.phase ?? "pending") === "active" &&
      !isPassengerStop(stop),
  );
  /** Tonight's accommodation. Unrun suggestions do not hold the roll. */
  const readyForEvening =
    !activeOffDay &&
    !stillOpenToday &&
    (phase === "at_base" ||
      (hops.length === 0 && !overnightWake?.hotelOmitted) ||
      finalOpen);

  // Overnight / evening base = last stop today (Hotel), not Day 1 arrival (Mounties).
  const eveningBaseName =
    destinations.length > 0
      ? stopLabel(destinations[destinations.length - 1], overnightEndName)
      : overnightEndName;

  if (showEveningRoll) {
    steps.push({
      id: "evening-roll",
      label: rollCompleteLabel("Evening", evening),
      detail: evening.complete
        ? evening.total > 0
          ? evening.absent > 0
            ? `${evening.resolved} / ${evening.total} resolved · ${evening.absent} absent · overnight at ${eveningBaseName}`
            : `${evening.resolved} / ${evening.total} accounted · overnight at ${eveningBaseName}`
          : `Overnight at ${eveningBaseName}`
        : evening.total > 0
          ? `${evening.resolved} / ${evening.total} · deadline ${curfewClock ?? "—"}`
          : curfewClock
            ? `At ${eveningBaseName} · deadline ${curfewClock}`
            : `At ${eveningBaseName} — evening accountability`,
      stamps: rollStamps(evening),
      state: "upcoming",
    });
  } else {
    // Final day / no evening roll: end where the last activity was (e.g. Joes),
    // not the overnight wake hotel when the itinerary never returned there.
    const endStop =
      destinations.length > 0
        ? destinations[destinations.length - 1]
        : todayVenues[todayVenues.length - 1] ?? overnightEndStop;
    const endName = stopLabel(endStop, overnightEndName);
    steps.push({
      id: "base-end",
      label: `At ${endName} — end of programme`,
      detail: "Ready for check-out when the day is done",
      state: "upcoming",
    });
  }

  const eveningStep = steps.find((s) => s.id === "evening-roll");
  const baseEndStep = steps.find((s) => s.id === "base-end");

  // Once back at base, evening roll (not the final "At venue" hop) is the current step.
  if (showEveningRoll && eveningStep && readyForEvening && allCheckedIn) {
    for (const s of steps) {
      if (s.state === "current" && s.id !== "evening-roll") {
        s.state = "complete";
      }
    }
    if (evening.complete || (evening.total === 0 && checkedInCount === 0)) {
      eveningStep.state = "complete";
      eveningStep.label = rollCompleteLabel("Evening", evening);
      eveningStep.detail =
        evening.absent > 0
          ? `${evening.resolved} / ${evening.total} resolved · ${evening.absent} absent · overnight at ${eveningBaseName}`
          : `Overnight at ${eveningBaseName}`;
      return {
        headline: "Evening roll complete",
        subline: `Overnight at ${eveningBaseName}`,
        tone: "base",
        steps,
        morningRollBlocksProgramme: false,
      };
    }
    eveningStep.state = "current";
    return {
      headline: "Evening roll call",
      subline: curfewClock
        ? `Account for everyone by ${curfewClock}`
        : "Use the Evening Roll tab",
      tone: "roll",
      steps,
      morningRollBlocksProgramme: false,
    };
  }

  if ((phase === "at_base" || (allDestinationsDone && allCheckedIn)) && !currentAssigned) {
    if (baseEndStep) {
      baseEndStep.state = "current";
      const endLabel =
        baseEndStep.label.replace(/^At\s+/, "").replace(/\s+—\s+end of programme$/, "") ||
        baseName;
      return {
        headline: `Off bus at ${endLabel}`,
        subline: "Programme complete — use Check-Out when ready",
        tone: "base",
        steps,
        morningRollBlocksProgramme: false,
      };
    }
  }

  if (phase === "in_transit") {
    const activeHop = steps.find((s) => s.state === "current");
    return {
      headline: activeHop?.label ?? "Group in transit",
      subline: activeHop?.detail,
      tone: "transit",
      steps,
      morningRollBlocksProgramme: false,
    };
  }

  if (currentAssigned) {
    const current = steps.find((s) => s.state === "current");
    return {
      headline: current?.label ?? `All checked in at ${baseName}`,
      subline: current?.detail,
      tone:
        current?.id.includes("depart") ||
        current?.id.includes("collect") ||
        current?.label.includes("transit")
          ? "transit"
          : "activity",
      steps,
      morningRollBlocksProgramme: false,
    };
  }

  if (allCheckedIn && hops.length === 0 && !timeline.some((t) => t.kind === "onsite")) {
    if (showEveningRoll && eveningStep) {
      if (evening.complete) {
        eveningStep.state = "complete";
        return {
          headline: "Evening roll complete",
          subline: `No outbound stops · overnight at ${overnightEndName}`,
          tone: "base",
          steps,
          morningRollBlocksProgramme: false,
        };
      }
      eveningStep.state = "current";
      return {
        headline: "Evening roll call",
        subline: curfewClock
          ? `No outbound stops · deadline ${curfewClock}`
          : "No outbound stops — evening accountability",
        tone: "roll",
        steps,
        morningRollBlocksProgramme: false,
      };
    }
    if (baseEndStep) baseEndStep.state = "current";
    return {
      headline: `All checked in at ${baseName}`,
      subline: "No outbound stops in today's programme",
      tone: "base",
      steps,
      morningRollBlocksProgramme: false,
    };
  }

  // Default: checked in, morning done — next incomplete on-site or hop.
  const nextOnsite = steps.find(
    (s) => s.id.startsWith("onsite-") && s.state === "upcoming",
  );
  const nextHopDepart = steps.find(
    (s) => s.id.includes("-depart") && s.state === "upcoming",
  );
  const nextHopAt = steps.find((s) => s.id.includes("-at") && s.state === "upcoming");
  if (nextOnsite) {
    nextOnsite.state = "current";
  } else if (nextHopDepart) {
    nextHopDepart.state = "current";
  } else if (nextHopAt) {
    nextHopAt.state = "current";
  }

  const current = steps.find((s) => s.state === "current");
  return {
    headline: current?.label ?? `All checked in at ${baseName}`,
    subline: current?.detail
      ?? (showMorningRoll
        ? "Morning roll complete — open the next activity in Programme"
        : "Ready for programme — open the next activity when ready"),
    tone:
      current?.id.includes("depart") ||
      current?.id.includes("collect") ||
      current?.label.includes("transit")
        ? "transit"
        : "activity",
    steps,
    morningRollBlocksProgramme: false,
  };
}

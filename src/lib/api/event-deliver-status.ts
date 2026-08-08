/**
 * Event Deliver — group journey status (GUARDRAILS §12.13.8)
 *
 * Derives a read-only timeline for trip leaders: arrival roll, morning roll
 * (multi-day day 2+), bus hops (§11 Manifest + event_bus_manifest), activities,
 * and evening roll (multi-day non-final nights).
 */
import { supabase } from "@/integrations/supabase/client";
import { listEventAttendanceRoll } from "@/lib/api/event-attendance";
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
  isVenueTransportStop,
  type EventDayPhase,
  type EventMealSlot,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import type { StopPhase } from "@/lib/api/event-activity-roll";

const MEAL_SLOT_LABELS: Record<EventMealSlot, string> = {
  breakfast: "Breakfast",
  morning_tea: "Morning tea",
  lunch: "Lunch",
  dinner: "Dinner",
};

export type StatusStepState = "complete" | "current" | "upcoming";

export interface EventDeliverStatusStep {
  id: string;
  label: string;
  detail?: string;
  state: StatusStepState;
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
  allStops: VenueStopRow[],
  sessionDate: string,
  todayStops: VenueStopRow[],
): OvernightWakeBase {
  // Meals / meds are not overnight hotels or hop origins.
  const todayVenues = todayStops.filter((s) => isVenueTransportStop(s));
  const priorDates = [
    ...new Set(
      allStops
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

  const priorVenues = allStops
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

/**
 * Consecutive venue→venue hops only (BL-073 / BL-077).
 * Meal and medication_round stops are on-site at the current venue — never hop destinations.
 */
export function buildProgrammeHops(
  todayStops: VenueStopRow[],
  overnightWake: OvernightWakeBase | null,
): Array<{ from: VenueStopRow; to: VenueStopRow; hopIndex: number }> {
  const venues = todayStops.filter((s) => isVenueTransportStop(s));
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
  if (isMealStop(stop)) {
    const slot = stop.meal_slot;
    const mealName =
      stop.label_override?.trim() ||
      (slot ? MEAL_SLOT_LABELS[slot] : null) ||
      "Meal";
    return `${mealName} at ${at}`;
  }
  if (isMedicationStop(stop)) {
    return stop.label_override?.trim() || `Medication round at ${at}`;
  }
  return `${stopLabel(stop)} at ${at}`;
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

  if (overnightWake?.hotelOmitted && overnightWake.priorLastStop && firstVenue) {
    for (const act of onSiteBeforeFirstVenue(todayStops, firstVenue)) {
      items.push({
        kind: "onsite",
        stop: act,
        atVenue: overnightWake.priorLastStop,
      });
    }
  } else if (firstVenue) {
    for (const act of [
      ...onSiteBeforeFirstVenue(todayStops, firstVenue),
      ...onSiteActivitiesAtVenue(todayStops, firstVenue, nextAfterFirst),
    ]) {
      items.push({ kind: "onsite", stop: act, atVenue: firstVenue });
    }
  } else {
    for (const act of todayStops.filter((s) => isOnSiteProgrammeStop(s))) {
      items.push({ kind: "onsite", stop: act, atVenue: act });
    }
  }

  for (const hop of hops) {
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
  return {
    total: rows.length,
    resolved,
    pending,
    absent,
    complete: rows.length > 0 && pending === 0,
  };
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
    const attendance = await listEventAttendanceRoll(opts.sessionId);
    const pendingArrival = attendance.filter((r) => r.status === "expected").length;
    const checkedIn = attendance.filter((r) => r.status === "checked_in").length;
    if (pendingArrival === 0 && checkedIn === 0) return;
    throw new Error(
      "Complete Morning Roll Call before starting the programme (Morning Roll tab).",
    );
  }

  throw new Error(
    `Morning roll incomplete — ${progress.pending} still to account (Morning Roll tab).`,
  );
}

async function fetchHopTrips(sessionId: string) {
  const { data, error } = await supabase
    .from("transport_trips")
    .select("id, hop_index, status, venue_stop_from_id, venue_stop_to_id")
    .eq("event_day_session_id", sessionId)
    .order("hop_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    hop_index: number | null;
    status: string;
    venue_stop_from_id: string | null;
    venue_stop_to_id: string | null;
  }>;
}

async function fetchActiveTripLegSummary(tripId: string) {
  const { data, error } = await supabase
    .from("trip_legs")
    .select("status, to_label, from_label, passenger_present, to_participant_id")
    .eq("trip_id", tripId)
    .order("leg_index", { ascending: true });
  if (error) throw error;
  const legs = data ?? [];
  const pickupLegs = legs.filter((l) => l.to_participant_id != null);
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
      .select("phase, curfew_time, morning_roll_time")
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

  const todayStops = (allStops as VenueStopRow[])
    .filter((s) => s.session_date === opts.sessionDate)
    .sort((a, b) => a.stop_order - b.stop_order);
  const todayVenues = todayStops.filter((s) => isVenueTransportStop(s));

  // Day 2+: wake / morning base is where the group slept (prior day's last stop),
  // not necessarily today's first itinerary stop (e.g. Day 4 only lists Joes).
  const overnightWake = showMorningRoll
    ? resolveOvernightWakeBase(allStops as VenueStopRow[], opts.sessionDate, todayStops)
    : null;
  /** Arrival / wake label — Day 1 first venue; Day 2+ overnight hotel. */
  const baseStop = overnightWake?.todayStop ?? todayVenues[0] ?? todayStops[0];
  const baseName = overnightWake?.label ?? stopLabel(baseStop);
  /**
   * Where the group sleeps tonight (last venue today — not a meal/med row).
   * Day 1: Mounties (arrive) → Hotel 1 (overnight) — do not reuse arrival name for evening.
   */
  const overnightEndStop =
    todayVenues[todayVenues.length - 1] ?? baseStop;
  const overnightEndName = stopLabel(overnightEndStop, baseName);

  const totalOnTrip = attendance.length;
  const checkedInCount = attendance.filter((r) => r.status === "checked_in").length;
  const checkedInOrOut = attendance.filter(
    (r) => r.status === "checked_in" || r.status === "checked_out",
  ).length;
  const pendingArrival = attendance.filter((r) => r.status === "expected").length;
  const allCheckedIn = totalOnTrip > 0 && pendingArrival === 0;

  const [morning, evening] = await Promise.all([
    showMorningRoll
      ? getAccountabilityProgress("event_morning_log", opts.sessionId)
      : Promise.resolve({
          total: 0,
          resolved: 0,
          pending: 0,
          absent: 0,
          complete: true,
        } satisfies AccountabilityProgress),
    showEveningRoll
      ? getAccountabilityProgress("event_curfew_log", opts.sessionId)
      : Promise.resolve({
          total: 0,
          resolved: 0,
          pending: 0,
          absent: 0,
          complete: true,
        } satisfies AccountabilityProgress),
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
    detail: totalOnTrip > 0 ? `${checkedInOrOut} / ${totalOnTrip} on the trip` : undefined,
    state: "upcoming",
  });

  if (phase === "planning" || phase === "pre_departure") {
    steps[0]!.state = "current";
    return {
      headline: "Open location to begin check-in",
      subline: baseName,
      tone: "planning",
      steps,
      morningRollBlocksProgramme: false,
    };
  }

  if (phase === "closed_orderly" || phase === "closed_incident") {
    steps[0]!.state = "complete";
    if (showMorningRoll) {
      steps.push({
        id: "morning-roll",
        label: rollCompleteLabel("Morning", morning),
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
          state: "complete",
        });
        continue;
      }
      const fromName = stopLabel(item.from);
      const toName = stopLabel(item.to);
      const movement = item.to.movement_method ?? "bus";
      const isBus = movement === "bus";
      if (isBus) {
        steps.push({
          id: `hop-${item.hopIndex}-depart`,
          label: `Board bus — depart ${fromName} for ${toName}`,
          detail: "Delivered · hop complete",
          state: "complete",
        });
      }
      steps.push({
        id: `hop-${item.hopIndex}-at`,
        label: isBus ? `At ${toName}` : `Activity at ${toName}`,
        state: "complete",
      });
    }
    if (showEveningRoll) {
      steps.push({
        id: "evening-roll",
        label: rollCompleteLabel("Evening", evening),
        detail: `Overnight at ${overnightEndName}`,
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
      steps,
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
        steps,
        morningRollBlocksProgramme: true,
      };
    }
  }

  // ── 3. Programme: on-site meals/meds at venue, then venue→venue hops ──
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

    const trip =
      hopTrips.find((t) => t.hop_index === item.hopIndex) ??
      hopTrips.find(
        (t) =>
          t.venue_stop_from_id === item.from.id && t.venue_stop_to_id === item.to.id,
      );

    let onBoard = 0;
    let busTotal = 0;
    let manifestNote: string | undefined;
    let inTransit = false;

    if (isBus && trip) {
      const manifest = await listBusManifest(trip.id);
      onBoard = manifest.filter((r) => r.status === "on_bus").length;
      busTotal = manifest.filter((r) => r.status !== "not_travelling").length;

      if (busTotal > 0) {
        manifestNote = `${onBoard} / ${busTotal} on bus`;
      } else {
        const legSummary = await fetchActiveTripLegSummary(trip.id);
        if (legSummary.pickupTotal > 0) {
          onBoard = legSummary.onBoard;
          busTotal = legSummary.pickupTotal;
          manifestNote = `${onBoard} / ${busTotal} boarded (Manifest)`;
        }
      }

      if (trip.status === "active") {
        const legSummary = await fetchActiveTripLegSummary(trip.id);
        inTransit = legSummary.activeLeg?.status === "en_route";
      }
    }

    const leaveStepId = `hop-${item.hopIndex}-leave`;
    const departStepId = `hop-${item.hopIndex}-depart`;
    const atStepId = `hop-${item.hopIndex}-at`;

    if (methodUnset) {
      steps.push({
        id: leaveStepId,
        label: `Leave for ${toName}`,
        detail: "Choose Bus / Walk / Other / On-site on Programme",
        state: "upcoming",
      });
    } else if (isBus) {
      steps.push({
        id: departStepId,
        label: `Board bus — depart ${fromName} for ${toName}`,
        detail: manifestNote
          ? `${manifestNote} · driver uses Manifest (§11)`
          : "Driver boards passengers via Manifest",
        state: "upcoming",
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
      state: "upcoming",
    });

    const hopComplete = toPhase === "completed";
    const hopActive = toPhase === "active";
    const tripDone = trip?.status === "completed";
    // Destination `active` alone must not skip boarding — only hop arrive does.
    const arrivedAtDest = isBus ? tripDone : hopActive;

    if (hopComplete) {
      if (isBus) {
        const departStep = steps.find((s) => s.id === departStepId);
        if (departStep) {
          departStep.state = "complete";
          // Don't keep stale "4/4 on bus" after the venue is closed out.
          departStep.detail = "Delivered · hop complete";
        }
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
      if (arrivedAtDest || (tripDone && hopActive)) {
        departStep.state = "complete";
        atStep.state = "current";
        atStep.label = `At ${toName}`;
      } else if (inTransit) {
        departStep.state = "complete";
        atStep.state = "current";
        atStep.label = `In transit to ${toName}`;
      } else {
        // Not released, boarding, or active at origin — stay on Board bus.
        departStep.state = "current";
      }
    } else {
      const atStep = steps.find((s) => s.id === atStepId)!;
      atStep.state = "current";
    }
  }

  // ── 4. Evening roll (multi-day non-final) OR base-until note ──────────────
  // Destinations = hop targets (includes first venue when hotel omitted today).
  const destinations = hops.map((h) => h.to);
  const nonFinalDests = destinations.slice(0, -1);
  const finalDest = destinations[destinations.length - 1];
  const allDestinationsDone =
    hops.length === 0 ||
    destinations.every((s) => (s.phase ?? "pending") === "completed");
  /** Back at overnight base (final stop active/completed) — evening roll is next. */
  const readyForEvening =
    phase === "at_base" ||
    (hops.length === 0 && !overnightWake?.hotelOmitted) ||
    (destinations.length > 0 &&
      nonFinalDests.every((s) => (s.phase ?? "pending") === "completed") &&
      finalDest != null &&
      ((finalDest.phase ?? "pending") === "active" ||
        (finalDest.phase ?? "pending") === "completed"));

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
        current?.id.includes("depart") || current?.label.includes("transit")
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
      current?.id.includes("depart") || current?.label.includes("transit")
        ? "transit"
        : "activity",
    steps,
    morningRollBlocksProgramme: false,
  };
}

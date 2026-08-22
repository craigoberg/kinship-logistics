/**
 * Event venue-hop transport (GUARDRAILS §12.3.3 / §12.4.3 / §11)
 *
 * In-day bus movement between itinerary stops — separate from outbound/return manifests.
 */
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger } from "@/lib/api/ledger";
import {
  getOrCreateEventHopTrip,
  listBusManifest,
  type EventBusManifestRow,
} from "@/lib/api/event-day-ops";
import {
  isVenueTransportStop,
  listEventVenueStops,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import {
  mapTransportTripFromDb,
  mapTripLegFromDb,
  resolveStaffIdWithFallback,
  type ActiveTripBundle,
  type TransportTrip,
} from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  assertMorningRollCompleteBeforeProgramme,
  buildProgrammeHops,
  resolveOvernightWakeBase,
  sessionRequiresMorningRoll,
} from "@/lib/api/event-deliver-status";
import {
  eventBusRunOptions,
  eventBusRunShortLabel,
  matchesEventBusRun,
  transportRunKeysForDirection,
} from "@/lib/event-bus-runs";
import { listLookupParameters, LOOKUP_CATEGORIES } from "@/lib/data-store";
import { operationalNowIso } from "@/lib/operational-clock";

export type EventTransportRunKind = "outbound" | "venue_hop" | "return";

export type EventTransportRunStatus =
  | "completed"
  | "active"
  /** Trip prepared / group released — awaiting driver start in Manifest. */
  | "released"
  | "ready"
  | "waiting"
  | "blocked";

export interface EventTransportRunCard {
  key: string;
  kind: EventTransportRunKind;
  hopIndex?: number;
  label: string;
  detail?: string;
  status: EventTransportRunStatus;
  tripId?: string | null;
  fromStopId?: string;
  toStopId?: string;
  originLabel?: string;
  originAddress?: string | null;
  /** BL-069 — Admin bus_runs.code; null = legacy shared bus. */
  busRunCode?: string | null;
  /** Event short label R1/R2 when multi-bus. */
  busRunShortLabel?: string | null;
}

export const eventTransportRunsKey = (
  eventId: string,
  sessionDate: string,
  sessionId: string,
) => ["event-transport-runs", eventId, sessionDate, sessionId] as const;

function stopLabel(stop: EventVenueStop | undefined): string {
  if (!stop) return "Stop";
  return stop.label_override ?? stop.venue_name ?? "Stop";
}

function stopAddress(stop: EventVenueStop | undefined): string | null {
  return stop?.venue_street_address?.trim() || null;
}

async function fetchTripsForSession(sessionId: string, eventId: string, sessionDate: string) {
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

function isHopTrip(row: Record<string, unknown>): boolean {
  return row.trip_kind === "event_venue_hop" || row.hop_index != null;
}

function isCancelledTrip(row: Record<string, unknown>): boolean {
  return String(row.status ?? "").toLowerCase() === "cancelled";
}

function isOutboundTrip(row: Record<string, unknown>): boolean {
  if (isHopTrip(row) || isCancelledTrip(row)) return false;
  const ret = row.trip_return as string | null | undefined;
  return ret === "none" || ret == null;
}

function isReturnTrip(row: Record<string, unknown>): boolean {
  if (isHopTrip(row) || isCancelledTrip(row)) return false;
  return row.trip_return === "depot" || row.trip_return === "day_centre";
}

function tripStatus(row: Record<string, unknown>): string {
  return String(row.status ?? "").toLowerCase();
}

/** Prefer the Manifest run in progress over an older planned/released leftover. */
export function pickTripForRun(
  trips: Record<string, unknown>[],
  runCode: string | null,
): Record<string, unknown> | undefined {
  const matches = trips.filter((t) => {
    if (isCancelledTrip(t)) return false;
    const code = String(t.bus_run_code ?? "").trim() || null;
    return matchesEventBusRun(code, runCode);
  });
  if (matches.length === 0) return undefined;
  const rank = (t: Record<string, unknown>) => {
    const s = tripStatus(t);
    if (s === "active") return 0;
    if (s === "completed") return 1;
    return 2;
  };
  return [...matches].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const at = String(a.started_at ?? a.created_at ?? "");
    const bt = String(b.started_at ?? b.created_at ?? "");
    return bt.localeCompare(at);
  })[0];
}

export async function listEventTransportRuns(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<EventTransportRunCard[]> {
  const [stopsRaw, tripsRaw, sessionRow, attendance, bookingsRes, busLookups] =
    await Promise.all([
      listEventVenueStops(opts.eventId),
      fetchTripsForSession(opts.sessionId, opts.eventId, opts.sessionDate),
      supabase
        .from("event_day_sessions")
        .select("phase")
        .eq("id", opts.sessionId)
        .single(),
      supabase
        .from("event_attendance_log")
        .select("status, return_transport, return_bus_run_code")
        .eq("event_day_session_id", opts.sessionId),
      supabase
        .from("event_roster_bookings")
        .select(
          "outbound_transport_mode, return_transport_mode, outbound_bus_run_code, return_bus_run_code",
        )
        .eq("event_id", opts.eventId)
        .neq("booking_status", "Cancelled"),
      listLookupParameters(LOOKUP_CATEGORIES.busRun),
    ]);

  if (sessionRow.error) throw sessionRow.error;
  if (attendance.error && !isSchemaMismatchError(attendance.error)) throw attendance.error;

  const phase = String(sessionRow.data?.phase ?? "planning");
  const locationOpen = phase === "active" || phase === "in_transit" || phase === "at_base";
  const attRows = (attendance.data ?? []) as Array<{
    status: string;
    return_transport: string | null;
    return_bus_run_code?: string | null;
  }>;
  const pendingArrival = attRows.filter((r) => r.status === "expected").length;
  const allCheckedIn = attRows.length > 0 && pendingArrival === 0;

  const bookingRows = (bookingsRes.error && isSchemaMismatchError(bookingsRes.error)
    ? []
    : (bookingsRes.data ?? [])) as Array<{
    outbound_transport_mode?: string | null;
    return_transport_mode?: string | null;
    outbound_bus_run_code?: string | null;
    return_bus_run_code?: string | null;
  }>;

  const outboundRosterCodes = bookingRows
    .filter((b) => (b.outbound_transport_mode ?? "bus") === "bus")
    .map((b) => b.outbound_bus_run_code);
  const returnRosterCodes = bookingRows
    .filter((b) => (b.return_transport_mode ?? "bus") === "bus")
    .map((b) => b.return_bus_run_code);
  // Floor overrides also open return cards for that run.
  const returnFloorCodes = attRows
    .filter(
      (r) =>
        r.status === "checked_out" && (r.return_transport ?? "").toLowerCase() === "bus",
    )
    .map((r) => r.return_bus_run_code);

  const outboundRunKeys = transportRunKeysForDirection(outboundRosterCodes);
  const returnRunKeys = transportRunKeysForDirection([
    ...returnRosterCodes,
    ...returnFloorCodes,
  ]);

  const runOpts = eventBusRunOptions(busLookups);
  const shortFor = (code: string | null) =>
    code ? eventBusRunShortLabel(code, runOpts) : null;

  const findTripForRun = (
    trips: Record<string, unknown>[],
    runCode: string | null,
  ): Record<string, unknown> | undefined => pickTripForRun(trips, runCode);

  const handoverStartedForRun = (runCode: string | null) =>
    attRows.some(
      (r) =>
        r.status === "checked_out" &&
        (r.return_transport ?? "").toLowerCase() === "bus" &&
        matchesEventBusRun(r.return_bus_run_code, runCode),
    );

  const allHandoverDone =
    attRows.length > 0 &&
    attRows.every((r) => r.status === "checked_out" || r.status === "absent");

  // Meal / medication Programme activities are not venue hops (BL-073 / BL-077).
  const dayStops = stopsRaw
    .filter((s) => s.session_date === opts.sessionDate)
    .filter((s) => isVenueTransportStop(s))
    .sort((a, b) => a.stop_order - b.stop_order);

  const showMorning = await sessionRequiresMorningRoll(opts.eventId, opts.sessionDate);
  const overnightWake = showMorning
    ? resolveOvernightWakeBase(stopsRaw, opts.sessionDate, dayStops)
    : null;
  const programmeHops = buildProgrammeHops(dayStops, overnightWake);

  const cards: EventTransportRunCard[] = [];
  const hopTrips = tripsRaw.filter(isHopTrip);
  const outboundTrips = tripsRaw.filter(isOutboundTrip);
  const returnTrips = tripsRaw.filter(isReturnTrip);

  // ── Outbound (Transport IN) — one card per bus run (BL-069) ───────────────
  for (const runCode of outboundRunKeys) {
    const outboundTrip = findTripForRun(outboundTrips, runCode);
    const rx = shortFor(runCode);
    let outboundStatus: EventTransportRunStatus = "waiting";
    let outboundDetail = rx
      ? `${rx} morning pickup · bus stays at venue`
      : "Morning pickup · bus stays at venue";
    if (outboundTrip) {
      const st = tripStatus(outboundTrip);
      if (st === "completed") outboundStatus = "completed";
      else if (st === "active") outboundStatus = "active";
      else outboundStatus = "released";
    } else if (locationOpen && allCheckedIn) {
      outboundStatus = "completed";
      outboundDetail = "Group already at venue today";
    } else {
      outboundStatus = "ready";
      if (locationOpen && pendingArrival > 0) {
        outboundDetail = rx
          ? `${rx} pickup · ${pendingArrival} still expected at venue`
          : `Morning pickup · ${pendingArrival} still expected at venue`;
      }
    }

    cards.push({
      key: runCode ? `outbound:${runCode}` : "outbound",
      kind: "outbound",
      label: rx
        ? `Transport IN (${rx}) — Depot → venue`
        : "Transport IN — Depot → venue",
      detail: outboundDetail,
      status: outboundStatus,
      tripId: (outboundTrip?.id as string | undefined) ?? null,
      busRunCode: runCode,
      busRunShortLabel: rx,
    });
  }

  // Aggregate outbound status for hop gating (any completed / all done).
  const outboundCards = cards.filter((c) => c.kind === "outbound");
  const outboundStatusAgg: EventTransportRunStatus = outboundCards.every(
    (c) => c.status === "completed",
  )
    ? "completed"
    : outboundCards.some((c) => c.status === "active")
      ? "active"
      : outboundCards.some((c) => c.status === "ready" || c.status === "released")
        ? "ready"
        : "waiting";

  // ── Venue hops (programme pairs + omitted-hotel wake hop; bus only) ───────
  // Walk / on-site destinations are skipped. Unset movement still appears as a
  // potential bus hop (waiting for trip leader to choose Bus + Release).
  for (const hop of programmeHops) {
    const from = hop.from;
    const to = hop.to;
    const i = hop.hopIndex;
    const movementRaw = (
      to as EventVenueStop & { movement_method?: string | null }
    ).movement_method;
    // Only bus hops appear on Manifest. walk / on_site / other skip.
    if (
      movementRaw === "walk" ||
      movementRaw === "on_site" ||
      movementRaw === "other"
    ) {
      continue;
    }

    const fromName = stopLabel(from);
    const toName = stopLabel(to);
    const hopTrip =
      hopTrips.find((t) => Number(t.hop_index) === i) ??
      hopTrips.find(
        (t) =>
          t.venue_stop_from_id === from.id && t.venue_stop_to_id === to.id,
      );

    let hopStatus: EventTransportRunStatus = "waiting";
    let hopDetail =
      overnightWake?.hotelOmitted && i === 0
        ? "Overnight wake → first activity · board where the group is"
        : "In-day bus hop · boarding at origin";
    const priorHopDone =
      i === 0
        ? outboundStatusAgg === "completed" || (locationOpen && allCheckedIn)
        : hopTrips.some(
            (t) => Number(t.hop_index) === i - 1 && tripStatus(t) === "completed",
          );
    const busPlanned = movementRaw === "bus";

    if (hopTrip) {
      const st = tripStatus(hopTrip);
      if (st === "completed") hopStatus = "completed";
      else if (st === "active") hopStatus = "active";
      else hopStatus = "released";
    } else if (!locationOpen) {
      hopStatus = "blocked";
      hopDetail = "Open location on Event Deliver before in-day hops";
    } else if (!allCheckedIn) {
      hopStatus = "waiting";
      hopDetail =
        pendingArrival > 0
          ? `Waiting — finish Transport IN / Check-In (${pendingArrival} still expected)`
          : "Waiting — finish Transport IN / Check-In first";
    } else if (!priorHopDone) {
      hopStatus = "waiting";
      hopDetail = "Waiting — complete the previous hop first";
    } else if (!busPlanned) {
      hopStatus = "waiting";
      hopDetail =
        "Waiting — trip leader chooses By Bus and Releases on Programme";
    } else {
      // Destination still pending; Release unlocks Manifest (not Open).
      hopStatus = "ready";
      hopDetail =
        "Ready for trip leader Release on Programme — then start here";
    }

    cards.push({
      key: `hop-${i}`,
      kind: "venue_hop",
      hopIndex: i,
      label: `${fromName} → ${toName}`,
      detail: hopDetail,
      status: hopStatus,
      tripId: (hopTrip?.id as string | undefined) ?? null,
      fromStopId: from.id,
      toStopId: to.id,
      originLabel: fromName,
      originAddress: stopAddress(from),
    });
  }

  // ── Return home — one card per bus run (BL-069) ───────────────────────────
  const allHopsDone =
    cards.filter((c) => c.kind === "venue_hop").length === 0 ||
    cards
      .filter((c) => c.kind === "venue_hop")
      .every((c) => c.status === "completed");

  const lastStop = dayStops[dayStops.length - 1];
  const lastStopLabel = stopLabel(lastStop);
  const lastStopAddress = stopAddress(lastStop);

  for (const runCode of returnRunKeys) {
    const returnTrip = findTripForRun(returnTrips, runCode);
    const rx = shortFor(runCode);
    const busHandoverStarted = handoverStartedForRun(runCode);

    let returnStatus: EventTransportRunStatus = "waiting";
    let returnDetail = rx
      ? `Complete Check-Out — hand to ${rx} before starting HOME`
      : "Complete Check-Out (hand to bus) before starting the home run";
    if (returnTrip) {
      const st = tripStatus(returnTrip);
      if (st === "completed") returnStatus = "completed";
      else if (st === "active") returnStatus = "active";
      else returnStatus = "released";
      returnDetail = rx
        ? `${rx} · bus passengers only · start from last stop`
        : "Bus passengers only · start from last stop";
    } else if (phase === "closed_orderly" || phase === "closed_incident") {
      returnStatus = "ready";
      returnDetail = rx
        ? `From ${lastStopLabel} → depot · ${rx}`
        : `From ${lastStopLabel} → depot · bus passengers only`;
    } else if (allHopsDone && locationOpen && (busHandoverStarted || allHandoverDone)) {
      returnStatus = "ready";
      returnDetail = rx
        ? `From ${lastStopLabel} → depot · ${rx}`
        : `From ${lastStopLabel} → depot · bus passengers only`;
    } else if (allHopsDone && locationOpen) {
      returnStatus = "waiting";
      returnDetail = rx
        ? `Finish Check-Out first — hand passengers to ${rx}`
        : "Finish Check-Out first — hand bus passengers to return transport";
    }

    cards.push({
      key: runCode ? `return:${runCode}` : "return",
      kind: "return",
      label: rx
        ? `Transport HOME (${rx}) — ${lastStopLabel} → depot`
        : `Transport HOME — ${lastStopLabel} → depot`,
      detail: returnDetail,
      status: returnStatus,
      tripId: (returnTrip?.id as string | undefined) ?? null,
      originLabel: lastStopLabel,
      originAddress: lastStopAddress,
      busRunCode: runCode,
      busRunShortLabel: rx,
    });
  }

  return cards;
}

/** Seed boarding roll from checked-in event-floor attendees only. */
export async function seedBusManifestForHop(opts: {
  eventId: string;
  eventDaySessionId: string;
  tripId: string;
}): Promise<number> {
  const { data: attendance, error: attErr } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("status", "checked_in");
  if (attErr) throw attErr;

  const participantIds = (attendance ?? []).map(
    (r) => (r as { participant_id: string }).participant_id,
  );
  if (!participantIds.length) return 0;

  const { data: bookings } = await supabase
    .from("event_roster_bookings")
    .select("participant_id, carer_id, brings_carer, carer_transport_required")
    .eq("event_id", opts.eventId)
    .neq("booking_status", "Cancelled")
    .in("participant_id", participantIds);

  const rows: Record<string, unknown>[] = [];
  for (const pid of participantIds) {
    rows.push({
      event_day_session_id: opts.eventDaySessionId,
      transport_trip_id: opts.tripId,
      participant_id: pid,
      carer_id: null,
      expected_on_bus: true,
      status: "expected",
    });
  }
  for (const bk of bookings ?? []) {
    const b = bk as {
      participant_id: string;
      carer_id?: string | null;
      brings_carer?: boolean;
      carer_transport_required?: boolean;
    };
    if (b.brings_carer && b.carer_transport_required && b.carer_id) {
      rows.push({
        event_day_session_id: opts.eventDaySessionId,
        transport_trip_id: opts.tripId,
        participant_id: null,
        carer_id: b.carer_id,
        expected_on_bus: true,
        status: "expected",
      });
    }
  }

  if (!rows.length) return 0;

  for (const batch of [rows.filter((r) => r.participant_id), rows.filter((r) => r.carer_id && !r.participant_id)]) {
    if (!batch.length) continue;
    const { error } = await supabase.from("event_bus_manifest").insert(batch);
    if (error && error.code !== "23505") throw error;
  }

  const manifest = await listBusManifest(opts.tripId);
  return manifest.length;
}

/** Trip leader prepares a hop before the driver opens Manifest (Release only). */
export async function prepareEventHopManifest(opts: {
  eventId: string;
  eventDaySessionId: string;
  sessionDate: string;
  hopIndex: number;
  fromStopId: string;
  toStopId: string;
}): Promise<string> {
  await assertMorningRollCompleteBeforeProgramme({
    eventId: opts.eventId,
    sessionId: opts.eventDaySessionId,
    sessionDate: opts.sessionDate,
  });

  const { getProgrammeSuspend } = await import("@/lib/api/operational-emergency");
  const suspended = await getProgrammeSuspend(opts.eventDaySessionId);
  if (suspended?.active) {
    throw new Error(
      `Programme suspended${suspended.reason ? `: ${suspended.reason}` : ""}. Manager must clear before releasing a hop.`,
    );
  }

  const { data: toStop, error: toErr } = await supabase
    .from("event_venue_stops")
    .select("id, phase, movement_method")
    .eq("id", opts.toStopId)
    .maybeSingle();
  if (toErr) throw toErr;
  if (!toStop) throw new Error("Destination stop not found.");
  const toPhase = (toStop as { phase?: string | null }).phase ?? "pending";
  const toMovement = (toStop as { movement_method?: string | null }).movement_method;
  if (toPhase !== "pending") {
    throw new Error(
      "Destination is already open or completed — Release is only before the hop arrives.",
    );
  }
  if (toMovement !== "bus") {
    throw new Error(
      "Choose By Bus on Programme before releasing the group to the bus.",
    );
  }

  const { countOutstandingActivityExpected } = await import(
    "@/lib/api/event-activity-roll"
  );
  const outstandingFrom = await countOutstandingActivityExpected(opts.fromStopId);
  if (outstandingFrom > 0) {
    throw new Error(
      `${outstandingFrom} person${outstandingFrom === 1 ? "" : "s"} still outstanding on the activity check-in. Confirm or mark Not at activity before releasing to the bus.`,
    );
  }

  const tripId = await getOrCreateEventHopTrip({
    eventId: opts.eventId,
    eventDaySessionId: opts.eventDaySessionId,
    sessionDate: opts.sessionDate,
    fromStopId: opts.fromStopId,
    toStopId: opts.toStopId,
    hopIndex: opts.hopIndex,
  });

  const existing = await listBusManifest(tripId);
  if (existing.length === 0) {
    await seedBusManifestForHop({
      eventId: opts.eventId,
      eventDaySessionId: opts.eventDaySessionId,
      tripId,
    });
  }

  await supabase
    .from("event_day_sessions")
    .update({ phase: "in_transit", updated_at: operationalNowIso() })
    .eq("id", opts.eventDaySessionId)
    .in("phase", ["active", "at_base"]);

  // Leave-from-current: Release completes the origin stop (custody handed to bus).
  const { closeVenueStop } = await import("@/lib/api/event-activity-roll");
  const { data: fromRow } = await supabase
    .from("event_venue_stops")
    .select("id, label_override, venues(name)")
    .eq("id", opts.fromStopId)
    .maybeSingle();
  const fromVenues = (
    fromRow as { venues?: { name?: string } | null } | null
  )?.venues;
  await closeVenueStop({
    id: opts.fromStopId,
    eventId: opts.eventId,
    venueName:
      (fromRow as { label_override?: string | null } | null)?.label_override ??
      fromVenues?.name ??
      null,
    sessionDate: opts.sessionDate,
  });

  const staffId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "GREEN",
    action_type: "EVENT_HOP_PREPARED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      trip_id: tripId,
      event_id: opts.eventId,
      session_id: opts.eventDaySessionId,
      hop_index: opts.hopIndex,
      from_stop_id: opts.fromStopId,
      to_stop_id: opts.toStopId,
    },
  });

  return tripId;
}

export interface StartEventVenueHopInput {
  tripId: string;
  driverStaffId: string;
  startOdometerKm: number;
  /** Fleet vehicle for Close Run → current_odometer_km (BL-096). */
  assetId?: string | null;
  varianceReason?: string | null;
}

async function resolveHopStopLabels(fromStopId: string, toStopId: string) {
  const { data: stops, error: stopErr } = await supabase
    .from("event_venue_stops")
    .select("id, label_override, venues(name, street_address)")
    .in("id", [fromStopId, toStopId]);
  if (stopErr) throw stopErr;

  const stopMap = new Map(
    (stops ?? []).map((s) => {
      const r = s as {
        id: string;
        label_override?: string | null;
        venues?: { name?: string; street_address?: string | null } | null;
      };
      return [r.id, r];
    }),
  );
  const fromStop = stopMap.get(fromStopId);
  const toStop = stopMap.get(toStopId);
  return {
    fromLabel:
      fromStop?.label_override?.trim() || fromStop?.venues?.name?.trim() || "Origin",
    toLabel: toStop?.label_override?.trim() || toStop?.venues?.name?.trim() || "Destination",
    fromAddress: fromStop?.venues?.street_address?.trim() || null,
    toAddress: toStop?.venues?.street_address?.trim() || null,
  };
}

/**
 * Ensure the single venue_to_venue hop leg exists.
 * Must set medication_handover_status — live CHECK rejects null / omitted values.
 */
/** Public heal for active hops that activated before the leg insert succeeded. */
export async function healActiveVenueHopLegs(tripId: string): Promise<boolean> {
  const { data: tripRow, error } = await supabase
    .from("transport_trips")
    .select("id, trip_kind, venue_stop_from_id, venue_stop_to_id")
    .eq("id", tripId)
    .maybeSingle();
  if (error || !tripRow) return false;
  const row = tripRow as Record<string, unknown>;
  if (row.trip_kind !== "event_venue_hop") return false;
  const fromStopId = row.venue_stop_from_id as string | null;
  const toStopId = row.venue_stop_to_id as string | null;
  if (!fromStopId || !toStopId) return false;

  const { data: existing } = await supabase
    .from("trip_legs")
    .select("id")
    .eq("trip_id", tripId)
    .limit(1);
  if (existing?.length) return false;

  const labels = await resolveHopStopLabels(fromStopId, toStopId);
  await ensureVenueHopLeg({
    tripId,
    fromLabel: labels.fromLabel,
    toLabel: labels.toLabel,
    toAddress: labels.toAddress,
  });
  return true;
}

async function ensureVenueHopLeg(opts: {
  tripId: string;
  fromLabel: string;
  toLabel: string;
  toAddress: string | null;
}): Promise<void> {
  const { data: existingLegs } = await supabase
    .from("trip_legs")
    .select("id")
    .eq("trip_id", opts.tripId)
    .limit(1);
  if (existingLegs?.length) return;

  const { error: legErr } = await supabase.from("trip_legs").insert({
    trip_id: opts.tripId,
    leg_index: 1,
    leg_kind: "venue_to_venue",
    from_label: opts.fromLabel,
    to_label: opts.toLabel,
    from_participant_id: null,
    to_participant_id: null,
    status: "pending",
    medication_expected: false,
    medication_handover_status: "not_required",
    target_address: opts.toAddress,
  });
  if (legErr) throw new Error(`Could not create hop leg: ${legErr.message}`);
}

export async function startEventVenueHop(
  input: StartEventVenueHopInput,
): Promise<ActiveTripBundle> {
  const { data: tripRow, error: tripErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("id", input.tripId)
    .single();
  if (tripErr) throw new Error(`Hop trip not found: ${tripErr.message}`);

  const row = tripRow as Record<string, unknown>;
  if (row.trip_kind !== "event_venue_hop") {
    throw new Error("This is not a venue hop trip.");
  }

  const fromStopId = row.venue_stop_from_id as string | null;
  const toStopId = row.venue_stop_to_id as string | null;
  if (!fromStopId || !toStopId) {
    throw new Error("Hop trip is missing venue stop linkage.");
  }

  const labels = await resolveHopStopLabels(fromStopId, toStopId);

  const st = tripStatus(row);
  if (st === "completed") throw new Error("This hop is already completed.");

  // Resume / heal: prior start activated the trip then failed on leg insert.
  if (st === "active" && row.driver_staff_id === input.driverStaffId) {
    await ensureVenueHopLeg({
      tripId: input.tripId,
      fromLabel: labels.fromLabel,
      toLabel: labels.toLabel,
      toAddress: labels.toAddress,
    });
    const { data: legRows } = await supabase
      .from("trip_legs")
      .select("*")
      .eq("trip_id", input.tripId)
      .order("leg_index", { ascending: true });
    const { data: ev } = await supabase
      .from("event_manifest")
      .select("title")
      .eq("id", row.event_id as string)
      .maybeSingle();
    return {
      trip: mapTransportTripFromDb(tripRow),
      legs: (legRows ?? []).map((l) => mapTripLegFromDb(l)),
      eventTitle: (ev as { title?: string } | null)?.title ?? null,
    };
  }
  if (st === "active") {
    throw new Error("Another driver already has this hop active.");
  }

  const { data: activeOther } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("driver_staff_id", input.driverStaffId)
    .eq("status", "active")
    .neq("id", input.tripId)
    .maybeSingle();
  if (activeOther) {
    throw new Error("You already have an active manifest. Complete or cancel it first.");
  }

  const manifest = await listBusManifest(input.tripId);
  if (manifest.length === 0) {
    await seedBusManifestForHop({
      eventId: row.event_id as string,
      eventDaySessionId: row.event_day_session_id as string,
      tripId: input.tripId,
    });
  }

  // Create leg first so a CHECK failure cannot leave an active trip with 0 legs.
  await ensureVenueHopLeg({
    tripId: input.tripId,
    fromLabel: labels.fromLabel,
    toLabel: labels.toLabel,
    toAddress: labels.toAddress,
  });

  const hopUpdateBase = {
    driver_staff_id: input.driverStaffId,
    status: "active" as const,
    start_odometer: input.startOdometerKm,
    start_odometer_km: input.startOdometerKm,
    start_odometer_variance_reason: input.varianceReason?.trim() || null,
    trip_origin: "depot",
    trip_return: "none",
    origin_address: labels.fromAddress,
    updated_at: operationalNowIso(),
  };
  let { data: updatedTrip, error: updErr } = await supabase
    .from("transport_trips")
    .update({
      ...hopUpdateBase,
      asset_id: input.assetId?.trim() || null,
    })
    .eq("id", input.tripId)
    .select("*")
    .single();
  // Pre-BL-096 DBs: retry without asset_id until migration is applied.
  if (updErr && isSchemaMismatchError(updErr)) {
    const retry = await supabase
      .from("transport_trips")
      .update(hopUpdateBase)
      .eq("id", input.tripId)
      .select("*")
      .single();
    updatedTrip = retry.data;
    updErr = retry.error;
  }
  if (updErr) throw new Error(`Could not activate hop: ${updErr.message}`);

  const staffId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "GREEN",
    action_type: "EVENT_HOP_STARTED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      trip_id: input.tripId,
      event_id: row.event_id,
      hop_index: row.hop_index,
      driver_staff_id: input.driverStaffId,
    },
  });

  const { data: legRowsFixed, error: legLoadErrFixed } = await supabase
    .from("trip_legs")
    .select("*")
    .eq("trip_id", input.tripId)
    .order("leg_index", { ascending: true });
  if (legLoadErrFixed) throw legLoadErrFixed;

  const { data: ev } = await supabase
    .from("event_manifest")
    .select("title")
    .eq("id", row.event_id as string)
    .maybeSingle();

  return {
    trip: mapTransportTripFromDb(updatedTrip),
    legs: (legRowsFixed ?? []).map((l) => mapTripLegFromDb(l)),
    eventTitle: (ev as { title?: string } | null)?.title ?? null,
  };
}

/** After driver closes a hop manifest — restore event floor phase and mark stops. */
export async function finalizeEventVenueHop(trip: TransportTrip): Promise<void> {
  if (trip.tripKind !== "event_venue_hop") return;
  if (!trip.eventDaySessionId) return;

  const now = operationalNowIso();
  await supabase
    .from("event_day_sessions")
    .update({ phase: "active", updated_at: now })
    .eq("id", trip.eventDaySessionId)
    .eq("phase", "in_transit");

  if (trip.venueStopFromId) {
    await supabase
      .from("event_venue_stops")
      .update({ phase: "completed", closed_at: now })
      .eq("id", trip.venueStopFromId);
  }
  if (trip.venueStopToId) {
    await supabase
      .from("event_venue_stops")
      .update({
        phase: "active",
        movement_method: "bus",
        opened_at: now,
      })
      .eq("id", trip.venueStopToId);
  }
}

export function hopBoardingComplete(manifest: EventBusManifestRow[]): boolean {
  if (!manifest.length) return false;
  return manifest.every((r) => r.status === "on_bus" || r.status === "not_travelling");
}

export function hopBoardingCounts(manifest: EventBusManifestRow[]): {
  onBoard: number;
  total: number;
} {
  const travelling = manifest.filter((r) => r.status !== "not_travelling");
  return {
    onBoard: manifest.filter((r) => r.status === "on_bus").length,
    total: travelling.length,
  };
}

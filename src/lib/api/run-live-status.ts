/**
 * Office live view of a Day Centre Manifest run — derived from trip_legs.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  isCancelledPickupLeg,
  isPassengerPickupLeg,
  mapTripLegFromDb,
  mapTransportTripFromDb,
  NON_CHARGEABLE_STATUSES,
  type AttendanceStatus,
  type TripLeg,
  type TransportTrip,
} from "@/lib/data-store";
import type { BusRunRouteDirection } from "@/lib/api/bus-run-routes";

export type RunLiveStatusKind =
  | "not_started"
  | "awaiting_pu"
  | "traveling_to"
  | "stopped_at"
  | "on_bus"
  | "off_today"
  | "dropped";

export interface RunLiveStatus {
  kind: RunLiveStatusKind;
  label: string;
  runCode: string;
  direction: BusRunRouteDirection;
  tripId: string | null;
  participantId: string;
  /** When this status was set (depart / arrive / board / exemption). */
  setAt: string | null;
}

const KIND_LABEL: Record<RunLiveStatusKind, string> = {
  not_started: "Not started",
  awaiting_pu: "Awaiting PU",
  traveling_to: "Traveling-To",
  stopped_at: "Stopped-At",
  on_bus: "On-Bus",
  off_today: "Off today",
  dropped: "Dropped",
};

export function runLiveStatusKey(
  participantId: string,
  runCode: string,
  direction: BusRunRouteDirection,
): string {
  return `${participantId}|${runCode}|${direction}`;
}

function tripDirection(trip: TransportTrip): BusRunRouteDirection {
  return trip.tripReturn === "none" ? "morning" : "afternoon";
}

function statusFromLeg(
  leg: TripLeg,
  activeLeg: TripLeg | null,
  direction: BusRunRouteDirection,
): RunLiveStatusKind {
  if (isCancelledPickupLeg(leg)) return "off_today";
  if (leg.status === "completed") {
    if (leg.passengerPresent === false) return "off_today";
    return direction === "afternoon" ? "dropped" : "on_bus";
  }
  if (activeLeg?.id === leg.id) {
    if (leg.status === "en_route") return "traveling_to";
    if (leg.status === "arrived") return "stopped_at";
  }
  if (direction === "afternoon" && leg.status === "pending") return "on_bus";
  return "awaiting_pu";
}

function setAtForKind(
  kind: RunLiveStatusKind,
  leg: TripLeg | null,
  trip: TransportTrip | null,
  exemptAt: string | null,
): string | null {
  switch (kind) {
    case "traveling_to":
      return leg?.startAt ?? null;
    case "stopped_at":
      return leg?.endAt ?? leg?.startAt ?? null;
    case "on_bus":
      if (leg?.status === "completed") return leg.completedAt ?? leg.endAt ?? null;
      return trip?.startedAt ?? null;
    case "dropped":
      return leg?.completedAt ?? leg?.endAt ?? null;
    case "off_today":
      return exemptAt ?? leg?.completedAt ?? null;
    case "awaiting_pu":
      return trip?.startedAt ?? null;
    default:
      return null;
  }
}

export async function listExemptParticipantIdsForDate(
  dateIso: string,
): Promise<Set<string>> {
  const stamped = await listExemptAtForDate(dateIso);
  return new Set(stamped.keys());
}

async function listExemptAtForDate(dateIso: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("attendance_roster_logs")
    .select("participant_id, actual_status, created_at")
    .eq("roster_date", dateIso);
  if (error) {
    if (isSchemaMismatchError(error)) return new Map();
    console.warn("[listExemptAtForDate]", error);
    return new Map();
  }
  const out = new Map<string, string>();
  for (const raw of data ?? []) {
    const row = raw as {
      participant_id: string;
      actual_status: string;
      created_at: string;
    };
    if (!NON_CHARGEABLE_STATUSES.includes(row.actual_status as AttendanceStatus)) {
      continue;
    }
    const prev = out.get(row.participant_id);
    if (!prev || row.created_at > prev) out.set(row.participant_id, row.created_at);
  }
  return out;
}

/** Today's Day Centre run status keyed by participant|run|direction. */
export async function listTodaysRunLiveStatus(
  todayIso: string,
): Promise<Map<string, RunLiveStatus>> {
  const map = new Map<string, RunLiveStatus>();
  const exemptAt = await listExemptAtForDate(todayIso);

  const { data: tripRows, error: tripErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("trip_date", todayIso)
    .eq("status", "active")
    .not("bus_run_code", "is", null);
  if (tripErr) {
    if (isSchemaMismatchError(tripErr)) return map;
    throw new Error(tripErr.message);
  }

  for (const raw of tripRows ?? []) {
    const trip = mapTransportTripFromDb(raw);
    const runCode = trip.busRunCode;
    if (!runCode) continue;
    const direction = tripDirection(trip);

    const { data: legRows, error: legErr } = await supabase
      .from("trip_legs")
      .select("*")
      .eq("trip_id", trip.id)
      .order("leg_index", { ascending: true });
    if (legErr) continue;
    const legs = (legRows ?? []).map(mapTripLegFromDb);
    const activeLeg = legs.find((l) => l.status !== "completed") ?? null;

    for (const leg of legs) {
      if (!isPassengerPickupLeg(leg) || !leg.toParticipantId) continue;
      const kind = exemptAt.has(leg.toParticipantId)
        ? "off_today"
        : statusFromLeg(leg, activeLeg, direction);
      map.set(runLiveStatusKey(leg.toParticipantId, runCode, direction), {
        kind,
        label: KIND_LABEL[kind],
        runCode,
        direction,
        tripId: trip.id,
        participantId: leg.toParticipantId,
        setAt: setAtForKind(
          kind,
          leg,
          trip,
          exemptAt.get(leg.toParticipantId) ?? null,
        ),
      });
    }
  }

  for (const [participantId, at] of exemptAt) {
    // People exempted before the run started still show Off today on office screens.
    if (![...map.keys()].some((k) => k.startsWith(`${participantId}|`))) {
      map.set(runLiveStatusKey(participantId, "", "morning"), {
        kind: "off_today",
        label: KIND_LABEL.off_today,
        runCode: "",
        direction: "morning",
        tripId: null,
        participantId,
        setAt: at,
      });
    }
  }

  for (const status of map.values()) {
    if (status.kind !== "on_bus" || status.direction !== "afternoon") continue;
    const morning = map.get(
      runLiveStatusKey(status.participantId, status.runCode, "morning"),
    );
    if (morning?.setAt) status.setAt = morning.setAt;
  }

  return map;
}

export function lookupRunLiveStatus(
  map: Map<string, RunLiveStatus>,
  participantId: string,
  runCode: string | null | undefined,
  direction: BusRunRouteDirection,
): RunLiveStatus | null {
  if (runCode) {
    const hit = map.get(runLiveStatusKey(participantId, runCode, direction));
    if (hit) return hit;
  }
  return map.get(runLiveStatusKey(participantId, "", "morning")) ?? null;
}

/**
 * transport-run-close.ts — driver attestation + ledger receipt when closing a manifest run (§11).
 *
 * Mirrors Day Centre closure: reconcile summary → operator PIN → immutable ledger row
 * → trip status completed.
 */
import { supabase } from "@/integrations/supabase/client";
import { writeToLedgerOrThrow, tryGetGps } from "@/lib/api/ledger";
import {
  completeTrip,
  resolveStaffIdWithFallback,
  verifyStaffPin,
  getStaffId,
  getActiveUserProfile,
  DEFAULT_STAFF_UUID,
  isPassengerPickupLeg,
  mapTripLegFromDb,
  mapTransportTripFromDb,
  type TransportTrip,
  type TripLeg,
} from "@/lib/data-store";

export type RunCloseKind =
  | "event_outbound"
  | "event_return"
  | "day_centre_morning"
  | "day_centre_afternoon"
  | "event_legacy";

export interface RunCloseSummary {
  kind: RunCloseKind;
  attestationLine: string;
  totalLegs: number;
  completedLegs: number;
  totalKm: number;
  cancelledPickups: Array<{ legId: string; label: string }>;
  noShowLegs: Array<{ legId: string; label: string }>;
  unexpectedMedLegs: number;
  issuesLoggedThisRun: number;
}

export interface OpenTransportRedBlock {
  id: string;
  description: string;
}

const ATTESTATION: Record<RunCloseKind, string> = {
  event_outbound:
    "All bus passengers on this manifest are delivered or accounted for at the venue. Issues this run are logged, or none occurred.",
  event_return:
    "All bus passengers are safely at their drop-off. Issues this run are logged, or none occurred.",
  event_legacy:
    "All legs on this manifest are complete and passengers accounted for.",
  day_centre_morning:
    "Morning run complete — all pickups on this manifest are reconciled.",
  day_centre_afternoon:
    "Return run complete — all drop-offs on this manifest are reconciled.",
};

export function inferRunCloseKind(trip: TransportTrip): RunCloseKind {
  if (trip.eventId) {
    return trip.tripReturn === "none" ? "event_outbound" : "event_return";
  }
  if (trip.busRunCode) {
    return trip.tripReturn === "none" ? "day_centre_morning" : "day_centre_afternoon";
  }
  return trip.tripReturn === "none" ? "event_outbound" : "event_return";
}

export function buildRunCloseSummary(trip: TransportTrip, legs: TripLeg[]): RunCloseSummary {
  const kind = inferRunCloseKind(trip);
  const completed = legs.filter((l) => l.status === "completed");
  const cancelledPickups = legs
    .filter(
      (l) =>
        isPassengerPickupLeg(l) && l.status === "completed" && l.passengerPresent === false,
    )
    .map((l) => ({ legId: l.id, label: l.toLabel }));
  const noShowLegs = legs
    .filter((l) => l.noShowTriggeredAt != null)
    .map((l) => ({ legId: l.id, label: l.toLabel }));
  const unexpectedMedLegs = completed.filter((l) => l.unexpectedMedicationLogged).length;
  const totalKm = completed.reduce(
    (sum, l) => sum + (l.loggedDistanceKm ?? l.gpsDistanceKm ?? 0),
    0,
  );

  return {
    kind,
    attestationLine: ATTESTATION[kind],
    totalLegs: legs.length,
    completedLegs: completed.length,
    totalKm,
    cancelledPickups,
    noShowLegs,
    unexpectedMedLegs,
    issuesLoggedThisRun: 0,
  };
}

function incidentBlocksClose(row: {
  description: string;
  status: string;
  severity: string;
}): boolean {
  if (row.severity !== "sev1") return false;
  if (!["pending", "open"].includes(row.status)) return false;
  const desc = row.description ?? "";
  if (desc.includes("[VERBAL WORKAROUND]") || desc.includes("VERBAL WORKAROUND")) {
    return false;
  }
  return true;
}

/** Open RED incidents tied to this run that lack an accepted verbal workaround. */
export async function listOpenTransportRedBlocks(
  trip: TransportTrip,
): Promise<OpenTransportRedBlock[]> {
  const blocks: OpenTransportRedBlock[] = [];
  const seen = new Set<string>();

  const addRows = (
    rows: Array<{ id: string; description: string; status: string; severity: string }> | null,
  ) => {
    for (const row of rows ?? []) {
      if (seen.has(row.id)) continue;
      if (!incidentBlocksClose(row)) continue;
      seen.add(row.id);
      blocks.push({ id: row.id, description: row.description });
    }
  };

  let q = supabase
    .from("operational_incidents")
    .select("id, description, status, severity, created_at")
    .gte("created_at", trip.startedAt)
    .in("status", ["pending", "open"])
    .eq("severity", "sev1");

  if (trip.eventId) {
    q = q.eq("event_id", trip.eventId);
  }

  const { data: eventIncidents, error: evErr } = await q;
  if (evErr) throw evErr;
  addRows(eventIncidents as Array<{ id: string; description: string; status: string; severity: string }>);

  const { data: tripTagged, error: tagErr } = await supabase
    .from("operational_incidents")
    .select("id, description, status, severity, created_at")
    .gte("created_at", trip.startedAt)
    .ilike("description", `%${trip.id}%`)
    .in("status", ["pending", "open"])
    .eq("severity", "sev1");
  if (tagErr) throw tagErr;
  addRows(tripTagged as Array<{ id: string; description: string; status: string; severity: string }>);

  return blocks;
}

export async function countIssuesLoggedDuringRun(trip: TransportTrip): Promise<number> {
  let q = supabase
    .from("operational_incidents")
    .select("id", { count: "exact", head: true })
    .gte("created_at", trip.startedAt);

  if (trip.eventId) {
    q = q.or(`event_id.eq.${trip.eventId},description.ilike.%${trip.id}%`);
  } else {
    q = q.ilike("description", `%${trip.id}%`);
  }

  const { count, error } = await q;
  if (error) {
    console.warn("[countIssuesLoggedDuringRun]", error);
    return 0;
  }
  return count ?? 0;
}

export interface CloseTransportRunInput {
  tripId: string;
  endOdometerKm: number;
  operatorPin: string;
  cancellationsAcknowledged: boolean;
}

export async function closeTransportRun(input: CloseTransportRunInput): Promise<TransportTrip> {
  const operatorStaffId =
    getActiveUserProfile()?.staffId ?? getStaffId() ?? DEFAULT_STAFF_UUID;
  if (!/^\d{4}$/.test(input.operatorPin)) {
    throw new Error("Incorrect operator PIN. Please try again.");
  }
  const pinOk = await verifyStaffPin(operatorStaffId, input.operatorPin);
  if (!pinOk) throw new Error("Incorrect operator PIN. Please try again.");

  const { data: tripRow, error: tripErr } = await supabase
    .from("transport_trips")
    .select("*")
    .eq("id", input.tripId)
    .single();
  if (tripErr) throw new Error(`Trip not found: ${tripErr.message}`);

  const { data: legRows, error: legErr } = await supabase
    .from("trip_legs")
    .select("*")
    .eq("trip_id", input.tripId)
    .order("leg_index", { ascending: true });
  if (legErr) throw new Error(`Could not load legs: ${legErr.message}`);

  const trip = mapTransportTripFromDb(tripRow);

  if (trip.status === "completed") {
    throw new Error("This run is already closed.");
  }

  if (input.endOdometerKm < trip.startOdometerKm) {
    throw new Error("Ending odometer must be ≥ starting odometer.");
  }

  const legs = (legRows ?? []).map((r) => mapTripLegFromDb(r));

  const pendingLegs = legs.filter((l) => l.status !== "completed");
  if (pendingLegs.length > 0) {
    throw new Error("All legs must be completed before closing this run.");
  }

  const summary = buildRunCloseSummary(trip, legs);
  summary.issuesLoggedThisRun = await countIssuesLoggedDuringRun(trip);

  if (summary.cancelledPickups.length > 0 && !input.cancellationsAcknowledged) {
    throw new Error("Confirm cancelled pickups were intentional before closing the run.");
  }

  const redBlocks = await listOpenTransportRedBlocks(trip);
  if (redBlocks.length > 0) {
    const preview = redBlocks[0]!.description.slice(0, 100);
    throw new Error(
      `Open RED issue must be resolved or verbally authorised before closing: ${preview}`,
    );
  }

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();

  await writeToLedgerOrThrow({
    staff_id: staffId,
    category: "TRIP",
    severity: "GREEN",
    action_type: "TRANSPORT_RUN_CLOSED",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      trip_id: input.tripId,
      event_id: trip.eventId,
      bus_run_code: trip.busRunCode,
      run_kind: summary.kind,
      end_odometer_km: input.endOdometerKm,
      legs_total: summary.totalLegs,
      legs_completed: summary.completedLegs,
      total_km: summary.totalKm,
      cancelled_pickups: summary.cancelledPickups,
      no_show_count: summary.noShowLegs.length,
      unexpected_med_legs: summary.unexpectedMedLegs,
      issues_logged_this_run: summary.issuesLoggedThisRun,
      cancellations_acknowledged: input.cancellationsAcknowledged,
      closed_by: staffId,
      operator_staff_id: operatorStaffId,
    },
  });

  return completeTrip(input.tripId, input.endOdometerKm);
}

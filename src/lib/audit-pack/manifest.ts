/**
 * Transport manifest evidence (§11) — trips + legs for Day Centre runs and event hops.
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { rowsToCsv } from "./csv";
import { auditDate, auditDateTime } from "./format";
import { auditIdentity } from "./identity";
import { resolveParticipantNames, resolveStaffNames } from "./staff-names";
import type { AuditDateRange, AuditPackFile } from "./types";

export interface ManifestTripRow {
  tripId: string;
  tripDate: string;
  status: string;
  tripKind: string;
  eventId: string;
  eventDaySessionId: string;
  driverStaffId: string;
  driverName: string;
  vehicleId: string;
  startedAt: string;
  completedAt: string;
  startOdoKm: string;
  endOdoKm: string;
  busRunCode: string;
  hopIndex: string;
}

export interface ManifestLegRow {
  tripId: string;
  legId: string;
  sequence: string;
  legKind: string;
  status: string;
  fromLabel: string;
  toLabel: string;
  passengerPresent: string;
  startAt: string;
  endAt: string;
  completedAt: string;
  targetAddress: string;
  medicationHandover: string;
  noShowAt: string;
  fromParticipantId: string;
  toParticipantId: string;
  fromParticipantName: string;
  toParticipantName: string;
}

async function fetchTrips(opts: {
  range?: AuditDateRange;
  eventId?: string;
}): Promise<Array<Record<string, unknown>>> {
  let q = supabase.from("transport_trips").select("*");
  if (opts.eventId) {
    q = q.eq("event_id", opts.eventId);
  } else if (opts.range) {
    q = q
      .gte("trip_date", opts.range.from)
      .lte("trip_date", opts.range.to)
      .is("event_id", null);
  }
  const { data, error } = await q.order("trip_date", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function fetchLegs(
  tripIds: string[],
): Promise<Array<Record<string, unknown>>> {
  if (tripIds.length === 0) return [];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < tripIds.length; i += 40) {
    const chunk = tripIds.slice(i, i + 40);
    const { data, error } = await supabase
      .from("trip_legs")
      .select("*")
      .in("trip_id", chunk)
      .order("leg_index", { ascending: true });
    if (error) {
      if (isSchemaMismatchError(error)) continue;
      throw error;
    }
    out.push(...((data ?? []) as Array<Record<string, unknown>>));
  }
  return out;
}

async function mapManifestFiles(
  trips: Array<Record<string, unknown>>,
  pathPrefix: string,
): Promise<{ files: AuditPackFile[]; tripCount: number; legCount: number }> {
  const tripIds = trips.map((t) => String(t.id));
  const legs = await fetchLegs(tripIds);
  const staffNames = await resolveStaffNames(
    trips.map((t) => (t.driver_staff_id as string | null) ?? null),
  );
  const partNames = await resolveParticipantNames(
    legs.flatMap((l) => [
      (l.from_participant_id as string | null) ?? null,
      (l.to_participant_id as string | null) ?? null,
      (l.participant_id as string | null) ?? null,
    ]),
  );

  const book = auditIdentity();
  const tripRows: ManifestTripRow[] = trips.map((t) => {
    const driverId = (t.driver_staff_id as string | null) ?? "";
    return {
      tripId: String(t.id),
      tripDate: auditDate(String(t.trip_date ?? "")),
      status: String(t.status ?? ""),
      tripKind: String(t.trip_kind ?? ""),
      eventId: String(t.event_id ?? ""),
      eventDaySessionId: String(t.event_day_session_id ?? ""),
      driverStaffId: book.staffKey(driverId),
      driverName: driverId ? staffNames.get(driverId) ?? driverId : "",
      vehicleId: String(t.vehicle_id ?? ""),
      startedAt: auditDateTime(String(t.started_at ?? "")),
      completedAt: auditDateTime(String(t.completed_at ?? "")),
      startOdoKm: String(t.start_odometer_km ?? t.start_odometer ?? ""),
      endOdoKm: String(t.end_odometer_km ?? t.end_odometer ?? ""),
      busRunCode: String(t.bus_run_code ?? ""),
      hopIndex: t.hop_index != null ? String(t.hop_index) : "",
    };
  });

  const legRows: ManifestLegRow[] = legs.map((l) => {
    const fromId = (l.from_participant_id as string | null) ?? "";
    const toId = (l.to_participant_id as string | null) ?? "";
    return {
      tripId: String(l.trip_id ?? ""),
      legId: String(l.id ?? ""),
      sequence: String(l.leg_index ?? l.sequence_order ?? ""),
      legKind: String(l.leg_kind ?? l.leg_type ?? ""),
      status: String(l.status ?? ""),
      fromLabel: String(l.from_label ?? ""),
      toLabel: String(l.to_label ?? ""),
      passengerPresent:
        l.passenger_present == null ? "" : l.passenger_present ? "yes" : "no",
      startAt: auditDateTime(String(l.start_at ?? l.started_at ?? "")),
      endAt: auditDateTime(String(l.end_at ?? "")),
      completedAt: auditDateTime(String(l.completed_at ?? "")),
      targetAddress: String(l.target_address ?? ""),
      medicationHandover: String(l.medication_handover_status ?? ""),
      noShowAt: auditDateTime(String(l.no_show_triggered_at ?? "")),
      fromParticipantId: book.participantKey(fromId),
      toParticipantId: book.participantKey(toId),
      fromParticipantName: fromId ? partNames.get(fromId) ?? "" : "",
      toParticipantName: toId ? partNames.get(toId) ?? "" : "",
    };
  });

  const tripsCsv = rowsToCsv(
    [
      "tripId",
      "tripDate",
      "status",
      "tripKind",
      "eventId",
      "eventDaySessionId",
      "driverName",
      "driverStaffId",
      "vehicleId",
      "startedAt",
      "completedAt",
      "startOdoKm",
      "endOdoKm",
      "busRunCode",
      "hopIndex",
    ],
    tripRows.map((r) => ({ ...r })),
  );

  const legsCsv = rowsToCsv(
    [
      "tripId",
      "legId",
      "sequence",
      "legKind",
      "status",
      "fromLabel",
      "toLabel",
      "fromParticipantName",
      "toParticipantName",
      "passengerPresent",
      "startAt",
      "endAt",
      "completedAt",
      "targetAddress",
      "medicationHandover",
      "noShowAt",
    ],
    legRows.map((r) => ({ ...r })),
  );

  const files: AuditPackFile[] = [
    { path: `${pathPrefix}/manifest_trips.csv`, content: tripsCsv },
    { path: `${pathPrefix}/manifest_legs.csv`, content: legsCsv },
  ];
  if (tripRows.length === 0) {
    files.push({
      path: `${pathPrefix}/manifest_README.txt`,
      content:
        "No transport_trips rows for this scope. Day Centre runs use event_id null; outing hops set event_id.\r\n",
    });
  }

  return { files, tripCount: tripRows.length, legCount: legRows.length };
}

/** Day Centre / non-event runs in date range. */
export async function assembleDayCentreManifest(
  range: AuditDateRange,
): Promise<{ files: AuditPackFile[]; tripCount: number; legCount: number }> {
  const trips = await fetchTrips({ range });
  return mapManifestFiles(trips, "02_Day_Centre");
}

/** Event-linked hops / return buses for one outing. */
export async function assembleEventManifest(
  eventId: string,
  folderPrefix: string,
): Promise<{ files: AuditPackFile[]; tripCount: number; legCount: number }> {
  const trips = await fetchTrips({ eventId });
  return mapManifestFiles(trips, folderPrefix);
}

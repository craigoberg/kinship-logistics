/**
 * One live Manifest per run slot (event IN/HOME or Day Centre morning/afternoon).
 * A second staff cannot open the same slot; a closed slot cannot be reopened
 * (incident / second bus = later manager override).
 */
import { supabase } from "@/integrations/supabase/client";

export type EventRunDirection = "outbound" | "return" | "legacy";
export type CentreRunDirection = "morning" | "afternoon";

export type TransportRunSlot =
  | {
      kind: "event";
      eventId: string;
      tripDate: string;
      busRunCode: string | null;
      direction: EventRunDirection;
    }
  | {
      kind: "day_centre";
      tripDate: string;
      busRunCode: string;
      direction: CentreRunDirection;
    };

export type TransportRunSlotOccupant = {
  tripId: string;
  driverStaffId: string | null;
  driverName: string;
  status: string;
};

export type TransportRunSlotInspection = {
  slotLabel: string;
  completed: TransportRunSlotOccupant | null;
  active: TransportRunSlotOccupant | null;
};

type TripSlotRow = {
  id: string;
  status: string | null;
  driver_staff_id: string | null;
  bus_run_code?: string | null;
  trip_return?: string | null;
  trip_kind?: string | null;
  hop_index?: number | null;
  trip_date?: string | null;
  event_id?: string | null;
};

function normRun(code: string | null | undefined): string | null {
  return (code ?? "").trim() || null;
}

function isHopRow(row: TripSlotRow): boolean {
  return row.trip_kind === "event_venue_hop" || row.hop_index != null;
}

function isCancelled(row: TripSlotRow): boolean {
  return String(row.status ?? "").toLowerCase() === "cancelled";
}

function isCompleted(row: TripSlotRow): boolean {
  return String(row.status ?? "").toLowerCase() === "completed";
}

function isOutboundReturn(row: TripSlotRow): boolean {
  const ret = row.trip_return ?? "depot";
  return ret === "none";
}

function isHomeReturn(row: TripSlotRow): boolean {
  const ret = row.trip_return ?? "depot";
  return ret === "depot" || ret === "day_centre";
}

function matchesDirection(row: TripSlotRow, slot: TransportRunSlot): boolean {
  if (slot.kind === "event") {
    if (slot.direction === "legacy") return true;
    if (slot.direction === "outbound") return isOutboundReturn(row);
    return isHomeReturn(row);
  }
  if (slot.direction === "morning") return isOutboundReturn(row);
  return isHomeReturn(row);
}

export function formatTransportRunSlotLabel(slot: TransportRunSlot): string {
  if (slot.kind === "event") {
    const run = normRun(slot.busRunCode);
    const rx = run ? `${run} ` : "";
    if (slot.direction === "return") return `${rx}Transport HOME`.trim();
    if (slot.direction === "outbound") return `${rx}Transport IN`.trim();
    return run ? `${run} event run` : "this event run";
  }
  const when = slot.direction === "morning" ? "morning" : "afternoon";
  return `${slot.busRunCode} ${when}`;
}

async function staffName(id: string | null | undefined): Promise<string> {
  if (!id) return "Someone";
  const { data, error } = await supabase
    .from("staff_registry")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  if (error) return "Someone";
  const name = ((data as { full_name?: string | null } | null)?.full_name ?? "").trim();
  return name || "Someone";
}

function toOccupant(
  row: TripSlotRow,
  name: string,
): TransportRunSlotOccupant {
  return {
    tripId: row.id,
    driverStaffId: row.driver_staff_id,
    driverName: name,
    status: String(row.status ?? "").toLowerCase(),
  };
}

async function loadSlotRows(slot: TransportRunSlot): Promise<TripSlotRow[]> {
  const date = slot.tripDate.slice(0, 10);
  if (slot.kind === "event") {
    const { data, error } = await supabase
      .from("transport_trips")
      .select(
        "id, status, driver_staff_id, bus_run_code, trip_return, trip_kind, hop_index, trip_date, event_id",
      )
      .eq("event_id", slot.eventId);
    if (error) throw error;
    return (data ?? []) as TripSlotRow[];
  }

  const { data, error } = await supabase
    .from("transport_trips")
    .select(
      "id, status, driver_staff_id, bus_run_code, trip_return, trip_kind, hop_index, trip_date, event_id",
    )
    .is("event_id", null)
    .eq("bus_run_code", slot.busRunCode)
    .or(`trip_date.eq.${date},trip_date.is.null`);
  if (error) throw error;
  return (data ?? []) as TripSlotRow[];
}

function rowInSlot(row: TripSlotRow, slot: TransportRunSlot): boolean {
  if (isCancelled(row) || isHopRow(row)) return false;
  const date = slot.tripDate.slice(0, 10);
  const rowDate = (row.trip_date ?? "").slice(0, 10) || null;
  if (rowDate && rowDate !== date) return false;
  if (normRun(row.bus_run_code) !== normRun(slot.busRunCode)) {
    return false;
  }
  return matchesDirection(row, slot);
}

export async function inspectTransportRunSlot(
  slot: TransportRunSlot,
): Promise<TransportRunSlotInspection> {
  const slotLabel = formatTransportRunSlotLabel(slot);
  const rows = (await loadSlotRows(slot)).filter((r) => rowInSlot(r, slot));
  const completedRow = rows.find(isCompleted) ?? null;
  const activeRow =
    rows.find((r) => !isCompleted(r)) ?? null;

  const [completedName, activeName] = await Promise.all([
    completedRow ? staffName(completedRow.driver_staff_id) : Promise.resolve(""),
    activeRow ? staffName(activeRow.driver_staff_id) : Promise.resolve(""),
  ]);

  return {
    slotLabel,
    completed: completedRow ? toOccupant(completedRow, completedName) : null,
    active: activeRow ? toOccupant(activeRow, activeName) : null,
  };
}

export function transportRunSlotClosedMessage(inspection: TransportRunSlotInspection): string {
  return `${inspection.slotLabel} is already closed. Do not start it again — a second bus is an incident (manager override comes later).`;
}

export function transportRunSlotHeldMessage(inspection: TransportRunSlotInspection): string {
  const who = inspection.active?.driverName ?? "Someone";
  return `${who} already has ${inspection.slotLabel} open. Join that run, or a manager must cancel it first.`;
}

/**
 * Same staff + still open → reuse that trip.
 * Anyone else open → throw.
 * Slot already completed → throw.
 */
export async function assertTransportRunSlotStartable(opts: {
  slot: TransportRunSlot;
  actorStaffId: string;
}): Promise<{ reuseTripId: string | null }> {
  const inspection = await inspectTransportRunSlot(opts.slot);
  if (inspection.completed) {
    throw new Error(transportRunSlotClosedMessage(inspection));
  }
  if (inspection.active) {
    if (
      inspection.active.driverStaffId &&
      inspection.active.driverStaffId === opts.actorStaffId
    ) {
      return { reuseTripId: inspection.active.tripId };
    }
    throw new Error(transportRunSlotHeldMessage(inspection));
  }
  return { reuseTripId: null };
}

export const dayCentreRunSlotKey = (
  tripDate: string,
  busRunCode: string,
  direction: CentreRunDirection,
) => ["transport-run-slot", "day-centre", tripDate, busRunCode, direction] as const;

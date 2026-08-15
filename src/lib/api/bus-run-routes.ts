/**
 * Day Centre default run routes — office drag order that seeds Manifest.
 * Driver can still reorder on the active run (GUARDRAILS §11).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

export type BusRunRouteDirection = "morning" | "afternoon";

export interface BusRunRouteStop {
  participantId: string;
  name: string;
  address: string | null;
  /** Day codes this person is on this run (e.g. DAY-TUE). */
  dayCodes: string[];
  stopOrder: number | null;
}

const DAY_SHORT: Record<string, string> = {
  "DAY-MON": "Mon",
  Monday: "Mon",
  "DAY-TUE": "Tue",
  Tuesday: "Tue",
  "DAY-WED": "Wed",
  Wednesday: "Wed",
  "DAY-THU": "Thu",
  Thursday: "Thu",
  "DAY-FRI": "Fri",
  Friday: "Fri",
  "DAY-SAT": "Sat",
  Saturday: "Sat",
  "DAY-SUN": "Sun",
  Sunday: "Sun",
};

export function shortDayLabel(dayCode: string): string {
  return DAY_SHORT[dayCode] ?? dayCode.replace(/^DAY-/, "").slice(0, 3);
}

export function busRunRouteQueryKey(
  busRunCode: string,
  direction: BusRunRouteDirection,
) {
  return ["bus-run-default-routes", busRunCode, direction] as const;
}

export function sortRosterByRouteOrder<T extends { id: string }>(
  roster: T[],
  orderMap: Map<string, number>,
): T[] {
  if (orderMap.size === 0) return roster;
  return [...roster].sort((a, b) => {
    const ao = orderMap.get(a.id) ?? 9_999;
    const bo = orderMap.get(b.id) ?? 9_999;
    if (ao !== bo) return ao - bo;
    return 0;
  });
}

export async function loadBusRunRouteOrderMap(
  busRunCode: string,
  direction: BusRunRouteDirection,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("bus_run_default_routes")
    .select("participant_id, stop_order")
    .eq("bus_run_code", busRunCode)
    .eq("direction", direction);
  if (error) {
    if (isSchemaMismatchError(error)) return new Map();
    throw new Error(error.message);
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as { participant_id: string; stop_order: number };
    map.set(r.participant_id, Number(r.stop_order));
  }
  return map;
}

type ScheduleJoinRow = {
  participant_id: string;
  day_of_week: string;
  inbound_transport: string | null;
  outbound_transport: string | null;
  participants:
    | {
        first_name: string;
        last_name: string;
        regular_pickup_address: string | null;
        street_address: string | null;
      }
    | Array<{
        first_name: string;
        last_name: string;
        regular_pickup_address: string | null;
        street_address: string | null;
      }>
    | null;
};

/**
 * Everyone assigned to this run (any day), ordered by the saved default route.
 * People not yet on the route appear at the end (name order).
 */
export async function listBusRunRouteRoster(
  busRunCode: string,
  direction: BusRunRouteDirection,
): Promise<BusRunRouteStop[]> {
  const transportCol = direction === "morning" ? "inbound_transport" : "outbound_transport";
  const { data: schedRows, error: schedErr } = await supabase
    .from("participant_attendance_schedules")
    .select(
      "participant_id, day_of_week, inbound_transport, outbound_transport, participants!inner(first_name, last_name, regular_pickup_address, street_address)",
    )
    .eq("active", true)
    .eq(transportCol, busRunCode);
  if (schedErr) throw new Error(schedErr.message);

  const byId = new Map<string, BusRunRouteStop>();
  for (const raw of schedRows ?? []) {
    const row = raw as unknown as ScheduleJoinRow;
    const p = Array.isArray(row.participants) ? row.participants[0] : row.participants;
    const regular = (p?.regular_pickup_address ?? "").trim();
    const street = (p?.street_address ?? "").trim();
    const existing = byId.get(row.participant_id);
    if (existing) {
      if (!existing.dayCodes.includes(row.day_of_week)) {
        existing.dayCodes.push(row.day_of_week);
      }
      continue;
    }
    byId.set(row.participant_id, {
      participantId: row.participant_id,
      name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "(participant)",
      address: regular.length > 0 ? regular : street.length > 0 ? street : null,
      dayCodes: [row.day_of_week],
      stopOrder: null,
    });
  }

  const orderMap = await loadBusRunRouteOrderMap(busRunCode, direction);
  const stops = [...byId.values()].map((s) => ({
    ...s,
    stopOrder: orderMap.get(s.participantId) ?? null,
  }));
  stops.sort((a, b) => {
    const ao = a.stopOrder ?? 9_999;
    const bo = b.stopOrder ?? 9_999;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return stops;
}

export async function reorderBusRunDefaultRoute(input: {
  busRunCode: string;
  direction: BusRunRouteDirection;
  participantIds: string[];
  staffId?: string | null;
}): Promise<void> {
  const { error: delErr } = await supabase
    .from("bus_run_default_routes")
    .delete()
    .eq("bus_run_code", input.busRunCode)
    .eq("direction", input.direction);
  if (delErr) {
    if (isSchemaMismatchError(delErr)) {
      throw new Error(
        "Default route table is not on the database yet. Run docs/sql/2026-08-15_bus_run_default_routes.sql in Supabase SQL editor, then retry.",
      );
    }
    throw new Error(delErr.message);
  }

  if (input.participantIds.length === 0) return;

  const staffId = input.staffId?.trim() || null;
  const rows = input.participantIds.map((participantId, idx) => ({
    bus_run_code: input.busRunCode,
    direction: input.direction,
    participant_id: participantId,
    stop_order: (idx + 1) * 10,
    updated_by_staff_id: staffId,
  }));

  const { error: insErr } = await supabase.from("bus_run_default_routes").insert(rows);
  if (insErr) throw new Error(insErr.message);
}

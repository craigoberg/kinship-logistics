/**
 * Day Centre default run routes — office drag order that seeds Manifest.
 * Driver can still reorder on the active run (GUARDRAILS §11).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

export type BusRunRouteDirection = "morning" | "afternoon";

export interface BusRunTodaySchedule {
  id: string;
  participantId: string;
  dayOfWeek: string;
  serviceType: string;
  transportRule: string;
  inboundTransport: string;
  outboundTransport: string;
  expectedArrivalTime: string;
  expectedDepartureTime: string;
  active: boolean;
  createdAt: string;
}

export interface BusRunRouteStop {
  participantId: string;
  name: string;
  address: string | null;
  /** Day codes this person is on this run (e.g. DAY-TUE). */
  dayCodes: string[];
  stopOrder: number | null;
  /** Today's matching schedule for Off today — null if not on this run today. */
  todaySchedule: BusRunTodaySchedule | null;
  personKind?: "participant" | "staff" | "volunteer" | "carer";
  staffId?: string | null;
  carerId?: string | null;
  roleLabel?: string | null;
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

export function dayCodeIsToday(dayCode: string, todayDayCode: string): boolean {
  if (dayCode === todayDayCode) return true;
  return shortDayLabel(dayCode) === shortDayLabel(todayDayCode);
}

export function busRunRouteQueryKey(
  busRunCode: string,
  direction: BusRunRouteDirection,
  todayDayCode?: string,
) {
  return todayDayCode
    ? (["bus-run-default-routes", busRunCode, direction, todayDayCode] as const)
    : (["bus-run-default-routes", busRunCode, direction] as const);
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
    .select("participant_id, staff_id, carer_id, person_kind, stop_order")
    .eq("bus_run_code", busRunCode)
    .eq("direction", direction);
  if (error) {
    if (isSchemaMismatchError(error)) {
      const fallback = await supabase
        .from("bus_run_default_routes")
        .select("participant_id, stop_order")
        .eq("bus_run_code", busRunCode)
        .eq("direction", direction);
      if (fallback.error) return new Map();
      const map = new Map<string, number>();
      for (const row of fallback.data ?? []) {
        const r = row as { participant_id: string; stop_order: number };
        map.set(r.participant_id, Number(r.stop_order));
      }
      return map;
    }
    throw new Error(error.message);
  }
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as {
      participant_id: string | null;
      staff_id: string | null;
      carer_id: string | null;
      person_kind?: string | null;
      stop_order: number;
    };
    const key = r.carer_id
      ? `c:${r.carer_id}`
      : r.staff_id
        ? `s:${r.staff_id}`
        : r.participant_id;
    if (key) map.set(key, Number(r.stop_order));
  }
  return map;
}

type ScheduleJoinRow = {
  id: string;
  participant_id: string;
  day_of_week: string;
  service_type: string;
  transport_required: string;
  inbound_transport: string | null;
  outbound_transport: string | null;
  expected_arrival_time: string | null;
  expected_departure_time: string | null;
  active: boolean;
  created_at: string;
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
  todayDayCode?: string,
): Promise<BusRunRouteStop[]> {
  const transportCol = direction === "morning" ? "inbound_transport" : "outbound_transport";
  const { data: schedRows, error: schedErr } = await supabase
    .from("participant_attendance_schedules")
    .select(
      "id, participant_id, day_of_week, service_type, transport_required, inbound_transport, outbound_transport, expected_arrival_time, expected_departure_time, active, created_at, participants!inner(first_name, last_name, regular_pickup_address, street_address)",
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
    const inbound = row.inbound_transport ?? row.transport_required;
    const outbound = row.outbound_transport ?? row.transport_required;
    const todaySchedule =
      todayDayCode && dayCodeIsToday(row.day_of_week, todayDayCode)
        ? {
            id: row.id,
            participantId: row.participant_id,
            dayOfWeek: row.day_of_week,
            serviceType: row.service_type,
            transportRule: row.transport_required,
            inboundTransport: inbound,
            outboundTransport: outbound,
            expectedArrivalTime: (row.expected_arrival_time ?? "09:00").slice(0, 5),
            expectedDepartureTime: (row.expected_departure_time ?? "15:00").slice(0, 5),
            active: row.active,
            createdAt: row.created_at,
          }
        : null;
    const existing = byId.get(row.participant_id);
    if (existing) {
      if (!existing.dayCodes.includes(row.day_of_week)) {
        existing.dayCodes.push(row.day_of_week);
      }
      if (todaySchedule && !existing.todaySchedule) {
        existing.todaySchedule = todaySchedule;
      }
      continue;
    }
    byId.set(row.participant_id, {
      participantId: row.participant_id,
      name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "(participant)",
      address: regular.length > 0 ? regular : street.length > 0 ? street : null,
      dayCodes: [row.day_of_week],
      stopOrder: null,
      todaySchedule,
    });
  }

  try {
    const { listSupportSchedules } = await import("@/lib/api/support-attendance");
    const support = await listSupportSchedules();
    for (const s of support) {
      const transport = direction === "morning" ? s.inboundTransport : s.outboundTransport;
      if (transport !== busRunCode) continue;
      const key = s.carerId ? `c:${s.carerId}` : `s:${s.staffId}`;
      const todaySchedule =
        todayDayCode && dayCodeIsToday(s.dayOfWeek, todayDayCode)
          ? {
              id: s.id,
              participantId: key,
              dayOfWeek: s.dayOfWeek,
              serviceType: s.personKind,
              transportRule: transport ?? "",
              inboundTransport: s.inboundTransport ?? "",
              outboundTransport: s.outboundTransport ?? "",
              expectedArrivalTime: s.expectedArrivalTime,
              expectedDepartureTime: s.expectedDepartureTime,
              active: s.active,
              createdAt: "",
            }
          : null;
      const existing = byId.get(key);
      if (existing) {
        if (!existing.dayCodes.includes(s.dayOfWeek)) existing.dayCodes.push(s.dayOfWeek);
        if (todaySchedule && !existing.todaySchedule) existing.todaySchedule = todaySchedule;
        continue;
      }
      byId.set(key, {
        participantId: key,
        name: s.displayName,
        address: s.pickupAddressOverride,
        dayCodes: [s.dayOfWeek],
        stopOrder: null,
        todaySchedule,
        personKind: s.personKind,
        staffId: s.staffId,
        carerId: s.carerId,
        roleLabel: s.personKind === "volunteer" ? "Volunteer" : s.personKind === "carer" ? "Carer" : "Staff",
      });
    }
  } catch {
    /* table not migrated yet */
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
  const rows = input.participantIds.map((personKey, idx) => {
    const carer = personKey.startsWith("c:");
    const staff = personKey.startsWith("s:");
    return {
      bus_run_code: input.busRunCode,
      direction: input.direction,
      person_kind: carer ? "carer" : staff ? "staff" : "participant",
      participant_id: carer || staff ? null : personKey,
      staff_id: staff ? personKey.slice(2) : null,
      carer_id: carer ? personKey.slice(2) : null,
      stop_order: (idx + 1) * 10,
      updated_by_staff_id: staffId,
    };
  });

  const { error: insErr } = await supabase.from("bus_run_default_routes").insert(rows);
  if (insErr) throw new Error(insErr.message);
}

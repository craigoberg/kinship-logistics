/**
 * Run Planning board — every person with a Day Centre IN/OUT default.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  DAY_CODE_LABEL,
  DAY_CODE_ORDER,
  type DayCode,
} from "@/lib/api/centre-hours";
import { listSupportSchedules } from "@/lib/api/support-attendance";
import { supportPersonKindLabel, type RoutePersonKind } from "@/lib/support-person";

const PLANNING_DAY_RANK: Record<string, number> = {
  "day-mon": 1,
  monday: 1,
  "day-tue": 2,
  tuesday: 2,
  "day-wed": 3,
  wednesday: 3,
  "day-thu": 4,
  thursday: 4,
  "day-fri": 5,
  friday: 5,
  "day-sat": 6,
  saturday: 6,
  "day-sun": 7,
  sunday: 7,
};

function planningDayRank(value: string): number {
  return PLANNING_DAY_RANK[value.trim().toLowerCase()] ?? 99;
}

const DAY_BOARD_SHORT: Record<DayCode, string> = {
  "DAY-MON": "Mon",
  "DAY-TUE": "Tue",
  "DAY-WED": "Wed",
  "DAY-THU": "Thu",
  "DAY-FRI": "Fri",
  "DAY-SAT": "Sat",
  "DAY-SUN": "Sun",
};

export type WeekBoardDayCode = DayCode;

export interface OperatingBoardDay {
  code: DayCode;
  label: string;
  long: string;
}

/** Columns and filters follow Admin → Lookups → Operating days. */
export function operatingBoardDays(
  rows: { code: string; displayName?: string }[],
): OperatingBoardDay[] {
  const seen = new Set<DayCode>();
  const out: OperatingBoardDay[] = [];
  for (const row of rows) {
    const code = normalizeDayCode(row.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      label: DAY_BOARD_SHORT[code],
      long: DAY_CODE_LABEL[code] || row.displayName || code,
    });
  }
  out.sort((a, b) => DAY_CODE_ORDER.indexOf(a.code) - DAY_CODE_ORDER.indexOf(b.code));
  return out;
}

export function normalizeDayCode(raw: string): WeekBoardDayCode | null {
  const v = raw.trim().toLowerCase();
  if (v === "day-mon" || v === "monday" || v === "mon") return "DAY-MON";
  if (v === "day-tue" || v === "tuesday" || v === "tue") return "DAY-TUE";
  if (v === "day-wed" || v === "wednesday" || v === "wed") return "DAY-WED";
  if (v === "day-thu" || v === "thursday" || v === "thu") return "DAY-THU";
  if (v === "day-fri" || v === "friday" || v === "fri") return "DAY-FRI";
  if (v === "day-sat" || v === "saturday" || v === "sat") return "DAY-SAT";
  if (v === "day-sun" || v === "sunday" || v === "sun") return "DAY-SUN";
  return null;
}

export interface RunPlanningDayCell {
  inboundTransport: string;
  outboundTransport: string;
}

export interface RunPlanningPerson {
  personKey: string;
  name: string;
  personKind: RoutePersonKind;
  roleLabel: string;
  address: string | null;
  cells: Partial<Record<WeekBoardDayCode, RunPlanningDayCell>>;
}

export function groupRunPlanningPeople(rows: RunPlanningRow[]): RunPlanningPerson[] {
  const byKey = new Map<string, RunPlanningPerson>();
  for (const r of rows) {
    const day = normalizeDayCode(r.dayOfWeek);
    let person = byKey.get(r.personKey);
    if (!person) {
      person = {
        personKey: r.personKey,
        name: r.name,
        personKind: r.personKind,
        roleLabel: r.roleLabel,
        address: r.address,
        cells: {},
      };
      byKey.set(r.personKey, person);
    }
    if (day) {
      person.cells[day] = {
        inboundTransport: r.inboundTransport,
        outboundTransport: r.outboundTransport,
      };
    }
    if (!person.address && r.address) person.address = r.address;
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const RUN_PLANNING_PEOPLE_KEY = ["run-planning-people"] as const;

export interface RunPlanningRow {
  id: string;
  personKey: string;
  name: string;
  personKind: RoutePersonKind;
  roleLabel: string;
  dayOfWeek: string;
  inboundTransport: string;
  outboundTransport: string;
  address: string | null;
}

interface ParticipantJoin {
  first_name?: string | null;
  last_name?: string | null;
  regular_pickup_address?: string | null;
  street_address?: string | null;
}

interface ParticipantScheduleJoin {
  id: string;
  participant_id: string;
  day_of_week: string;
  inbound_transport: string | null;
  outbound_transport: string | null;
  transport_required: string | null;
  participants: ParticipantJoin | ParticipantJoin[] | null;
}

export async function listRunPlanningRows(): Promise<RunPlanningRow[]> {
  const { loadExitedParticipantIds, loadInactiveStaffIds } = await import("@/lib/api/service-exit");
  const [exitedIds, inactiveStaffIds] = await Promise.all([
    loadExitedParticipantIds(),
    loadInactiveStaffIds(),
  ]);
  const { data, error } = await supabase
    .from("participant_attendance_schedules")
    .select(
      "id, participant_id, day_of_week, inbound_transport, outbound_transport, transport_required, participants!inner(first_name, last_name, regular_pickup_address, street_address)",
    )
    .eq("active", true);
  if (error) throw new Error(error.message);

  const rows: RunPlanningRow[] = [];
  for (const raw of data ?? []) {
    const row = raw as unknown as ParticipantScheduleJoin;
    if (exitedIds.has(row.participant_id)) continue;
    const p = Array.isArray(row.participants) ? row.participants[0] : row.participants;
    const regular = (p?.regular_pickup_address ?? "").trim();
    const street = (p?.street_address ?? "").trim();
    rows.push({
      id: `p:${row.id}`,
      personKey: row.participant_id,
      name: `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "(participant)",
      personKind: "participant",
      roleLabel: "Participant",
      dayOfWeek: row.day_of_week,
      inboundTransport: row.inbound_transport ?? row.transport_required ?? "",
      outboundTransport: row.outbound_transport ?? row.transport_required ?? "",
      address: regular.length > 0 ? regular : street.length > 0 ? street : null,
    });
  }

  try {
    const support = await listSupportSchedules();
    for (const s of support) {
      if (s.staffId && inactiveStaffIds.has(s.staffId)) continue;
      rows.push({
        id: `s:${s.id}`,
        personKey: s.carerId ? `c:${s.carerId}` : `s:${s.staffId}`,
        name: s.displayName,
        personKind: s.personKind,
        roleLabel: supportPersonKindLabel(s.personKind),
        dayOfWeek: s.dayOfWeek,
        inboundTransport: s.inboundTransport ?? "",
        outboundTransport: s.outboundTransport ?? "",
        address: s.pickupAddressOverride,
      });
    }
  } catch {
    /* table not migrated yet */
  }

  rows.sort((a, b) => {
    const name = a.name.localeCompare(b.name);
    if (name !== 0) return name;
    return planningDayRank(a.dayOfWeek) - planningDayRank(b.dayOfWeek);
  });
  return rows;
}

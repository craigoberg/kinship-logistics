// centre_operating_hours — facility-wide Monday→Sunday open/close defaults.
// Tier 2 of the daily attendance seeder priority ladder:
//   1. participant_attendance_schedules.expected_*_time  (override)
//   2. centre_operating_hours.{open|close}_time          (master default)
//   3. 09:00 / 15:00 system baseline                     (final fallback)

import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback, dayChronoIndex } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";

export type DayCode =
  | "DAY-MON" | "DAY-TUE" | "DAY-WED" | "DAY-THU"
  | "DAY-FRI" | "DAY-SAT" | "DAY-SUN";

export const DAY_CODE_ORDER: DayCode[] = [
  "DAY-MON", "DAY-TUE", "DAY-WED", "DAY-THU",
  "DAY-FRI", "DAY-SAT", "DAY-SUN",
];

export const DAY_CODE_LABEL: Record<DayCode, string> = {
  "DAY-MON": "Monday",
  "DAY-TUE": "Tuesday",
  "DAY-WED": "Wednesday",
  "DAY-THU": "Thursday",
  "DAY-FRI": "Friday",
  "DAY-SAT": "Saturday",
  "DAY-SUN": "Sunday",
};

// 0=Sun..6=Sat (matches Date.getDay + getSydneyDayIndex).
const SUN_TO_SAT_TO_CODE: Record<number, DayCode> = {
  0: "DAY-SUN", 1: "DAY-MON", 2: "DAY-TUE", 3: "DAY-WED",
  4: "DAY-THU", 5: "DAY-FRI", 6: "DAY-SAT",
};

export function dayCodeFromSydneyIndex(idx: number): DayCode {
  return SUN_TO_SAT_TO_CODE[idx] ?? "DAY-MON";
}

export interface CentreHourRow {
  dayOfWeek: DayCode;
  openTime: string;   // "HH:MM" (24h)
  closeTime: string;  // "HH:MM" (24h)
  updatedAt: string;
  updatedByStaffId: string | null;
}

interface DbRow {
  day_of_week: DayCode;
  open_time: string;
  close_time: string;
  updated_at: string;
  updated_by_staff_id: string | null;
}

function trimTime(t: string | null | undefined): string {
  // Postgres `time` returns "HH:MM:SS"; the form wants "HH:MM".
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function toRow(r: DbRow): CentreHourRow {
  return {
    dayOfWeek: r.day_of_week,
    openTime: trimTime(r.open_time),
    closeTime: trimTime(r.close_time),
    updatedAt: r.updated_at,
    updatedByStaffId: r.updated_by_staff_id,
  };
}

export async function listCentreHours(): Promise<CentreHourRow[]> {
  const { data, error } = await supabase
    .from("centre_operating_hours")
    .select("day_of_week, open_time, close_time, updated_at, updated_by_staff_id");
  if (error) throw error;
  const rows = (data ?? []).map((r) => toRow(r as DbRow));
  rows.sort(
    (a, b) =>
      dayChronoIndex(DAY_CODE_LABEL[a.dayOfWeek]) -
      dayChronoIndex(DAY_CODE_LABEL[b.dayOfWeek]),
  );
  return rows;
}

/**
 * Fetch today's row (Sydney-local weekday). Returns null if the table is
 * empty (seeder should fall back to Tier 3 system baseline).
 */
export async function getTodayCentreHours(
  todayIdx: number,
): Promise<CentreHourRow | null> {
  const code = dayCodeFromSydneyIndex(todayIdx);
  const { data, error } = await supabase
    .from("centre_operating_hours")
    .select("day_of_week, open_time, close_time, updated_at, updated_by_staff_id")
    .eq("day_of_week", code)
    .maybeSingle();
  if (error) throw error;
  return data ? toRow(data as DbRow) : null;
}

export interface UpdateCentreHoursInput {
  dayOfWeek: DayCode;
  openTime: string;   // "HH:MM"
  closeTime: string;  // "HH:MM"
  justification: string;
}

export async function updateCentreHours(
  input: UpdateCentreHoursInput,
): Promise<CentreHourRow> {
  const justification = input.justification.trim();
  if (justification.length < 10) {
    throw new Error("Justification must be at least 10 characters.");
  }
  if (!/^\d{2}:\d{2}$/.test(input.openTime) || !/^\d{2}:\d{2}$/.test(input.closeTime)) {
    throw new Error("Open and close times must be HH:MM.");
  }
  if (input.openTime >= input.closeTime) {
    throw new Error("Open time must be before close time.");
  }

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();

  // Upsert because the row should always exist post-migration, but the
  // SQL editor step may have been skipped.
  const { data, error } = await supabase
    .from("centre_operating_hours")
    .upsert(
      {
        day_of_week: input.dayOfWeek,
        open_time: `${input.openTime}:00`,
        close_time: `${input.closeTime}:00`,
        updated_at: nowIso,
        updated_by_staff_id: staffId,
      },
      { onConflict: "day_of_week" },
    )
    .select("day_of_week, open_time, close_time, updated_at, updated_by_staff_id")
    .single();
  if (error) throw error;

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "CENTRE_HOURS_UPDATED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      day_of_week: input.dayOfWeek,
      open_time: input.openTime,
      close_time: input.closeTime,
      justification,
    },
  });

  return toRow(data as DbRow);
}

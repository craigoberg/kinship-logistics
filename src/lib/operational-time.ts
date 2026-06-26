// Operational calendar helpers for Yada's Sydney-based day centre.
// Storage timestamps remain UTC ISO strings; calendar decisions use Australia/Sydney.

export const OPERATIONAL_TIME_ZONE = "Australia/Sydney";

const DATE_PART_FORMATTER = new Intl.DateTimeFormat("en-AU", {
  timeZone: OPERATIONAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: OPERATIONAL_TIME_ZONE,
  weekday: "short",
});

const DATE_TIME_PART_FORMATTER = new Intl.DateTimeFormat("en-AU", {
  timeZone: OPERATIONAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function dateParts(date: Date): { year: number; month: number; day: number } {
  const parts = DATE_PART_FORMATTER.formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateTimeParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = DATE_TIME_PART_FORMATTER.formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function timeZoneOffsetMs(date: Date): number {
  const parts = dateTimeParts(date);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - date.getTime();
}

function sydneyLocalTimeToUtcIso(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}): string {
  const nominalUtc = Date.UTC(
    args.year,
    args.month - 1,
    args.day,
    args.hour,
    args.minute,
    args.second ?? 0,
  );
  let offset = timeZoneOffsetMs(new Date(nominalUtc));
  let utcMs = nominalUtc - offset;
  const correctedOffset = timeZoneOffsetMs(new Date(utcMs));
  if (correctedOffset !== offset) utcMs = nominalUtc - correctedOffset;
  return new Date(utcMs).toISOString();
}

export function getSydneyIsoDate(date: Date = new Date()): string {
  const { year, month, day } = dateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getSydneyDayIndex(date: Date = new Date()): number {
  return WEEKDAY_INDEX[WEEKDAY_FORMATTER.format(date)] ?? date.getDay();
}

// Map Sydney-local weekday → the canonical DAY-XXX code stored in
// public.participant_attendance_schedules.day_of_week.
const SYDNEY_DAY_CODES = [
  "DAY-SUN",
  "DAY-MON",
  "DAY-TUE",
  "DAY-WED",
  "DAY-THU",
  "DAY-FRI",
  "DAY-SAT",
] as const;

export function todaysSydneyDayCode(date: Date = new Date()): string {
  return SYDNEY_DAY_CODES[getSydneyDayIndex(date)] ?? "DAY-MON";
}

export function getSydneyTimeTodayIso(
  hour: number,
  minute: number,
  date: Date = new Date(),
): string {
  const { year, month, day } = dateParts(date);
  return sydneyLocalTimeToUtcIso({ year, month, day, hour, minute });
}

/**
 * Combine today's Sydney calendar date with a "HH:MM" local clock string and
 * return the corresponding UTC ISO instant. Falls back to 09:00 when the
 * supplied clock value is null, empty, or malformed.
 */
export function sydneyTimeTodayFromClock(
  hhmm: string | null | undefined,
  date: Date = new Date(),
): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  const hour = m ? Math.min(23, Math.max(0, Number(m[1]))) : 9;
  const minute = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
  return getSydneyTimeTodayIso(hour, minute, date);
}

/** Format a UTC ISO instant as Sydney-local "HH:MM" (24h) for <input type="time">. */
export function isoToSydneyClock(iso: string): string {
  const parts = DATE_TIME_PART_FORMATTER.formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${v("hour")}:${v("minute")}`;
}

// ---------------------------------------------------------------------------
// Canonical app-wide date/time formatters (project standard).
//   Date:      dd-MM-yy           e.g. 26-06-26
//   Time:      HH:mm              e.g. 14:30
//   Date/Time: dd-MM-yy / HH:mm   e.g. 26-06-26 / 14:30
// Pure helpers — use browser-local time. Render via a client-only span when
// embedded in SSR'd markup to avoid hydration mismatches.
// ---------------------------------------------------------------------------

import { format as dfFormat } from "date-fns";

function toSafeDate(input: string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function formatDateStandard(input: string | Date | null | undefined): string {
  const d = toSafeDate(input);
  return d ? dfFormat(d, "dd-MM-yy") : "—";
}

export function formatTimeStandard(input: string | Date | null | undefined): string {
  const d = toSafeDate(input);
  return d ? dfFormat(d, "HH:mm") : "—";
}

export function formatDateTimeStandard(input: string | Date | null | undefined): string {
  const d = toSafeDate(input);
  return d ? dfFormat(d, "dd-MM-yy / HH:mm") : "—";
}

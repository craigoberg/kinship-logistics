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

export function getSydneyTimeTodayIso(
  hour: number,
  minute: number,
  date: Date = new Date(),
): string {
  const { year, month, day } = dateParts(date);
  return sydneyLocalTimeToUtcIso({ year, month, day, hour, minute });
}
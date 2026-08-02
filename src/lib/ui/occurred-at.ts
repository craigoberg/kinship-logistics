/**
 * Occurred-at (when it happened) vs logged-at (when filed).
 * Operator enters Sydney date + HH:mm; storage is UTC ISO.
 */
import { format } from "date-fns";
import { isValidClockTime, padClockTime } from "@/lib/tour-roll-call";
import { getOperationalTodayIso, getOperationalNow } from "@/lib/operational-clock";
import {
  getSydneyIsoDate,
  isoToSydneyClock,
  sydneyWallClockToUtcDate,
} from "@/lib/operational-time";

export type OccurredAtParts = {
  /** YYYY-MM-DD (Sydney calendar) */
  date: string;
  /** HH:mm */
  time: string;
};

export function defaultOccurredAtParts(now = getOperationalNow()): OccurredAtParts {
  return {
    date: getSydneyIsoDate(now),
    time: isoToSydneyClock(now.toISOString()),
  };
}

export function ymdToPickerDate(ymd: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function pickerDateToYmd(date: Date | undefined): string {
  if (!date || !Number.isFinite(date.getTime())) return "";
  return format(date, "yyyy-MM-dd");
}

export function isOccurredAtPartsValid(parts: OccurredAtParts): boolean {
  const date = (parts?.date ?? "").trim();
  const time = (parts?.time ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (!isValidClockTime(time)) return false;
  const utc = sydneyWallClockToUtcDate(date, padClockTime(time));
  if (!Number.isFinite(utc.getTime())) return false;
  // Allow a small clock skew; block far-future relative to operational now.
  return utc.getTime() <= getOperationalNow().getTime() + 2 * 60_000;
}

export function occurredAtPartsToIso(parts: OccurredAtParts): string | null {
  if (!isOccurredAtPartsValid(parts)) return null;
  return sydneyWallClockToUtcDate(
    parts.date.trim(),
    padClockTime(parts.time.trim()),
  ).toISOString();
}

/** True when the calendar day is after operational "today" (Sydney). */
export function isFutureOccurredDate(date: Date): boolean {
  const ymd = pickerDateToYmd(date);
  return ymd > getOperationalTodayIso();
}

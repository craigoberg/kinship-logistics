import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getOperationalTodayIso } from "@/lib/operational-clock";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Global date/time formatting standards for Yada Connect.
 * Regional date: dd-Mmm-yy (e.g. 06-Jul-26)
 * Time: 24-hour hh:mm (e.g. 08:43)
 * Combined: dd-Mmm-yy / hh:mm (e.g. 06-Jul-26 / 08:43)
 * See GUARDRAILS §5.3.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Canonical date-picker display format (date-fns token). */
export const REGIONAL_DATE_FORMAT = "dd-MMM-yy";

/** Parse YYYY-MM-DD (or ISO prefix) as local calendar date — no UTC shift. */
export function parseIsoDateLocal(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Local calendar date → YYYY-MM-DD for storage. */
export function toIsoDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's date as YYYY-MM-DD (Sydney operational calendar; DEV clock override aware). */
export function todayLocalIso(): string {
  return getOperationalTodayIso();
}

/** Normalize stored calendar dates / ISO timestamps to YYYY-MM-DD. */
export function isoDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m?.[1] ?? "";
}

/** True when `date` falls within an event's start/end range (inclusive). */
export function eventSpansDate(
  startDate: string,
  endDate: string | null | undefined,
  date: string,
): boolean {
  const start = isoDateOnly(startDate);
  const end = isoDateOnly(endDate ?? startDate);
  if (!start || !date) return false;
  return start <= date && end >= date;
}

/** Compare YYYY-MM-DD calendar strings. */
export function compareIsoDates(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Inclusive day span between two YYYY-MM-DD calendar dates. */
export function calendarDaySpan(startIso: string, endIso: string): number {
  const start = parseIsoDateLocal(startIso);
  const end = parseIsoDateLocal(endIso);
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * When the start date moves, shift the end date by the same number of calendar
 * days so the tour length is preserved.
 */
export function shiftEndDateWithStart(
  previousStart: string,
  newStart: string,
  previousEnd: string,
): string {
  const prevEnd =
    previousEnd && previousEnd.length === 10 ? previousEnd : previousStart;
  const span = calendarDaySpan(previousStart, prevEnd);
  const base = parseIsoDateLocal(newStart);
  if (!base) return newStart;
  const shifted = new Date(base);
  shifted.setDate(shifted.getDate() + span);
  return toIsoDateString(shifted);
}

/** Ensure end is on/after start and not before minDate (defaults to today). */
export function normalizeEventEndDate(
  startDate: string,
  endDate: string,
  minDate = todayLocalIso(),
): string {
  let end = endDate && endDate.length === 10 ? endDate : startDate;
  if (compareIsoDates(end, startDate) < 0) end = startDate;
  const floor = compareIsoDates(startDate, minDate) >= 0 ? startDate : minDate;
  if (compareIsoDates(end, floor) < 0) end = floor;
  return end;
}

/**
 * Start of operational "today" — for date-picker disabled matchers.
 * Must match `todayLocalIso()` / DEV SIM clock (not raw wall clock).
 */
export function startOfTodayLocal(): Date {
  return (
    parseIsoDateLocal(todayLocalIso()) ??
    (() => {
      const t = new Date();
      return new Date(t.getFullYear(), t.getMonth(), t.getDate());
    })()
  );
}

/** dd-Mmm-YY (e.g. 17-Jun-26) */
export function formatDate(input: Date | string | number | null | undefined): string {
  // Calendar YYYY-MM-DD must not go through Date.parse (UTC midnight → prior day in some TZs).
  const d =
    typeof input === "string" && /^\d{4}-\d{2}-\d{2}/.test(input)
      ? (parseIsoDateLocal(input) ?? null)
      : toDate(input);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${dd}-${mmm}-${yy}`;
}

const REGIONAL_DATE_INPUT_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;

/** Parse free-typed `dd-Mmm-yy` (e.g. `06-Jul-26`) as a local calendar date. */
export function parseRegionalDateText(text: string): Date | undefined {
  const m = REGIONAL_DATE_INPUT_RE.exec(text.trim());
  if (!m) return undefined;
  const day = Number(m[1]);
  const monthKey = m[2].toLowerCase();
  const monthIdx = MONTHS.findIndex((mon) => mon.toLowerCase() === monthKey);
  if (monthIdx < 0) return undefined;
  const year = 2000 + Number(m[3]);
  const d = new Date(year, monthIdx, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== monthIdx ||
    d.getDate() !== day
  ) {
    return undefined;
  }
  return d;
}

export function isValidRegionalDateText(text: string): boolean {
  if (!text.trim()) return false;
  return !!parseRegionalDateText(text);
}

/** 24-hour HH:MM */
export function formatTime(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** dd-Mmm-yy / hh:mm (e.g. 06-Jul-26 / 08:43) */
export function formatDateTime(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return `${formatDate(d)} / ${formatTime(d)}`;
}

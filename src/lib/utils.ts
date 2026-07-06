import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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

/** Today's date as YYYY-MM-DD in the browser's local timezone (not UTC). */
export function todayLocalIso(): string {
  return toIsoDateString(new Date());
}

/** dd-Mmm-YY (e.g. 17-Jun-26) */
export function formatDate(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${dd}-${mmm}-${yy}`;
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

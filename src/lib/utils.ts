import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Global date/time formatting standards for Yada Connect.
 * Regional format: dd-Mmm-YY (e.g. 17-Jun-26)
 * Time format: 24-hour HH:MM (no seconds)
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
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

/** dd-Mmm-YY HH:MM */
export function formatDateTime(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return "—";
  return `${formatDate(d)} ${formatTime(d)}`;
}

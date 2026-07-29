/**
 * Display dates/times in audit pack CSVs/PDFs — GUARDRAILS §5.3.
 * Calendar → dd-Mmm-yy · Instants → dd-Mmm-yy / hh:mm (local).
 * Empty/invalid → "" (not em-dash) so CSV cells stay clean.
 */
import { formatDate, formatDateTime, formatTime } from "@/lib/utils";

export function auditDate(
  input: Date | string | number | null | undefined,
): string {
  if (input == null || input === "") return "";
  const s = formatDate(input);
  return s === "—" ? "" : s;
}

export function auditDateTime(
  input: Date | string | number | null | undefined,
): string {
  if (input == null || input === "") return "";
  const s = formatDateTime(input);
  return s === "—" ? "" : s;
}

export function auditTime(
  input: Date | string | number | null | undefined,
): string {
  if (input == null || input === "") return "";
  const s = formatTime(input);
  return s === "—" ? "" : s;
}

/** HH:mm clock field already stored as text (e.g. morning_roll_time). */
export function auditClock(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const t = hhmm.trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(t) ? t : hhmm.trim();
}

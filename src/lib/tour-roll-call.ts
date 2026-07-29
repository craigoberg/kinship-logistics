/** Multi-day tour roll call times — §12.5 (evening + morning accountability). */

export const EVENING_ROLL_CALL_PARAM = "default_evening_roll_call_time";
export const MORNING_ROLL_CALL_PARAM = "default_morning_roll_call_time";

export const DEFAULT_EVENING_ROLL_CALL = "21:00";
export const DEFAULT_MORNING_ROLL_CALL = "07:00";

/** 48 slots — 24-hour clock, 30-minute steps. */
export const HALF_HOUR_CLOCK_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LOOSE_CLOCK_RE = /^(\d{1,2}):(\d{2})$/;

/** Pad single-digit hours — `9:00` → `09:00`. */
export function padClockTime(value: string | null | undefined): string {
  const v = value?.trim() ?? "";
  if (!v) return "";
  const m = LOOSE_CLOCK_RE.exec(v);
  if (!m) return v;
  const h = Number(m[1]);
  if (h > 23) return v;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function isValidClockTime(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return CLOCK_RE.test(padClockTime(value));
}

/** True when minutes are :00 or :30 (half-hour grid). */
export function isHalfHourClockTime(value: string | null | undefined): boolean {
  const v = normalizeClockTime(value);
  if (!v) return false;
  const mins = v.split(":")[1];
  return mins === "00" || mins === "30";
}

export function normalizeClockTime(value: string | null | undefined): string | null {
  const padded = padClockTime(value);
  if (!padded || !CLOCK_RE.test(padded)) return null;
  return padded;
}

export function formatClockTimeLabel(value: string | null | undefined): string {
  const v = normalizeClockTime(value);
  return v ?? "—";
}

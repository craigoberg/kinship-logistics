import { isHalfHourClockTime, isValidClockTime } from "@/lib/tour-roll-call";
import { parseISODateLocal, toISODate } from "@/lib/governance/next-expiry";

/** Tomorrow 09:00 local — `yyyy-mm-ddTHH:mm` for defer / next-action fields. */
export function defaultDeferIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return combineDeferIso(d, "09:00");
}

export function splitDeferIso(iso: string): { date: Date | undefined; time: string } {
  if (!iso) return { date: undefined, time: "09:00" };
  const [datePart, timePart] = iso.split("T");
  const date = parseISODateLocal(datePart) ?? undefined;
  const rawTime = (timePart ?? "").slice(0, 5);
  const time = isValidClockTime(rawTime) ? rawTime : "09:00";
  return { date, time };
}

export function combineDeferIso(date: Date | undefined, time: string): string {
  if (!date) return "";
  return `${toISODate(date)}T${time}`;
}

export function isValidDeferIso(iso: string): boolean {
  if (!iso) return false;
  const { date, time } = splitDeferIso(iso);
  if (!date) return false;
  if (!isHalfHourClockTime(time)) return false;
  return !Number.isNaN(Date.parse(iso));
}

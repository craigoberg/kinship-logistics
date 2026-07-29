/**
 * DEV-only operational clock override.
 *
 * Lets QA fake Sydney date + time so multi-day trips and YELLOW→RED sweeps
 * can be tested without waiting for the wall clock.
 *
 * Gated by IS_TEST_BUILD. Production builds always use the live clock.
 * Ledger `created_at` stays real wall time. Operational stamps that operators
 * see on the floor (e.g. location `open_declared_at` / `close_declared_at`,
 * test overnight reset check-in / stop open) use `operationalNowIso()` so SIM
 * clock QA matches the day being tested.
 */
import { useSyncExternalStore } from "react";
import { IS_TEST_BUILD } from "@/lib/test-mode";
import {
  getSydneyIsoDate,
  setOperationalNowProvider,
  sydneyWallClockToUtcDate,
} from "@/lib/operational-time";
import { format as dfFormat } from "date-fns";

export const OPERATIONAL_CLOCK_STORAGE_KEY = "dev:operational-clock-override";
export const OPERATIONAL_CLOCK_EVENT = "yada:operational-clock-changed";

export interface OperationalClockOverride {
  /** Sydney calendar date YYYY-MM-DD */
  date: string;
  /** Sydney local clock HH:mm */
  time: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let memoryCache: OperationalClockOverride | null | undefined;

/**
 * Until true, ignore localStorage SIM TIME so SSR HTML matches the first
 * client paint (todayLocalIso / Dev clock bar / Event Deliver date lines).
 * Flipped once in the root after mount.
 */
let clientReady = false;

function canOverride(): boolean {
  return IS_TEST_BUILD && typeof window !== "undefined";
}

/** Call once after React hydrates (root useEffect). Safe to call repeatedly. */
export function markOperationalClockClientReady(): void {
  if (typeof window === "undefined" || clientReady) return;
  clientReady = true;
  memoryCache = undefined; // re-read localStorage on next access
  notify();
}

function parseOverride(raw: string | null): OperationalClockOverride | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OperationalClockOverride>;
    if (
      typeof parsed.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      typeof parsed.time === "string" &&
      /^\d{1,2}:\d{2}$/.test(parsed.time.trim())
    ) {
      const [hh, mm] = parsed.time.trim().split(":").map(Number);
      const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      return { date: parsed.date, time };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readOverride(): OperationalClockOverride | null {
  if (!canOverride()) return null;
  // Hydration: match SSR (no localStorage) until root marks client ready.
  if (!clientReady) return null;
  if (memoryCache !== undefined) return memoryCache;
  try {
    memoryCache = parseOverride(localStorage.getItem(OPERATIONAL_CLOCK_STORAGE_KEY));
  } catch {
    memoryCache = null;
  }
  return memoryCache;
}

function notify(): void {
  for (const l of listeners) l();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPERATIONAL_CLOCK_EVENT));
  }
}

/** Current operational instant (simulated or live). */
export function getOperationalNow(): Date {
  const o = readOverride();
  if (!o) return new Date();
  return sydneyWallClockToUtcDate(o.date, o.time);
}

/** Wire provider so getSydneyIsoDate() / day-centre helpers use the override. */
setOperationalNowProvider(getOperationalNow);

/** Epoch ms for overdue / sweep comparisons. */
export function operationalNowMs(): number {
  return getOperationalNow().getTime();
}

/** ISO stamp for floor ops (open/close, check-in) — SIM clock when overridden. */
export function operationalNowIso(): string {
  return getOperationalNow().toISOString();
}

/** Sydney YYYY-MM-DD for "today" decisions. */
export function getOperationalTodayIso(): string {
  return getSydneyIsoDate(getOperationalNow());
}

export function getOperationalClockOverride(): OperationalClockOverride | null {
  return readOverride();
}

export function isOperationalClockOverridden(): boolean {
  return readOverride() != null;
}

export function setOperationalClockOverride(next: OperationalClockOverride): void {
  if (!canOverride()) return;
  clientReady = true;
  const [hh, mm] = next.time.trim().split(":").map(Number);
  const time = `${String(Math.min(23, Math.max(0, hh ?? 0))).padStart(2, "0")}:${String(Math.min(59, Math.max(0, mm ?? 0))).padStart(2, "0")}`;
  const value: OperationalClockOverride = { date: next.date, time };
  memoryCache = value;
  try {
    localStorage.setItem(OPERATIONAL_CLOCK_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  notify();
}

export function clearOperationalClockOverride(): void {
  if (!canOverride()) return;
  memoryCache = null;
  try {
    localStorage.removeItem(OPERATIONAL_CLOCK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

/** Shift the operational clock by minutes (starts from override or live now). */
export function shiftOperationalClockMinutes(deltaMins: number): OperationalClockOverride {
  const base = getOperationalNow();
  const shifted = new Date(base.getTime() + deltaMins * 60_000);
  const date = getSydneyIsoDate(shifted);
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(shifted);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const next = { date, time: `${hh}:${mm}` };
  setOperationalClockOverride(next);
  return next;
}

/** Advance operational calendar by whole days (keeps current sim/live clock). */
export function shiftOperationalClockDays(deltaDays: number): OperationalClockOverride {
  return shiftOperationalClockMinutes(deltaDays * 24 * 60);
}

/** Snapshot live wall clock into the override (frozen at this Sydney date/time). */
export function freezeOperationalClockToLive(): OperationalClockOverride {
  const now = new Date();
  const date = getSydneyIsoDate(now);
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const next = { date, time: `${hh}:${mm}` };
  setOperationalClockOverride(next);
  return next;
}

export function formatOperationalClockLabel(o: OperationalClockOverride | null): string {
  if (!o) return "Live clock";
  // Format from Sydney wall strings — avoid UTC→local display drift.
  const [y, m, d] = o.date.split("-").map(Number);
  const labelDate = dfFormat(new Date(y!, (m ?? 1) - 1, d ?? 1), "dd-MMM-yy");
  return `${labelDate} · ${o.time} Syd`;
}

export function subscribeOperationalClock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For React useSyncExternalStore. */
export function getOperationalClockSnapshot(): string {
  // Include clientReady so subscribers re-render when SIM TIME unlocks after hydrate.
  const o = readOverride();
  return `${clientReady ? "ready" : "ssr"}:${o ? `${o.date}T${o.time}` : "live"}`;
}

/** SSR-safe "today" for UI — re-renders when SIM TIME unlocks or changes. */
export function useOperationalTodayIso(): string {
  useSyncExternalStore(
    subscribeOperationalClock,
    getOperationalClockSnapshot,
    () => "ssr:live",
  );
  return getOperationalTodayIso();
}

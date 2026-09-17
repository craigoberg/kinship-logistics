/**
 * DEV-only operational clock override.
 *
 * Lets QA fake Sydney date + time so multi-day trips and YELLOW→RED sweeps
 * can be tested without waiting for the wall clock.
 *
 * Gated by IS_TEST_BUILD. Production builds always use the live clock.
 * GUARDRAILS §5.3: any date/time work must honour this clock. Floor stamps
 * operators see (depart/arrive/board, check-in, open/close, Off today) use
 * `operationalNowIso()`. Ledger `created_at` is SIM so Logs/Hub match the
 * amber bar. Outbox `savedAt` stays real wall time (when the device queued).
 * Production builds always use the live clock via the same helpers.
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
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

/** Persisted with the override — Sydney wall date when SIM was applied. */
interface StoredOperationalClockOverride extends OperationalClockOverride {
  setOnWallDate: string;
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
let wallDateWatcherStarted = false;

function canOverride(): boolean {
  return IS_TEST_BUILD && typeof window !== "undefined";
}

/** Call once after React hydrates (root useEffect). Safe to call repeatedly. */
export function markOperationalClockClientReady(): void {
  if (typeof window === "undefined" || clientReady) return;
  clientReady = true;
  expireStaleOperationalClockOverride("midnight");
  memoryCache = undefined; // re-read localStorage on next access
  notify();
  startWallDateWatcher();
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Real Sydney calendar date — wall clock, never SIM. Used only to expire SIM. */
function wallSydneyDateIso(now: Date = new Date()): string {
  return getSydneyIsoDate(now);
}

function parseStoredOverride(raw: string | null): StoredOperationalClockOverride | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredOperationalClockOverride>;
    if (!isIsoDate(parsed.date) || typeof parsed.time !== "string") return null;
    if (!/^\d{1,2}:\d{2}$/.test(parsed.time.trim())) return null;
    const [hh, mm] = parsed.time.trim().split(":").map(Number);
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    if (!isIsoDate(parsed.setOnWallDate)) return null;
    return { date: parsed.date, time, setOnWallDate: parsed.setOnWallDate };
  } catch {
    return null;
  }
}

function toPublicOverride(stored: StoredOperationalClockOverride): OperationalClockOverride {
  return { date: stored.date, time: stored.time };
}

/**
 * Drop SIM when a real Sydney day has passed since it was set, or when the
 * stored blob is the old forever-persist shape (no setOnWallDate).
 * Safe to call often. Does not run during SSR getSnapshot.
 */
export function expireStaleOperationalClockOverride(
  reason: "midnight" | "legacy" = "midnight",
): boolean {
  if (!canOverride() || !clientReady) return false;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OPERATIONAL_CLOCK_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  const stored = parseStoredOverride(raw);
  const wallDate = wallSydneyDateIso();
  const stale = !stored || stored.setOnWallDate !== wallDate;
  if (!stale) return false;
  memoryCache = null;
  try {
    localStorage.removeItem(OPERATIONAL_CLOCK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  toast.message("SIM TIME expired — back to live clock", {
    description:
      stored && reason === "midnight"
        ? "A new calendar day started since this SIM was set."
        : "Saved SIM TIME was from a previous session and is no longer kept overnight.",
  });
  notify();
  return true;
}

function startWallDateWatcher(): void {
  if (typeof window === "undefined" || wallDateWatcherStarted) return;
  wallDateWatcherStarted = true;
  const tick = () => {
    expireStaleOperationalClockOverride("midnight");
  };
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  window.setInterval(tick, 60_000);
}

function readOverride(): OperationalClockOverride | null {
  if (!canOverride()) return null;
  // Hydration: match SSR (no localStorage) until root marks client ready.
  if (!clientReady) return null;
  if (memoryCache !== undefined) return memoryCache;
  try {
    const stored = parseStoredOverride(localStorage.getItem(OPERATIONAL_CLOCK_STORAGE_KEY));
    memoryCache = stored ? toPublicOverride(stored) : null;
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

/** Insert stamps for operator-visible log rows (issues, ledger). Honour SIM. */
export function operationalRowStamps(): { created_at: string; occurred_at: string } {
  const now = operationalNowIso();
  return { created_at: now, occurred_at: now };
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
  const stored: StoredOperationalClockOverride = {
    ...value,
    setOnWallDate: wallSydneyDateIso(),
  };
  memoryCache = value;
  try {
    localStorage.setItem(OPERATIONAL_CLOCK_STORAGE_KEY, JSON.stringify(stored));
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

/**
 * Day email login or PIN on `/auth` — not idle unlock / action step-up.
 * SIM is a same-sitting QA tool; a new operator session returns to wall clock.
 */
export function clearOperationalClockOnOperatorLogin(): void {
  if (!canOverride()) return;
  const hadOverride =
    memoryCache != null ||
    (typeof localStorage !== "undefined" &&
      !!localStorage.getItem(OPERATIONAL_CLOCK_STORAGE_KEY));
  if (!hadOverride) return;
  clearOperationalClockOverride();
  toast.message("SIM TIME cleared on sign-in", {
    description: "Back to live wall clock. Set SIM again only for this sitting.",
  });
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
  const labelDate = dfFormat(new Date(y!, (m ?? 1) - 1, d ?? 1), "EEE dd-MMM-yy");
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

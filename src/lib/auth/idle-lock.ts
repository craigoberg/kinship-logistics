/**
 * Idle screen lock — last-activity stamps and bounds.
 * Uses wall-clock ms (physical tablet idle), not SIM / operational time.
 */

export const AUTH_IDLE_LOCK_MINUTES_KEY = "auth_idle_lock_minutes";
export const DEFAULT_AUTH_IDLE_LOCK_MINUTES = 15;
export const MIN_AUTH_IDLE_LOCK_MINUTES = 0;
export const MAX_AUTH_IDLE_LOCK_MINUTES = 240;

const LAST_ACTIVITY_KEY = "yada_idle_last_activity_ms";

export function clampIdleLockMinutes(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_AUTH_IDLE_LOCK_MINUTES;
  const n = Math.trunc(raw);
  if (n < MIN_AUTH_IDLE_LOCK_MINUTES) return MIN_AUTH_IDLE_LOCK_MINUTES;
  if (n > MAX_AUTH_IDLE_LOCK_MINUTES) return MAX_AUTH_IDLE_LOCK_MINUTES;
  return n;
}

export function readLastActivityMs(): number | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function touchLastActivity(atMs: number = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(atMs));
  } catch {
    // Quota / private mode — timer still works in-memory via the hook.
  }
}

export function clearLastActivity(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

export function isIdlePastLock(minutes: number, nowMs: number = Date.now()): boolean {
  const mins = clampIdleLockMinutes(minutes);
  if (mins <= 0) return false;
  const last = readLastActivityMs();
  if (last == null) return false;
  return nowMs - last >= mins * 60_000;
}

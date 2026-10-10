export interface HubReviewNoteLike {
  note: string;
  stampedAt: string;
  metadata: Record<string, unknown> | null;
}

export function isHubReviewStarted(notes: HubReviewNoteLike[]): boolean {
  return findHubReviewStartedNote(notes) != null;
}

export function findHubReviewStartedNote<T extends HubReviewNoteLike>(
  notes: T[],
): T | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.metadata?.review_started === true) return n;
    if (/^Review started/i.test(n.note) || n.note === "Work started.") return n;
  }
  return null;
}

/**
 * Elapsed or remaining span. `40m`, `3h 0m`, `2d 4h 15m`.
 * Days always keep hours and minutes, including zeros.
 */
export function formatSpanMinutes(totalMins: number): string {
  const minsTotal = Math.max(0, Math.floor(totalMins));
  const days = Math.floor(minsTotal / 1440);
  const hours = Math.floor((minsTotal % 1440) / 60);
  const mins = minsTotal % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Time left until a defer deadline. Past the deadline: `overdue`.
 * `nowMs` must be the operational clock (SIM-aware).
 */
export function formatDeferRemaining(untilIso: string, nowMs: number): string {
  const until = Date.parse(untilIso);
  if (!Number.isFinite(until)) return "—";
  const ms = until - nowMs;
  if (ms <= 0) return "overdue";
  return formatSpanMinutes(ms / 60_000);
}

/** How long a ticket was open: occurred (or logged) through resolved. */
export function formatOpenDuration(fromIso: string, toIso: string): string {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "—";
  return formatSpanMinutes(Math.max(0, to - from) / 60_000);
}

export function formatHubWaitDuration(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

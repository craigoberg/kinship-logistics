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

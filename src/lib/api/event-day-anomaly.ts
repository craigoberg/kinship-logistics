import type { EventDaySession } from "@/lib/api/event-outing";
import type { EventManifest } from "@/lib/data-store";

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LIVE_PHASES = new Set([
  "active",
  "in_transit",
  "at_base",
  "pre_departure",
]);

/**
 * Pick the trip day session for anomaly logging from Manage Event.
 * Prefers today (when in range), then any live day, then first open day.
 */
export function resolveEventDaySessionForAnomaly(
  sessions: EventDaySession[],
  event: EventManifest,
): EventDaySession | null {
  if (sessions.length === 0) return null;

  const endDate = event.endDate ?? event.startDate;
  const today = todayLocalIso();
  if (today >= event.startDate && today <= endDate) {
    const todaySession = sessions.find((s) => s.session_date === today);
    if (todaySession) return todaySession;
  }

  const live = sessions.find((s) => LIVE_PHASES.has(s.phase));
  if (live) return live;

  const open = sessions.find(
    (s) => s.phase !== "closed_orderly" && s.phase !== "closed_incident",
  );
  return open ?? sessions[0] ?? null;
}

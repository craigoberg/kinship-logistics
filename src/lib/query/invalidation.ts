/**
 * Centralised silent cache invalidation for the operational surfaces.
 *
 * Two helpers are exported:
 *
 * - `invalidateIssueCaches(qc)` — Day Centre / Governance Hub surfaces.
 * - `invalidateTransportCaches(qc)` — Driver manifest, dashboard manifest
 *   tile, and the confirmed-events picker. Any mutation that writes to
 *   `participants`, `event_roster_bookings`, `event_manifest`, `trip_legs`,
 *   or `transport_trips` must call this helper so the driver manifest and
 *   coordinator views update without a manual page refresh.
 *
 * No hard reload, no remount — TanStack Query handles the diff.
 */
import type { QueryClient } from "@tanstack/react-query";

import { unifiedIssuesKey } from "@/hooks/use-unified-issues";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

export interface InvalidateScope {
  /** Optional Hub source ("day_centre" | "incident" | "escalation" | "renewal"). */
  source?: string;
  /** Optional source row id — invalidates the matching timeline cache. */
  sourceRowId?: string;
  /** Optional site-day session id — narrows attendance / issue refetches. */
  sessionId?: string;
}

/**
 * Invalidate every cache that could be affected by an issue / attendance
 * mutation. Safe to call from any mutation `onSuccess`; never reloads the
 * document.
 */
export function invalidateIssueCaches(
  qc: QueryClient,
  scope: InvalidateScope = {},
): void {
  // Governance Hub unified-issues feed (both Active and Awaiting tabs).
  qc.invalidateQueries({ queryKey: unifiedIssuesKey });

  // Site session header (RYGE phase changes).
  qc.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });

  // Per-issue Hub timeline (only when we know the row).
  if (scope.source && scope.sourceRowId) {
    qc.invalidateQueries({
      queryKey: ["hub-issue-timeline", scope.source, scope.sourceRowId],
    });
  }

  // Attendance roll for the active session (or all sessions when unknown).
  if (scope.sessionId) {
    qc.invalidateQueries({
      queryKey: ["client-attendance-roll", scope.sessionId],
    });
  } else {
    qc.invalidateQueries({
      predicate: (q) => q.queryKey?.[0] === "client-attendance-roll",
    });
  }

  // Broad prefix match for everything else under the site-day umbrella.
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey?.[0];
      return (
        typeof k === "string" &&
        (k.startsWith("site-issues") ||
          k.startsWith("site-day") ||
          k.startsWith("site-escalation") ||
          k.startsWith("governance"))
      );
    },
  });
}

/**
 * Invalidate every cache that could be affected by a transport mutation
 * (participant profile save, booking edit, event roster change, or leg patch).
 *
 * Call from any mutation `onSuccess` that writes to `participants`,
 * `event_roster_bookings`, `event_manifest`, `trip_legs`, or
 * `transport_trips`. This keeps the driver manifest, dashboard manifest
 * summary tile, and start/end-day anomaly feed in sync with the coordinator
 * in real time without a page reload.
 */
export function invalidateTransportCaches(qc: QueryClient): void {
  // Active driver manifest bundle (trip + legs).
  qc.invalidateQueries({ queryKey: ["transport_trips", "active"] });

  // Dashboard manifest summary tile (hoist dependents, headcount, etc.).
  qc.invalidateQueries({ queryKey: ["today-manifest-summary"] });

  // Dashboard start/end-day anomaly feed (clearance failures, split legs).
  qc.invalidateQueries({ queryKey: ["start-end-day-anomalies"] });

  // Confirmed-events picker shown to the driver before trip start.
  qc.invalidateQueries({ queryKey: ["events", "confirmed"] });

  // Participants directory Bus/Self indicator grid (reads participant_attendance_schedules).
  qc.invalidateQueries({ queryKey: ["participant-directory-indicators", "v3-split-transport"] });
}

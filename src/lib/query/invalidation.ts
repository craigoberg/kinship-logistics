/**
 * Centralised silent cache invalidation for the operational surfaces.
 *
 * Mutations across the Day Centre / Governance Hub should call
 * `invalidateIssueCaches(qc)` (optionally narrowed via a source/row hint) so
 * every list, badge and timeline refetches once in the background. No hard
 * reload, no remount — TanStack Query handles the diff.
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

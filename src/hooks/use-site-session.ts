import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTodaySession,
  subscribeToSiteSession,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { useOperationalTodayIso } from "@/lib/operational-clock";

export const SITE_SESSION_QUERY_KEY = ["site-day-session", "today"] as const;

/**
 * Today's site_day_session.
 *
 * Background polling and focus refetches are OFF — they were the source of
 * the noisy 15-second `[site_day_sessions]` log loop and the visible
 * mid-typing refresh of the escalation handshake panels. Realtime
 * (subscribeToSiteSession below) plus explicit `invalidateQueries` after
 * writes is the freshness rail.
 *
 * When the operational (SIM) date changes, refetch so "today" is not a
 * stale prior-day row left in the shared cache key.
 */
export function useSiteSession() {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
  const today = useOperationalTodayIso();
  const canQuery = isReady;
  const q = useQuery<SiteDaySession | null>({
    queryKey: SITE_SESSION_QUERY_KEY,
    queryFn: getTodaySession,
    enabled: canQuery,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
  }, [today, queryClient]);

  const sessionId = q.data?.id;
  useEffect(() => {
    if (!sessionId) return;
    const off = subscribeToSiteSession(sessionId, (next) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
    });
    return off;
  }, [sessionId, queryClient]);

  return q;
}

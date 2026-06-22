import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTodaySession,
  subscribeToSiteSession,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const SITE_SESSION_QUERY_KEY = ["site-day-session", "today"] as const;

/**
 * Today's site_day_session.
 *
 * Background polling and focus refetches are OFF — they were the source of
 * the noisy 15-second `[site_day_sessions]` log loop and the visible
 * mid-typing refresh of the escalation handshake panels. Realtime
 * (subscribeToSiteSession below) plus explicit `invalidateQueries` after
 * writes is the freshness rail.
 */
export function useSiteSession() {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
  const canQuery = isReady;
  const q = useQuery<SiteDaySession | null>({
    queryKey: SITE_SESSION_QUERY_KEY,
    queryFn: getTodaySession,
    enabled: canQuery,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

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

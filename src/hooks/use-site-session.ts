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
 * Today's site_day_session. Polling + Supabase realtime so the opener's
 * panel flips from "Manager is reviewing" to Accept/Reject the moment the
 * manager submits their proposal.
 */
export function useSiteSession() {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
  const canQuery = isReady;
  const q = useQuery<SiteDaySession | null>({
    queryKey: SITE_SESSION_QUERY_KEY,
    queryFn: getTodaySession,
    enabled: canQuery,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
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

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTodaySession,
  subscribeToSiteSession,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";

export const SITE_SESSION_QUERY_KEY = ["site-day-session", "today"] as const;

/**
 * Today's site_day_session. Smart polling (30s / no-bg / focus refetch)
 * paired with a Supabase realtime subscription so dashboards stay live
 * without thrashing the editor while a user is typing in a form.
 */
export function useSiteSession() {
  const queryClient = useQueryClient();
  const q = useQuery<SiteDaySession | null>({
    queryKey: SITE_SESSION_QUERY_KEY,
    queryFn: getTodaySession,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
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

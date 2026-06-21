import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTodaySession, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const SITE_SESSION_QUERY_KEY = ["site-day-session", "today"] as const;

/**
 * Today's site_day_session. Smart polling (30s / no-bg / focus refetch)
 * paired with a Supabase realtime subscription so dashboards stay live
 * without thrashing the editor while a user is typing in a form.
 */
export function useSiteSession() {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
  const canQuery = isReady;
  const q = useQuery<SiteDaySession | null>({
    queryKey: SITE_SESSION_QUERY_KEY,
    queryFn: getTodaySession,
    enabled: canQuery,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const sessionId = q.data?.id;
  useEffect(() => {
    // Realtime subscription temporarily disabled to prevent subscription lifecycle race conditions
    return () => {};
  }, [sessionId, queryClient]);

  return q;
}

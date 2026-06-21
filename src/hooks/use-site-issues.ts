import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listIssues,
  subscribeToSiteIssues,
  type SiteIssue,
} from "@/lib/api/site-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";

export function siteIssuesKey(sessionId: string | null | undefined) {
  return ["site-issues", sessionId ?? "none"] as const;
}

export function useSiteIssues(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { user, isReady } = useAuthReady();
  const canQuery = isReady && !!user && !!sessionId;
  const q = useQuery<SiteIssue[]>({
    queryKey: siteIssuesKey(sessionId),
    queryFn: () => (sessionId ? listIssues(sessionId) : Promise.resolve([])),
    enabled: canQuery,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!canQuery || !sessionId) return;
    const off = subscribeToSiteIssues(sessionId, () => {
      queryClient.invalidateQueries({ queryKey: siteIssuesKey(sessionId) });
    });
    return off;
  }, [canQuery, sessionId, queryClient]);

  return q;
}

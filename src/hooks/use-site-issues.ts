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
  const { isReady } = useAuthReady();
  // Gate only on auth-ready + sessionId. Do NOT require a signed-in user —
  // the publishable (anon) key is sufficient to read site_issues_register
  // under current RLS, and gating on `user` silently disables the query
  // and renders the "No issues logged yet" empty state forever when the
  // session hasn't been hydrated.
  const canQuery = isReady && !!sessionId;
  const q = useQuery<SiteIssue[]>({
    queryKey: siteIssuesKey(sessionId),
    queryFn: () => (sessionId ? listIssues(sessionId) : Promise.resolve([])),
    enabled: canQuery,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  // Realtime subscription intentionally disabled — programmatic cache
  // invalidation on mutation success + polling refetchInterval cover updates,
  // and re-subscribing on the same channel caused
  // "cannot add postgres_changes callbacks after subscribe()" crashes.
  useEffect(() => {
    return () => {};
  }, [canQuery, sessionId, queryClient]);

  return q;
}

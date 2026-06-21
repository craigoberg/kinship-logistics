import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listIssues,
  listActiveIssues,
  type SiteIssue,
} from "@/lib/api/site-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";

export function siteIssuesKey(sessionId: string | null | undefined) {
  return ["site-issues", sessionId ?? "none"] as const;
}

export function activeSiteIssuesKey(sessionId: string | null | undefined) {
  return ["site-issues-active", sessionId ?? "none"] as const;
}

export function useSiteIssues(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
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

  useEffect(() => {
    return () => {};
  }, [canQuery, sessionId, queryClient]);

  return q;
}

/**
 * Unified active-issues hook for the post-declaration ActiveDayPanel.
 * Returns today's issues for `sessionId` PLUS any still-open issues
 * carried over from prior sessions.
 */
export function useActiveSiteIssues(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
  const canQuery = isReady && !!sessionId;
  const q = useQuery<SiteIssue[]>({
    queryKey: activeSiteIssuesKey(sessionId),
    queryFn: () =>
      sessionId ? listActiveIssues(sessionId) : Promise.resolve([]),
    enabled: canQuery,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  // Realtime intentionally disabled — see useSiteIssues note.
  useEffect(() => {
    return () => {};
  }, [canQuery, sessionId, queryClient]);

  return q;
}

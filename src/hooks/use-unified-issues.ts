import { useQuery } from "@tanstack/react-query";
import {
  listOpenUnifiedIssues,
  type UnifiedIssue,
  type UnifiedIssueTab,
} from "@/lib/api/unified-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const unifiedIssuesKey = ["governance-unified-issues"] as const;
export const unifiedIssuesTabKey = (tab: UnifiedIssueTab) =>
  ["governance-unified-issues", tab] as const;

/**
 * Governance Hub unified-issues feed.
 *
 * `tab` controls whether the active list (open / pending rows) or the
 * Awaiting / Deferred list (deferred + awaiting_external) is returned.
 * The tab is part of the query key so the two caches stay independent.
 */
export function useUnifiedIssues(tab: UnifiedIssueTab = "active") {
  const { isReady } = useAuthReady();
  return useQuery<UnifiedIssue[]>({
    queryKey: unifiedIssuesTabKey(tab),
    queryFn: () => listOpenUnifiedIssues({ tab }),
    enabled: isReady,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

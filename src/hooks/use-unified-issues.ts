import { useQuery } from "@tanstack/react-query";
import {
  listOpenUnifiedIssues,
  type UnifiedIssue,
  type UnifiedIssueTab,
} from "@/lib/api/unified-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { useIssueDeferRewarnDays } from "@/hooks/use-system-parameters";

export const unifiedIssuesKey = ["governance-unified-issues"] as const;
export const unifiedIssuesTabKey = (tab: UnifiedIssueTab, deferRewarnDays: number) =>
  ["governance-unified-issues", tab, deferRewarnDays] as const;

/**
 * Governance Hub unified-issues feed.
 *
 * `tab` controls whether the active list (open / pending rows) or the
 * Awaiting / Deferred list (deferred + awaiting_external) is returned.
 * The tab is part of the query key so the two caches stay independent.
 *
 * On the Active tab, deferred issues are hidden until their deadline is
 * within `issue_defer_rewarn_days` (Admin → System Parameters, default 7).
 */
export function useUnifiedIssues(tab: UnifiedIssueTab = "active") {
  const { isReady } = useAuthReady();
  const deferRewarnDays = useIssueDeferRewarnDays();
  return useQuery<UnifiedIssue[]>({
    queryKey: unifiedIssuesTabKey(tab, deferRewarnDays),
    queryFn: () => listOpenUnifiedIssues({ tab, deferRewarnDays }),
    enabled: isReady,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

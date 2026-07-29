import { useQuery } from "@tanstack/react-query";
import {
  listOpenUnifiedIssues,
  type UnifiedIssue,
  type UnifiedIssueTab,
} from "@/lib/api/unified-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { useIssueDeferRewarnMs } from "@/hooks/use-system-parameters";

export const unifiedIssuesKey = ["governance-unified-issues"] as const;
export const unifiedIssuesTabKey = (tab: UnifiedIssueTab, deferRewarnMs: number) =>
  ["governance-unified-issues", tab, deferRewarnMs] as const;

/**
 * Governance Hub unified-issues feed.
 *
 * tab = "active"   → open / pending rows.
 * tab = "deferred" → deferred + council awaiting rows.
 * tab = "resolved" → resolved history.
 *
 * On the Active tab, deferred issues are hidden until their deadline is
 * within `issue_defer_rewarn_hours` (Admin → System Parameters, default 1 h).
 * Human issues use hours; the days-based key is legacy.
 */
export function useUnifiedIssues(tab: UnifiedIssueTab = "active") {
  const { isReady } = useAuthReady();
  const deferRewarnMs = useIssueDeferRewarnMs();
  return useQuery<UnifiedIssue[]>({
    queryKey: unifiedIssuesTabKey(tab, deferRewarnMs),
    queryFn: () => listOpenUnifiedIssues({ tab, deferRewarnMs }),
    enabled: isReady,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

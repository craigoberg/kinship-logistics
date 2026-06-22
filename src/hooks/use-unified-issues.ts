import { useQuery } from "@tanstack/react-query";
import { listOpenUnifiedIssues, type UnifiedIssue } from "@/lib/api/unified-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const unifiedIssuesKey = ["governance-unified-issues"] as const;

/**
 * Governance Hub unified-issues feed.
 *
 * Background polling and window-focus refetches are intentionally OFF — they
 * were causing the visible "page is refreshing while I type" symptom in the
 * Resolve dialog and on the driver-side waiting panels. Freshness is driven
 * by explicit `queryClient.invalidateQueries(unifiedIssuesKey)` after writes
 * and Supabase realtime subscriptions on the underlying tables.
 */
export function useUnifiedIssues() {
  const { isReady } = useAuthReady();
  return useQuery<UnifiedIssue[]>({
    queryKey: unifiedIssuesKey,
    queryFn: () => listOpenUnifiedIssues(),
    enabled: isReady,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

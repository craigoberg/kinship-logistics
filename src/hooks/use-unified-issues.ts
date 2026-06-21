import { useQuery } from "@tanstack/react-query";
import { listOpenUnifiedIssues, type UnifiedIssue } from "@/lib/api/unified-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";

export const unifiedIssuesKey = ["governance-unified-issues"] as const;

export function useUnifiedIssues() {
  const { isReady } = useAuthReady();
  return useQuery<UnifiedIssue[]>({
    queryKey: unifiedIssuesKey,
    queryFn: () => listOpenUnifiedIssues(),
    enabled: isReady,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import { useAuthReady } from "@/hooks/use-auth-ready";

/**
 * Counts today's `attendance_roster_logs` rows that are still 'Pending'
 * and were created longer than `site_management.no_show_threshold_minutes`
 * ago. Pragmatic UI-only heuristic — the events module is responsible for
 * pre-seeding pending rows.
 */
export function useNoShowWatch(): { count: number; thresholdMinutes: number } {
  const { user, isReady } = useAuthReady();
  const threshold = useSystemParameter<number>(
    "site_management.no_show_threshold_minutes",
    60,
  );

  const q = useQuery<number>({
    queryKey: ["no-show-watch", threshold],
    queryFn: async () => {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const cutoffIso = new Date(Date.now() - threshold * 60_000).toISOString();
      const { data, error } = await supabase
        .from("attendance_roster_logs")
        .select("id", { count: "exact", head: false })
        .eq("roster_date", today)
        .eq("actual_status", "Pending")
        .lt("created_at", cutoffIso);
      if (error) {
        // Surface zero on table-not-ready; do not crash the sidebar.
        console.error("[useNoShowWatch] query failed", error);
        return 0;
      }
      return (data ?? []).length;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    enabled: isReady && !!user,
  });

  return { count: q.data ?? 0, thresholdMinutes: threshold };
}

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getTodaySession, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { supabase } from "@/integrations/supabase/client";

export const SITE_SESSION_QUERY_KEY = ["site-day-session", "today"] as const;

interface SiteDaySessionRealtimeRow {
  id: string;
  session_date: string;
  phase: SiteDaySession["phase"];
  opened_by_id: string | null;
  open_declared_at: string | null;
  open_leader_notes: string | null;
  closed_by_id: string | null;
  close_declared_at: string | null;
  close_leader_notes: string | null;
  manager_plan_text: string | null;
  manager_decision: SiteDaySession["managerDecision"];
  manager_auth_staff_id: string | null;
  manager_auth_at: string | null;
  leader_decision: SiteDaySession["leaderDecision"];
  leader_auth_staff_id: string | null;
  leader_auth_at: string | null;
  created_at: string;
  updated_at: string;
}

function realtimeRowToSession(r: SiteDaySessionRealtimeRow): SiteDaySession {
  return {
    id: r.id,
    sessionDate: r.session_date,
    phase: r.phase,
    openedById: r.opened_by_id,
    openDeclaredAt: r.open_declared_at,
    openLeaderNotes: r.open_leader_notes,
    closedById: r.closed_by_id,
    closeDeclaredAt: r.close_declared_at,
    closeLeaderNotes: r.close_leader_notes,
    managerPlanText: r.manager_plan_text,
    managerDecision: r.manager_decision,
    managerAuthStaffId: r.manager_auth_staff_id,
    managerAuthAt: r.manager_auth_at,
    leaderDecision: r.leader_decision,
    leaderAuthStaffId: r.leader_auth_staff_id,
    leaderAuthAt: r.leader_auth_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Today's site_day_session. Smart polling (30s / no-bg / focus refetch)
 * paired with a Supabase realtime subscription so dashboards stay live
 * without thrashing the editor while a user is typing in a form.
 */
export function useSiteSession() {
  const queryClient = useQueryClient();
  const { isReady } = useAuthReady();
  const canQuery = isReady;
  const channelRef = useRef<RealtimeChannel | null>(null);
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
    if (!sessionId) return;
    if (channelRef.current) return;

    const channel = supabase
      .channel(`site-day-session-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "site_day_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          queryClient.setQueryData(
            SITE_SESSION_QUERY_KEY,
            realtimeRowToSession(payload.new as SiteDaySessionRealtimeRow),
          );
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [sessionId, queryClient]);

  return q;
}

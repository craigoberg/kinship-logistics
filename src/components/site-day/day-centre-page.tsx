import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClientTime } from "@/components/ui/client-time";
import { SITE_SESSION_QUERY_KEY, useSiteSession } from "@/hooks/use-site-session";
import { useSiteIssues } from "@/hooks/use-site-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { ensureTodaySession } from "@/lib/api/site-day-sessions";
import { getEscalationBySourceIssue } from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { StartOfDayPanel } from "./start-of-day-panel";
import { ActiveDayPanel } from "./active-day-panel";
import { EscalationLockBanner } from "./escalation-lock-banner";
import { EscalationResolutionPanel } from "./escalation-resolution-panel";
import { DayClosedPanel } from "./day-closed-panel";

export function DayCentrePage() {
  const queryClient = useQueryClient();
  const { user, isReady } = useAuthReady();
  const sessionQ = useSiteSession();
  const session = sessionQ.data ?? null;
  const issuesQ = useSiteIssues(session?.id ?? null);
  const redIssue =
    (issuesQ.data ?? []).find((i) => i.severity === "red" && i.status !== "resolved") ?? null;
  const redEscalationQ = useQuery({
    queryKey: ["site-escalation", redIssue?.id ?? "none"],
    queryFn: () => (redIssue ? getEscalationBySourceIssue(redIssue.id) : Promise.resolve(null)),
    enabled: !!redIssue,
    staleTime: 5_000,
  });

  // One-shot bootstrap: if no row exists for today, provision exactly one
  // so every child component reads the same session_id.
  const bootstrappedRef = useRef(false);
  const bootstrapMut = useMutation({
    mutationFn: () => ensureTodaySession(),
    onSuccess: (row) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, row);
      queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
    },
    onError: (err: Error) => {
      // Allow retry on next render / via the manual Retry button.
      bootstrappedRef.current = false;
      console.error("[DayCentrePage] ensureTodaySession failed", err);
      toast.error("Could not provision today's session", {
        description: err.message,
      });
    },
  });

  useEffect(() => {
    if (bootstrappedRef.current) return;
    if (!isReady || !user) return;
    if (sessionQ.isLoading || sessionQ.isError) return;
    if (sessionQ.data) return;
    bootstrappedRef.current = true;
    bootstrapMut.mutate();
  }, [isReady, user, sessionQ.isLoading, sessionQ.isError, sessionQ.data, bootstrapMut]);

  console.log("Current Session State:", {
    session: sessionQ.data,
    sessionLoading: sessionQ.isLoading,
    isReady,
    userId: user?.id ?? null,
    bootstrapStatus: bootstrapMut.status,
    bootstrapError: bootstrapMut.error?.message ?? null,
  });

  if (sessionQ.isLoading || bootstrapMut.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading today's session…
      </div>
    );
  }

  if (sessionQ.isError || bootstrapMut.isError) {
    const err = (sessionQ.error ?? bootstrapMut.error) as Error | undefined;
    return (
      <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <div className="font-medium">Could not load the Day Centre session.</div>
            <div className="text-xs">{err?.message ?? "Session row unavailable."}</div>
            <div className="text-xs">
              If the error mentions a missing table or column, an admin must apply the site-day
              schema migration.
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                bootstrappedRef.current = false;
                bootstrapMut.reset();
                queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
                bootstrapMut.mutate();
              }}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!session) {
    // No row yet and bootstrap hasn't started/finished — give the user an
    // explicit recovery path instead of a silent spinner.
    return (
      <Card className="space-y-3 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
          <div className="space-y-1">
            <div className="font-medium">Provisioning today's session…</div>
            <div className="text-xs text-muted-foreground">
              {isReady && user
                ? "Tap Retry if this card does not clear in a few seconds."
                : "Waiting for sign-in to complete."}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!isReady || !user || bootstrapMut.isPending}
          onClick={() => {
            bootstrappedRef.current = false;
            bootstrapMut.mutate();
          }}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Retry now
        </Button>
      </Card>
    );
  }



  const redEscalation = redEscalationQ.data ?? null;
  const hasLiveEscalation =
    redEscalation?.status === "pending" || redEscalation?.status === "claimed";
  const isEscalationActive = session.phase === "escalated_lock" || hasLiveEscalation;

  const renderPhase = () => {
    if (isEscalationActive) {
      return (
        <div className="space-y-4">
          <EscalationLockBanner session={session} />
          <EscalationResolutionPanel session={session} redIssue={redIssue} />
        </div>
      );
    }

    switch (session.phase) {
      case "open_pending":
        return <StartOfDayPanel sessionId={session.id} reportedBy={user?.id ?? ""} />;
      case "active_day":
        return <ActiveDayPanel session={session} />;
      case "closed_orderly":
      case "closed_no_go":
        return <DayClosedPanel session={session} />;
      default:
        return (
          <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Unknown session phase: {String(session.phase)}
          </Card>
        );
    }
  };

  return <div className="space-y-6">{renderPhase()}</div>;
}

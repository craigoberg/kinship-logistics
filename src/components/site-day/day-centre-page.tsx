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

  // Cross-session: any open RED anywhere blocks a new Day Centre opening.
  // Queryable even without today's session row, so we can show guidance
  // BEFORE provisioning.
  const openRedsQ = useQuery({
    queryKey: ["site-issues", "open-reds-all"],
    enabled: isReady,
    staleTime: 5_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_issues_register")
        .select("id, session_id, severity, status, issue_description, workaround_plan, created_at")
        .eq("severity", "red")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const blockingReds = openRedsQ.data ?? [];
  const hasBlockingRed = blockingReds.length > 0;

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
    // Do not auto-provision today's session while an unresolved RED is
    // blocking. The Manager must clear it in the Governance Hub first.
    if (openRedsQ.isLoading) return;
    if (hasBlockingRed) return;
    bootstrappedRef.current = true;
    bootstrapMut.mutate();
  }, [
    isReady,
    user,
    sessionQ.isLoading,
    sessionQ.isError,
    sessionQ.data,
    openRedsQ.isLoading,
    hasBlockingRed,
    bootstrapMut,
  ]);

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

  // Blocking RED check — show BEFORE provisioning today's session. The
  // Day Centre cannot open while any RED issue is still open in the
  // Governance Hub. Only a Manager can clear it.
  if (hasBlockingRed && (!session || session.phase === "open_pending")) {
    return (
      <Card className="space-y-4 border-destructive/50 bg-destructive/5 p-5 text-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <div className="text-base font-semibold text-destructive">
              Day Centre cannot be opened — unresolved RED issue
              {blockingReds.length > 1 ? "s" : ""}
            </div>
            <div className="text-muted-foreground">
              Only a Manager can clear a RED in the Governance Hub. Once every
              RED below is resolved there, the Open Centre workflow becomes
              available again.
            </div>
          </div>
        </div>

        <ul className="space-y-2">
          {blockingReds.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-destructive/30 bg-background/40 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                  RED
                </span>
                <ClientTime iso={r.created_at} className="text-xs text-muted-foreground" />
              </div>
              <div className="mt-1 font-medium">{r.issue_description}</div>
              {r.workaround_plan ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Workaround: {r.workaround_plan}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <Button asChild size="sm">
          <Link to="/governance">
            Open Governance Hub
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
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

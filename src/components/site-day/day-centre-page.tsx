import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SITE_SESSION_QUERY_KEY, useSiteSession } from "@/hooks/use-site-session";
import { useSiteIssues } from "@/hooks/use-site-issues";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import { ensureTodaySession } from "@/lib/api/site-day-sessions";
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

  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["site-day", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    enabled: isReady && !!user,
    staleTime: 60_000,
  });
  const isManager = permissionQ.data === true;

  // One-shot bootstrap: if no row exists for today, provision exactly one
  // so every child component reads the same session_id.
  const bootstrappedRef = useRef(false);
  const bootstrapMut = useMutation({
    mutationFn: () => ensureTodaySession(),
    onSuccess: (row) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, row);
      queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
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

  const [managerModalOpen, setManagerModalOpen] = useState(true);

  console.log("Current Session State:", {
    session: sessionQ.data,
    isLoading: sessionQ.isLoading,
    bootstrapPending: bootstrapMut.isPending,
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
          <div className="space-y-1">
            <div className="font-medium">
              Could not load the Day Centre session.
            </div>
            <div className="text-xs">
              {err?.message ?? "Session row unavailable."}
            </div>
            <div className="text-xs">
              If the error mentions a missing table or column, an admin must
              apply the site-day schema migration.
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading today's session…
      </div>
    );
  }

  const redIssue =
    (issuesQ.data ?? []).find(
      (i) => i.severity === "red" && i.status !== "resolved",
    ) ?? null;

  const renderPhase = () => {
    switch (session.phase) {
      case "open_pending":
        return (
          <StartOfDayPanel
            sessionId={session.id}
            reportedBy={user?.id ?? ""}
          />
        );
      case "escalated_lock":
        return (
          <div className="space-y-4">
            <EscalationLockBanner session={session} />
            <EscalationResolutionPanel session={session} redIssue={redIssue} />
          </div>
        );
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

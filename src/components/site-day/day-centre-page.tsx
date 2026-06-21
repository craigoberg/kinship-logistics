import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useSiteSession } from "@/hooks/use-site-session";
import { useSiteIssues } from "@/hooks/use-site-issues";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import { StartOfDayPanel } from "./start-of-day-panel";
import { ActiveDayPanel } from "./active-day-panel";
import { EscalationLockBanner } from "./escalation-lock-banner";
import { SiteLeaderHandshakePanel } from "./site-leader-handshake-panel";
import { SiteManagerHandshakeModal } from "./site-manager-handshake-modal";
import { DayClosedPanel } from "./day-closed-panel";

export function DayCentrePage() {
  const sessionQ = useSiteSession();
  const session = sessionQ.data ?? null;
  const issuesQ = useSiteIssues(session?.id ?? null);

  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["site-day", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const isManager = permissionQ.data === true;

  // When escalated, render Manager modal automatically for managers.
  const [managerModalOpen, setManagerModalOpen] = useState(true);

  if (sessionQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading today's session…
      </div>
    );
  }

  if (sessionQ.isError || !session) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div className="font-medium">
              Could not load the Day Centre session.
            </div>
            <div className="text-xs">
              {(sessionQ.error as Error | undefined)?.message ??
                "Session row unavailable."}
            </div>
            <div className="text-xs">
              If this is the first time the page loads after migration, refresh
              once. If the error mentions a missing table or column, an admin
              must apply the site-day schema migration.
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const redIssue =
    (issuesQ.data ?? []).find((i) => i.severity === "red" && i.status !== "resolved") ??
    null;

  return (
    <div className="space-y-6">
      {/* Phase-branched primary content */}
      {session.phase === "open_pending" && (
        <StartOfDayPanel sessionId={session.id} />
      )}

      {session.phase === "escalated_lock" && (
        <div className="space-y-4">
          <EscalationLockBanner session={session} />
          <SiteLeaderHandshakePanel session={session} />
          {/* Manager-side modal pops automatically once for a manager. */}
          {isManager && (
            <SiteManagerHandshakeModal
              open={managerModalOpen}
              onOpenChange={setManagerModalOpen}
              session={session}
              context={{
                kind: "site_session",
                sessionId: session.id,
                issue: redIssue,
              }}
            />
          )}
        </div>
      )}

      {session.phase === "active_day" && <ActiveDayPanel session={session} />}

      {(session.phase === "closed_orderly" ||
        session.phase === "closed_no_go") && (
        <DayClosedPanel session={session} />
      )}
    </div>
  );
}

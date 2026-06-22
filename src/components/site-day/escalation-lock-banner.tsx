import { ShieldAlert } from "lucide-react";
import { ClientTime } from "@/components/ui/client-time";
import { ElapsedTimer } from "@/components/ui/elapsed-timer";
import type { SiteDaySession } from "@/lib/api/site-day-sessions";
import type { OperationalEscalation } from "@/lib/data-store";
import type { SiteIssue } from "@/lib/api/site-issues";

interface Props {
  session: SiteDaySession;
  escalation?: OperationalEscalation | null;
  redIssue?: SiteIssue | null;
}

export function EscalationLockBanner({ session, escalation, redIssue }: Props) {
  // Timer source-of-truth:
  //   - "Waiting for Manager" runs from escalation.createdAt while the
  //     escalation is still pending (no claim yet).
  //   - Once a workaround has been accepted on the issue row, we show two
  //     counters: time on the workaround + total time the issue has been open.
  const waiting =
    !!escalation && escalation.status === "pending" && !redIssue?.workaroundAcceptedAt;
  const onWorkaround = !!redIssue?.workaroundAcceptedAt;

  return (
    <div className="flex items-start gap-3 rounded-lg border-2 border-red-600/60 bg-red-600/10 p-4 text-red-700 dark:text-red-300">
      <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-base font-bold uppercase tracking-wide">
            Site Locked — Unresolved Red issue
          </div>
          {waiting && (
            <ElapsedTimer
              since={escalation!.createdAt}
              label="Waiting for Manager"
            />
          )}
        </div>

        {onWorkaround && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-red-600/30 bg-red-600/5 px-2 py-1">
            <ElapsedTimer
              since={redIssue!.workaroundAcceptedAt}
              label="Workaround active"
            />
            <ElapsedTimer
              since={redIssue!.createdAt}
              label="Total open"
              className="opacity-80"
            />
          </div>
        )}

        <p className="text-sm">
          An unresolved Red issue is blocking the Day Centre. A Manager must
          clear it in the Governance Hub before the open-centre workflow can
          restart.
        </p>
        {session.openDeclaredAt && (
          <p className="text-xs opacity-80">
            Session opened <ClientTime iso={session.openDeclaredAt} />
          </p>
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { Building2, CheckCircle2, Info, Mail, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import { ElapsedTimer, formatElapsed } from "@/components/ui/elapsed-timer";
import { type SiteIssue } from "@/lib/api/site-issues";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";

interface Props {
  issue: SiteIssue;
}

const RYGE_MAP = new Map(RYGE_SEVERITY_CHIPS.map((c) => [c.value, c]));

const SEVERITY_LABEL: Record<SiteIssue["severity"], string> = {
  green: "NOTE",
  yellow: "YELLOW",
  red: "RED",
};

const SEVERITY_ICON: Record<SiteIssue["severity"], ReactNode> = {
  green: <Info className="h-3 w-3" />,
  yellow: null,
  red: null,
};

export function IssuesRegisterCard({ issue }: Props) {
  const sevCls = RYGE_MAP.get(issue.severity)?.activeClass ?? "bg-slate-600 text-white";
  const sevLabel = SEVERITY_LABEL[issue.severity];
  const sevIcon = SEVERITY_ICON[issue.severity];
  const isResolved = issue.status === "resolved";
  const isWorkaroundAccepted = issue.status === "workaround_accepted";

  return (
    <Card
      className={cn(
        "space-y-2 p-3",
        issue.severity === "red" && "border-red-600/40",
        issue.severity === "yellow" && "border-yellow-500/40",
        isResolved && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            sevCls,
          )}
        >
          {sevIcon}
          {sevLabel}
        </span>
        <span className="text-xs text-muted-foreground">
          Occurred <ClientTime iso={issue.occurredAt} />
          {issue.occurredAt !== issue.createdAt && (
            <>
              {" "}
              · Logged <ClientTime iso={issue.createdAt} />
            </>
          )}
        </span>
        {issue.owner === "council" && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Building2 className="h-3 w-3" /> Council
          </Badge>
        )}
        {issue.emailDispatchedToCouncil && (
          <Badge
            variant="outline"
            className="gap-1 border-green-600/60 text-[10px] text-green-700"
          >
            <Mail className="h-3 w-3" /> Council notified
          </Badge>
        )}
        {isResolved && (
          <Badge
            variant="outline"
            className="gap-1 border-green-600/60 text-[10px] text-green-700"
          >
            <CheckCircle2 className="h-3 w-3" /> Resolved
          </Badge>
        )}
        {isWorkaroundAccepted && (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-600/60 text-[10px] text-emerald-700"
          >
            <ShieldCheck className="h-3 w-3" /> Workaround accepted
          </Badge>
        )}
      </div>

      <div className="text-sm">{issue.issueDescription}</div>

      {issue.workaroundPlan && (
        <div className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
          <span className="font-semibold">Workaround:</span>{" "}
          {issue.workaroundPlan}
        </div>
      )}

      {/* Live timer while still open on a workaround */}
      {isWorkaroundAccepted && !isResolved && issue.workaroundAcceptedAt && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-emerald-700">
          <ElapsedTimer
            since={issue.workaroundAcceptedAt}
            label="Workaround active"
          />
          <ElapsedTimer
            since={issue.createdAt}
            label="Total open"
            className="opacity-70"
          />
        </div>
      )}

      {/* Frozen summary once resolved */}
      {isResolved && issue.resolvedAt && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold">Total time:</span>{" "}
            <span className="font-mono tabular-nums">
              {formatElapsed(
                new Date(issue.resolvedAt).getTime() -
                  new Date(issue.createdAt).getTime(),
              )}
            </span>
          </span>
          {issue.workaroundAcceptedAt && (
            <span>
              <span className="font-semibold">On workaround:</span>{" "}
              <span className="font-mono tabular-nums">
                {formatElapsed(
                  new Date(issue.resolvedAt).getTime() -
                    new Date(issue.workaroundAcceptedAt).getTime(),
                )}
              </span>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

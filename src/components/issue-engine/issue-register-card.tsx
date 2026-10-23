import type { ReactNode } from "react";
import { Building2, CheckCircle2, Info, Mail, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import { ElapsedTimer, formatElapsed } from "@/components/ui/elapsed-timer";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";

export type IssueRegisterSeverity = "red" | "yellow" | "green" | null;

/** One issue card for Day Centre and Manifest. Extra fields stay blank when a screen does not have them. */
export type IssueRegisterCardModel = {
  severity: IssueRegisterSeverity;
  occurredAt: string;
  loggedAt?: string | null;
  description: string;
  sourceLabel?: string | null;
  workaroundPlan?: string | null;
  councilOwned?: boolean;
  councilNotified?: boolean;
  resolved?: boolean;
  workaroundAccepted?: boolean;
  workaroundAcceptedAt?: string | null;
  resolvedAt?: string | null;
};

const RYGE_MAP = new Map(RYGE_SEVERITY_CHIPS.map((c) => [c.value, c]));

const SEVERITY_LABEL: Record<"green" | "yellow" | "red", string> = {
  green: "NOTE",
  yellow: "YELLOW",
  red: "RED",
};

const SEVERITY_ICON: Record<"green" | "yellow" | "red", ReactNode> = {
  green: <Info className="h-3 w-3" />,
  yellow: null,
  red: null,
};

export function IssueRegisterCard({ issue }: { issue: IssueRegisterCardModel }) {
  const severity = issue.severity;
  const sevCls = severity
    ? (RYGE_MAP.get(severity)?.activeClass ?? "bg-slate-600 text-white")
    : "bg-slate-600 text-white";
  const sevLabel = severity ? SEVERITY_LABEL[severity] : null;
  const sevIcon = severity ? SEVERITY_ICON[severity] : null;
  const isResolved = !!issue.resolved;
  const isWorkaroundAccepted = !!issue.workaroundAccepted;
  const loggedAt = issue.loggedAt ?? null;

  return (
    <Card
      className={cn(
        "space-y-2 p-3",
        severity === "red" && "border-red-600/40",
        severity === "yellow" && "border-yellow-500/40",
        isResolved && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {sevLabel && (
          <span
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
              sevCls,
            )}
          >
            {sevIcon}
            {sevLabel}
          </span>
        )}
        {issue.sourceLabel && (
          <Badge variant="outline" className="text-[10px]">
            {issue.sourceLabel}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          Occurred <ClientTime iso={issue.occurredAt} />
          {loggedAt && loggedAt !== issue.occurredAt && (
            <>
              {" "}
              · Logged <ClientTime iso={loggedAt} />
            </>
          )}
        </span>
        {issue.councilOwned && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Building2 className="h-3 w-3" /> Council
          </Badge>
        )}
        {issue.councilNotified && (
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

      <div className="text-sm">{issue.description}</div>

      {issue.workaroundPlan && (
        <div className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
          <span className="font-semibold">Workaround:</span>{" "}
          {issue.workaroundPlan}
        </div>
      )}

      {isWorkaroundAccepted && !isResolved && issue.workaroundAcceptedAt && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-emerald-700">
          <ElapsedTimer since={issue.workaroundAcceptedAt} label="Workaround active" />
          <ElapsedTimer since={issue.occurredAt} label="Total open" className="opacity-70" />
        </div>
      )}

      {isResolved && issue.resolvedAt && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold">Total time:</span>{" "}
            <span className="font-mono tabular-nums">
              {formatElapsed(
                new Date(issue.resolvedAt).getTime() - new Date(issue.occurredAt).getTime(),
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

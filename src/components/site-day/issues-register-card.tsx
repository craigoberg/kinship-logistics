import type { ReactNode } from "react";
import { Building2, CheckCircle2, Info, Mail, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import { type SiteIssue } from "@/lib/api/site-issues";

interface Props {
  issue: SiteIssue;
}

const SEVERITY_CHIP: Record<
  SiteIssue["severity"],
  { label: string; classes: string; icon: ReactNode | null }
> = {
  green: {
    label: "NOTE",
    classes: "bg-green-600 text-white",
    icon: <Info className="h-3 w-3" />,
  },
  yellow: {
    label: "YELLOW",
    classes: "bg-yellow-400 text-black",
    icon: null,
  },
  red: {
    label: "RED",
    classes: "bg-red-600 text-white",
    icon: null,
  },
};

export function IssuesRegisterCard({ issue }: Props) {
  const sev = SEVERITY_CHIP[issue.severity];
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
            sev.classes,
          )}
        >
          {sev.icon}
          {sev.label}
        </span>
        <span className="text-xs text-muted-foreground">
          <ClientTime iso={issue.createdAt} />
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
      </div>

      <div className="text-sm">{issue.issueDescription}</div>

      {issue.workaroundPlan && (
        <div className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
          <span className="font-semibold">Workaround:</span>{" "}
          {issue.workaroundPlan}
        </div>
      )}
    </Card>
  );
}

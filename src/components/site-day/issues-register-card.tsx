import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CheckCircle2, Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/client-time";
import {
  markResolved,
  type SiteIssue,
} from "@/lib/api/site-issues";
import { siteIssuesKey } from "@/hooks/use-site-issues";
import { RouteToCouncilModal } from "./route-to-council-modal";

interface Props {
  issue: SiteIssue;
  canManage: boolean;
}

const SEVERITY_CHIP: Record<
  SiteIssue["severity"],
  { label: string; classes: string }
> = {
  green: { label: "GREEN", classes: "bg-green-600 text-white" },
  yellow: { label: "YELLOW", classes: "bg-yellow-400 text-black" },
  red: { label: "RED", classes: "bg-red-600 text-white" },
};

export function IssuesRegisterCard({ issue, canManage }: Props) {
  const queryClient = useQueryClient();
  const [councilOpen, setCouncilOpen] = useState(false);
  const sev = SEVERITY_CHIP[issue.severity];

  const resolveMut = useMutation({
    mutationFn: () => markResolved(issue.id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: siteIssuesKey(issue.sessionId),
      });
      toast.success("Issue marked resolved.");
    },
    onError: (e: Error) =>
      toast.error("Could not resolve issue", { description: e.message }),
  });

  const isResolved = issue.status === "resolved";

  return (
    <>
      <Card
        className={cn(
          "space-y-2 p-3",
          issue.severity === "red" && "border-red-600/40",
          issue.severity === "yellow" && "border-yellow-500/40",
          isResolved && "opacity-60",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                sev.classes,
              )}
            >
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
        </div>

        <div className="text-sm">{issue.issueDescription}</div>
        {issue.workaroundPlan && (
          <div className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">
            <span className="font-semibold">Workaround:</span>{" "}
            {issue.workaroundPlan}
          </div>
        )}

        {canManage && !isResolved && (
          <div className="flex flex-wrap gap-2 pt-1">
            {!issue.emailDispatchedToCouncil && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCouncilOpen(true)}
                className="gap-1.5"
              >
                <Building2 className="h-3.5 w-3.5" />
                Route to Council Maintenance
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => resolveMut.mutate()}
              disabled={resolveMut.isPending}
            >
              {resolveMut.isPending ? "Resolving…" : "Mark resolved"}
            </Button>
          </div>
        )}
      </Card>

      <RouteToCouncilModal
        open={councilOpen}
        onOpenChange={setCouncilOpen}
        issue={issue}
      />
    </>
  );
}

/**
 * EventIssuesCard — compact active-issues list for an event day session (§12.6)
 *
 * Shows all issues (open + recent resolved) for `eventDaySessionId`.
 * Embedded in DaySessionsTab Config inner tab so coordinators see the live
 * RED/YELLOW register before taking action.
 *
 * Severity colour band mirrors ActiveIssuesRegister conventions.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import { listEventDayIssues, markResolved, type SiteIssue } from "@/lib/api/site-issues";

const issuesKey = (sessionId: string) => ["event-day-issues", sessionId] as const;

interface Props {
  eventDaySessionId: string;
}

export function EventIssuesCard({ eventDaySessionId }: Props) {
  const qc = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);

  const { data: issues = [], isLoading } = useQuery({
    queryKey: issuesKey(eventDaySessionId),
    queryFn: () => listEventDayIssues(eventDaySessionId),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const resolveMut = useMutation({
    mutationFn: (id: string) => markResolved(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuesKey(eventDaySessionId) });
      qc.invalidateQueries({ queryKey: ["governance-unified-issues"] });
      toast.success("Issue resolved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = issues.filter((i) => i.status === "open");
  const resolved = issues.filter((i) => i.status !== "open");

  const redCount = open.filter((i) => i.severity === "red").length;
  const yellowCount = open.filter((i) => i.severity === "yellow").length;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading issues…
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      {/* Header */}
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <ShieldAlert className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Active Issues Register</span>
        <div className="ml-auto flex gap-1.5">
          {redCount > 0 && (
            <Badge className="bg-destructive text-destructive-foreground h-5 text-[10px]">
              {redCount} RED
            </Badge>
          )}
          {yellowCount > 0 && (
            <Badge className="bg-yellow-400 text-black h-5 text-[10px]">
              {yellowCount} YELLOW
            </Badge>
          )}
          {open.length === 0 && (
            <Badge variant="secondary" className="h-5 text-[10px]">Clear</Badge>
          )}
        </div>
      </div>

      {/* Open issues */}
      {open.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          No open issues for this day session.
        </div>
      ) : (
        <div className="divide-y">
          {open.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onResolve={() => resolveMut.mutate(issue.id)}
              resolving={resolveMut.isPending && resolveMut.variables === issue.id}
            />
          ))}
        </div>
      )}

      {/* Resolved toggle */}
      {resolved.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/30"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved issue{resolved.length > 1 ? "s" : ""}
          </button>
          {showResolved && (
            <div className="divide-y border-t">
              {resolved.map((issue) => (
                <IssueRow key={issue.id} issue={issue} resolved />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: SiteIssue;
  onResolve?: () => void;
  resolving?: boolean;
  resolved?: boolean;
}

const SEV_CLASSES: Record<string, string> = {
  red: "border-l-4 border-l-destructive bg-destructive/5",
  yellow: "border-l-4 border-l-yellow-400 bg-yellow-400/5",
  green: "border-l-4 border-l-emerald-500 bg-emerald-500/5",
};

function IssueRow({ issue, onResolve, resolving, resolved }: IssueRowProps) {
  const [expanded, setExpanded] = useState(false);
  const sevClass = SEV_CLASSES[issue.severity] ?? "";

  return (
    <div className={cn("px-3 py-2.5", sevClass, resolved && "opacity-60")}>
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            issue.severity === "red" ? "text-destructive" : issue.severity === "yellow" ? "text-yellow-600" : "text-emerald-600",
          )}
        />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-xs font-medium",
              !expanded && "line-clamp-2 cursor-pointer",
            )}
            onClick={() => setExpanded((v) => !v)}
          >
            {issue.issueDescription}
          </p>
          {issue.workaroundPlan && expanded && (
            <p className="mt-1 text-xs text-muted-foreground">
              Workaround: {issue.workaroundPlan}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <ClientTime iso={issue.createdAt} />
            <span className="uppercase tracking-wide">{issue.severity}</span>
            {resolved && <span className="text-emerald-600 font-semibold">Resolved</span>}
          </div>
        </div>
        {!resolved && onResolve && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-[10px]"
            disabled={resolving}
            onClick={onResolve}
          >
            {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Resolve"}
          </Button>
        )}
      </div>
    </div>
  );
}

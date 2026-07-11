/**
 * EventIssuesCard — RYGE issues log for an event day session (§12.6)
 *
 * All issues (Green / Yellow / Red — open and resolved) are always visible.
 * Each row shows its status clearly so the coordinator has a complete record
 * of what happened during that day.
 *
 * RED blocking           → Resolve button (must be cleared)
 * RED verbal workaround  → "Operating via verbal workaround" tag, no Resolve here (Hub closes it)
 * YELLOW                 → Resolve button available
 * GREEN                  → Informational note, no Resolve needed
 * Resolved               → Shown with dimmed styling + Resolved tag
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Phone,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import { listEventDayIssues, markResolved, sortByRygeNewestFirst, type SiteIssue } from "@/lib/api/site-issues";
import {
  isVerbalWorkaroundDescription,
  redHasAcceptedWorkaround,
} from "@/lib/site-day/red-workaround";

export const issuesKey = (sessionId: string) => ["event-day-issues", sessionId] as const;
export const eventIssuesKey = (eventId: string) => ["event-all-issues", eventId] as const;

interface Props {
  eventId: string;
  eventDaySessionId: string;
}

export function EventIssuesCard({ eventId: _eventId, eventDaySessionId }: Props) {
  const qc = useQueryClient();

  // Uses listEventDayIssues which calls .in() — confirmed to work (§13.9 sort applied below).
  const { data: rawIssues = [], isLoading } = useQuery({
    queryKey: issuesKey(eventDaySessionId),
    queryFn: () => listEventDayIssues(eventDaySessionId),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  // Trip Days: newest first within each RYG group so the latest log surfaces immediately (§13.9)
  const issues = sortByRygeNewestFirst(rawIssues);

  const resolveMut = useMutation({
    mutationFn: (id: string) => markResolved(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuesKey(eventDaySessionId) });
      qc.invalidateQueries({ queryKey: ["event-day-issues-red-check", eventDaySessionId] });
      qc.invalidateQueries({ queryKey: ["governance-unified-issues"] });
      toast.success("Issue resolved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasVerbalWorkaround = (issue: SiteIssue) =>
    redHasAcceptedWorkaround({
      id: issue.id,
      status: issue.status,
      workaroundPlan: issue.workaroundPlan,
      issueDescription: issue.issueDescription,
      workaroundAcceptedAt: issue.workaroundAcceptedAt,
    }) || isVerbalWorkaroundDescription(issue.issueDescription);

  // Counts for the header badges — only blocking issues count as "RED"
  const openIssues = issues.filter((i) => i.status === "open");
  const blockingRed = openIssues.filter(
    (i) => i.severity === "red" && !hasVerbalWorkaround(i),
  ).length;
  const workaroundRed = openIssues.filter(
    (i) => i.severity === "red" && hasVerbalWorkaround(i),
  ).length;
  const openYellow = openIssues.filter((i) => i.severity === "yellow").length;
  const openGreen = openIssues.filter((i) => i.severity === "green").length;

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
        <div className="ml-auto flex flex-wrap gap-1.5">
          {blockingRed > 0 && (
            <Badge className="bg-destructive text-destructive-foreground h-5 text-[10px]">
              {blockingRed} RED
            </Badge>
          )}
          {workaroundRed > 0 && (
            <Badge className="bg-amber-600 text-white h-5 text-[10px]">
              {workaroundRed} RED — verbal workaround
            </Badge>
          )}
          {openYellow > 0 && (
            <Badge className="bg-yellow-400 text-black h-5 text-[10px]">
              {openYellow} YELLOW
            </Badge>
          )}
          {openGreen > 0 && (
            <Badge className="bg-emerald-600 text-white h-5 text-[10px]">
              {openGreen} GREEN
            </Badge>
          )}
          {issues.length === 0 && (
            <Badge variant="secondary" className="h-5 text-[10px]">No issues logged</Badge>
          )}
        </div>
      </div>

      {/* All issues — always visible */}
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          No issues logged for this day session.
        </div>
      ) : (
        <div className="divide-y">
          {issues.map((issue) => {
            const verbal = hasVerbalWorkaround(issue);
            const isResolved = issue.status !== "open";
            const canResolve =
              !isResolved &&
              issue.severity !== "green" &&
              !(issue.severity === "red" && verbal);

            return (
              <IssueRow
                key={issue.id}
                issue={issue}
                verbalWorkaround={verbal}
                resolved={isResolved}
                onResolve={canResolve ? () => resolveMut.mutate(issue.id) : undefined}
                resolving={resolveMut.isPending && resolveMut.variables === issue.id}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Issue row ────────────────────────────────────────────────────────────────

interface IssueRowProps {
  issue: SiteIssue;
  verbalWorkaround?: boolean;
  onResolve?: () => void;
  resolving?: boolean;
  resolved?: boolean;
}

const SEV_CLASSES: Record<string, string> = {
  red: "border-l-4 border-l-destructive bg-destructive/5",
  yellow: "border-l-4 border-l-yellow-400 bg-yellow-400/5",
  green: "border-l-4 border-l-emerald-500 bg-emerald-500/5",
};

const SEV_ICON_CLASS: Record<string, string> = {
  red: "text-destructive",
  yellow: "text-yellow-600",
  green: "text-emerald-600",
};

function SevIcon({ severity, className }: { severity: string; className?: string }) {
  if (severity === "green")
    return <Info className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600", className)} />;
  return (
    <AlertTriangle
      className={cn(
        "mt-0.5 h-3.5 w-3.5 shrink-0",
        SEV_ICON_CLASS[severity] ?? "text-muted-foreground",
        className,
      )}
    />
  );
}

function IssueRow({ issue, verbalWorkaround, onResolve, resolving, resolved }: IssueRowProps) {
  const [expanded, setExpanded] = useState(false);
  const sevClass = SEV_CLASSES[issue.severity] ?? "";

  return (
    <div className={cn("px-3 py-2.5", sevClass, resolved && "opacity-60")}>
      <div className="flex items-start gap-2">
        {verbalWorkaround && !resolved ? (
          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        ) : (
          <SevIcon severity={issue.severity} />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={cn("text-xs font-medium", !expanded && "line-clamp-2 cursor-pointer")}
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
            <span className="uppercase tracking-wide font-semibold">{issue.severity}</span>
            {verbalWorkaround && !resolved && (
              <span className="font-semibold text-amber-700">Verbal workaround — pending Hub close-out</span>
            )}
            {issue.severity === "yellow" && issue.workaroundPlan && !resolved && (
              <span className="font-semibold text-yellow-700">Workaround in place</span>
            )}
            {resolved && <span className="text-emerald-600 font-semibold">Resolved</span>}
          </div>
        </div>
        {onResolve && (
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

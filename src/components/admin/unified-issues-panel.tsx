import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { HubListCard } from "@/components/governance/hub-list-card";
import { HubListCardBody } from "@/components/governance/hub-list-card-body";
import { HubListMetaRows } from "@/components/governance/hub-context-meta-grid";
import { unifiedIssueBodyLines } from "@/lib/governance/hub-unified-issue-body";
import { hubIssueContextMeta } from "@/lib/governance/hub-issue-context";
import {
  computeHubUrgency,
  deriveIssueWorkflowStatus,
  HUB_WORKFLOW_STATUS_BADGE,
  HUB_WORKFLOW_STATUS_LABEL,
  issueDeferredUntil,
  type HubWorkflowStatus,
} from "@/lib/governance/hub-workflow-status";
import { useIssueUrgencyParams } from "@/hooks/use-system-parameters";
import { fetchHubReviewStartedKeySet } from "@/lib/api/unified-issues";
import { useUnifiedIssues, unifiedIssuesKey } from "@/hooks/use-unified-issues";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type {
  UnifiedIssue,
  UnifiedIssueSource,
  UnifiedIssueTab,
  UnifiedSeverity,
} from "@/lib/api/unified-issues";
import { ManageIssueDialog } from "./resolve-issue-dialog";
import { sortUnifiedIssuesByRygeThenExpiry } from "@/lib/governance-sort";

interface Props {
  onManageRenewal?: (assetId: string) => void;
}

const CATEGORY_OPTIONS: Array<{ value: UnifiedIssueSource | "all"; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "day_centre", label: "Day Centre" },
  { value: "event", label: "Trip Day" },
  { value: "incident", label: "Incident" },
  { value: "escalation", label: "Escalation" },
];

const CATEGORY_BADGE: Record<UnifiedIssueSource, string> = {
  day_centre: "bg-sky-600 text-white",
  event: "bg-teal-600 text-white",
  incident: "bg-orange-600 text-white",
  escalation: "bg-destructive text-destructive-foreground",
  renewal: "bg-violet-600 text-white",
};

function issueUpdatedAt(issue: UnifiedIssue): string {
  const raw = (issue.raw ?? {}) as Record<string, unknown>;
  return String(raw.updated_at ?? raw.created_at ?? issue.createdAt);
}

function severityBadge(sev: UnifiedSeverity) {
  if (sev === "red")
    return <Badge className="bg-red-600 text-white">RED</Badge>;
  if (sev === "yellow")
    return <Badge className="bg-yellow-400 text-black">YELLOW</Badge>;
  if (sev === "green")
    return <Badge className="bg-green-600 text-white">GREEN</Badge>;
  return null;
}

function openIssue(
  issue: UnifiedIssue,
  onManage: (i: UnifiedIssue, workflow: HubWorkflowStatus) => void,
  reviewStartedKeys: ReadonlySet<string>,
  onManageRenewal?: (assetId: string) => void,
) {
  if (issue.source === "renewal") {
    onManageRenewal?.(issue.sourceRowId);
    return;
  }
  onManage(issue, deriveIssueWorkflowStatus(issue, reviewStartedKeys));
}

function IssuesList({
  tab,
  onManage,
  onManageRenewal,
}: {
  tab: UnifiedIssueTab;
  onManage: (i: UnifiedIssue, workflow: HubWorkflowStatus) => void;
  onManageRenewal?: (assetId: string) => void;
}) {
  const q = useUnifiedIssues(tab);
  const urgencyParams = useIssueUrgencyParams();
  const reviewKeysQ = useQuery({
    queryKey: ["hub-review-started-keys"],
    queryFn: fetchHubReviewStartedKeySet,
    staleTime: 30_000,
  });
  const reviewStartedKeys = reviewKeysQ.data ?? new Set<string>();
  const [categoryFilter, setCategoryFilter] = useState<UnifiedIssueSource | "all">(
    "all",
  );
  const [severityFilter, setSeverityFilter] = useState<
    "all" | "red" | "yellow" | "green"
  >("all");
  const [search, setSearch] = useState("");

  const all = q.data ?? [];
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = all.filter((i) => {
      if (categoryFilter !== "all" && i.source !== categoryFilter) return false;
      if (severityFilter !== "all" && i.severity !== severityFilter) return false;
      if (needle) {
        const hay = `${i.title} ${i.description} ${i.category} ${i.subCategory ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return sortUnifiedIssuesByRygeThenExpiry(filtered);
  }, [all, categoryFilter, severityFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {
            {
              active:
                "Open issues and accepted workarounds still in play. Tap a card to manage. Deferred items stay hidden until their deadline is close.",
              deferred:
                "Items parked until a future date, or awaiting Council. They return to Active automatically when the deadline is near.",
              resolved: "Resolved issue history. Tap a card to review the timeline.",
            }[tab]
          }
        </p>
        <div className="flex items-center gap-2">
          {q.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Badge variant="secondary">
            {visible.length}{" "}
            {tab === "active" ? "open" : tab === "deferred" ? "deferred" : "resolved"}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as UnifiedIssueSource | "all")}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Severity</Label>
          <Select
            value={severityFilter}
            onValueChange={(v) =>
              setSeverityFilter(v as "all" | "red" | "yellow" | "green")
            }
          >
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="red">Red</SelectItem>
              <SelectItem value="yellow">Yellow</SelectItem>
              <SelectItem value="green">Green</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            className="h-8"
            placeholder="Search title, description, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {q.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <div className="font-medium">Could not load unified issues.</div>
              <div className="text-xs">{(q.error as Error).message}</div>
            </div>
          </div>
        </Card>
      )}

      {q.isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          {
            {
              active:
                "No open issues need attention right now. Check the Deferred tab for parked items.",
              deferred: "Nothing deferred right now.",
              resolved: "No resolved issues in history yet.",
            }[tab]
          }
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((i) => {
            const { location, reporter } = hubIssueContextMeta(i);
            const updatedAt = issueUpdatedAt(i);
            const workflow = deriveIssueWorkflowStatus(i, reviewStartedKeys);
            const deferredUntil = issueDeferredUntil(i);
            const bodyLines = unifiedIssueBodyLines(i);
            const nowMs = Date.now();
            const urgency = tab === "resolved" ? "none" : computeHubUrgency({
              nowMs,
              createdAtMs: new Date(i.createdAt).getTime(),
              lastActivityMs: i.lastActivityAt ? new Date(i.lastActivityAt).getTime() : null,
              deferredUntilMs: i.deferredUntil ? new Date(i.deferredUntil).getTime() : null,
              params: urgencyParams,
            });

            return (
              <HubListCard
                key={i.key}
                ariaLabel={`Manage ${bodyLines.issue}`}
                summary={bodyLines.issue}
                body={
                  <HubListCardBody lines={bodyLines} severity={i.severity} />
                }
                onClick={() => openIssue(i, onManage, reviewStartedKeys, onManageRenewal)}
                badges={
                  <>
                    {severityBadge(i.severity)}
                    <Badge className={CATEGORY_BADGE[i.source]}>
                      {i.sourceLabel}
                    </Badge>
                  </>
                }
                status={
                  <Badge className={HUB_WORKFLOW_STATUS_BADGE[workflow]}>
                    {HUB_WORKFLOW_STATUS_LABEL[workflow]}
                  </Badge>
                }
                urgency={urgency}
                meta={
                  <HubListMetaRows
                    rows={[
                      ...(deferredUntil && workflow === "deferred"
                        ? [{ label: "Deferred to", value: deferredUntil }]
                        : []),
                      { label: "Location", value: location },
                      { label: "Reported by", value: reporter ?? "Unknown staff" },
                      {
                        label: "Logged",
                        value: <FormattedDateTime value={i.createdAt} />,
                      },
                      {
                        label: "Updated",
                        value: <FormattedDateTime value={updatedAt} />,
                      },
                    ]}
                  />
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function UnifiedIssuesPanel({ onManageRenewal }: Props) {
  const [managing, setManaging] = useState<UnifiedIssue | null>(null);
  const [managingWorkflow, setManagingWorkflow] = useState<HubWorkflowStatus>("open");
  const [tab, setTab] = useState<UnifiedIssueTab>("active");

  useRealtimeInvalidate({
    table: "site_issues_register",
    queryKeys: [unifiedIssuesKey],
  });
  useRealtimeInvalidate({
    table: "operational_escalations",
    queryKeys: [unifiedIssuesKey],
  });
  useRealtimeInvalidate({
    table: "operational_incidents",
    queryKeys: [unifiedIssuesKey],
  });
  useRealtimeInvalidate({
    table: "hub_issue_notes",
    queryKeys: [unifiedIssuesKey],
  });

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as UnifiedIssueTab)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="deferred">Deferred</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <IssuesList
            tab="active"
            onManage={(issue, workflow) => {
              setManaging(issue);
              setManagingWorkflow(workflow);
            }}
            onManageRenewal={onManageRenewal}
          />
        </TabsContent>
        <TabsContent value="deferred" className="mt-4">
          <IssuesList
            tab="deferred"
            onManage={(issue, workflow) => {
              setManaging(issue);
              setManagingWorkflow(workflow);
            }}
            onManageRenewal={onManageRenewal}
          />
        </TabsContent>
        <TabsContent value="resolved" className="mt-4">
          <IssuesList
            tab="resolved"
            onManage={(issue, workflow) => {
              setManaging(issue);
              setManagingWorkflow(workflow);
            }}
            onManageRenewal={onManageRenewal}
          />
        </TabsContent>
      </Tabs>

      {managing && (
        <ManageIssueDialog
          key={managing.key}
          issue={managing}
          autoStartReview={managingWorkflow === "open"}
          open
          onOpenChange={(o) => {
            if (!o) setManaging(null);
          }}
        />
      )}
    </div>
  );
}

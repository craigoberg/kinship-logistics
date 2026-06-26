import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { useUnifiedIssues, unifiedIssuesKey } from "@/hooks/use-unified-issues";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type {
  UnifiedIssue,
  UnifiedIssueSource,
  UnifiedIssueTab,
  UnifiedSeverity,
} from "@/lib/api/unified-issues";
import { ManageIssueDialog } from "./resolve-issue-dialog";

interface Props {
  onManageRenewal?: (assetId: string) => void;
}

const SOURCE_OPTIONS: Array<{ value: UnifiedIssueSource | "all"; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "day_centre", label: "Day Centre" },
  { value: "incident", label: "Incident" },
  { value: "escalation", label: "Escalation" },
];

const SOURCE_BADGE: Record<UnifiedIssueSource, string> = {
  day_centre: "bg-sky-600 text-white",
  incident: "bg-orange-600 text-white",
  escalation: "bg-destructive text-destructive-foreground",
  renewal: "bg-violet-600 text-white",
};

function severityBadge(sev: UnifiedSeverity) {
  if (sev === "red")
    return <Badge className="bg-destructive text-destructive-foreground">RED</Badge>;
  if (sev === "yellow")
    return <Badge className="bg-yellow-500 text-black">YELLOW</Badge>;
  if (sev === "green")
    return <Badge className="bg-emerald-600 text-white">GREEN</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function IssuesTable({
  tab,
  onManage,
  onManageRenewal,
}: {
  tab: UnifiedIssueTab;
  onManage: (i: UnifiedIssue) => void;
  onManageRenewal?: (assetId: string) => void;
}) {
  const q = useUnifiedIssues(tab);
  const [sourceFilter, setSourceFilter] = useState<UnifiedIssueSource | "all">(
    "all",
  );
  const [severityFilter, setSeverityFilter] = useState<
    "all" | "red" | "yellow" | "green"
  >("all");
  const [search, setSearch] = useState("");

  const all = q.data ?? [];
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((i) => {
      if (sourceFilter !== "all" && i.source !== sourceFilter) return false;
      if (severityFilter !== "all" && i.severity !== severityFilter) return false;
      if (needle) {
        const hay = `${i.title} ${i.description} ${i.category} ${i.subCategory ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [all, sourceFilter, severityFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {tab === "active"
            ? "Central queue for every open operational issue — walkthrough anomalies, incidents, gate escalations, and overdue renewals."
            : "Issues currently parked: deferred for a future action or awaiting a Council response."}
        </p>
        <div className="flex items-center gap-2">
          {q.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Badge variant="secondary">
            {all.length} {tab === "active" ? "open" : "awaiting"}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Source</Label>
          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v as UnifiedIssueSource | "all")}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
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
        <div className="space-y-1 flex-1 min-w-[12rem]">
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

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead className="w-[160px] whitespace-nowrap">Created</TableHead>
              <TableHead className="w-28 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-3">
                  Loading…
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-3">
                  {tab === "active"
                    ? "No open issues match the current filters."
                    : "Nothing deferred or awaiting Council."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((i) => (
                <TableRow key={i.key}>
                  <TableCell className="py-3">
                    <Badge className={SOURCE_BADGE[i.source]}>{i.sourceLabel}</Badge>
                  </TableCell>
                  <TableCell className="py-3">{severityBadge(i.severity)}</TableCell>
                  <TableCell className="max-w-[28rem] py-3">
                    <div className="font-medium truncate">{i.title}</div>
                    {i.source === "escalation" && (() => {
                      const r = i.raw as {
                        id?: string;
                        claimed_by?: string | null;
                        operator_acknowledged_at?: string | null;
                      };
                      return (
                        <div className="mt-1 font-mono text-[10px] text-amber-700 dark:text-amber-300">
                          ESC {String(r.id ?? "").slice(0, 8)} · {i.status}
                          {r.claimed_by ? ` · claimed ${String(r.claimed_by).slice(0, 8)}` : " · unclaimed"}
                          {r.operator_acknowledged_at ? " · op-ack ✓" : ""}
                        </div>
                      );
                    })()}
                    {i.description && i.description !== i.title && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {i.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums py-3">
                    <ClientTime iso={i.createdAt} />
                  </TableCell>
                  <TableCell className="text-right py-3">
                    {i.source === "renewal" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onManageRenewal?.(i.sourceRowId)}
                      >
                        Manage
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => onManage(i)}>
                        Manage
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function UnifiedIssuesPanel({ onManageRenewal }: Props) {
  const [managing, setManaging] = useState<UnifiedIssue | null>(null);
  const [tab, setTab] = useState<UnifiedIssueTab>("active");

  // BMS-style live updates: silently invalidate the unified-issues feed when
  // any of the underlying Hub tables change. The 60s polling on the query
  // itself remains as a fallback if the socket drops.
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
          <TabsTrigger value="awaiting">Awaiting / Deferred</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <IssuesTable
            tab="active"
            onManage={setManaging}
            onManageRenewal={onManageRenewal}
          />
        </TabsContent>
        <TabsContent value="awaiting" className="mt-4">
          <IssuesTable
            tab="awaiting"
            onManage={setManaging}
            onManageRenewal={onManageRenewal}
          />
        </TabsContent>
      </Tabs>

      {managing && (
        <ManageIssueDialog
          // Stable key — guarantees React never recycles the dialog (and its
          // textarea state) across different issues mid-typing.
          key={managing.key}
          issue={managing}
          open
          onOpenChange={(o) => {
            if (!o) setManaging(null);
          }}
        />
      )}
    </div>
  );
}

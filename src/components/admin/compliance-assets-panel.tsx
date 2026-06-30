import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate, FormattedDateTime } from "@/components/ui/formatted-time";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { useComplianceWarningDays } from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  computeRyge,
  fetchComplianceDeferMap,
  isComplianceAssetLiveDeferred,
  listComplianceAssets,
  type ComplianceAsset,
  type ComplianceAssetTab,
  type Ryge,
} from "@/lib/api/compliance-assets";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { ManageComplianceAssetDialog } from "./manage-compliance-asset-dialog";
import { EditComplianceAssetModal } from "./edit-compliance-asset-modal";
import { compareRygeThenExpiry } from "@/lib/governance-sort";

export const COMPLIANCE_ASSETS_KEY = ["compliance-assets"] as const;

const CATEGORY_BADGE: Record<string, string> = {
  INSURANCE: "bg-sky-600 text-white",
  EQUIPMENT: "bg-orange-600 text-white",
  FACILITY: "bg-violet-600 text-white",
  VEHICLE: "bg-slate-600 text-white",
  STAFF: "bg-emerald-600 text-white",
};
const DEFAULT_CATEGORY_BADGE = "bg-muted text-foreground";

function rygeBadge(asset: ComplianceAsset, params: { default: number; shortCycle: number }) {
  const r = computeRyge(asset, params);
  if (r === "red") return <Badge className="bg-destructive text-destructive-foreground">RED</Badge>;
  if (r === "yellow") return <Badge className="bg-yellow-500 text-black">YELLOW</Badge>;
  return <Badge className="bg-emerald-600 text-white">GREEN</Badge>;
}

/** Expiry on Active; deferred follow-up date on Awaiting. */
function complianceAssetSortDate(
  asset: ComplianceAsset,
  tab: ComplianceAssetTab,
): string | null {
  if (tab === "awaiting" && asset.next_action_at) return asset.next_action_at;
  return asset.expiry_date;
}

function AssetsTable({
  tab,
  assets,
  deferMap,
  canManage,
  isLoading,
  isError,
  error,
  isFetching,
  onManage,
}: {
  tab: ComplianceAssetTab;
  assets: ComplianceAsset[];
  deferMap: Map<string, { deferredUntil: Date }>;
  canManage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  onManage: (a: ComplianceAsset) => void;
}) {
  const warningDays = useComplianceWarningDays();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [rygeFilter, setRygeFilter] = useState<"all" | Ryge>("all");
  const [search, setSearch] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(assets.map((a) => a.category))).sort(),
    [assets],
  );

  const tabbed = useMemo(() => {
    return assets.filter((a) => {
      const deferred = isComplianceAssetLiveDeferred(a.id, deferMap);
      return tab === "awaiting" ? deferred : !deferred;
    });
  }, [assets, deferMap, tab]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = tabbed.filter((a) => {
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (rygeFilter !== "all" && computeRyge(a, warningDays) !== rygeFilter) return false;
      if (needle) {
        const hay = `${a.name} ${a.description ?? ""} ${a.category} ${a.type}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) =>
      compareRygeThenExpiry(
        computeRyge(a, warningDays),
        complianceAssetSortDate(a, tab),
        computeRyge(b, warningDays),
        complianceAssetSortDate(b, tab),
      ),
    );
  }, [tabbed, categoryFilter, rygeFilter, search, warningDays, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {tab === "active"
            ? "Central registry of every expiring item that powers the dashboard. Adding a new category here lights up a new dashboard tile — no code change needed."
            : "Assets parked with a deferred next-action date. They stay off the active list until the follow-up date passes or a new timeline note clears the defer."}
        </p>
        <div className="flex items-center gap-2">
          {isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Badge variant="secondary">
            {tabbed.length} {tab === "active" ? "active" : "deferred"}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">RYGE</Label>
          <Select
            value={rygeFilter}
            onValueChange={(v) => setRygeFilter(v as "all" | Ryge)}
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
            placeholder="Search name, description, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <div className="font-medium">Could not load compliance assets.</div>
              <div className="text-xs">{(error as Error)?.message}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px] whitespace-nowrap">Category</TableHead>
              <TableHead>Asset</TableHead>
              <TableHead className="w-[100px]">RYGE</TableHead>
              <TableHead className="w-[110px] whitespace-nowrap">Expiry</TableHead>
              <TableHead className="w-[160px] whitespace-nowrap">Updated</TableHead>
              <TableHead className="w-28 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-3 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-3 text-center text-muted-foreground">
                  {tab === "active"
                    ? "No active assets match the current filters."
                    : "Nothing deferred right now."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((a) => {
                const defer = deferMap.get(a.id);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="w-[140px] whitespace-nowrap py-3">
                      <Badge
                        className={
                          CATEGORY_BADGE[a.category.toUpperCase()] ?? DEFAULT_CATEGORY_BADGE
                        }
                      >
                        {a.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[28rem] py-3">
                      <div className="truncate font-medium">{a.name}</div>
                      {a.description && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">
                          {a.description}
                        </div>
                      )}
                      {tab === "awaiting" && defer && (
                        <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          Deferred until{" "}
                          <FormattedDateTime value={defer.deferredUntil.toISOString()} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="w-[100px] py-3">
                      {rygeBadge(a, warningDays)}
                    </TableCell>
                    <TableCell className="w-[110px] whitespace-nowrap py-3 tabular-nums text-sm">
                      <FormattedDate value={a.expiry_date} />
                    </TableCell>
                    <TableCell className="w-[160px] whitespace-nowrap py-3 text-xs tabular-nums text-muted-foreground">
                      <FormattedDateTime value={a.updated_at} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      {canManage && (
                        <Button size="sm" onClick={() => onManage(a)}>
                          Manage
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface Props {
  /** When Open Issues routes a renewal here, open Manage for that asset id. */
  externalManageAssetId?: string | null;
  onExternalManageHandled?: () => void;
}

export function ComplianceAssetsPanel({
  externalManageAssetId,
  onExternalManageHandled,
}: Props) {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["governance-hub", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canManage = permissionQ.data === true;

  const [tab, setTab] = useState<ComplianceAssetTab>("active");
  const [managing, setManaging] = useState<ComplianceAsset | null>(null);
  const [editing, setEditing] = useState<ComplianceAsset | "new" | null>(null);
  const listQ = useQuery({
    queryKey: [...COMPLIANCE_ASSETS_KEY, "active"],
    queryFn: () => listComplianceAssets({ status: "active" }),
    staleTime: 30_000,
  });

  const deferQ = useQuery({
    queryKey: [...COMPLIANCE_ASSETS_KEY, "defer-map"],
    queryFn: fetchComplianceDeferMap,
    staleTime: 15_000,
  });

  const deferMap = deferQ.data ?? new Map();
  const assets = listQ.data ?? [];

  const deferredCount = useMemo(
    () => assets.filter((a) => isComplianceAssetLiveDeferred(a.id, deferMap)).length,
    [assets, deferMap],
  );

  useRealtimeInvalidate({
    table: "compliance_assets",
    queryKeys: [COMPLIANCE_ASSETS_KEY],
  });
  useRealtimeInvalidate({
    table: "hub_issue_notes",
    queryKeys: [COMPLIANCE_ASSETS_KEY],
  });

  // Open Issues → Manage renewal hand-off
  useEffect(() => {
    if (!externalManageAssetId) return;
    const asset = assets.find((a) => a.id === externalManageAssetId);
    if (asset) {
      setManaging(asset);
      onExternalManageHandled?.();
    }
  }, [externalManageAssetId, assets, onExternalManageHandled]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: COMPLIANCE_ASSETS_KEY });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!canManage && <Badge variant="secondary">Read-only · Managers can manage</Badge>}
        {canManage && tab === "active" && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" /> New asset
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ComplianceAssetTab)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="awaiting">
            Awaiting / Deferred
            {deferredCount > 0 && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-bold">
                {deferredCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <AssetsTable
            tab="active"
            assets={assets}
            deferMap={deferMap}
            canManage={canManage}
            isLoading={listQ.isLoading || deferQ.isLoading}
            isError={listQ.isError}
            error={listQ.error as Error | null}
            isFetching={listQ.isFetching}
            onManage={setManaging}
          />
        </TabsContent>

        <TabsContent value="awaiting" className="mt-4">
          <AssetsTable
            tab="awaiting"
            assets={assets}
            deferMap={deferMap}
            canManage={canManage}
            isLoading={listQ.isLoading || deferQ.isLoading}
            isError={listQ.isError}
            error={listQ.error as Error | null}
            isFetching={listQ.isFetching}
            onManage={setManaging}
          />
        </TabsContent>
      </Tabs>

      {managing && (
        <ManageComplianceAssetDialog
          key={managing.id}
          asset={managing}
          open
          onOpenChange={(o) => !o && setManaging(null)}
        />
      )}

      {editing && (
        <EditComplianceAssetModal
          asset={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

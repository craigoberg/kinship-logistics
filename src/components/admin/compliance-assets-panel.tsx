import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Loader2, Plus, X } from "lucide-react";
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
import {
  useComplianceDeferRewarnDays,
  useComplianceHubVisibilityDays,
  useComplianceWarningDays,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  computeRyge,
  fetchComplianceDeferMap,
  isComplianceAssetActionable,
  isComplianceAssetLiveDeferred,
  isComplianceAssetParked,
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
  const visibilityDays = useComplianceHubVisibilityDays();
  const deferRewarnDays = useComplianceDeferRewarnDays();

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [rygeFilter, setRygeFilter] = useState<"all" | Ryge>("all");
  const [search, setSearch] = useState("");
  // "Show all upcoming" toggle — reveals every active asset sorted by expiry.
  const [showAll, setShowAll] = useState(false);

  const categories = useMemo(
    () => Array.from(new Set(assets.map((a) => a.category))).sort(),
    [assets],
  );

  const hasSearch = search.trim().length > 0;

  // Split assets into tabs using the new actionable / parked helpers.
  // When a search term is active the visibility window is suspended so all
  // matching assets are findable — "search lifts the action filter".
  const tabbed = useMemo(() => {
    if (showAll || hasSearch) {
      // Show all assets sorted by expiry when browsing the schedule or
      // searching. The search path still applies the text filter below.
      return [...assets].sort((a, b) => {
        const da = a.expiry_date ?? "9999";
        const db = b.expiry_date ?? "9999";
        return da < db ? -1 : da > db ? 1 : 0;
      });
    }
    return assets.filter((a) => {
      if (tab === "awaiting") {
        return isComplianceAssetParked(a, deferMap, deferRewarnDays);
      }
      return isComplianceAssetActionable(a, deferMap, {
        warningDays,
        visibilityDays,
        deferRewarnDays,
      });
    });
  }, [assets, deferMap, tab, warningDays, visibilityDays, deferRewarnDays, showAll, hasSearch]);

  // Hidden count — items not shown on Active tab due to the visibility filter.
  // Not relevant when the search is suspending the filter.
  const hiddenCount = useMemo(() => {
    if (tab !== "active" || showAll || hasSearch) return 0;
    return assets.filter(
      (a) =>
        !isComplianceAssetActionable(a, deferMap, {
          warningDays,
          visibilityDays,
          deferRewarnDays,
        }) && !isComplianceAssetParked(a, deferMap, deferRewarnDays),
    ).length;
  }, [assets, deferMap, warningDays, visibilityDays, deferRewarnDays, tab, showAll, hasSearch]);

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

    if (showAll || hasSearch) {
      return filtered.sort((a, b) => {
        const da = a.expiry_date ?? "9999";
        const db = b.expiry_date ?? "9999";
        return da < db ? -1 : da > db ? 1 : 0;
      });
    }

    return filtered.sort((a, b) =>
      compareRygeThenExpiry(
        computeRyge(a, warningDays),
        complianceAssetSortDate(a, tab),
        computeRyge(b, warningDays),
        complianceAssetSortDate(b, tab),
      ),
    );
  }, [tabbed, categoryFilter, rygeFilter, search, warningDays, tab, showAll, hasSearch]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {hasSearch
            ? "Search is active — action filter suspended. All assets matching your search are shown regardless of expiry window."
            : showAll
              ? "All scheduled compliance assets — sorted by expiry date, soonest first. Green items that need no action today are included."
              : tab === "active"
                ? "Items needing attention: overdue, approaching expiry, or with a deferral deadline coming up. Green items far from expiry are hidden — no news is good news."
                : "Assets safely parked with a future deferral date. They return to the Active tab automatically when the deadline is near."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Badge variant="secondary">
            {tabbed.length} {hasSearch ? "matching" : showAll ? "total" : tab === "active" ? "need action" : "parked"}
          </Badge>
          {hiddenCount > 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              {hiddenCount} green hidden
            </Badge>
          )}
          {tab === "active" && (
            <button
              type="button"
              onClick={() => setShowAll((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                showAll
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {showAll ? (
                <>
                  <X className="h-3.5 w-3.5" />
                  Back to action view
                </>
              ) : (
                <>
                  <CalendarDays className="h-3.5 w-3.5" />
                  Show all upcoming
                </>
              )}
            </button>
          )}
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
          <Label className="text-xs text-muted-foreground">Severity</Label>
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
        <div className="space-y-1 flex-1 min-w-[12rem]">
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
              <TableHead className="w-[100px]">Severity</TableHead>
              <TableHead className="w-[140px] whitespace-nowrap">Category</TableHead>
              <TableHead>Asset</TableHead>
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
                  {hasSearch
                    ? "No assets match your search."
                    : tab === "active"
                      ? showAll
                        ? "No compliance assets found."
                        : "Nothing needs attention right now. Use \"Show all upcoming\" to see the full schedule."
                      : "Nothing parked right now."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((a) => {
                const defer = deferMap.get(a.id);
                const isDeferred = isComplianceAssetLiveDeferred(a.id, deferMap);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="w-[100px] py-3">
                      {rygeBadge(a, warningDays)}
                    </TableCell>
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
                      {isDeferred && defer && (
                        <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          Deferred until{" "}
                          <FormattedDateTime value={defer.deferredUntil.toISOString()} />
                          {tab === "active" && " · deadline approaching"}
                        </div>
                      )}
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

  const deferRewarnDays = useComplianceDeferRewarnDays();

  // Count assets that are safely parked (on the Deferred tab, not returning
  // to Active yet) so the tab badge stays accurate.
  const deferredCount = useMemo(
    () => assets.filter((a) => isComplianceAssetParked(a, deferMap, deferRewarnDays)).length,
    [assets, deferMap, deferRewarnDays],
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
      {!canManage && (
        <Badge variant="secondary">Read-only · Managers can manage</Badge>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as ComplianceAssetTab)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          {canManage && tab === "active" && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-4 w-4" /> New asset
            </Button>
          )}
        </div>

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

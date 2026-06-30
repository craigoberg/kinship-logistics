import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Search, Accessibility } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormattedDate } from "@/components/ui/formatted-time";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { getActiveUserProfile, isActiveUserManager, type TransportAsset } from "@/lib/data-store";
import { useTransportAssets } from "@/hooks/use-supabase-data";
import { FleetAssetFormSheet } from "./fleet-asset-form-sheet";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const expiry = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((expiry.getTime() - start.getTime()) / 86_400_000);
}

function regoRyge(expiry: string | null) {
  const d = daysUntil(expiry);
  if (d === null) return <Badge variant="secondary">—</Badge>;
  if (d <= 7) return <Badge className="bg-destructive text-destructive-foreground">RED</Badge>;
  if (d <= 30) return <Badge className="bg-yellow-500 text-black">YELLOW</Badge>;
  return <Badge className="bg-emerald-600 text-white">GREEN</Badge>;
}

export function FleetRegisterWorkspace() {
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["fleet-register", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isActiveUserManager() || permissionQ.data === true;

  const { data: assets = [], isLoading } = useTransportAssets();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [editing, setEditing] = useState<TransportAsset | "new" | null>(null);

  const visible = useMemo(() => {
    let rows = assets;
    if (statusFilter === "active") rows = rows.filter((a) => a.isActive);
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) =>
      [a.name, a.regoPlate, a.makeModel, a.vehicleCategory ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [assets, query, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Centre fleet register — buses and support vehicles. Rego and service dates sync to{" "}
            <Link to="/governance" className="font-medium text-primary underline-offset-2 hover:underline">
              Governance Hub
            </Link>{" "}
            compliance tiles.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Depot addresses and bus run names: Lookups → Day Centre Bus Runs.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" /> Add vehicle
          </Button>
        )}
      </div>

      {!canEdit && (
        <Badge variant="secondary">Read-only · Managers can edit</Badge>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, rego, model…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "all")}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead className="w-16 text-center">Seats</TableHead>
              <TableHead className="w-20 text-center">Access</TableHead>
              <TableHead className="w-24">Rego RYGE</TableHead>
              <TableHead className="w-28">Rego expiry</TableHead>
              <TableHead className="w-20">Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Loading fleet…
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No vehicles match this filter.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {a.regoPlate}
                      {a.makeModel ? ` · ${a.makeModel}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{a.passengerCapacity}</TableCell>
                  <TableCell className="text-center">
                    {a.hasWheelchairHoist ? (
                      <Accessibility className="mx-auto h-4 w-4 text-blue-500" aria-label="Hoist equipped" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{regoRyge(a.registrationExpiry)}</TableCell>
                  <TableCell className="tabular-nums text-sm">
                    <FormattedDate value={a.registrationExpiry} />
                  </TableCell>
                  <TableCell>
                    {a.isActive ? (
                      <Badge variant="outline" className="text-emerald-600">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <FleetAssetFormSheet
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          asset={editing === "new" ? null : editing}
        />
      )}
    </div>
  );
}

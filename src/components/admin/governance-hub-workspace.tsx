import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClientTime } from "@/components/ui/client-time";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { getActiveUserProfile, listStaffRegistry, verifyStaffPin, type StaffMember } from "@/lib/data-store";
import {
  ACTION_MODULES,
  archiveComplianceAsset,
  computeRyge,
  listComplianceAssets,
  upsertComplianceAsset,
  type ComplianceActionModule,
  type ComplianceAsset,
  type ComplianceStatus,
} from "@/lib/api/compliance-assets";

const COMPLIANCE_ASSETS_KEY = ["compliance-assets"] as const;

function rygeBadge(asset: ComplianceAsset) {
  const r = computeRyge(asset);
  if (r === "red") return <Badge className="bg-destructive text-destructive-foreground">RED</Badge>;
  if (r === "yellow") return <Badge className="bg-yellow-500 text-black">YELLOW</Badge>;
  return <Badge className="bg-emerald-600 text-white">GREEN</Badge>;
}

export function GovernanceHubWorkspace() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["governance-hub", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = permissionQ.data === true;

  const [statusFilter, setStatusFilter] = useState<ComplianceStatus>("active");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editing, setEditing] = useState<ComplianceAsset | "new" | null>(null);
  const [archiving, setArchiving] = useState<ComplianceAsset | null>(null);

  const listQ = useQuery({
    queryKey: [...COMPLIANCE_ASSETS_KEY, statusFilter],
    queryFn: () => listComplianceAssets({ status: statusFilter }),
    staleTime: 30_000,
  });

  const rows = listQ.data ?? [];
  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category))).sort(),
    [rows],
  );
  const visible = categoryFilter === "all" ? rows : rows.filter((r) => r.category === categoryFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Central registry of every expiring item that powers the dashboard. Adding a new category
          here lights up a new dashboard tile — no code change needed.
        </p>
        <div className="flex items-center gap-2">
          {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
          {canEdit && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-4 w-4" /> New asset
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ComplianceStatus)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Category / Type</TableHead>
              <TableHead>Action module</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>RYGE</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No assets.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    {a.description && (
                      <div className="text-xs text-muted-foreground">{a.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-mono">{a.category}</div>
                    <div className="text-muted-foreground">{a.type}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.action_module}</TableCell>
                  <TableCell className="text-sm tabular-nums">{a.expiry_date ?? "—"}</TableCell>
                  <TableCell>{rygeBadge(a)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <ClientTime iso={a.updated_at} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {a.status === "active" && (
                          <Button variant="ghost" size="sm" onClick={() => setArchiving(a)}>
                            <Archive className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <EditAssetModal
          asset={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: COMPLIANCE_ASSETS_KEY });
            setEditing(null);
          }}
        />
      )}

      {archiving && (
        <ArchiveAssetDialog
          asset={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => {
            qc.invalidateQueries({ queryKey: COMPLIANCE_ASSETS_KEY });
            setArchiving(null);
          }}
        />
      )}
    </div>
  );
}

function EditAssetModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: ComplianceAsset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !asset;
  const [category, setCategory] = useState(asset?.category ?? "");
  const [type, setType] = useState(asset?.type ?? "");
  const [name, setName] = useState(asset?.name ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [expiry, setExpiry] = useState(asset?.expiry_date ?? "");
  const [actionModule, setActionModule] = useState<ComplianceActionModule>(
    asset?.action_module ?? "generic_resolve",
  );
  const [yellowDays, setYellowDays] = useState<string>(
    String(asset?.config?.yellow_days ?? 30),
  );
  const [redDays, setRedDays] = useState<string>(String(asset?.config?.red_days ?? 7));
  const [handshake, setHandshake] = useState<"single" | "dual">(
    asset?.config?.handshake === "dual" ? "dual" : "single",
  );
  const [checklistCategory, setChecklistCategory] = useState<string>(
    (asset?.config?.checklist_category as string) ?? "",
  );
  const [justification, setJustification] = useState("");
  const [managerStaffId, setManagerStaffId] = useState<string>("");
  const [managerPin, setManagerPin] = useState("");

  // Taxonomy — fetch existing categories/types from the registry for type-ahead.
  const taxonomyQ = useQuery({
    queryKey: ["governance-hub", "taxonomy"],
    queryFn: () => listComplianceAssets({}),
    staleTime: 60_000,
  });
  const all = taxonomyQ.data ?? [];
  const categories = useMemo(
    () => Array.from(new Set(all.map((a) => a.category))).sort(),
    [all],
  );
  const typesByCategory = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const a of all) {
      (map[a.category] ??= new Set()).add(a.type);
    }
    const out: Record<string, string[]> = {};
    for (const k of Object.keys(map)) out[k] = Array.from(map[k]).sort();
    return out;
  }, [all]);

  const normCategory = category.trim().toUpperCase();
  const normType = type.trim();
  const isNewCategory = normCategory.length > 0 && !categories.includes(normCategory);
  const isNewType =
    normType.length > 0 && !(typesByCategory[normCategory] ?? []).includes(normType);
  const pinRequired = isNewCategory || isNewType;

  // Staff picker for PIN gate.
  const staffQ = useQuery({
    queryKey: ["governance-hub", "staff"],
    queryFn: () => listStaffRegistry(),
    enabled: pinRequired,
    staleTime: 60_000,
  });
  const staff: StaffMember[] = (staffQ.data ?? []).filter((s) => s.active);

  const mut = useMutation({
    mutationFn: async () => {
      const y = Number(yellowDays);
      const r = Number(redDays);
      if (!Number.isFinite(y) || !Number.isFinite(r)) {
        throw new Error("Yellow and Red thresholds must be numbers.");
      }
      if (r > y) throw new Error("Red threshold must be ≤ Yellow threshold.");

      let pinVerifiedBy: string | null = null;
      if (pinRequired) {
        if (!managerStaffId) throw new Error("Manager required to authorise new taxonomy.");
        if (!managerPin || managerPin.length < 4) throw new Error("Manager PIN required.");
        const ok = await verifyStaffPin(managerStaffId, managerPin);
        if (!ok) throw new Error("Invalid Manager PIN.");
        pinVerifiedBy = managerStaffId;
      }

      return upsertComplianceAsset(
        {
          id: asset?.id,
          category: normCategory,
          type: normType,
          name: name.trim(),
          description,
          expiry_date: expiry || null,
          action_module: actionModule,
          config: {
            yellow_days: y,
            red_days: r,
            handshake,
            checklist_category:
              actionModule === "formal_audit" ? checklistCategory || null : null,
            ...(pinVerifiedBy ? { taxonomy_pin_verified_by: pinVerifiedBy } : {}),
          },
        },
        justification,
      );
    },
    onSuccess: () => {
      toast.success(isNew ? "Compliance asset created" : "Compliance asset updated");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const descLen = description?.trim().length ?? 0;
  const justLen = justification.trim().length;
  const canSubmit =
    normCategory.length > 0 &&
    normType.length > 0 &&
    name.trim().length > 0 &&
    descLen >= 20 &&
    justLen >= 20 &&
    (!pinRequired || (managerStaffId.length > 0 && managerPin.length >= 4)) &&
    !mut.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New compliance asset" : asset?.name}</DialogTitle>
          <DialogDescription>
            Every change is appended to the operational ledger as an immutable receipt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-1">
            <Label>Category</Label>
            <Select
              value={isNewCategory || !category ? "__NEW__" : normCategory}
              onValueChange={(v) => {
                if (v === "__NEW__") {
                  setCategory("");
                } else {
                  setCategory(v);
                  // Reset type when category changes so the dropdown options refresh.
                  if (!(typesByCategory[v] ?? []).includes(type)) setType("");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value="__NEW__">+ Add new category…</SelectItem>
              </SelectContent>
            </Select>
            {isNewCategory || !categories.includes(normCategory) ? (
              <Input
                className="mt-1"
                placeholder="New category (e.g. INSURANCE)"
                value={category}
                onChange={(e) => setCategory(e.target.value.toUpperCase())}
              />
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={isNewType || !type ? "__NEW__" : normType}
              onValueChange={(v) => {
                if (v === "__NEW__") setType("");
                else setType(v);
              }}
              disabled={!normCategory}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={normCategory ? "Select type…" : "Pick category first"}
                />
              </SelectTrigger>
              <SelectContent>
                {(typesByCategory[normCategory] ?? []).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
                <SelectItem value="__NEW__">+ Add new type…</SelectItem>
              </SelectContent>
            </Select>
            {normCategory && (isNewType || !(typesByCategory[normCategory] ?? []).includes(normType)) ? (
              <Input
                className="mt-1"
                placeholder="New type (e.g. rego / policy)"
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            ) : null}
          </div>

          {pinRequired && (
            <div className="sm:col-span-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2">
              <div className="text-xs font-medium text-yellow-700 dark:text-yellow-300">
                You are creating a new {isNewCategory ? "Category" : ""}
                {isNewCategory && isNewType ? " and " : ""}
                {isNewType ? "Type" : ""}. Manager PIN required.
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Manager</Label>
                  <Select value={managerStaffId} onValueChange={setManagerStaffId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {staff.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Manager PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1 sm:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={2}
              placeholder="Audit-ready context (min 20 chars)"
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className={`text-xs ${descLen < 20 ? "text-destructive" : "text-muted-foreground"}`}>
              {descLen}/20 minimum
            </div>
          </div>
          <div className="space-y-1">
            <Label>Expiry date</Label>
            <Input type="date" value={expiry ?? ""} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Action module</Label>
            <Select
              value={actionModule}
              onValueChange={(v) => setActionModule(v as ComplianceActionModule)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_MODULES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              Locked to modules with a registered Dispatcher modal.
            </div>
          </div>
          <div className="space-y-1">
            <Label>Yellow threshold (days before expiry)</Label>
            <Input
              type="number"
              min={0}
              value={yellowDays}
              onChange={(e) => setYellowDays(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Red threshold (days before expiry)</Label>
            <Input
              type="number"
              min={0}
              value={redDays}
              onChange={(e) => setRedDays(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Handshake</Label>
            <Select value={handshake} onValueChange={(v) => setHandshake(v as "single" | "dual")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single PIN (manager)</SelectItem>
                <SelectItem value="dual">Dual PIN (manager + witness)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {actionModule === "formal_audit" && (
            <div className="space-y-1">
              <Label>Checklist category</Label>
              <Input
                placeholder="VEHICLE_FORMAL_AUDIT"
                value={checklistCategory}
                onChange={(e) => setChecklistCategory(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Label>
              Justification <span className="text-destructive">*</span>
            </Label>
            <Textarea
              rows={2}
              placeholder="Why is this changing? (min 20 chars, recorded in the ledger)"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
            <div className={`text-xs ${justLen < 20 ? "text-destructive" : "text-muted-foreground"}`}>
              {justLen}/20 minimum
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit}>
            {mut.isPending ? "Saving…" : "Save & log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveAssetDialog({
  asset,
  onClose,
  onArchived,
}: {
  asset: ComplianceAsset;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [justification, setJustification] = useState("");
  const mut = useMutation({
    mutationFn: () => archiveComplianceAsset(asset.id, justification),
    onSuccess: () => {
      toast.success("Asset archived");
      onArchived();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive “{asset.name}”?</DialogTitle>
          <DialogDescription>
            Archived assets disappear from the dashboard but remain in the ledger.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          placeholder="Justification (min 20 chars)"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />
        <div
          className={`text-xs ${justification.trim().length < 20 ? "text-destructive" : "text-muted-foreground"}`}
        >
          {justification.trim().length}/20 minimum
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mut.mutate()}
            disabled={justification.trim().length < 20 || mut.isPending}
          >
            {mut.isPending ? "Archiving…" : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

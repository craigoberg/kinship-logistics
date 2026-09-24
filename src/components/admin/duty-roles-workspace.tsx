/**
 * BL-126 — Admin: Duty roles and function/asset bindings.
 * Ticket names live in Lookups → Certificates & orientations.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { FLEET_VEHICLE_CATEGORIES, listFleet } from "@/lib/api/fleet";
import {
  createDutyBinding,
  deleteDutyBinding,
  listDutyBindings,
  listDutyRoles,
  listRequirementTypes,
  setDutyRoleActive,
  upsertDutyRole,
} from "@/lib/api/duty-roles";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import {
  DUTY_FUNCTION_KEYS,
  DUTY_SUBJECT_KINDS,
  dutyFunctionLabel,
  type DutyBinding,
  type DutyFunctionKey,
  type DutyRole,
  type DutySubjectKind,
  type RequirementType,
} from "@/lib/duty-roles";

const DUTY_Q = ["duty-roles"] as const;

export function DutyRolesWorkspace() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["duty-roles", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isActiveUserManager() || permissionQ.data === true;

  const typesQ = useQuery({
    queryKey: [...DUTY_Q, "types"],
    queryFn: () => listRequirementTypes(true),
    staleTime: 15_000,
  });
  const rolesQ = useQuery({
    queryKey: [...DUTY_Q, "roles"],
    queryFn: () => listDutyRoles(true),
    staleTime: 15_000,
  });
  const bindingsQ = useQuery({
    queryKey: [...DUTY_Q, "bindings"],
    queryFn: listDutyBindings,
    staleTime: 15_000,
  });
  const fleetQ = useQuery({
    queryKey: ["fleet", "active"],
    queryFn: listFleet,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: [...DUTY_Q] });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Duty roles are jobs people can be asked to do (Food Preparation, Bus Driver).
        They are not menu access. Tick official certificates and orientations from
        Lookups → Certificates & orientations. Bind a role to a floor function to
        challenge it. No tickets on a role means that bind falls through.
      </p>
      {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}

      <Tabs defaultValue="roles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roles">Duty roles</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
        </TabsList>

        <TabsContent value="roles">
          <RolesPanel
            roles={rolesQ.data ?? []}
            types={typesQ.data ?? []}
            loading={rolesQ.isLoading}
            canEdit={canEdit}
            onInvalidate={invalidate}
          />
        </TabsContent>
        <TabsContent value="bindings">
          <BindingsPanel
            bindings={bindingsQ.data ?? []}
            roles={rolesQ.data ?? []}
            assets={fleetQ.data ?? []}
            loading={bindingsQ.isLoading}
            canEdit={canEdit}
            onInvalidate={invalidate}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RolesPanel({
  roles,
  types,
  loading,
  canEdit,
  onInvalidate,
}: {
  roles: DutyRole[];
  types: RequirementType[];
  loading: boolean;
  canEdit: boolean;
  onInvalidate: () => void;
}) {
  const [editor, setEditor] = useState<"new" | DutyRole | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reqIds, setReqIds] = useState<string[]>([]);

  const nameOk = name.trim().length >= 2;
  const missing = !nameOk ? ["Duty role name (min 2)"] : [];
  const activeTypes = types.filter((t) => t.active);

  const saveMut = useMutation({
    mutationFn: () =>
      upsertDutyRole({
        id: editor === "new" || !editor ? undefined : editor.id,
        name,
        description,
        requirementIds: reqIds,
      }),
    onSuccess: () => {
      toast.success(editor === "new" ? "Duty role added" : "Duty role updated");
      setEditor(null);
      onInvalidate();
    },
    onError: (e: Error) =>
      toast.error("Could not save Duty role", { description: e.message }),
  });

  const archiveMut = useMutation({
    mutationFn: (row: DutyRole) => setDutyRoleActive(row.id, !row.active),
    onSuccess: () => {
      toast.success("Duty role updated");
      onInvalidate();
    },
    onError: (e: Error) => toast.error("Could not update", { description: e.message }),
  });

  function openNew() {
    setEditor("new");
    setName("");
    setDescription("");
    setReqIds([]);
  }
  function openEdit(row: DutyRole) {
    setEditor(row);
    setName(row.name);
    setDescription(row.description ?? "");
    setReqIds(row.requirementIds);
  }

  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Add Duty role
          </Button>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Duty role</TableHead>
              <TableHead>Requirements</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : roles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No Duty roles yet.
                </TableCell>
              </TableRow>
            ) : (
              roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-medium">{r.name}</p>
                    {r.description ? (
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.requirementIds.length
                      ? r.requirementIds.map(typeName).join(", ")
                      : "None yet"}
                  </TableCell>
                  <TableCell>
                    {r.active ? (
                      <Badge className="bg-emerald-600 text-white">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Archived</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <IconActionButton
                          className="h-8 w-8"
                          onClick={() => openEdit(r)}
                          tooltip="Edit Duty role"
                        >
                          <Pencil className="h-4 w-4" />
                        </IconActionButton>
                        <IconActionButton
                          className="h-8 w-8"
                          onClick={() => archiveMut.mutate(r)}
                          tooltip={r.active ? "Archive" : "Restore"}
                        >
                          <Archive className="h-4 w-4" />
                        </IconActionButton>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor === "new" ? "Add Duty role" : "Edit Duty role"}</DialogTitle>
            <DialogDescription>
              Tick the certificates and orientations this job needs. Leave a row
              unticked if the job has no ticket yet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <CharacterCountedInput
              label="Name"
              value={name}
              onValueChange={setName}
              minChars={2}
              maxChars={80}
              required
            />
            <div className="grid gap-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Description
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-9"
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Required items
              </p>
              {activeTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add types in Lookups → Certificates &amp; orientations first.
                </p>
              ) : (
                activeTypes.map((t) => {
                  const checked = reqIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setReqIds((prev) =>
                            v ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                          );
                        }}
                      />
                      <span>
                        {t.name}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({t.kind})
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            {missing.length > 0 && (
              <p className="text-sm text-destructive">Missing: {missing.join(", ")}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!nameOk || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BindingsPanel({
  bindings,
  roles,
  assets,
  loading,
  canEdit,
  onInvalidate,
}: {
  bindings: DutyBinding[];
  roles: DutyRole[];
  assets: Array<{ id: string; name: string; vehicleCategory: string | null }>;
  loading: boolean;
  canEdit: boolean;
  onInvalidate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [functionKey, setFunctionKey] = useState<DutyFunctionKey>("meal_prep");
  const [subjectKind, setSubjectKind] = useState<DutySubjectKind>("function");
  const [subjectId, setSubjectId] = useState("");
  const [dutyRoleId, setDutyRoleId] = useState("");

  const subjectNeeded = subjectKind !== "function";
  const subjectOk = !subjectNeeded || subjectId.trim().length > 0;
  const roleOk = !!dutyRoleId;
  const missing: string[] = [];
  if (!roleOk) missing.push("Duty role");
  if (!subjectOk) {
    missing.push(subjectKind === "fleet_asset" ? "Fleet asset" : "Vehicle category");
  }

  const saveMut = useMutation({
    mutationFn: () =>
      createDutyBinding({
        functionKey,
        subjectKind,
        subjectId: subjectKind === "function" ? null : subjectId,
        dutyRoleId,
      }),
    onSuccess: () => {
      toast.success("Binding added");
      setOpen(false);
      setDutyRoleId("");
      setSubjectId("");
      onInvalidate();
    },
    onError: (e: Error) =>
      toast.error("Could not add binding", { description: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteDutyBinding,
    onSuccess: () => {
      toast.success("Binding removed");
      onInvalidate();
    },
    onError: (e: Error) => toast.error("Could not remove", { description: e.message }),
  });

  function subjectLabel(b: DutyBinding): string {
    if (b.subjectKind === "function") return "All uses";
    if (b.subjectKind === "vehicle_category") {
      return (
        FLEET_VEHICLE_CATEGORIES.find((c) => c.value === b.subjectId)?.label ??
        b.subjectId ??
        "—"
      );
    }
    return assets.find((a) => a.id === b.subjectId)?.name ?? b.subjectId ?? "—";
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add binding
          </Button>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Function</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead>Duty role</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : bindings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No bindings. Meal prep and fleet categories are seeded after SQL.
                </TableCell>
              </TableRow>
            ) : (
              bindings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    {dutyFunctionLabel(b.functionKey)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {subjectLabel(b)}
                  </TableCell>
                  <TableCell>
                    {roles.find((r) => r.id === b.dutyRoleId)?.name ?? b.dutyRoleId}
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <IconActionButton
                        className="h-8 w-8"
                        onClick={() => deleteMut.mutate(b.id)}
                        tooltip="Remove binding"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconActionButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add binding</DialogTitle>
            <DialogDescription>
              Whoever does this function (or drives this vehicle) is challenged for
              the Duty role’s requirements. No binding, or a role with no tickets,
              falls through and allows the action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Function
              </Label>
              <Select
                value={functionKey}
                onValueChange={(v) => {
                  const key = v as DutyFunctionKey;
                  setFunctionKey(key);
                  if (key === "fleet_drive" && subjectKind === "function") {
                    setSubjectKind("vehicle_category");
                  }
                  if (key !== "fleet_drive") {
                    setSubjectKind("function");
                    setSubjectId("");
                  }
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUTY_FUNCTION_KEYS.map((k) => (
                    <SelectItem key={k.key} value={k.key}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Applies to
              </Label>
              <Select
                value={subjectKind}
                onValueChange={(v) => {
                  setSubjectKind(v as DutySubjectKind);
                  setSubjectId("");
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUTY_SUBJECT_KINDS.filter((s) =>
                    functionKey === "fleet_drive" ? s.key !== "function" : s.key === "function",
                  ).map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {subjectKind === "vehicle_category" && (
              <div className="grid gap-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Vehicle category
                </Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick category" />
                  </SelectTrigger>
                  <SelectContent>
                    {FLEET_VEHICLE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {subjectKind === "fleet_asset" && (
              <div className="grid gap-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fleet asset
                </Label>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Duty role
              </Label>
              <Select value={dutyRoleId} onValueChange={setDutyRoleId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Pick Duty role" />
                </SelectTrigger>
                <SelectContent>
                  {roles
                    .filter((r) => r.active)
                    .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {missing.length > 0 && (
              <p className="text-sm text-destructive">Missing: {missing.join(", ")}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={missing.length > 0 || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

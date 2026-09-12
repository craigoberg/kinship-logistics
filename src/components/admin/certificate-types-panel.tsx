/**
 * Lookups → Certificates & orientations.
 * Single catalogue (`requirement_types`). Duty roles and Staff only pick from here.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import {
  listRequirementTypes,
  setRequirementTypeActive,
  upsertRequirementType,
} from "@/lib/api/duty-roles";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import type { RequirementKind, RequirementType } from "@/lib/duty-roles";

const TYPES_Q = ["duty-roles", "types"] as const;

export function CertificateTypesPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["certificate-types", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isActiveUserManager() || permissionQ.data === true;

  const typesQ = useQuery({
    queryKey: TYPES_Q,
    queryFn: () => listRequirementTypes(true),
    staleTime: 15_000,
  });

  const [editor, setEditor] = useState<"new" | RequirementType | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<RequirementKind>("certificate");
  const [aliasText, setAliasText] = useState("");

  const nameOk = name.trim().length >= 2;
  const missing = !nameOk ? ["Name (min 2)"] : [];
  const types = typesQ.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["duty-roles"] });
  };

  const saveMut = useMutation({
    mutationFn: () =>
      upsertRequirementType({
        id: editor === "new" || !editor ? undefined : editor.id,
        name,
        kind,
        aliases: aliasText.split(",").map((a) => a.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(editor === "new" ? "Type added" : "Type updated");
      setEditor(null);
      invalidate();
    },
    onError: (e: Error) =>
      toast.error("Could not save type", { description: e.message }),
  });

  const archiveMut = useMutation({
    mutationFn: (row: RequirementType) => setRequirementTypeActive(row.id, !row.active),
    onSuccess: () => {
      toast.success("Type updated");
      invalidate();
    },
    onError: (e: Error) => toast.error("Could not update", { description: e.message }),
  });

  function openNew() {
    setEditor("new");
    setName("");
    setKind("certificate");
    setAliasText("");
  }
  function openEdit(row: RequirementType) {
    setEditor(row);
    setName(row.name);
    setKind(row.kind);
    setAliasText(row.aliases.join(", "));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Official names for certificates and orientations. Duty roles tick these;
        Staff pick them from a dropdown. Also-matches keeps old spellings
        (Food Handler Basic) mapped to this name. Expiry lives on the person.
      </p>
      {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      <div className="flex justify-end">
        {canEdit && (
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Add type
          </Button>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Kind</TableHead>
              <TableHead>Also matches</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {typesQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No types yet. Run the Duty roles SQL, or add one here.
                </TableCell>
              </TableRow>
            ) : (
              types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="capitalize">{t.kind}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.aliases.join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {t.active ? (
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
                          onClick={() => openEdit(t)}
                          tooltip="Edit type"
                        >
                          <Pencil className="h-4 w-4" />
                        </IconActionButton>
                        <IconActionButton
                          className="h-8 w-8"
                          onClick={() => archiveMut.mutate(t)}
                          tooltip={t.active ? "Archive" : "Restore"}
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
            <DialogTitle>
              {editor === "new" ? "Add type" : "Edit type"}
            </DialogTitle>
            <DialogDescription>
              This name is what Staff and Duty roles show. Certificates usually
              have a number on the person. Orientations often never expire.
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
                Kind
              </Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RequirementKind)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="certificate">Certificate</SelectItem>
                  <SelectItem value="orientation">Orientation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Also matches (comma-separated)
              </Label>
              <Input
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                placeholder="Food Handler Basic, SFH"
                className="h-9"
              />
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

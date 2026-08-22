import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ADMIN_LOOKUP_CATEGORIES,
  deleteLookupParameter,
  insertLookupParameter,
  LOOKUP_CATEGORIES,
  updateLookupParameter,
  updateLookupParameterColor,
  type LookupParameter,
} from "@/lib/data-store";
import {
  clearLookupCacheCategory,
  useLookupParameters,
} from "@/hooks/use-supabase-data";
import { TransportSiteAddressesPanel } from "@/components/admin/transport-site-addresses-panel";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
} from "@/lib/ui/caution-callout";
import { busRunEffectiveColor } from "@/lib/bus-run-palette";
import { cn } from "@/lib/utils";

/** Categories where each entry can have a badge color configured. */
const COLOR_ENABLED_CATEGORIES = new Set(["bus_runs", "transport_types"]);

export function AdminLookupWorkspace() {
  const first = ADMIN_LOOKUP_CATEGORIES[0]?.category ?? "";
  const [active, setActive] = useState(first);

  return (
    <Tabs value={active} onValueChange={setActive} className="space-y-4">
      <TabsList>
        {ADMIN_LOOKUP_CATEGORIES.map((c) => (
          <TabsTrigger key={c.category} value={c.category}>
            {c.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {ADMIN_LOOKUP_CATEGORIES.map((c) => (
        <TabsContent key={c.category} value={c.category} className="space-y-4">
          <p className="text-sm text-muted-foreground">{c.description}</p>
          {c.category === LOOKUP_CATEGORIES.busRun && <TransportSiteAddressesPanel />}
          <CategoryPanel
            category={c.category}
            label={c.label}
            showColor={COLOR_ENABLED_CATEGORIES.has(c.category)}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CategoryPanel({
  category,
  label,
  showColor,
}: {
  category: string;
  label: string;
  showColor: boolean;
}) {
  const qc = useQueryClient();
  const { data = [], isFetching, refetch } = useLookupParameters(category);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [removeTarget, setRemoveTarget] = useState<LookupParameter | null>(null);
  const [editTarget, setEditTarget] = useState<LookupParameter | null>(null);

  const invalidate = () => {
    clearLookupCacheCategory(category);
    qc.invalidateQueries({ queryKey: ["system_lookup_parameters", category], exact: true });
    // Also invalidate the directory indicators so badge colors refresh immediately.
    qc.invalidateQueries({ queryKey: ["participant-directory-indicators"] });
    if (category === LOOKUP_CATEGORIES.busRun) {
      qc.invalidateQueries({ queryKey: ["today-bus-run-summaries"] });
      qc.invalidateQueries({ queryKey: ["bus-run-default-routes"] });
      qc.invalidateQueries({ queryKey: ["bus-run-roster"] });
      qc.invalidateQueries({ queryKey: ["attendance_schedules"] });
    }
  };

  const insert = useMutation({
    mutationFn: () =>
      insertLookupParameter({
        category,
        code: code.trim(),
        displayName: displayName.trim() || code.trim(),
      }),
    onSuccess: async (inserted) => {
      // If a color was chosen and the category supports it, save it immediately.
      if (showColor && newColor && newColor !== "#3b82f6") {
        await updateLookupParameterColor(inserted.id, newColor);
      }
      invalidate();
      setCode("");
      setDisplayName("");
      setNewColor("#3b82f6");
      toast.success(`${label} entry added`);
    },
    onError: (e: Error) =>
      toast.error("Could not add entry", { description: e.message }),
  });

  const saveEdit = useMutation({
    mutationFn: (input: {
      id: string;
      code: string;
      displayName: string;
      previousCode: string;
    }) => updateLookupParameter(input),
    onSuccess: (result) => {
      invalidate();
      setEditTarget(null);
      toast.success(
        result.codeChanged && category === LOOKUP_CATEGORIES.busRun
          ? "Run updated — clients and Manifest kept their assignment"
          : `${label} entry updated`,
      );
    },
    onError: (e: Error) =>
      toast.error("Could not save changes", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLookupParameter(id),
    onSuccess: () => {
      invalidate();
      setRemoveTarget(null);
      toast.success("Entry removed");
    },
    onError: (e: Error) =>
      toast.error("Could not remove entry", { description: e.message }),
  });

  const updateColor = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) =>
      updateLookupParameterColor(id, color),
    onSuccess: () => {
      invalidate();
    },
    onError: (e: Error) =>
      toast.error("Could not save color", { description: e.message }),
  });

  const canSubmit = code.trim().length > 0 && !insert.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
      {/* ── Add entry form ─────────────────────────────────────────────── */}
      <div
        className={`grid gap-3 md:items-end ${
          showColor
            ? "md:grid-cols-[1fr_1fr_auto_auto]"
            : "md:grid-cols-[1fr_1fr_auto]"
        }`}
      >
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Code (stored value)
          </Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. R3"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Display name
          </Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Visible label"
          />
        </div>
        {showColor && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Badge colour
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-input bg-input p-0.5"
                title="Pick badge colour"
              />
              <span className="text-xs font-mono text-muted-foreground">{newColor}</span>
            </div>
          </div>
        )}
        <Button
          onClick={() => insert.mutate()}
          disabled={!canSubmit}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {insert.isPending ? "Adding…" : "Add entry"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {data.length} {data.length === 1 ? "entry" : "entries"} configured
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            invalidate();
            refetch();
          }}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Entry table ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Display name</th>
              {showColor && <th className="px-3 py-2 text-left">Badge colour</th>}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={showColor ? 4 : 3}
                  className="px-3 py-6 text-center text-xs text-muted-foreground"
                >
                  No entries yet. Add one above to expose it across the app.
                </td>
              </tr>
            ) : (
              data.map((row: LookupParameter) => {
                const effectiveColor =
                  category === LOOKUP_CATEGORIES.busRun
                    ? busRunEffectiveColor(data, row)
                    : row.badgeColor;

                return (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {effectiveColor && (
                          <span
                            className="inline-flex h-5 min-w-[2.5rem] items-center justify-center rounded px-1.5 text-[10px] font-bold text-white"
                            style={{ backgroundColor: effectiveColor }}
                          >
                            {row.displayName}
                          </span>
                        )}
                        {!effectiveColor && row.displayName}
                      </div>
                    </td>
                    {showColor && (
                      <td className="px-3 py-2">
                        <ColorCell
                          row={row}
                          fallback={effectiveColor}
                          onSave={(color) =>
                            updateColor.mutate({ id: row.id, color })
                          }
                          isSaving={updateColor.isPending}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditTarget(row)}
                          className="gap-1.5"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveTarget(row)}
                          className="gap-1.5 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <EditLookupDialog
        row={editTarget}
        category={category}
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onSave={(input) => saveEdit.mutate(input)}
        isSaving={saveEdit.isPending}
      />

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{removeTarget?.displayName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This lookup entry will be deleted from {label}. Code{" "}
              <span className="font-mono">{removeTarget?.code}</span> will no longer appear in
              pickers that use this list. Clients still assigned to that code will need a new
              run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removeTarget && remove.mutate(removeTarget.id)}
            >
              {remove.isPending ? "Removing…" : "Remove entry"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditLookupDialog({
  row,
  category,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  row: LookupParameter | null;
  category: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    id: string;
    code: string;
    displayName: string;
    previousCode: string;
  }) => void;
  isSaving: boolean;
}) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (open && row) {
      setCode(row.code);
      setDisplayName(row.displayName);
    }
  }, [open, row]);

  const codeValid = code.trim().length >= 1;
  const nameValid = displayName.trim().length >= 1;
  const dirty =
    !!row &&
    (code.trim() !== row.code.trim() || displayName.trim() !== row.displayName.trim());
  const codeChanged = !!row && code.trim() !== row.code.trim();
  const missing = useMemo(() => {
    const list: string[] = [];
    if (!codeValid) list.push("Code");
    if (!nameValid) list.push("Display name");
    return list;
  }, [codeValid, nameValid]);
  const canSave = codeValid && nameValid && dirty && !isSaving && !!row;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit lookup entry</DialogTitle>
          <DialogDescription>
            {category === LOOKUP_CATEGORIES.busRun
              ? "Display name shows on Manifest and Clients. Changing the code keeps people on this run."
              : "Code is the stored value; display name is what operators see."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <CharacterCountedInput
            label="Code (stored value)"
            value={code}
            onValueChange={setCode}
            minChars={1}
            maxChars={40}
            placeholder="e.g. R3"
            className="font-mono"
            autoFocus
          />
          <CharacterCountedInput
            label="Display name"
            value={displayName}
            onValueChange={setDisplayName}
            minChars={1}
            maxChars={80}
            placeholder="Visible label"
          />

          {category === LOOKUP_CATEGORIES.busRun && codeChanged && (
            <div className={cn("px-3 py-2.5 text-sm", CAUTION_CALLOUT_CLASS)}>
              <p className={cn("text-xs leading-relaxed", CAUTION_CALLOUT_BODY_CLASS)}>
                Changing the code from{" "}
                <span className="font-mono">{row?.code}</span> to{" "}
                <span className="font-mono">{code.trim()}</span> will update client
                schedules, Manifest trips, default routes, and event bookings so nobody
                has to be re-assigned.
              </p>
            </div>
          )}

          {!canSave && missing.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <p className="font-semibold">Still needed:</p>
              <ul className="mt-1 list-disc pl-4">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() =>
              row &&
              onSave({
                id: row.id,
                code: code.trim(),
                displayName: displayName.trim(),
                previousCode: row.code,
              })
            }
            disabled={!canSave}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inline color picker cell — change fires save immediately. */
function ColorCell({
  row,
  fallback,
  onSave,
  isSaving,
}: {
  row: LookupParameter;
  fallback: string | null;
  onSave: (color: string) => void;
  isSaving: boolean;
}) {
  const current = row.badgeColor ?? fallback ?? "#3b82f6";
  return (
    <div className="flex items-center gap-2">
      <input
        key={row.id}
        type="color"
        value={current}
        onChange={(e) => onSave(e.target.value)}
        disabled={isSaving}
        className="h-8 w-10 cursor-pointer rounded border border-input bg-input p-0.5 disabled:opacity-50"
        title="Click to change badge colour"
      />
      <span className="font-mono text-xs text-muted-foreground">{current}</span>
      {!row.badgeColor && (
        <span className="text-[10px] text-muted-foreground/60 italic">default</span>
      )}
    </div>
  );
}

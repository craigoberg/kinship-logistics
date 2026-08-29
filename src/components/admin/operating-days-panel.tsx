/**
 * Lookups → Operating days: which weekdays the centre is open, plus open/close times.
 * Days live in system_lookup_parameters; times stay on centre_operating_hours.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import { ClientTime } from "@/components/ui/client-time";
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
  LOOKUP_CATEGORIES,
  deleteLookupParameter,
  insertLookupParameter,
  updateLookupParameter,
  type LookupParameter,
} from "@/lib/data-store";
import {
  clearLookupCacheCategory,
  useLookupParameters,
} from "@/hooks/use-supabase-data";
import {
  CENTRE_HOURS_QUERY_KEY,
  DAY_CODE_LABEL,
  DEFAULT_CENTRE_CLOSE,
  DEFAULT_CENTRE_OPEN,
  isKnownDayCode,
  listCentreHours,
  updateCentreHours,
  type CentreHourRow,
} from "@/lib/api/centre-hours";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";

const CATEGORY = LOOKUP_CATEGORIES.operatingDay;

function hoursFor(hours: CentreHourRow[], code: string): CentreHourRow | undefined {
  return hours.find((h) => h.dayOfWeek === code);
}

function invalidateOperatingDays(qc: ReturnType<typeof useQueryClient>) {
  clearLookupCacheCategory(CATEGORY);
  qc.invalidateQueries({ queryKey: ["system_lookup_parameters", CATEGORY], exact: true });
  qc.invalidateQueries({ queryKey: CENTRE_HOURS_QUERY_KEY });
  qc.invalidateQueries({ queryKey: ["centre-hours"] });
}

export function OperatingDaysPanel() {
  const qc = useQueryClient();
  const { data = [], isFetching, refetch } = useLookupParameters(CATEGORY);
  const hoursQ = useQuery({
    queryKey: CENTRE_HOURS_QUERY_KEY,
    queryFn: listCentreHours,
    staleTime: 30_000,
  });
  const hours = hoursQ.data ?? [];

  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [openTime, setOpenTime] = useState(DEFAULT_CENTRE_OPEN);
  const [closeTime, setCloseTime] = useState(DEFAULT_CENTRE_CLOSE);
  const [removeTarget, setRemoveTarget] = useState<LookupParameter | null>(null);
  const [editTarget, setEditTarget] = useState<LookupParameter | null>(null);

  const normalizedCode = code.trim().toUpperCase();

  useEffect(() => {
    if (!isKnownDayCode(normalizedCode)) return;
    const h = hoursFor(hours, normalizedCode);
    if (h) {
      setOpenTime(h.openTime);
      setCloseTime(h.closeTime);
    }
  }, [normalizedCode, hours]);
  const timesOk =
    /^\d{2}:\d{2}$/.test(openTime) &&
    /^\d{2}:\d{2}$/.test(closeTime) &&
    openTime < closeTime;
  const codeOk = isKnownDayCode(normalizedCode);

  const insert = useMutation({
    mutationFn: async () => {
      if (!isKnownDayCode(normalizedCode)) {
        throw new Error("Code must be DAY-MON … DAY-SUN");
      }
      const inserted = await insertLookupParameter({
        category: CATEGORY,
        code: normalizedCode,
        displayName: displayName.trim() || DAY_CODE_LABEL[normalizedCode] || normalizedCode,
      });
      await updateCentreHours({
        dayOfWeek: normalizedCode,
        openTime,
        closeTime,
        justification: "Added with new operating day.",
      });
      return inserted;
    },
    onSuccess: () => {
      invalidateOperatingDays(qc);
      setCode("");
      setDisplayName("");
      setOpenTime(DEFAULT_CENTRE_OPEN);
      setCloseTime(DEFAULT_CENTRE_CLOSE);
      toast.success("Operating day added");
    },
    onError: (e: Error) =>
      toast.error("Could not add operating day", { description: e.message }),
  });

  const saveEdit = useMutation({
    mutationFn: async (input: {
      id: string;
      code: string;
      displayName: string;
      previousCode: string;
      openTime: string;
      closeTime: string;
      timesChanged: boolean;
      justification: string;
    }) => {
      const result = await updateLookupParameter({
        id: input.id,
        code: input.code,
        displayName: input.displayName,
        previousCode: input.previousCode,
      });
      if (input.timesChanged && isKnownDayCode(input.code)) {
        await updateCentreHours({
          dayOfWeek: input.code,
          openTime: input.openTime,
          closeTime: input.closeTime,
          justification: input.justification,
        });
      }
      return result;
    },
    onSuccess: () => {
      invalidateOperatingDays(qc);
      setEditTarget(null);
      toast.success("Operating day updated");
    },
    onError: (e: Error) =>
      toast.error("Could not save changes", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteLookupParameter(id),
    onSuccess: () => {
      invalidateOperatingDays(qc);
      setRemoveTarget(null);
      toast.success("Operating day removed");
    },
    onError: (e: Error) =>
      toast.error("Could not remove entry", { description: e.message }),
  });

  const canSubmit = codeOk && timesOk && !insert.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Code (stored value)
          </Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. DAY-SAT"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Display name
          </Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Saturday"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Open
          </Label>
          <HalfHourTimeField value={openTime} onChange={setOpenTime} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Close
          </Label>
          <HalfHourTimeField value={closeTime} onChange={setCloseTime} className="h-9" />
        </div>
        <Button onClick={() => insert.mutate()} disabled={!canSubmit} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {insert.isPending ? "Adding…" : "Add entry"}
        </Button>
      </div>
      {!canSubmit && code.trim().length > 0 && (
        <p className="text-xs text-destructive">
          {[
            !codeOk && "Code must be DAY-MON … DAY-SUN",
            !timesOk && "Open must be before close",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {data.length} {data.length === 1 ? "entry" : "entries"} configured
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            invalidateOperatingDays(qc);
            refetch();
          }}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching || hoursQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Display name</th>
              <th className="px-3 py-2 text-left">Open</th>
              <th className="px-3 py-2 text-left">Close</th>
              <th className="px-3 py-2 text-left">Updated</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No operating days yet. Add Tuesday / Thursday (or weekend days) above.
                  Leftover hours for unused weekdays stay in the database until you add that day.
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const h = hoursFor(hours, row.code);
                return (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-3 py-2">{row.displayName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h?.openTime ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h?.closeTime ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {h?.updatedAt ? <ClientTime iso={h.updatedAt} /> : "—"}
                    </td>
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

      <EditOperatingDayDialog
        row={editTarget}
        hours={hoursFor(hours, editTarget?.code ?? "")}
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
            <AlertDialogTitle>Remove “{removeTarget?.displayName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This day will no longer count as a centre operating day (rosters, calendar,
              staff Centre run). Open/close times stay on file if you add the day again.
              Code <span className="font-mono">{removeTarget?.code}</span>.
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

function EditOperatingDayDialog({
  row,
  hours,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  row: LookupParameter | null;
  hours: CentreHourRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    id: string;
    code: string;
    displayName: string;
    previousCode: string;
    openTime: string;
    closeTime: string;
    timesChanged: boolean;
    justification: string;
  }) => void;
  isSaving: boolean;
}) {
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [openTime, setOpenTime] = useState(DEFAULT_CENTRE_OPEN);
  const [closeTime, setCloseTime] = useState(DEFAULT_CENTRE_CLOSE);
  const [just, setJust] = useState("");

  useEffect(() => {
    if (open && row) {
      setCode(row.code);
      setDisplayName(row.displayName);
      setOpenTime(hours?.openTime || DEFAULT_CENTRE_OPEN);
      setCloseTime(hours?.closeTime || DEFAULT_CENTRE_CLOSE);
      setJust("");
    }
  }, [open, row, hours?.openTime, hours?.closeTime]);

  const normalizedCode = code.trim().toUpperCase();
  const codeValid = isKnownDayCode(normalizedCode);
  const nameValid = displayName.trim().length >= 1;
  const timesOk =
    /^\d{2}:\d{2}$/.test(openTime) &&
    /^\d{2}:\d{2}$/.test(closeTime) &&
    openTime < closeTime;
  const lookupDirty =
    !!row &&
    (normalizedCode !== row.code.trim().toUpperCase() ||
      displayName.trim() !== row.displayName.trim());
  const storedOpen = hours?.openTime || DEFAULT_CENTRE_OPEN;
  const storedClose = hours?.closeTime || DEFAULT_CENTRE_CLOSE;
  const timesChanged = openTime !== storedOpen || closeTime !== storedClose;
  const justOk = just.trim().length >= MIN_TIMELINE_NOTE;
  const missing = useMemo(() => {
    const list: string[] = [];
    if (!codeValid) list.push("Code (DAY-MON … DAY-SUN)");
    if (!nameValid) list.push("Display name");
    if (!timesOk) list.push("Open must be before close");
    if (timesChanged && !justOk) list.push(`Justification (min ${MIN_TIMELINE_NOTE} chars)`);
    return list;
  }, [codeValid, nameValid, timesOk, timesChanged, justOk]);
  const canSave =
    !!row &&
    codeValid &&
    nameValid &&
    timesOk &&
    (lookupDirty || timesChanged) &&
    (!timesChanged || justOk) &&
    !isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit operating day</DialogTitle>
          <DialogDescription>
            Code is the stored weekday. Open/close are facility defaults when a person has
            no per-client schedule override.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <CharacterCountedInput
            label="Code (stored value)"
            value={code}
            onValueChange={setCode}
            minChars={1}
            maxChars={40}
            placeholder="DAY-TUE"
            className="font-mono"
            autoFocus
          />
          <CharacterCountedInput
            label="Display name"
            value={displayName}
            onValueChange={setDisplayName}
            minChars={1}
            maxChars={80}
            placeholder="Tuesday"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Open
              </Label>
              <HalfHourTimeField value={openTime} onChange={setOpenTime} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Close
              </Label>
              <HalfHourTimeField value={closeTime} onChange={setCloseTime} className="h-9" />
            </div>
          </div>
          {timesChanged && (
            <CharacterCountedTextarea
              id="operating-day-just"
              label="Justification"
              rows={2}
              minChars={MIN_TIMELINE_NOTE}
              maxChars={500}
              counterMode="minimum"
              value={just}
              onValueChange={setJust}
              placeholder="Why are the hours changing?"
            />
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
                code: normalizedCode,
                displayName: displayName.trim(),
                previousCode: row.code,
                openTime,
                closeTime,
                timesChanged,
                justification: just,
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

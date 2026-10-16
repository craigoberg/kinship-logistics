/**
 * Expected checks for one venue type. A change needs a manager PIN and a reason.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  addRequirementToType,
  archiveRequirement,
  listRequirementCatalogue,
  listRequirementsForType,
  renameRequirement,
  setTypeRequirementLinks,
  type VenueRequirement,
} from "@/lib/api/venue-requirements";

type Draft =
  | { mode: "add" }
  | { mode: "rename"; row: VenueRequirement }
  | { mode: "links" };

export function VenueTypeRequirements({ typeCode }: { typeCode: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["venue-type-requirements", typeCode],
    queryFn: () => listRequirementsForType(typeCode),
    staleTime: 30_000,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [reason, setReason] = useState("");
  const [pinOk, setPinOk] = useState(false);
  const pinRef = useRef("");
  const staffId = getActiveUserProfile()?.staffId ?? "";

  const catalogue = useQuery({
    queryKey: ["venue-requirement-catalogue"],
    queryFn: listRequirementCatalogue,
    staleTime: 30_000,
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedReady, setPickedReady] = useState(false);

  useEffect(() => {
    setPickedReady(false);
  }, [typeCode]);

  const rows = q.data ?? [];
  useEffect(() => {
    if (!pickedReady && Array.isArray(q.data)) {
      setPicked(q.data.map((r) => r.code));
      setPickedReady(true);
    }
  }, [q.data, pickedReady]);

  const missingSql = q.data === null;
  const promptOk = draft?.mode === "links" || prompt.trim().length >= 8;
  const reasonOk = reason.trim().length >= 20;
  const canSave = promptOk && reasonOk && pinOk;

  function open(next: Draft) {
    setDraft(next);
    setPrompt(next.mode === "rename" ? next.row.prompt : "");
    setReason("");
    setPinOk(false);
    pinRef.current = "";
  }

  const save = useMutation({
    mutationFn: async (intent: "save" | "archive") => {
      if (!draft) return intent;
      if (intent === "archive" && draft.mode === "rename") {
        await archiveRequirement({
          code: draft.row.code,
          prompt: draft.row.prompt,
          staffId,
          pin: pinRef.current,
          reason,
        });
        return intent;
      }
      if (draft.mode === "add") {
        await addRequirementToType({
          typeCode,
          prompt,
          staffId,
          pin: pinRef.current,
          reason,
        });
      } else if (draft.mode === "rename") {
        await renameRequirement({
          code: draft.row.code,
          prompt,
          typeCode,
          staffId,
          pin: pinRef.current,
          reason,
        });
      } else {
        await setTypeRequirementLinks({
          typeCode,
          codes: picked,
          staffId,
          pin: pinRef.current,
          reason,
        });
      }
      return intent;
    },
    onSuccess: (intent) => {
      toast.success(
        intent === "archive"
          ? "Requirement archived. Venues that used it need a new baseline."
          : "Requirement updated. Venues of this type need a new baseline.",
      );
      setDraft(null);
      setPickedReady(false);
      void qc.invalidateQueries({ queryKey: ["venue-type-requirements", typeCode] });
      void qc.invalidateQueries({ queryKey: ["venue-requirement-catalogue"] });
      void qc.invalidateQueries({ queryKey: ["venue-template-fields"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="border-b px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tick the checks this type of place should have. A new type such as Cruise uses
          this same list. Untick what does not apply, then save. A venue that does not
          have one is still usable when a manager records why.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => open({ mode: "add" })} disabled={missingSql}>
          Add
        </Button>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading requirements…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : missingSql ? (
        <p className="text-sm text-muted-foreground">
          Run the venue requirements SQL to edit this list.
        </p>
      ) : (
        <RequirementTicks
          rows={rows}
          catalogue={catalogue.data ?? []}
          picked={picked}
          dirty={
            pickedReady &&
            (picked.length !== rows.length ||
              rows.some((r) => !picked.includes(r.code)) ||
              picked.some((code) => !rows.some((r) => r.code === code)))
          }
          onToggle={(code) =>
            setPicked((prev) =>
              prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
            )
          }
          onEdit={(row) => open({ mode: "rename", row })}
          onSave={() => open({ mode: "links" })}
        />
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft?.mode === "links"
                ? "Save which checks apply"
                : draft?.mode === "rename"
                  ? "Change requirement"
                  : "Add requirement"}
            </DialogTitle>
            <DialogDescription>
              {draft?.mode === "rename"
                ? "Save updates the wording. Archive retires this check from every venue type. The reason is kept for an NDIS review."
                : "Venues of this type keep their old baseline until a manager signs a new one. The reason is kept for an NDIS review."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {draft?.mode === "links" ? (
              <p className="text-sm text-muted-foreground">
                Venues of this type pick up the ticked checks and need a new baseline.
              </p>
            ) : (
              <CharacterCountedInput
                label="Requirement"
                value={prompt}
                onValueChange={setPrompt}
                minChars={8}
                maxChars={160}
                required
                placeholder="e.g. Handrails on the ramp"
              />
            )}
            <CharacterCountedTextarea
              label="Why this change"
              value={reason}
              onValueChange={setReason}
              minChars={20}
              maxChars={500}
              required
              placeholder={
                draft?.mode === "rename"
                  ? "Why the wording is changing, or why this check should be archived"
                  : "What was wrong or missing, and why this wording is right now"
              }
            />
            <PinEntryTrigger
              label="Tap to enter manager PIN"
              verified={pinOk}
              verifiedLabel="Manager PIN verified"
              length={6}
              title="Change venue requirement"
              description="This change is logged."
              disabled={!staffId}
              required
              onVerify={async (p) => {
                await verifyManagerPin(staffId, p);
              }}
              onSuccess={(p) => {
                pinRef.current = p;
                setPinOk(true);
              }}
            />
            {(!promptOk || !reasonOk || !pinOk) && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Missing:{" "}
                {[
                  !promptOk ? "Requirement (min 8)" : null,
                  !reasonOk ? "Why (min 20)" : null,
                  !pinOk ? "Manager PIN" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            )}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Close
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {draft?.mode === "rename" && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!reasonOk || !pinOk || save.isPending}
                  onClick={() => save.mutate("archive")}
                >
                  Archive
                </Button>
              )}
              <Button type="button" disabled={!canSave || save.isPending} onClick={() => save.mutate("save")}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequirementTicks({
  rows,
  catalogue,
  picked,
  dirty,
  onToggle,
  onEdit,
  onSave,
}: {
  rows: VenueRequirement[];
  catalogue: VenueRequirement[];
  picked: string[];
  dirty: boolean;
  onToggle: (code: string) => void;
  onEdit: (row: VenueRequirement) => void;
  onSave: () => void;
}) {
  const [search, setSearch] = useState("");
  const list = useMemo(() => {
    const byCode = new Map<string, VenueRequirement>();
    for (const row of catalogue) byCode.set(row.code, row);
    for (const row of rows) {
      if (!byCode.has(row.code)) byCode.set(row.code, row);
    }
    return [...byCode.values()].sort(
      (a, b) => a.sort_order - b.sort_order || a.prompt.localeCompare(b.prompt),
    );
  }, [catalogue, rows]);
  const query = search.trim().toLowerCase();
  const visible = query ? list.filter((row) => row.prompt.toLowerCase().includes(query)) : list;
  const pickedSet = new Set(picked);

  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">No requirements yet. Add one, then tick it for this type.</p>;
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requirements…"
          className="pl-9"
        />
      </div>
      {visible.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No requirement matches that search.</p>
      ) : visible.map((row) => (
        <div key={row.code} className="flex items-start gap-2 py-1">
          <Checkbox
            checked={pickedSet.has(row.code)}
            onCheckedChange={() => onToggle(row.code)}
            aria-label={row.prompt}
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1 text-sm">{row.prompt}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => onEdit(row)}>
            Edit
          </Button>
        </div>
      ))}
      {dirty && (
        <Button type="button" size="sm" className="mt-2" onClick={onSave}>
          Save which checks apply
        </Button>
      )}
    </div>
  );
}

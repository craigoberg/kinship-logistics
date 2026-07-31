/**
 * BL-084 Phase A — Manager clears infectious exclusion (return-to-care).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import {
  CERT_RECOMMENDED_CATEGORIES,
  clearInfectiousExclusion,
  INFECTION_CATEGORY_LABELS,
  type ClearanceMethod,
  type InfectiousExclusion,
} from "@/lib/api/infectious-exclusion";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exclusion: InfectiousExclusion | null;
  /** Called after a successful clear (before sheet closes). */
  onCleared?: () => void;
}

export function InfectiousClearanceSheet({
  open,
  onOpenChange,
  exclusion,
  onCleared,
}: Props) {
  const qc = useQueryClient();
  const profile = getActiveUserProfile();
  const managerStaffId = profile?.staffId ?? "";
  const canClear = isActiveUserManager() && !!managerStaffId;

  const [method, setMethod] = useState<ClearanceMethod | null>(null);
  const [note, setNote] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [pinVerified, setPinVerified] = useState(false);

  const certRecommended =
    exclusion != null && CERT_RECOMMENDED_CATEGORIES.has(exclusion.category);
  const noteOk = note.trim().length >= MIN_TIMELINE_NOTE;
  const canSubmit = canClear && !!exclusion && !!method && noteOk && pinVerified;

  function reset() {
    setMethod(null);
    setNote("");
    setEvidenceRef("");
    setPinVerified(false);
  }

  const clearMut = useMutation({
    mutationFn: async () => {
      if (!exclusion || !method) throw new Error("Complete clearance fields.");
      return clearInfectiousExclusion({
        exclusionId: exclusion.id,
        method,
        clearanceNote: note,
        evidenceRef: evidenceRef.trim() || null,
      });
    },
    onSuccess: (row) => {
      toast.success("Cleared to return", {
        description: `${row.participantName ?? "Participant"} may return under normal attendance.`,
      });
      invalidateIssueCaches(qc);
      qc.invalidateQueries({ queryKey: ["infectious-exclusions-active"] });
      qc.invalidateQueries({ queryKey: ["hub-human-incidents-feed"] });
      reset();
      onCleared?.();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error("Could not clear exclusion", { description: e.message });
    },
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Clear to return
        </span>
      }
      description={
        exclusion
          ? `${exclusion.participantName ?? "Participant"} — ${INFECTION_CATEGORY_LABELS[exclusion.category]}. Manager accepts carer attestation or medical certificate.`
          : "No active exclusion selected."
      }
    >
      <div className="space-y-4">
        {!canClear && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Only a signed-in manager/coordinator can clear an infectious exclusion.
          </p>
        )}

        {certRecommended && (
          <p className="text-xs text-amber-800">
            Medical certificate is recommended for this category. You may still
            accept carer attestation if policy allows.
          </p>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Clearance method</Label>
          <div className="grid gap-2">
            <MobileFieldButton
              title="Carer attestation"
              subtitle="Carer confirms fit to return"
              active={method === "carer_attestation"}
              onClick={() => setMethod("carer_attestation")}
              tone="neutral"
            />
            <MobileFieldButton
              title="Medical certificate"
              subtitle="GP / clinic evidence on file"
              active={method === "medical_cert"}
              onClick={() => setMethod("medical_cert")}
              tone="success"
            />
          </div>
        </div>

        <CharacterCountedTextarea
          label="Clearance note"
          value={note}
          onValueChange={setNote}
          minChars={MIN_TIMELINE_NOTE}
          rows={3}
          placeholder="Who attested, what was said, or cert details…"
        />

        <div className="space-y-1.5">
          <Label className="text-xs">Evidence ref (optional)</Label>
          <Input
            value={evidenceRef}
            onChange={(e) => setEvidenceRef(e.target.value)}
            placeholder="e.g. SharePoint path, cert date, carer name"
          />
        </div>

        <PinEntryTrigger
          label="Manager PIN to clear"
          verified={pinVerified}
          verifiedLabel="Manager PIN verified"
          length={4}
          title="Clear infectious exclusion"
          description="Manager PIN accepts return-to-care."
          disabled={!canClear || !exclusion || !method || !noteOk}
          onVerify={async (pin) => {
            await verifyManagerPin(managerStaffId, pin);
          }}
          onSuccess={() => setPinVerified(true)}
        />

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Close
          </Button>
          <Button
            className="flex-1"
            disabled={!canSubmit || clearMut.isPending}
            onClick={() => clearMut.mutate()}
          >
            {clearMut.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Clear to return
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

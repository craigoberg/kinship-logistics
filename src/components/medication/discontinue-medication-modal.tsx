import { useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useStaffRegistry,
  useDiscontinueMedicationSchedule,
} from "@/hooks/use-supabase-data";
import type {
  MedicationArchiveReference,
  MedicationSchedule,
} from "@/lib/data-store";

const REFERENCE_OPTIONS: MedicationArchiveReference[] = [
  "Doctor Certificate / Medical Order",
  "Carer Written Request",
  "Management Operational Directive",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: MedicationSchedule | null;
  /** Optional pre-selected "Authorized By" staff id (current user). */
  currentStaffId?: string | null;
}

export function DiscontinueMedicationModal({
  open,
  onOpenChange,
  schedule,
  currentStaffId,
}: Props) {
  const { data: staff = [], isLoading: staffLoading } = useStaffRegistry();
  const discontinue = useDiscontinueMedicationSchedule();

  const [authorizedById, setAuthorizedById] = useState<string>("");
  const [witnessedById, setWitnessedById] = useState<string>("");
  const [referenceType, setReferenceType] =
    useState<MedicationArchiveReference | "">("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setAuthorizedById(currentStaffId ?? "");
      setWitnessedById("");
      setReferenceType("");
      setReason("");
    }
  }, [open, currentStaffId]);

  const activeStaff = staff.filter((s) => s.active);

  const canSubmit =
    !!schedule &&
    !!authorizedById &&
    !!witnessedById &&
    authorizedById !== witnessedById &&
    !!referenceType &&
    reason.trim().length >= 10 &&
    !discontinue.isPending;

  const submit = async () => {
    if (!schedule || !canSubmit) return;
    try {
      await discontinue.mutateAsync({
        id: schedule.id,
        authorizedById,
        witnessedById,
        referenceType: referenceType as MedicationArchiveReference,
        reason: reason.trim(),
      });
      toast.success("Medication routine discontinued", {
        description: `${schedule.medicationName} archived with dual sign-off.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Discontinuation failed", {
        description: (err as Error).message,
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-destructive/40 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Discontinue Medication Routine Verification
          </DialogTitle>
          <DialogDescription>
            {schedule ? (
              <>
                <span className="font-semibold text-foreground">
                  {schedule.medicationName}
                </span>{" "}
                · {schedule.dosage} · {schedule.expectedTime.slice(0, 5)} ·{" "}
                {schedule.frequency}
              </>
            ) : (
              "Select a medication routine to discontinue."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This action <strong>permanently stops daily administration
            tracking</strong> for this routine. A dual-staff sign-off and a
            paper-trail reference are required for compliance.
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Authorized By
            </Label>
            <Select
              value={authorizedById}
              onValueChange={setAuthorizedById}
              disabled={staffLoading}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select authorising staff…" />
              </SelectTrigger>
              <SelectContent>
                {activeStaff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                    {s.role ? ` · ${s.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Witnessed By
            </Label>
            <Select
              value={witnessedById}
              onValueChange={setWitnessedById}
              disabled={staffLoading}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select witnessing staff…" />
              </SelectTrigger>
              <SelectContent>
                {activeStaff
                  .filter((s) => s.id !== authorizedById)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.fullName}
                      {s.role ? ` · ${s.role}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Authorization Source
            </Label>
            <Select
              value={referenceType}
              onValueChange={(v) =>
                setReferenceType(v as MedicationArchiveReference)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select physical paper trail…" />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reason for Discontinuation
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="e.g. Doctor certificate received changing prescription to alternative brand. Document filed in physical cabinet."
              maxLength={1000}
            />
            <p className="text-[11px] text-muted-foreground">
              Minimum 10 characters. {reason.trim().length}/1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            <ShieldAlert className="h-4 w-4" />
            {discontinue.isPending
              ? "Recording sign-off…"
              : "Confirm Discontinuation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

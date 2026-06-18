import { useEffect, useMemo, useState } from "react";
import { Syringe, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

import { useGiveDose, useStaffRegistry } from "@/hooks/use-supabase-data";
import type {
  AdministrationStatus,
  ComplianceLog,
  MedicationSchedule,
} from "@/lib/data-store";

const STATUS_OPTIONS: AdministrationStatus[] = [
  "Administered",
  "Refused",
  "Missed",
];

const GIVE_DOSE_ACTIONS = new Set([
  "MEDICATION_ADMIN",
  "MEDICATION_ADMIN_QUICK",
  "MEDICATION_ADMIN_DUAL",
]);

/**
 * Find today's administration log entry for a given schedule.
 * Match by participant_id + case-insensitive medication name.
 */
export function findTodaysAdministrationLog(
  schedule: MedicationSchedule,
  todaysLogs: ComplianceLog[],
): ComplianceLog | undefined {
  const target = schedule.medicationName.trim().toLowerCase();
  return todaysLogs.find((l) => {
    if (!GIVE_DOSE_ACTIONS.has(l.actionPerformed)) return false;
    if (!l.participantId || l.participantId !== schedule.participantId) {
      return false;
    }
    const meta = l.metadata as Record<string, unknown>;
    const name = String(meta.medication_name ?? "").trim().toLowerCase();
    return name === target;
  });
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: MedicationSchedule | null;
  participantName: string;
}

export function GiveDoseModal({
  open,
  onOpenChange,
  schedule,
  participantName,
}: Props) {
  const { data: staff = [], isLoading: staffLoading } = useStaffRegistry();
  const giveDose = useGiveDose();

  const [administeredById, setAdministeredById] = useState("");
  const [witnessedById, setWitnessedById] = useState("");
  const [status, setStatus] = useState<AdministrationStatus>("Administered");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<{
    administeredBy?: string;
    witnessedBy?: string;
    notes?: string;
    form?: string;
  }>({});

  useEffect(() => {
    if (open) {
      setAdministeredById("");
      setWitnessedById("");
      setStatus("Administered");
      setNotes("");
      setErrors({});
    }
  }, [open]);

  const activeStaff = useMemo(
    () => staff.filter((s) => s.active),
    [staff],
  );

  const now = new Date();
  const nowLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const requiresNotes = status === "Refused";

  const submit = async () => {
    if (!schedule || giveDose.isPending) return;

    // Click-time validation — surfaces visible per-field errors instead of
    // silently disabling the button.
    const next: typeof errors = {};
    if (!administeredById) {
      next.administeredBy = "Select the administering staff member.";
    }
    if (!witnessedById) {
      next.witnessedBy = "Select a staff witness.";
    }
    if (
      administeredById &&
      witnessedById &&
      administeredById === witnessedById
    ) {
      next.administeredBy =
        "Administering staff and witness must be different people.";
      next.witnessedBy =
        "Administering staff and witness must be different people.";
    }
    if (requiresNotes && notes.trim().length < 10) {
      next.notes =
        "Refusal requires at least 10 characters of context for the audit trail.";
    }
    if (Object.keys(next).length > 0) {
      next.form =
        "Dual sign-off is mandatory. Please select a staff witness to verify medication delivery.";
      setErrors(next);
      return;
    }
    setErrors({});

    const administeredBy = activeStaff.find((s) => s.id === administeredById);
    const witnessedBy = activeStaff.find((s) => s.id === witnessedById);
    if (!administeredBy || !witnessedBy) return;

    try {
      await giveDose.mutateAsync({
        scheduleId: schedule.id,
        participantId: schedule.participantId as string,
        medicationName: schedule.medicationName,
        dosage: schedule.dosage,
        scheduledTime: schedule.expectedTime,
        administeredById: administeredBy.id,
        administeredByName: administeredBy.fullName,
        witnessedById: witnessedBy.id,
        witnessedByName: witnessedBy.fullName,
        status,
        notes: notes.trim() || undefined,
      });
      toast.success("Medication administration logged successfully.", {
        description: `${schedule.medicationName} — ${status} for ${participantName}.`,
        className: "!bg-green-600 !text-white !border-green-700",
      });
      onOpenChange(false);
    } catch (err) {
      // Keep the form open so the user can adjust and retry.
      toast.error((err as Error).message || "Database rejected the sign-off.", {
        description:
          "Postgres rejected the insert. The form has been kept open so you can adjust and retry.",
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Syringe className="h-5 w-5 text-primary" />
            Medication Administration Verification
          </DialogTitle>
          <DialogDescription>
            Dual-staff sign-off, written to the compliance audit trail.
          </DialogDescription>
        </DialogHeader>

        {schedule && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            Administering{" "}
            <span className="font-semibold text-foreground">
              {schedule.medicationName}
            </span>{" "}
            —{" "}
            <span className="font-semibold text-foreground">
              {schedule.dosage}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-foreground">
              {participantName}
            </span>{" "}
            at{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {nowLabel}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              (scheduled {schedule.expectedTime.slice(0, 5)})
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Administered By
            </Label>
            <Select
              value={administeredById}
              onValueChange={setAdministeredById}
              disabled={staffLoading}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select staff…" />
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
              Witnessed / Verified By
            </Label>
            <Select
              value={witnessedById}
              onValueChange={setWitnessedById}
              disabled={staffLoading}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select witness…" />
              </SelectTrigger>
              <SelectContent>
                {activeStaff
                  .filter((s) => s.id !== administeredById)
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
              Administration Status
            </Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as AdministrationStatus)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiresNotes && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Refusal notes (required)
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Participant refused 8am dose, stated nausea. Escalated to RN on duty."
                maxLength={1000}
              />
              <p className="text-[11px] text-muted-foreground">
                Minimum 10 characters. {notes.trim().length}/1000
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {giveDose.isPending ? "Saving…" : "Confirm & Sign Off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

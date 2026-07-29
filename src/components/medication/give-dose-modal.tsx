/**
 * BL-077 — Give Dose with dual staff PIN or sole-carer PIN + justification.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Syringe, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getOperationalClockSnapshot,
  subscribeOperationalClock,
} from "@/lib/operational-clock";
import { operationalNowMinutes } from "@/lib/medication/todays-medication-round";

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
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyNamedStaffPin } from "@/components/auth/pin-verify";

import { useStaffRegistry } from "@/hooks/use-supabase-data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  insertDualWitnessAdministrationLog,
  insertSoleCarerAdministrationLog,
  type AdministrationStatus,
  type ComplianceLog,
  type MedicationSchedule,
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
  "MEDICATION_ADMIN_SOLE",
]);

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

type SignMode = "dual" | "sole";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: MedicationSchedule | null;
  participantName: string;
  /** Default dual; trips often need sole available. */
  allowSoleCarer?: boolean;
  source?: string;
  eventId?: string | null;
  eventDaySessionId?: string | null;
}

export function GiveDoseModal({
  open,
  onOpenChange,
  schedule,
  participantName,
  allowSoleCarer = true,
  source = "care_profile_give_dose",
  eventId = null,
  eventDaySessionId = null,
}: Props) {
  const { data: staff = [], isLoading: staffLoading } = useStaffRegistry();
  const qc = useQueryClient();

  const [mode, setMode] = useState<SignMode>("dual");
  const [administeredById, setAdministeredById] = useState("");
  const [witnessedById, setWitnessedById] = useState("");
  const [adminPin, setAdminPin] = useState<string | null>(null);
  const [witnessPin, setWitnessPin] = useState<string | null>(null);
  const [solePin, setSolePin] = useState<string | null>(null);
  const [soleNote, setSoleNote] = useState("");
  const [status, setStatus] = useState<AdministrationStatus>("Administered");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode("dual");
      setAdministeredById("");
      setWitnessedById("");
      setAdminPin(null);
      setWitnessPin(null);
      setSolePin(null);
      setSoleNote("");
      setStatus("Administered");
      setNotes("");
      setFormError(null);
    }
  }, [open]);

  const activeStaff = useMemo(
    () => staff.filter((s) => s.active),
    [staff],
  );

  useSyncExternalStore(
    subscribeOperationalClock,
    getOperationalClockSnapshot,
    () => "ssr:live",
  );
  const nowMins = operationalNowMinutes();
  const nowLabel = `${String(Math.floor(nowMins / 60)).padStart(2, "0")}:${String(nowMins % 60).padStart(2, "0")}`;

  const requiresNotes = status === "Refused";

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!schedule) throw new Error("No schedule selected.");
      if (requiresNotes && notes.trim().length < 10) {
        throw new Error("Refusal requires at least 10 characters of notes.");
      }
      if (mode === "dual") {
        if (!administeredById || !witnessedById) {
          throw new Error("Select administering staff and witness.");
        }
        if (administeredById === witnessedById) {
          throw new Error("Administering staff and witness must be different.");
        }
        if (!adminPin || !witnessPin) {
          throw new Error("Both staff must enter their PIN.");
        }
        await verifyNamedStaffPin(administeredById, adminPin);
        await verifyNamedStaffPin(witnessedById, witnessPin);
        const administeredBy = activeStaff.find((s) => s.id === administeredById);
        const witnessedBy = activeStaff.find((s) => s.id === witnessedById);
        if (!administeredBy || !witnessedBy) throw new Error("Staff not found.");
        await insertDualWitnessAdministrationLog({
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
          source,
          eventId,
          eventDaySessionId,
        });
        return;
      }
      if (!administeredById || !solePin) {
        throw new Error("Select staff and enter PIN for sole-carer sign-off.");
      }
      if (soleNote.trim().length < 10) {
        throw new Error("Sole-carer justification needs at least 10 characters.");
      }
      await verifyNamedStaffPin(administeredById, solePin);
      const administeredBy = activeStaff.find((s) => s.id === administeredById);
      if (!administeredBy) throw new Error("Staff not found.");
      await insertSoleCarerAdministrationLog({
        scheduleId: schedule.id,
        participantId: schedule.participantId as string,
        medicationName: schedule.medicationName,
        dosage: schedule.dosage,
        scheduledTime: schedule.expectedTime,
        administeredById: administeredBy.id,
        administeredByName: administeredBy.fullName,
        soleCarerNote: soleNote.trim(),
        status,
        notes: notes.trim() || undefined,
        source,
        eventId,
        eventDaySessionId,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["compliance_audit_logs"] });
      void qc.invalidateQueries({ queryKey: ["compliance_audit_logs", "today"] });
      void qc.invalidateQueries({ queryKey: ["medication_schedules"] });
      toast.success("Medication administration logged.", {
        description: `${schedule?.medicationName} — ${status} for ${participantName}.`,
      });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      setFormError(e.message);
      toast.error(e.message);
    },
  });

  const adminName =
    activeStaff.find((s) => s.id === administeredById)?.fullName ?? "Staff";
  const witnessName =
    activeStaff.find((s) => s.id === witnessedById)?.fullName ?? "Witness";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Syringe className="h-5 w-5 text-primary" />
            Medication administration
          </DialogTitle>
          <DialogDescription>
            Dual staff PIN when two carers are available; sole-carer PIN +
            justification when only one. Never a client as witness. Clock{" "}
            {nowLabel}.
          </DialogDescription>
        </DialogHeader>

        {schedule && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="font-medium">{participantName}</div>
              <div>
                {schedule.medicationName} · {schedule.dosage} · due{" "}
                {schedule.expectedTime.slice(0, 5)}
              </div>
            </div>

            {allowSoleCarer && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sign-off mode
                </p>
                <MobileFieldButton
                  title="Dual staff PIN"
                  subtitle="Administering staff + witness — both PIN"
                  tone="info"
                  active={mode === "dual"}
                  onClick={() => {
                    setMode("dual");
                    setSolePin(null);
                    setFormError(null);
                  }}
                />
                <MobileFieldButton
                  title="Sole carer PIN"
                  subtitle="One staff only — PIN + why no second carer"
                  tone="neutral"
                  active={mode === "sole"}
                  onClick={() => {
                    setMode("sole");
                    setWitnessedById("");
                    setAdminPin(null);
                    setWitnessPin(null);
                    setFormError(null);
                  }}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Outcome</Label>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={status === s ? "default" : "outline"}
                    className="h-11 min-h-11"
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            {(requiresNotes || mode === "sole") && (
              <CharacterCountedTextarea
                label={
                  mode === "sole"
                    ? "Sole-carer justification"
                    : "Refusal notes"
                }
                value={mode === "sole" ? soleNote : notes}
                onValueChange={mode === "sole" ? setSoleNote : setNotes}
                minChars={10}
                maxChars={240}
                rows={2}
                required
                placeholder={
                  mode === "sole"
                    ? "Why no second staff (min 10 characters)"
                    : "Context for refusal (min 10 characters)"
                }
              />
            )}
            {mode === "dual" && !requiresNotes && (
              <CharacterCountedTextarea
                label="Notes (optional)"
                value={notes}
                onValueChange={setNotes}
                minChars={0}
                maxChars={200}
                rows={2}
                required={false}
                placeholder="Optional notes"
              />
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {mode === "sole" ? "Administering staff" : "Administering staff"}
              </p>
              {staffLoading ? (
                <p className="text-sm text-muted-foreground">Loading staff…</p>
              ) : (
                <div className="max-h-36 space-y-1.5 overflow-y-auto">
                  {activeStaff.map((s) => (
                    <MobileFieldButton
                      key={s.id}
                      title={s.fullName}
                      subtitle={s.role ?? "Staff"}
                      tone="info"
                      active={administeredById === s.id}
                      onClick={() => {
                        setAdministeredById(s.id);
                        setAdminPin(null);
                        setSolePin(null);
                        setFormError(null);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {mode === "dual" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Witness
                </p>
                <div className="max-h-36 space-y-1.5 overflow-y-auto">
                  {activeStaff
                    .filter((s) => s.id !== administeredById)
                    .map((s) => (
                      <MobileFieldButton
                        key={s.id}
                        title={s.fullName}
                        subtitle={s.role ?? "Staff"}
                        tone="info"
                        active={witnessedById === s.id}
                        onClick={() => {
                          setWitnessedById(s.id);
                          setWitnessPin(null);
                          setFormError(null);
                        }}
                      />
                    ))}
                </div>
              </div>
            )}

            {mode === "dual" && administeredById && (
              <PinEntryTrigger
                className="w-full"
                label={
                  adminPin
                    ? `${adminName} PIN verified`
                    : `${adminName} — enter PIN`
                }
                verified={!!adminPin}
                verifiedLabel={`${adminName} PIN verified`}
                length={4}
                title="Administering staff PIN"
                description={`${adminName}: confirm you administered this dose.`}
                onVerify={async (pin) => {
                  await verifyNamedStaffPin(administeredById, pin);
                }}
                onSuccess={(pin) => setAdminPin(pin)}
              />
            )}
            {mode === "dual" && witnessedById && (
              <PinEntryTrigger
                className="w-full"
                label={
                  witnessPin
                    ? `${witnessName} PIN verified`
                    : `${witnessName} — enter PIN`
                }
                verified={!!witnessPin}
                verifiedLabel={`${witnessName} PIN verified`}
                length={4}
                title="Witness PIN"
                description={`${witnessName}: confirm you witnessed this dose.`}
                onVerify={async (pin) => {
                  await verifyNamedStaffPin(witnessedById, pin);
                }}
                onSuccess={(pin) => setWitnessPin(pin)}
              />
            )}
            {mode === "sole" && administeredById && (
              <PinEntryTrigger
                className="w-full"
                label={
                  solePin
                    ? `${adminName} PIN verified`
                    : `${adminName} — sole-carer PIN`
                }
                verified={!!solePin}
                verifiedLabel={`${adminName} PIN verified`}
                length={4}
                title="Sole-carer PIN"
                description={`${adminName}: you are the only staff attesting this dose.`}
                onVerify={async (pin) => {
                  await verifyNamedStaffPin(administeredById, pin);
                }}
                onSuccess={(pin) => setSolePin(pin)}
              />
            )}

            {formError && (
              <p className={cn("flex items-start gap-2 text-sm text-destructive")}>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {formError}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            disabled={saveMut.isPending || !schedule}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? "Saving…" : "Log administration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

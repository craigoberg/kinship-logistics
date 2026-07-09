import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, ShieldCheck, WifiOff, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useParticipants, useStaffRegistry } from "@/hooks/use-supabase-data";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  hashPin,
  insertComplianceLog,
  getDeviceUuid,
  resolveStaffIdWithFallback,
  type MedicationEventType,
  type MedicationLogPayload,
  type Participant,
  type StaffMember,
} from "@/lib/data-store";
import {
  writeToLedgerOrThrow,
  tryGetGps,
  type LedgerSeverity,
} from "@/lib/api/ledger";
import { enqueue } from "@/lib/sync-queue";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional preselected participant (from Care Profile context). */
  participant?: Participant | null;
}


/** Maps medication event type to operational_ledger severity and action_type. */
const LEDGER_MAP: Record<
  MedicationEventType,
  { severity: LedgerSeverity; actionType: string; label: string }
> = {
  MEDICATION_ADMIN: {
    severity: "GREEN",
    actionType: "MEDICATION_ADMINISTERED",
    label: "Administration",
  },
  MEDICATION_REFUSED: {
    severity: "YELLOW",
    actionType: "MEDICATION_REFUSED",
    label: "Participant Refusal",
  },
  MEDICATION_MISSED_BYPASS: {
    severity: "RED",
    actionType: "MEDICATION_WINDOW_BYPASSED",
    label: "Missed Window — Late Administration",
  },
};


async function verifyWitnessPin(member: StaffMember | undefined, pin: string): Promise<void> {
  if (!member?.pinHash) throw new Error("Incorrect PIN. Please try again.");
  const candidate = await hashPin(pin);
  const ok = candidate === member.pinHash || pin === member.pinHash;
  if (!ok) throw new Error("Incorrect PIN. Please try again.");
}

export function MedicationAdminModal({ open, onOpenChange, participant }: Props) {
  const online = useOnlineStatus();
  const { data: participants = [] } = useParticipants();
  const {
    data: staff = [],
    isLoading: staffLoading,
    error: staffError,
  } = useStaffRegistry();

  const [eventType, setEventType] = useState<MedicationEventType>("MEDICATION_ADMIN");
  const [participantId, setParticipantId] = useState<string>("");
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [notes, setNotes] = useState("");
  const [witness1Id, setWitness1Id] = useState("");
  const [witness1PinVerified, setWitness1PinVerified] = useState(false);
  const witness1PinRef = useRef("");
  const [witness2Id, setWitness2Id] = useState("");
  const [witness2PinVerified, setWitness2PinVerified] = useState(false);
  const witness2PinRef = useRef("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset on (re)open
  useEffect(() => {
    if (open) {
      setEventType("MEDICATION_ADMIN");
      setParticipantId(participant?.id ?? "");
      setParticipantPickerOpen(false);
      setMedicationName("");
      setDosage("");
      setNotes("");
      setWitness1Id("");
      setWitness1PinVerified(false);
      witness1PinRef.current = "";
      setWitness2Id("");
      setWitness2PinVerified(false);
      witness2PinRef.current = "";
      setPinError(null);
      setSubmitting(false);
    }
  }, [open, participant?.id]);

  // Clear stale PIN errors as the user edits.
  useEffect(() => {
    if (pinError) setPinError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [witness1PinVerified, witness2PinVerified, witness1Id, witness2Id]);

  const dirty =
    participantId.length > 0 ||
    medicationName.length > 0 ||
    dosage.length > 0 ||
    notes.length > 0 ||
    witness1Id.length > 0 ||
    witness1PinVerified ||
    witness2Id.length > 0 ||
    witness2PinVerified;

  const witnessesDistinct = witness1Id !== "" && witness2Id !== "" && witness1Id !== witness2Id;

  const canSubmit =
    !submitting &&
    dirty &&
    participantId.length > 0 &&
    medicationName.trim().length > 0 &&
    dosage.trim().length > 0 &&
    witnessesDistinct &&
    witness1PinVerified &&
    witness2PinVerified;

  const selectedParticipant = useMemo(
    () => participants.find((p) => p.id === participantId) ?? null,
    [participants, participantId],
  );

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setPinError(null);

    try {
      const w1 = staffById.get(witness1Id);
      const w2 = staffById.get(witness2Id);
      if (!witness1PinVerified || !witness2PinVerified) {
        setPinError("Both witness PINs must be verified.");
        return;
      }

      const [w1Hash, w2Hash] = await Promise.all([
        hashPin(witness1PinRef.current),
        hashPin(witness2PinRef.current),
      ]);

      const payload: MedicationLogPayload = {
        participant_id: participantId,
        action_performed: eventType,
        witness_1_identity: w1!.fullName,
        witness_2_identity: w2!.fullName,
        timestamp: new Date().toISOString(),
        metadata: {
          medication_name: medicationName.trim(),
          dosage: dosage.trim(),
          notes: notes.trim(),
          witness_1_pin_hash: w1Hash,
          witness_2_pin_hash: w2Hash,
          network_state: online ? "online" : "offline",
          device_uuid: getDeviceUuid(),
        },
      };

      // Offline path — enqueue as before; ledger requires network.
      if (!online) {
        enqueue("medication_log", payload as unknown as Record<string, unknown>);
        toast.info("Queued offline", {
          description: "Medication log will sync when connectivity returns.",
        });
        onOpenChange(false);
        return;
      }

      // ── Online path ─────────────────────────────────────────────────────
      // GUARDRAILS §1.1 — ledger write FIRST via writeToLedgerOrThrow.
      // If this fails, the entire record is aborted; the operator must be
      // told explicitly — no silent fallback to enqueue for a medication event.
      const { severity, actionType } = LEDGER_MAP[eventType];
      const staffId = await resolveStaffIdWithFallback();
      const gps = await tryGetGps();

      try {
        await writeToLedgerOrThrow({
          staff_id: staffId,
          category: "CLIENT",
          severity,
          action_type: actionType,
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            participant_id: participantId,
            participant_name: selectedParticipant?.fullName ?? null,
            medication_name: medicationName.trim(),
            dosage: dosage.trim(),
            notes: notes.trim() || null,
            witness_1: w1!.fullName,
            witness_2: w2!.fullName,
            event_type: eventType,
            source: "medication_admin_modal",
          },
        });
      } catch (ledgerErr) {
        // Ledger failure = abort entirely. Surface it clearly — do NOT enqueue
        // silently, do NOT close the modal, so the operator knows the record
        // was not written.
        toast.error("Medication record aborted — ledger write failed", {
          description:
            (ledgerErr as Error).message ??
            "Could not write to the audit ledger. Contact your coordinator immediately.",
        });
        return; // modal stays open
      }

      // Ledger succeeded — write secondary compliance_audit_logs record.
      // If this fails, we enqueue for retry (ledger receipt already exists,
      // so the event is already on record per GUARDRAILS §1.1).
      try {
        await insertComplianceLog(payload);
      } catch (complianceErr) {
        enqueue("medication_log", payload as unknown as Record<string, unknown>);
        console.warn("[MedicationAdminModal] compliance_audit_logs write failed — enqueued", complianceErr);
      }

      const eventLabel = LEDGER_MAP[eventType].label;
      toast.success(`Medication log recorded — ${eventLabel}`, {
        description: `Dual-witness sign-off saved for ${selectedParticipant?.fullName ?? "participant"}. Ledger receipt written.`,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const isMissedBypass = eventType === "MEDICATION_MISSED_BYPASS";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <DialogTitle>Record medication event</DialogTitle>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            Single-device dual-witness PIN verification. Writes an immutable row to{" "}
            <code className="rounded bg-muted px-1 text-[11px]">operational_ledger</code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1 text-[11px]">compliance_audit_logs</code>.
            {!online && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/50 px-2 py-0.5 text-[11px] font-medium text-warning">
                <WifiOff className="h-3 w-3" /> Offline — will queue
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Event type selector */}
          <Field label="Event type">
            <div className="flex gap-2">
              {(
                [
                  "MEDICATION_ADMIN",
                  "MEDICATION_REFUSED",
                  "MEDICATION_MISSED_BYPASS",
                ] as MedicationEventType[]
              ).map((type) => {
                const { label, severity } = LEDGER_MAP[type];
                const active = eventType === type;
                const colorClass =
                  severity === "RED"
                    ? active
                      ? "border-destructive bg-destructive/10 text-destructive font-semibold"
                      : "border-border text-muted-foreground hover:border-destructive/50"
                    : severity === "YELLOW"
                      ? active
                        ? "border-yellow-500 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200 font-semibold"
                        : "border-border text-muted-foreground hover:border-yellow-500/50"
                      : active
                        ? "border-green-600 bg-green-600/10 text-green-800 dark:text-green-200 font-semibold"
                        : "border-border text-muted-foreground hover:border-green-600/50";
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setEventType(type)}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-2 text-xs transition",
                      colorClass,
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Missed-window warning banner */}
          {isMissedBypass && (
            <div className="flex items-start gap-2 rounded-md border-2 border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-semibold">RED event — ledger write required.</span> This
                action will write a RED severity receipt to the immutable audit ledger. If the
                ledger write fails the record is aborted and you must contact your coordinator.
              </p>
            </div>
          )}

          <Field label="Participant">
            <Popover open={participantPickerOpen} onOpenChange={setParticipantPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={participantPickerOpen}
                  className="h-9 w-full justify-between font-normal"
                >
                  <span className={cn(!selectedParticipant && "text-muted-foreground")}>
                    {selectedParticipant
                      ? `${selectedParticipant.fullName} · ${selectedParticipant.ndisNumber}`
                      : "Search participants…"}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[--radix-popover-trigger-width] p-0"
              >
                <Command>
                  <CommandInput placeholder="Type a name or NDIS #…" />
                  <CommandList>
                    <CommandEmpty>No participants found.</CommandEmpty>
                    <CommandGroup>
                      {participants.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={`${p.fullName} ${p.ndisNumber}`}
                          onSelect={() => {
                            setParticipantId(p.id);
                            setParticipantPickerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              participantId === p.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">{p.fullName}</span>
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {p.ndisNumber}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </Field>

          <Field label="Medication name">
            <Input
              value={medicationName}
              onChange={(e) => setMedicationName(e.target.value)}
              placeholder="e.g. Paracetamol"
            />
          </Field>

          <Field label="Dosage">
            <Input
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="e.g. 500mg — 1 tablet"
            />
          </Field>

          <Field label={eventType === "MEDICATION_REFUSED" ? "Refusal reason / notes" : "Administration notes"}>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                eventType === "MEDICATION_REFUSED"
                  ? "Reason for refusal, participant's stated concerns, follow-up actions…"
                  : eventType === "MEDICATION_MISSED_BYPASS"
                    ? "Why the window was missed, when it was administered, any clinical guidance sought…"
                    : "Route, time, observations, participant tolerance…"
              }
            />
          </Field>

          {staffError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Couldn't load staff_registry: {(staffError as Error).message}</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <WitnessBlock
              title="Witness 1 sign-off"
              staff={staff}
              staffLoading={staffLoading}
              staffValue={witness1Id}
              onStaffChange={(id) => {
                setWitness1Id(id);
                setWitness1PinVerified(false);
                witness1PinRef.current = "";
              }}
              pinVerified={witness1PinVerified}
              onPinVerified={(pin) => {
                witness1PinRef.current = pin;
                setWitness1PinVerified(true);
              }}
              excludeId={witness2Id}
            />
            <WitnessBlock
              title="Witness 2 sign-off"
              staff={staff}
              staffLoading={staffLoading}
              staffValue={witness2Id}
              onStaffChange={(id) => {
                setWitness2Id(id);
                setWitness2PinVerified(false);
                witness2PinRef.current = "";
              }}
              pinVerified={witness2PinVerified}
              onPinVerified={(pin) => {
                witness2PinRef.current = pin;
                setWitness2PinVerified(true);
              }}
              excludeId={witness1Id}
            />
          </div>

          {witness1Id && witness2Id && !witnessesDistinct && (
            <p className="text-xs text-destructive">
              Witness 1 and Witness 2 must be different staff members.
            </p>
          )}

          {pinError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{pinError}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              "gap-1.5",
              isMissedBypass
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "",
            )}
          >
            <ShieldCheck className="h-4 w-4" />
            {submitting ? "Verifying…" : "Verify and submit log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WitnessBlock({
  title,
  staff,
  staffLoading,
  staffValue,
  onStaffChange,
  pinVerified,
  onPinVerified,
  excludeId,
}: {
  title: string;
  staff: StaffMember[];
  staffLoading: boolean;
  staffValue: string;
  onStaffChange: (v: string) => void;
  pinVerified: boolean;
  onPinVerified: (pin: string) => void;
  excludeId: string;
}) {
  const options = staff.filter((s) => s.id !== excludeId);
  const selected = staff.find((s) => s.id === staffValue);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <Select value={staffValue} onValueChange={onStaffChange} disabled={staffLoading}>
        <SelectTrigger>
          <SelectValue
            placeholder={staffLoading ? "Loading staff…" : "Select staff member"}
          />
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No staff available.
            </div>
          ) : (
            options.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.fullName}
                {s.role && (
                  <span className="text-muted-foreground"> — {s.role}</span>
                )}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <PinEntryTrigger
        label="Tap to enter witness PIN"
        verified={pinVerified}
        verifiedLabel="Witness PIN verified"
        length={4}
        title={title}
        description={`Verify ${selected?.fullName ?? "witness"} PIN for medication sign-off.`}
        disabled={!staffValue}
        onVerify={async (pin) => {
          await verifyWitnessPin(selected, pin);
        }}
        onSuccess={onPinVerified}
      />
      <p className="text-[11px] text-muted-foreground">
        4-digit security PIN — verified against staff_registry.pin_hash.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

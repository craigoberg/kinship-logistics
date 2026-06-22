import { useEffect, useMemo, useState } from "react";
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
  type MedicationLogPayload,
  type Participant,
  type StaffMember,
} from "@/lib/data-store";
import { enqueue } from "@/lib/sync-queue";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional preselected participant (from Care Profile context). */
  participant?: Participant | null;
}

const PIN_RE = /^\d{4}$/;

export function MedicationAdminModal({ open, onOpenChange, participant }: Props) {
  const online = useOnlineStatus();
  const { data: participants = [] } = useParticipants();
  const {
    data: staff = [],
    isLoading: staffLoading,
    error: staffError,
  } = useStaffRegistry();

  const [participantId, setParticipantId] = useState<string>("");
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [notes, setNotes] = useState("");
  const [witness1Id, setWitness1Id] = useState("");
  const [witness1Pin, setWitness1Pin] = useState("");
  const [witness2Id, setWitness2Id] = useState("");
  const [witness2Pin, setWitness2Pin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset on (re)open
  useEffect(() => {
    if (open) {
      setParticipantId(participant?.id ?? "");
      setParticipantPickerOpen(false);
      setMedicationName("");
      setDosage("");
      setNotes("");
      setWitness1Id("");
      setWitness1Pin("");
      setWitness2Id("");
      setWitness2Pin("");
      setPinError(null);
      setSubmitting(false);
    }
  }, [open, participant?.id]);

  // Clear stale PIN errors as the user edits.
  useEffect(() => {
    if (pinError) setPinError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [witness1Pin, witness2Pin, witness1Id, witness2Id]);

  const dirty =
    participantId.length > 0 ||
    medicationName.length > 0 ||
    dosage.length > 0 ||
    notes.length > 0 ||
    witness1Id.length > 0 ||
    witness1Pin.length > 0 ||
    witness2Id.length > 0 ||
    witness2Pin.length > 0;

  const witnessesDistinct = witness1Id !== "" && witness2Id !== "" && witness1Id !== witness2Id;

  const canSubmit =
    !submitting &&
    dirty &&
    participantId.length > 0 &&
    medicationName.trim().length > 0 &&
    dosage.trim().length > 0 &&
    witnessesDistinct &&
    PIN_RE.test(witness1Pin) &&
    PIN_RE.test(witness2Pin);

  const selectedParticipant = useMemo(
    () => participants.find((p) => p.id === participantId) ?? null,
    [participants, participantId],
  );

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  /** Verify a 4-digit PIN against the staff member's stored pin_hash. */
  const verifyPin = async (member: StaffMember | undefined, pin: string): Promise<boolean> => {
    if (!member) return false;
    if (!member.pinHash) return false;
    const candidate = await hashPin(pin);
    // Accept either a raw SHA-256 match or a plaintext fallback for legacy rows.
    return candidate === member.pinHash || pin === member.pinHash;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setPinError(null);
    try {
      const w1 = staffById.get(witness1Id);
      const w2 = staffById.get(witness2Id);

      const [w1ok, w2ok] = await Promise.all([
        verifyPin(w1, witness1Pin),
        verifyPin(w2, witness2Pin),
      ]);

      if (!w1ok || !w2ok) {
        setPinError(
          !w1ok && !w2ok
            ? "Incorrect PIN. Please try again. (Both witness PINs)"
            : !w1ok
              ? `Incorrect PIN. Please try again. (Witness 1 — ${w1?.fullName ?? "selected staff"})`
              : `Incorrect PIN. Please try again. (Witness 2 — ${w2?.fullName ?? "selected staff"})`,
        );
        return;
      }

      const [w1Hash, w2Hash] = await Promise.all([hashPin(witness1Pin), hashPin(witness2Pin)]);
      const payload: MedicationLogPayload = {
        participant_id: participantId,
        action_performed: "MEDICATION_ADMIN",
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

      if (!online) {
        enqueue("medication_log", payload as unknown as Record<string, unknown>);
        toast.info("Queued offline", {
          description: "Medication log will sync when connectivity returns.",
        });
        onOpenChange(false);
        return;
      }

      try {
        await insertComplianceLog(payload);
        toast.success("Medication log recorded", {
          description: `Dual-witness sign-off saved for ${selectedParticipant?.fullName ?? "participant"}.`,
        });
        onOpenChange(false);
      } catch (err) {
        enqueue("medication_log", payload as unknown as Record<string, unknown>);
        toast.warning("Saved offline", {
          description: `Will retry automatically. (${(err as Error).message})`,
        });
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <DialogTitle>Record medication administration</DialogTitle>
          </div>
          <DialogDescription className="flex items-center gap-2">
            Single-device dual-witness PIN verification. Writes an immutable row to{" "}
            <code className="rounded bg-muted px-1 text-[11px]">compliance_audit_logs</code>.
            {!online && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-warning/50 px-2 py-0.5 text-[11px] font-medium text-warning">
                <WifiOff className="h-3 w-3" /> Offline — will queue
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
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

          <Field label="Administration notes">
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Route, time, observations, participant tolerance…"
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
              onStaffChange={setWitness1Id}
              pinValue={witness1Pin}
              onPinChange={setWitness1Pin}
              excludeId={witness2Id}
            />
            <WitnessBlock
              title="Witness 2 sign-off"
              staff={staff}
              staffLoading={staffLoading}
              staffValue={witness2Id}
              onStaffChange={setWitness2Id}
              pinValue={witness2Pin}
              onPinChange={setWitness2Pin}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
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
  pinValue,
  onPinChange,
  excludeId,
}: {
  title: string;
  staff: StaffMember[];
  staffLoading: boolean;
  staffValue: string;
  onStaffChange: (v: string) => void;
  pinValue: string;
  onPinChange: (v: string) => void;
  excludeId: string;
}) {
  const options = staff.filter((s) => s.id !== excludeId);
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
      <Input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="----"
        value={pinValue}
        onChange={(e) => onPinChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="tracking-[0.5em] text-center font-mono"
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

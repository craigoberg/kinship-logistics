import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, ShieldCheck, WifiOff } from "lucide-react";
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
import { useParticipants } from "@/hooks/use-supabase-data";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  STAFF_DIRECTORY,
  hashPin,
  insertComplianceLog,
  getDeviceUuid,
  type MedicationLogPayload,
  type Participant,
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

  const [participantId, setParticipantId] = useState<string>("");
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [witness1Id, setWitness1Id] = useState("");
  const [witness1Pin, setWitness1Pin] = useState("");
  const [witness2Id, setWitness2Id] = useState("");
  const [witness2Pin, setWitness2Pin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on (re)open
  useEffect(() => {
    if (open) {
      setParticipantId(participant?.id ?? "");
      setParticipantPickerOpen(false);
      setNotes("");
      setWitness1Id("");
      setWitness1Pin("");
      setWitness2Id("");
      setWitness2Pin("");
      setSubmitting(false);
    }
  }, [open, participant?.id]);

  const dirty =
    participantId.length > 0 ||
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
    notes.trim().length > 0 &&
    witnessesDistinct &&
    PIN_RE.test(witness1Pin) &&
    PIN_RE.test(witness2Pin);

  const selectedParticipant = useMemo(
    () => participants.find((p) => p.id === participantId) ?? null,
    [participants, participantId],
  );

  const witnessName = (id: string) => {
    const s = STAFF_DIRECTORY.find((x) => x.id === id);
    return s ? `${s.name} (${s.role})` : id;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const [w1Hash, w2Hash] = await Promise.all([hashPin(witness1Pin), hashPin(witness2Pin)]);
      const payload: MedicationLogPayload = {
        participant_id: participantId,
        action_performed: "MEDICATION_ADMIN",
        witness_1_identity: witnessName(witness1Id),
        witness_2_identity: witnessName(witness2Id),
        timestamp: new Date().toISOString(),
        metadata: {
          medication_notes: notes.trim(),
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
        // Live insert failed — route to queue so it isn't lost.
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

          <Field label="Medication, dosage & administration notes">
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paracetamol 500mg PO — 1 tablet at 14:00 with water. Participant tolerated well."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <WitnessBlock
              title="Witness 1 sign-off"
              staffValue={witness1Id}
              onStaffChange={setWitness1Id}
              pinValue={witness1Pin}
              onPinChange={setWitness1Pin}
              excludeId={witness2Id}
            />
            <WitnessBlock
              title="Witness 2 sign-off"
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {submitting ? "Submitting…" : "Verify and submit log"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WitnessBlock({
  title,
  staffValue,
  onStaffChange,
  pinValue,
  onPinChange,
  excludeId,
}: {
  title: string;
  staffValue: string;
  onStaffChange: (v: string) => void;
  pinValue: string;
  onPinChange: (v: string) => void;
  excludeId: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <Select value={staffValue} onValueChange={onStaffChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select staff / guardian" />
        </SelectTrigger>
        <SelectContent>
          {STAFF_DIRECTORY.filter((s) => s.id !== excludeId).map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name} <span className="text-muted-foreground">— {s.role}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="••••"
        value={pinValue}
        onChange={(e) => onPinChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="tracking-[0.5em] text-center font-mono"
      />
      <p className="text-[11px] text-muted-foreground">
        4-digit security PIN — hashed on this device before storage.
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

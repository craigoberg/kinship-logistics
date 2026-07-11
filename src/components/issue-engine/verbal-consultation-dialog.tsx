import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, PhoneCall, ShieldAlert } from "lucide-react";

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
import { PinPad } from "@/components/auth/pin-pad";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
  listStaffRegistry,
} from "@/lib/data-store";
import { resolveOperatorStaffIdFromPin } from "@/components/auth/pin-verify";
import {
  tryGetGps,
  writeToLedgerOrThrow,
  type LedgerCategory,
} from "@/lib/api/ledger";

export type VerbalContactOutcome = "manager_reached" | "unable_to_contact";

/** Canonical `[VERBAL WORKAROUND]` prefix for Hub register rows (GUARDRAILS §3). */
export function formatVerbalWorkaroundDescription(
  baseDescription: string,
  payload: {
    managerName: string;
    contactOutcome: VerbalContactOutcome;
    notes: string;
  },
): string {
  const outcomeLabel =
    payload.contactOutcome === "manager_reached"
      ? "Manager reached — agreed plan"
      : "Unable to contact manager";
  return `[VERBAL WORKAROUND] ${baseDescription} — Consulted: ${payload.managerName}. Outcome: ${outcomeLabel}. ${payload.notes}`;
}

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  ledgerCategory: LedgerCategory;
  subjectLabel: string;
  sourceId?: string | null;
  actionType?: string;
  titleOverride?: string;
  descriptionOverride?: string;
  /**
   * Called after ledger receipt is written. Manager is identified by selection
   * only — no manager PIN (manager is not physically present).
   */
  onAccepted: (payload: {
    managerStaffId: string;
    managerName: string;
    contactOutcome: VerbalContactOutcome;
    notes: string;
  }) => void;
}

/**
 * Remote RED verbal consultation — GUARDRAILS §3 variant.
 *
 * The manager is NOT present and must never give their PIN to the operator.
 * Operator selects who they attempted to contact, records the outcome
 * (reached with agreed plan, or unable to contact), and signs with their
 * own PIN only.
 */
export function VerbalConsultationDialog({
  open,
  onOpenChange,
  ledgerCategory,
  subjectLabel,
  sourceId,
  actionType = "RED_VERBAL_CONSULTATION",
  titleOverride,
  descriptionOverride,
  onAccepted,
}: Props) {
  const MIN_NOTES = 20;

  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [contactOutcome, setContactOutcome] = useState<VerbalContactOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [operatorPinVerified, setOperatorPinVerified] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [operatorPinOpen, setOperatorPinOpen] = useState(false);
  const verifiedOperatorStaffIdRef = useRef<string | null>(null);

  const reset = () => {
    setSelectedManagerId("");
    setContactOutcome("");
    setNotes("");
    setOperatorPinVerified(false);
    verifiedOperatorStaffIdRef.current = null;
    setPinDraft("");
    setPinBusy(false);
    setPinError(null);
    setOperatorPinOpen(false);
  };

  const staffQ = useQuery({
    queryKey: ["staff-registry", "coordinators"],
    queryFn: async () => {
      const all = await listStaffRegistry();
      return all.filter(
        (s) =>
          s.active &&
          (s.role === "coordinator" ||
            s.role?.toLowerCase().includes("manager") ||
            s.role?.toLowerCase().includes("coordinator")),
      );
    },
    staleTime: 120_000,
    enabled: open,
  });

  const coordinators = staffQ.data ?? [];

  const selectedManager = useMemo(
    () => coordinators.find((s) => s.id === selectedManagerId) ?? null,
    [coordinators, selectedManagerId],
  );

  const submitMut = useMutation({
    mutationFn: async () => {
      const operatorStaffId =
        verifiedOperatorStaffIdRef.current ??
        getActiveUserProfile()?.staffId ??
        getStaffId() ??
        DEFAULT_STAFF_UUID;
      if (!operatorPinVerified) throw new Error("Operator PIN required.");
      if (!selectedManagerId) throw new Error("Please select the manager you attempted to contact.");
      if (!contactOutcome) throw new Error("Please record the contact outcome.");

      const gps = await tryGetGps();
      await writeToLedgerOrThrow({
        staff_id: operatorStaffId,
        category: ledgerCategory,
        severity: "RED",
        action_type: actionType,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        metadata: {
          subject_type: ledgerCategory === "VEHICLE" ? "transport_asset" : "trip_leg",
          subject_label: subjectLabel,
          source_id: sourceId ?? null,
          manager_staff_id: selectedManagerId,
          manager_name: selectedManager?.fullName ?? selectedManagerId,
          operator_staff_id: operatorStaffId,
          contact_outcome: contactOutcome,
          notes: notes.trim(),
          consultation_mode: "remote",
          gps_attempted: true,
          gps_captured: !!gps,
          source: "verbal_consultation_dialog",
        },
      });

      return {
        managerStaffId: selectedManagerId,
        managerName: selectedManager?.fullName ?? selectedManagerId,
        contactOutcome: contactOutcome as VerbalContactOutcome,
        notes: notes.trim(),
      };
    },
    onSuccess: (payload) => {
      toast.success("Verbal consultation recorded — ledger receipt written", {
        description: "Your contact attempt is on record. You may proceed when the form allows.",
      });
      // Fire onAccepted BEFORE closing so the parent's async handler runs
      // with its current closure (verbalPending is still set at this point).
      onAccepted(payload);
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(
        e.message.startsWith("[ledger]")
          ? "Ledger write failed — consultation aborted"
          : "Could not record verbal consultation",
        { description: e.message },
      );
    },
  });

  const notesOk = notes.trim().length >= MIN_NOTES;
  const managerSelected = !!selectedManagerId;
  const outcomeSelected = contactOutcome === "manager_reached" || contactOutcome === "unable_to_contact";
  const operatorPinOk = operatorPinVerified;
  const canSubmit =
    notesOk && managerSelected && outcomeSelected && operatorPinOk && !submitMut.isPending;

  const handleClose = () => {
    if (submitMut.isPending) return;
    reset();
    onOpenChange(false);
  };

  async function verifyOperatorPinInline(pin: string) {
    setPinBusy(true);
    setPinError(null);
    try {
      const staffId = await resolveOperatorStaffIdFromPin(pin);
      verifiedOperatorStaffIdRef.current = staffId;
      setOperatorPinVerified(true);
      setPinDraft("");
      setOperatorPinOpen(false);
      toast.success("Operator PIN verified");
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Incorrect operator PIN.");
      setPinDraft("");
    } finally {
      setPinBusy(false);
    }
  }

  const notesLabel =
    contactOutcome === "unable_to_contact"
      ? "Contact attempts (who, when, how — e.g. called Buffy 3×, no answer, left voicemail 18:42)"
      : "Agreed resolution / plan from manager";

  const notesPlaceholder =
    contactOutcome === "unable_to_contact"
      ? "e.g. Called Buffy at 18:40, 18:45, 18:50 — no answer. SMS sent. Proceeding per standing unsafe-drop protocol."
      : "e.g. Spoke with Buffy at 18:42 — agreed to leave passenger with on-site carer and notify family immediately.";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[92dvh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-amber-600" />
            {titleOverride ?? "RED Verbal Consultation"}
          </DialogTitle>
          <DialogDescription>
            {descriptionOverride ??
              "The manager is not with you. Select who you attempted to contact, record the outcome, and sign with your operator PIN. Do not enter the manager's PIN."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">{subjectLabel}</span> — record your
              manager contact attempt. The manager is remote; only your operator PIN
              is required to confirm this log.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Manager contacted (or attempted){" "}
              <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedManagerId}
              onValueChange={setSelectedManagerId}
              disabled={staffQ.isLoading}
            >
              <SelectTrigger
                className={
                  !managerSelected
                    ? "border-2 border-destructive focus:ring-destructive"
                    : ""
                }
              >
                <SelectValue
                  placeholder={
                    staffQ.isLoading
                      ? "Loading staff…"
                      : coordinators.length === 0
                        ? "No coordinators found"
                        : "Select manager…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {coordinators.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                    <span className="ml-2 text-xs text-muted-foreground">({s.role})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contact outcome <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={contactOutcome}
              onValueChange={(v) => setContactOutcome(v as VerbalContactOutcome)}
              className="grid gap-2"
            >
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <RadioGroupItem value="manager_reached" id="outcome-reached" className="mt-0.5" />
                <div>
                  <div className="font-medium">Manager reached — agreed plan documented</div>
                  <div className="text-xs text-muted-foreground">
                    You spoke with the manager and have a verbal resolution.
                  </div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <RadioGroupItem value="unable_to_contact" id="outcome-unreachable" className="mt-0.5" />
                <div>
                  <div className="font-medium">Unable to contact manager</div>
                  <div className="text-xs text-muted-foreground">
                    Document every attempt (calls, SMS, times).
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {outcomeSelected && (
            <CharacterCountedTextarea
              label={notesLabel}
              value={notes}
              onValueChange={setNotes}
              placeholder={notesPlaceholder}
              minChars={MIN_NOTES}
              rows={4}
              required
            />
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your operator PIN <span className="text-destructive">*</span>
            </Label>
            {!operatorPinVerified ? (
              !operatorPinOpen ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full"
                  disabled={!outcomeSelected || !notesOk}
                  onClick={() => setOperatorPinOpen(true)}
                >
                  Sign with your PIN
                </Button>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="mb-2 text-xs text-muted-foreground">Your 4-digit operator PIN</p>
                  <PinPad
                    value={pinDraft}
                    onChange={setPinDraft}
                    length={4}
                    disabled={pinBusy}
                    keyboardActive
                    onComplete={(pin) => void verifyOperatorPinInline(pin)}
                  />
                  {pinBusy && (
                    <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…
                    </p>
                  )}
                  {pinError && <p className="mt-2 text-xs font-medium text-destructive">{pinError}</p>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setOperatorPinOpen(false)}
                  >
                    Hide PIN pad
                  </Button>
                </div>
              )
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-green-700">
                <Check className="h-4 w-4" /> Operator PIN verified
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Confirms you attempted manager contact and the details above are accurate. The manager
              confirms the outcome later in the Governance Hub.
            </p>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-5 py-3">
          <Button variant="outline" onClick={handleClose} disabled={submitMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {submitMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Record consultation & proceed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

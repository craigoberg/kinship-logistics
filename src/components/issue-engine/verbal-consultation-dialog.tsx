import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, PhoneCall, ShieldAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PinPad } from "@/components/auth/pin-pad";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { requiredFieldOutline } from "@/lib/ui/required-field";
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
  const isMobile = useIsMobile();

  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
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
    setManagerFilter("");
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

  const coordinators = useMemo(() => {
    const list = (staffQ.data ?? [])
      .map((s) => ({
        id: s.id,
        fullName: s.fullName?.trim() || "Staff",
        role: s.role ?? "",
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return list;
  }, [staffQ.data]);

  const filteredManagers = useMemo(() => {
    const q = managerFilter.trim().toLowerCase();
    if (!q) return coordinators;
    return coordinators.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q),
    );
  }, [coordinators, managerFilter]);

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

  const title = titleOverride ?? "RED Verbal Consultation";
  const description =
    descriptionOverride ??
    "The manager is not with you. Select who you attempted to contact, record the outcome, and sign with your operator PIN. Do not enter the manager's PIN.";

  const listRowClass =
    "flex min-h-14 w-full touch-manipulation items-center rounded-md px-3 text-left text-sm transition hover:bg-muted/60";

  const scrollBody = (
    <div className="space-y-4">
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
        {selectedManager && (
          <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{selectedManager.fullName}</span>
            {selectedManager.role ? (
              <span className="ml-2 text-xs text-muted-foreground">
                ({selectedManager.role})
              </span>
            ) : null}
          </div>
        )}
        <Input
          value={managerFilter}
          onChange={(e) => setManagerFilter(e.target.value)}
          placeholder="Filter managers…"
          className="h-12"
          disabled={staffQ.isLoading}
        />
        <div
          className={cn(
            "max-h-[40dvh] space-y-1 overflow-y-auto rounded-md border p-1 sm:max-h-48",
            requiredFieldOutline(!managerSelected),
          )}
        >
          {staffQ.isLoading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
          ) : filteredManagers.length === 0 ? (
            <p className="px-2 py-3 text-sm text-destructive">
              No matching managers.
            </p>
          ) : (
            filteredManagers.map((s) => {
              const selected = selectedManagerId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedManagerId(s.id)}
                  className={cn(
                    listRowClass,
                    selected &&
                      "border border-primary bg-primary font-medium text-primary-foreground",
                  )}
                >
                  <span>
                    {selected ? "✓ " : ""}
                    {s.fullName}
                    {s.role ? (
                      <span
                        className={cn(
                          "ml-2 text-xs",
                          selected
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        ({s.role})
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contact outcome <span className="text-destructive">*</span>
        </Label>
        <div className="grid gap-2">
          {(
            [
              {
                value: "manager_reached" as const,
                title: "Manager reached — agreed plan documented",
                hint: "You spoke with the manager and have a verbal resolution.",
              },
              {
                value: "unable_to_contact" as const,
                title: "Unable to contact manager",
                hint: "Document every attempt (calls, SMS, times).",
              },
            ] as const
          ).map((opt) => {
            const active = contactOutcome === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setContactOutcome(opt.value)}
                className={cn(
                  "min-h-14 w-full touch-manipulation rounded-xl border-2 px-4 py-3 text-left transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : cn(
                        "border-border bg-background hover:bg-muted/50",
                        requiredFieldOutline(!outcomeSelected),
                      ),
                )}
              >
                <div className="text-sm font-medium">
                  {active ? "✓ " : ""}
                  {opt.title}
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-xs",
                    active
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {opt.hint}
                </div>
              </button>
            );
          })}
        </div>
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
              className="h-12 w-full touch-manipulation"
              disabled={!outcomeSelected || !notesOk}
              onClick={() => setOperatorPinOpen(true)}
            >
              Sign with your PIN
            </Button>
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Your 4-digit operator PIN
              </p>
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
              {pinError && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  {pinError}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 min-h-11"
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
          Confirms you attempted manager contact and the details above are
          accurate. The manager confirms the outcome later in the Governance Hub.
        </p>
      </div>
    </div>
  );

  const stickyFooter = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={handleClose}
      >
        Close
      </Button>
      <FieldActionButton
        variant="caution"
        size="sm"
        fullWidth={isMobile}
        disabled={!canSubmit}
        onClick={() => submitMut.mutate()}
        className={cn(!isMobile && "min-w-[14rem] px-4")}
      >
        {submitMut.isPending && (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        )}
        Record consultation & proceed
      </FieldActionButton>
    </div>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) handleClose();
        }}
        hideTicket
        title={
          <span className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-amber-600" />
            {title}
          </span>
        }
        description={description}
        className="flex flex-col gap-0 overflow-hidden"
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">{scrollBody}</div>
        <div className="shrink-0 border-t pt-3">{stickyFooter}</div>
      </BottomSheet>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent hideTicket className="flex max-h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-amber-600" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {scrollBody}
        </div>
        <div className="shrink-0 border-t px-5 py-3">{stickyFooter}</div>
      </DialogContent>
    </Dialog>
  );
}

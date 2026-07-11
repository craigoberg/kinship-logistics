import { useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, PhoneCall, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinPad } from "@/components/auth/pin-pad";
import { verifyManagerPin, resolveOperatorStaffIdFromPin } from "@/components/auth/pin-verify";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { cn } from "@/lib/utils";
import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
  listStaffRegistry,
} from "@/lib/data-store";
import {
  tryGetGps,
  writeToLedgerOrThrow,
  type LedgerCategory,
} from "@/lib/api/ledger";

/**
 * @deprecated Do not use for RED escalations. All app RED paths use
 * `VerbalConsultationDialog` (manager by name, operator PIN only).
 * Retained on disk per preservation policy until explicit removal review.
 */
interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  ledgerCategory: LedgerCategory;
  subjectLabel: string;
  sourceId?: string | null;
  actionType?: string;
  titleOverride?: string;
  descriptionOverride?: string;
  onAccepted: (payload: { managerStaffId: string; managerName: string; reason: string }) => void;
}

type PinStep = "manager" | "operator" | null;

/** GUARDRAILS §3 — portal overlay; one PIN pad at a time (no nested pop-ups). */
export function VerbalAuthOverrideDialog({
  open,
  onOpenChange,
  ledgerCategory,
  subjectLabel,
  sourceId,
  actionType = "VERBAL_AUTH_OVERRIDE",
  titleOverride,
  descriptionOverride,
  onAccepted,
}: Props) {
  const MIN_REASON = 20;

  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [managerPinVerified, setManagerPinVerified] = useState(false);
  const [reason, setReason] = useState("");
  const [operatorPinVerified, setOperatorPinVerified] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [activePinStep, setActivePinStep] = useState<PinStep>(null);
  const verifiedManagerPinRef = useRef("");
  const verifiedOperatorStaffIdRef = useRef<string | null>(null);

  const reset = () => {
    setSelectedManagerId("");
    setManagerPinVerified(false);
    verifiedManagerPinRef.current = "";
    setReason("");
    setOperatorPinVerified(false);
    verifiedOperatorStaffIdRef.current = null;
    setPinDraft("");
    setPinBusy(false);
    setPinError(null);
    setActivePinStep(null);
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

  const reasonOk = reason.trim().length >= MIN_REASON;
  const managerSelected = !!selectedManagerId;

  async function verifyManagerPinInline(pin: string) {
    setPinBusy(true);
    setPinError(null);
    try {
      await verifyManagerPin(selectedManagerId, pin);
      verifiedManagerPinRef.current = pin;
      setManagerPinVerified(true);
      setPinDraft("");
      setActivePinStep(null);
      toast.success("Manager PIN verified");
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Incorrect manager PIN.");
      setPinDraft("");
    } finally {
      setPinBusy(false);
    }
  }

  async function verifyOperatorPinInline(pin: string) {
    setPinBusy(true);
    setPinError(null);
    try {
      verifiedOperatorStaffIdRef.current = await resolveOperatorStaffIdFromPin(pin);
      setOperatorPinVerified(true);
      setPinDraft("");
      setActivePinStep(null);
      toast.success("Operator PIN verified");
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Incorrect operator PIN.");
      setPinDraft("");
    } finally {
      setPinBusy(false);
    }
  }

  function openPinStep(step: PinStep) {
    setPinDraft("");
    setPinError(null);
    setActivePinStep(step);
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      const operatorStaffId =
        verifiedOperatorStaffIdRef.current ??
        getActiveUserProfile()?.staffId ??
        getStaffId() ??
        DEFAULT_STAFF_UUID;
      if (!operatorPinVerified) throw new Error("Operator PIN required.");
      if (!selectedManagerId) throw new Error("Please select the authorising Manager.");
      if (!managerPinVerified) throw new Error("Manager PIN required.");

      const gps = await tryGetGps();
      await writeToLedgerOrThrow({
        staff_id: operatorStaffId,
        category: ledgerCategory,
        severity: "RED",
        action_type: actionType,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        metadata: {
          subject_type:
            ledgerCategory === "VEHICLE" ? "transport_asset" : "site_day_session",
          subject_label: subjectLabel,
          source_id: sourceId ?? null,
          manager_staff_id: selectedManagerId,
          manager_name: selectedManager?.fullName ?? selectedManagerId,
          operator_staff_id: operatorStaffId,
          reason: reason.trim(),
          gps_attempted: true,
          gps_captured: !!gps,
          source: "verbal_auth_override_dialog",
          override_kind:
            actionType === "RED_VERBAL_WORKAROUND" ? "red_verbal_workaround" : "verbal",
        },
      });

      return {
        managerStaffId: selectedManagerId,
        managerName: selectedManager?.fullName ?? selectedManagerId,
        reason: reason.trim(),
      };
    },
    onSuccess: (payload) => {
      toast.success("Verbal workaround recorded — ledger receipt written");
      reset();
      onOpenChange(false);
      onAccepted(payload);
    },
    onError: (e: Error) => {
      toast.error(
        e.message.startsWith("[ledger]")
          ? "Ledger write failed — override aborted"
          : "Could not record verbal authorization",
        { description: e.message },
      );
    },
  });

  const canSubmit =
    reasonOk &&
    managerSelected &&
    managerPinVerified &&
    operatorPinVerified &&
    !submitMut.isPending;

  const handleClose = () => {
    if (submitMut.isPending) return;
    reset();
    onOpenChange(false);
  };

  if (!open || typeof document === "undefined") return null;

  const showOperatorPinStep = managerPinVerified && reasonOk;

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="verbal-auth-title"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 id="verbal-auth-title" className="flex items-center gap-2 text-lg font-semibold">
            <PhoneCall className="h-5 w-5 text-amber-600" />
            {titleOverride ?? "Verbal Authorization Override"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {descriptionOverride ??
              "Complete steps 1–3 in order. PIN entry expands inline here — no second pop-up."}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">{subjectLabel}</span> — offline manager
              authorisation required.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              1. Authorising manager <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedManagerId}
              onValueChange={(v) => {
                setSelectedManagerId(v);
                setManagerPinVerified(false);
                verifiedManagerPinRef.current = "";
                setActivePinStep(null);
                setPinDraft("");
                setPinError(null);
              }}
              disabled={staffQ.isLoading || managerPinVerified}
            >
              <SelectTrigger className={!managerSelected ? "border-2 border-destructive" : ""}>
                <SelectValue placeholder="Select authorising manager…" />
              </SelectTrigger>
              <SelectContent className="z-[110]">
                {coordinators.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                    <span className="ml-2 text-xs text-muted-foreground">({s.role})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedManagerId && !managerPinVerified && (
              activePinStep !== "manager" ? (
                <Button type="button" variant="outline" className="h-12 w-full" onClick={() => openPinStep("manager")}>
                  Enter {selectedManager?.fullName}&apos;s PIN
                </Button>
              ) : (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Manager PIN — 4 digits
                  </p>
                  <PinPad
                    value={pinDraft}
                    onChange={setPinDraft}
                    length={4}
                    disabled={pinBusy}
                    keyboardActive
                    onComplete={(pin) => void verifyManagerPinInline(pin)}
                  />
                  {pinBusy && (
                    <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…
                    </p>
                  )}
                  {pinError && <p className="mt-2 text-xs font-medium text-destructive">{pinError}</p>}
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setActivePinStep(null)}>
                    Hide PIN pad
                  </Button>
                </div>
              )
            )}
            {managerPinVerified && (
              <p className="flex items-center gap-1.5 text-sm text-green-700">
                <Check className="h-4 w-4" /> Manager PIN verified
              </p>
            )}
          </div>

          <div className={cn("space-y-2", !managerPinVerified && "pointer-events-none opacity-50")}>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              2. What did the manager approve? <span className="text-destructive">*</span>
            </Label>
            <CharacterCountedTextarea
              label=""
              value={reason}
              onValueChange={setReason}
              placeholder="e.g. Manager approved by phone — proceed with agreed workaround."
              minChars={MIN_REASON}
              rows={3}
              required
            />
          </div>

          <div className={cn("space-y-2", !showOperatorPinStep && "pointer-events-none opacity-50")}>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              3. Your operator PIN <span className="text-destructive">*</span>
            </Label>
            {!operatorPinVerified ? (
              activePinStep !== "operator" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full"
                  disabled={!showOperatorPinStep}
                  onClick={() => openPinStep("operator")}
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
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setActivePinStep(null)}>
                    Hide PIN pad
                  </Button>
                </div>
              )
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-green-700">
                <Check className="h-4 w-4" /> Operator PIN verified
              </p>
            )}
          </div>

          <ul className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <li className={managerSelected ? "text-foreground" : ""}>{managerSelected ? "✓" : "○"} Manager selected</li>
            <li className={managerPinVerified ? "text-foreground" : ""}>{managerPinVerified ? "✓" : "○"} Manager PIN</li>
            <li className={reasonOk ? "text-foreground" : ""}>{reasonOk ? "✓" : "○"} Reason ({reason.trim().length}/{MIN_REASON} min)</li>
            <li className={operatorPinVerified ? "text-foreground" : ""}>{operatorPinVerified ? "✓" : "○"} Your PIN</li>
          </ul>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={handleClose} disabled={submitMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {submitMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Record Override & Proceed
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

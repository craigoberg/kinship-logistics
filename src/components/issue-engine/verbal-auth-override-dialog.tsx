import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PhoneCall, ShieldAlert } from "lucide-react";

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
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin, verifyOperatorPin } from "@/components/auth/pin-verify";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
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

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Ledger category — VEHICLE for pre-trip, CENTRE for site-day. */
  ledgerCategory: LedgerCategory;
  /** Free-text subject (e.g. "Bus 4 · ABC123" or `Day Centre · Session ${id}`). */
  subjectLabel: string;
  /** Optional source escalation/issue id; embedded in metadata. */
  sourceId?: string | null;
  /**
   * Ledger `action_type` written for this verbal consultation. Defaults to
   * the historical `VERBAL_AUTH_OVERRIDE` (high-trust escape hatch). The
   * promoted single-user RED flow passes `RED_VERBAL_WORKAROUND`.
   */
  actionType?: string;
  /** Optional title override for the canonical RED variant. */
  titleOverride?: string;
  /** Optional descriptive blurb for the canonical RED variant. */
  descriptionOverride?: string;
  /**
   * Called after the ledger receipt has been successfully written. Receives
   * the authorising manager's staff ID and the verbal plan so the caller can
   * land an open ticket in the appropriate source register with a
   * `[VERBAL WORKAROUND]` prefix.
   *
   * GUARDRAILS §1.3 / §3: the manager PIN has already been verified against
   * coordinator/manager role before `onAccepted` is invoked.
   */
  onAccepted: (payload: { managerStaffId: string; managerName: string; reason: string }) => void;
}

/**
 * High-trust escape hatch — GUARDRAILS §3 "Single-Rail Verbal Consultation".
 *
 * Requires:
 *   1. Operator selects the authorising Manager from the coordinator staff list.
 *   2. Operator enters the Manager's PIN — verified against coordinator/manager role
 *      via `verifyCoordinatorPin()` (GUARDRAILS §1.3).
 *   3. Operator enters their own PIN.
 *   4. Operator provides ≥20-char workaround justification.
 *
 * On success, writes an immutable `RED_VERBAL_WORKAROUND` receipt to
 * `operational_ledger` (writeToLedgerOrThrow — aborts on failure per §1.1),
 * then invokes `onAccepted` so the caller inserts the `[VERBAL WORKAROUND]`
 * ticket into the appropriate source register.
 */
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
  const verifiedManagerPinRef = useRef("");

  const reset = () => {
    setSelectedManagerId("");
    setManagerPinVerified(false);
    verifiedManagerPinRef.current = "";
    setReason("");
    setOperatorPinVerified(false);
  };

  // Load coordinator / manager staff for the picker
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
        getActiveUserProfile()?.staffId ?? getStaffId() ?? DEFAULT_STAFF_UUID;
      if (!operatorPinVerified) throw new Error("Operator PIN required.");
      if (!selectedManagerId) throw new Error("Please select the authorising Manager.");
      if (!managerPinVerified) throw new Error("Manager PIN required.");

      // --- Ledger write — throws on failure (GUARDRAILS §1.1) ---
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
      toast.success(
        actionType === "RED_VERBAL_WORKAROUND"
          ? "Verbal workaround recorded — ledger receipt written"
          : "Verbal authorization recorded — ledger receipt written",
        {
          description:
            "An immutable ledger receipt has been written. Governance Hub now shows this as an open verbal workaround.",
        },
      );
      reset();
      onOpenChange(false);
      onAccepted(payload);
    },
    onError: (e: Error) => {
      // Surface ledger abort errors clearly — they mean the operation cannot proceed
      toast.error(
        e.message.startsWith("[ledger]")
          ? "Ledger write failed — override aborted"
          : "Could not record verbal authorization",
        { description: e.message },
      );
    },
  });

  const reasonOk = reason.trim().length >= MIN_REASON;
  const managerSelected = !!selectedManagerId;
  const canSubmit =
    reasonOk &&
    managerSelected &&
    managerPinVerified &&
    operatorPinVerified &&
    !submitMut.isPending;

  const handleClose = (next: boolean) => {
    if (submitMut.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-amber-600" />
            {titleOverride ?? "Verbal Authorization Override"}
          </DialogTitle>
          <DialogDescription>
            {descriptionOverride ??
              "Use this only when a Manager cannot complete the digital handshake. Both the Manager's coordinator PIN and your own operator PIN are required. Every field is written to the immutable ledger."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Context banner */}
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">{subjectLabel}</span> — proceeding
              without a digital Manager handshake. The Manager must physically
              provide their coordinator PIN to authorise this override.
            </p>
          </div>

          {/* Manager selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Authorising Manager{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedManagerId}
              onValueChange={(v) => {
                setSelectedManagerId(v);
                setManagerPinVerified(false);
                verifiedManagerPinRef.current = "";
              }}
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
                      : "Select authorising manager…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {coordinators.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.fullName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({s.role})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Manager PIN */}
          {selectedManagerId && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Manager PIN — {selectedManager?.fullName}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <PinEntryTrigger
                label="Tap to enter manager PIN"
                verified={managerPinVerified}
                verifiedLabel="Manager PIN verified"
                length={6}
                title="Manager verbal authorization"
                description={`Confirm ${selectedManager?.fullName ?? "manager"} authorizes this override.`}
                required
                onVerify={async (pin) => {
                  await verifyManagerPin(selectedManagerId, pin);
                }}
                onSuccess={(pin) => {
                  verifiedManagerPinRef.current = pin;
                  setManagerPinVerified(true);
                }}
              />
            </div>
          )}

          {/* Workaround justification */}
          <CharacterCountedTextarea
            label="Authorization Reason (what did the Manager approve?)"
            value={reason}
            onValueChange={setReason}
            placeholder="e.g. Manager approved by phone at 0815 — proceed with Bus 4 despite cracked nearside mirror; replacement booked for 14:00."
            minChars={MIN_REASON}
            rows={4}
            required
          />

          {/* Operator PIN */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your Operator PIN{" "}
              <span className="text-destructive">*</span>
            </Label>
            <PinEntryTrigger
              label="Tap to sign with your PIN"
              verified={operatorPinVerified}
              verifiedLabel="Operator PIN verified"
              length={4}
              title="Sign verbal authorization"
              description="Confirms you recorded this verbal override accurately."
              required
              onVerify={verifyOperatorPin}
              onSuccess={() => setOperatorPinVerified(true)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={submitMut.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => submitMut.mutate()}
            disabled={!canSubmit}
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            {submitMut.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Record Override & Proceed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

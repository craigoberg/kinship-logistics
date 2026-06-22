import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  DEFAULT_STAFF_UUID,
  getActiveUserProfile,
  getStaffId,
  verifyStaffPin,
} from "@/lib/data-store";
import { tryGetGps, writeToLedger, type LedgerCategory } from "@/lib/api/ledger";

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
   * the captured manager name and verbal plan so the caller can land an
   * open ticket in the appropriate source register (site_issues_register /
   * operational_incidents) with a `[VERBAL WORKAROUND]` prefix.
   */
  onAccepted: (payload: { managerName: string; reason: string }) => void;
}

/**
 * High-trust escape hatch (MASTER_GUARDRAILS §1 / mem://architecture
 * — "Verbal Authorization Override"). Used when a Manager is unreachable
 * digitally but has authorised the action by phone / in person.
 *
 * Writes an immutable `VERBAL_AUTH_OVERRIDE` receipt to `operational_ledger`
 * with the operator's PIN-verified identity, the manager's name (free text),
 * the spoken justification, and a captured GPS coordinate (best-effort).
 *
 * This is the only path that allows proceeding without a dual-PIN digital
 * handshake. Every override is auditable and surfaces in the Governance Hub
 * for retroactive sign-off.
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
  const [managerName, setManagerName] = useState("");
  const [reason, setReason] = useState("");
  const [operatorPin, setOperatorPin] = useState("");

  const reset = () => {
    setManagerName("");
    setReason("");
    setOperatorPin("");
  };

  const submitMut = useMutation({
    mutationFn: async () => {
      const operatorStaffId =
        getActiveUserProfile()?.staffId ?? getStaffId() ?? DEFAULT_STAFF_UUID;
      if (!/^\d{4,6}$/.test(operatorPin)) {
        throw new Error("Enter your 4–6 digit operator PIN.");
      }
      const pinOk = await verifyStaffPin(operatorStaffId, operatorPin);
      if (!pinOk) throw new Error("Operator PIN does not match.");

      const gps = await tryGetGps();
      await writeToLedger({
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
          manager_name: managerName.trim(),
          operator_staff_id: operatorStaffId,
          reason: reason.trim(),
          gps_attempted: true,
          gps_captured: !!gps,
          source: "verbal_auth_override_dialog",
          override_kind:
            actionType === "RED_VERBAL_WORKAROUND" ? "red_verbal_workaround" : "verbal",
        },
      });
      return { managerName: managerName.trim(), reason: reason.trim() };
    },
    onSuccess: (payload) => {
      toast.success(
        actionType === "RED_VERBAL_WORKAROUND"
          ? "Verbal workaround recorded"
          : "Verbal authorization recorded",
        {
          description:
            "An immutable ledger receipt was written. Governance Hub now shows this as an open verbal workaround.",
        },
      );
      reset();
      onOpenChange(false);
      onAccepted(payload);
    },
    onError: (e: Error) => {
      toast.error("Could not record verbal authorization", {
        description: e.message,
      });
    },
  });

  const reasonOk = reason.trim().length >= MIN_REASON;
  const managerOk = managerName.trim().length >= 3;
  const pinOk = /^\d{4,6}$/.test(operatorPin);
  const canSubmit = reasonOk && managerOk && pinOk && !submitMut.isPending;

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
              "Use this only if a Manager cannot complete the digital handshake. Their verbal authorization is recorded as an immutable ledger receipt and queued for retroactive sign-off in the Governance Hub."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">{subjectLabel}</span> — proceeding
              without a digital Manager handshake. Every field is captured to
              the ledger.
            </p>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="vao-manager"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Authorizing Manager (full name){" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="vao-manager"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder="e.g. Sam Coordinator"
              className={
                !managerOk
                  ? "border-2 border-destructive focus-visible:ring-destructive"
                  : ""
              }
            />
          </div>

          <CharacterCountedTextarea
            label="Authorization Reason (what did the Manager approve?)"
            value={reason}
            onValueChange={setReason}
            placeholder="e.g. Manager S.C. approved by phone at 0815 — proceed with Bus 4 despite cracked nearside mirror; replacement booked for 14:00."
            minChars={MIN_REASON}
            rows={4}
            required
          />

          <div className="space-y-2">
            <Label
              htmlFor="vao-pin"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Your Operator PIN <span className="text-destructive">*</span>
            </Label>
            <Input
              id="vao-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="off"
              value={operatorPin}
              onChange={(e) =>
                setOperatorPin(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="••••"
              className={`h-12 max-w-[180px] text-center text-xl tracking-[0.4em] tabular-nums ${
                !pinOk
                  ? "border-2 border-destructive focus-visible:ring-destructive"
                  : ""
              }`}
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

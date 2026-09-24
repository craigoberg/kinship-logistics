import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserX, ShieldCheck } from "lucide-react";
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
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyOperatorPin } from "@/components/auth/pin-verify";
import { Textarea } from "@/components/ui/textarea";
import { MobileOptionButton } from "@/components/manifest/mobile-field-button";
import {
  markAttendanceAbsent,
  updateExpectedArrival,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";
import {
  markSupportAbsent,
  updateSupportExpectedArrival,
  type SupportAttendanceRow,
} from "@/lib/api/support-attendance";
import { isoToSydneyClock } from "@/lib/operational-time";
import { getActiveUserProfile } from "@/lib/data-store";

interface Props {
  row: ClientAttendanceRow | null;
  supportRow?: SupportAttendanceRow | null;
  participantName: string;
  yellowThresholdMins: number;
  onClose: (changed: boolean) => void;
}

// Operational absence reason codes. Kept in-component so the modal is
// always usable offline and never blocked on a lookup fetch.
const ABSENCE_REASONS: { code: string; label: string }[] = [
  { code: "SICK", label: "Sick / unwell" },
  { code: "FAMILY", label: "Family / carer reason" },
  { code: "APPOINTMENT", label: "Medical or other appointment" },
  { code: "HOLIDAY", label: "Holiday / planned leave" },
  { code: "TRANSPORT", label: "No transport available" },
  { code: "OTHER", label: "Other (see notes)" },
];

export function AdjustExpectedTimeModal({
  row,
  supportRow = null,
  participantName,
  yellowThresholdMins,
  onClose,
}: Props) {
  const activeId = supportRow?.id ?? row?.id ?? null;
  const expectedAt = supportRow?.expectedArrivalAt ?? row?.expectedArrivalAt ?? null;
  const status = supportRow?.status ?? row?.status ?? null;
  const [hhmm, setHhmm] = useState("09:00");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [operatorPinVerified, setOperatorPinVerified] = useState(false);

  // Reset internal state only when the modal transitions from closed -> open
  // for a NEW row id. A background refetch that returns a fresh `row` object
  // with the same id must NOT wipe the operator's typed PIN / notes / time.
  const openedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeId && openedForRef.current !== activeId) {
      openedForRef.current = activeId;
      setHhmm(expectedAt ? isoToSydneyClock(expectedAt) : "09:00");
      setReasonCode("");
      setDetail("");
      setOperatorPinVerified(false);
      setPinError(null);
    } else if (!activeId) {
      openedForRef.current = null;
    }
  }, [activeId, expectedAt]);

  const updateMut = useMutation({
    mutationFn: async () => {
      if (supportRow) {
        return updateSupportExpectedArrival(supportRow, hhmm, yellowThresholdMins);
      }
      if (!row) throw new Error("No row");
      return updateExpectedArrival(row, hhmm, yellowThresholdMins);
    },
    onSuccess: () => {
      toast.success("Expected arrival updated", {
        description: `${participantName} now expected at ${hhmm} (Sydney).`,
      });
      onClose(true);
    },
    onError: (e: Error) => {
      toast.error("Could not adjust expected time", { description: e.message });
    },
  });

  const absentMut = useMutation({
    mutationFn: async () => {
      const reason = ABSENCE_REASONS.find((r) => r.code === reasonCode);
      if (!reason) throw new Error("Select an absence reason.");
      if (!operatorPinVerified) throw new Error("Operator PIN required.");
      if (supportRow) {
        return markSupportAbsent(supportRow, {
          reasonCode: reason.code,
          reasonLabel: reason.label,
          detail: detail.trim() || undefined,
        });
      }
      if (!row) throw new Error("No row");
      return markAttendanceAbsent(row, {
        reasonCode: reason.code,
        reasonLabel: reason.label,
        detail: detail.trim() || null,
        operatorStaffId: getActiveUserProfile()?.staffId ?? null,
      });
    },
    onSuccess: (res) => {
      const closed = res.closedIssueId
        ? ` Closed ${res.prevSeverity?.toUpperCase() ?? "active"} anomaly.`
        : "";
      toast.success(`${participantName} marked absent for today.`, {
        description: `Not on morning or afternoon Manifest. Late arrival: tap their Check-In row.${closed}`,
      });
      onClose(true);
    },
    onError: (e: Error) => {
      setPinError(e.message);
      toast.error("Could not mark absent", { description: e.message });
    },
  });

  const busy = updateMut.isPending || absentMut.isPending;
  const canMarkAbsent = !!reasonCode && operatorPinVerified && !busy;

  return (
    <Dialog open={!!row || !!supportRow} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Expected Time</DialogTitle>
          <DialogDescription>
            {participantName} — set the new expected arrival time (Sydney
            local). If this clears the overdue window, any active YELLOW
            warning is auto-resolved. RED escalations remain open.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="adjust-time">New expected arrival</Label>
          <HalfHourTimeField
            id="adjust-time"
            value={hhmm}
            onChange={setHhmm}
          />
        </div>

        {status === "absent" ? (
          <div className="mt-2 rounded-lg border border-slate-400/50 bg-slate-100 p-3 text-sm text-slate-800">
            Already marked absent for today. Close this, set arrival method
            (usually Self / family), then tap the wide row to record a late
            arrival. They go onto Check-Out and, if going by bus, the afternoon
            Manifest.
          </div>
        ) : (
        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
              Or record this person as absent
            </div>
            <p className="text-xs text-muted-foreground">
              They stay on the roll as Absent, come off morning and afternoon
              Manifest, and any active YELLOW or RED arrival anomaly is
              auto-closed. Late arrival: tap their Check-In row. Requires a
              reason and your PIN.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Absence reason
            </Label>
            <div className="space-y-1.5">
              {ABSENCE_REASONS.map((r) => (
                <MobileOptionButton
                  key={r.code}
                  selected={reasonCode === r.code}
                  label={r.label}
                  disabled={busy}
                  onClick={() => {
                    setReasonCode(r.code);
                    setPinError(null);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={2}
              placeholder="Family called — flu, back tomorrow."
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Operator PIN
            </Label>
            <PinEntryTrigger
              label="Tap to sign with your PIN"
              verified={operatorPinVerified}
              verifiedLabel="Operator PIN verified"
              length={4}
              title="Mark client absent"
              description="Confirms this absence record and writes to the ledger."
              disabled={busy}
              onVerify={verifyOperatorPin}
              onSuccess={() => setOperatorPinVerified(true)}
            />
            {pinError && (
              <p className="text-xs font-medium text-destructive">{pinError}</p>
            )}
          </div>

          <Button
            type="button"
            variant="destructive"
            className="w-full gap-2"
            disabled={!canMarkAbsent}
            onClick={() => absentMut.mutate()}
          >
            {absentMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserX className="h-4 w-4" />
            )}
            Mark Absent for Today
          </Button>
        </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => onClose(false)}
          >
            Close
          </Button>
          <Button onClick={() => updateMut.mutate()} disabled={busy}>
            {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

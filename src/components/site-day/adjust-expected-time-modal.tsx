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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  markAttendanceAbsent,
  updateExpectedArrival,
  type ClientAttendanceRow,
} from "@/lib/api/client-attendance";
import { isoToSydneyClock } from "@/lib/operational-time";
import { GuardianPinError, loginWithPin } from "@/lib/data-store";

interface Props {
  row: ClientAttendanceRow | null;
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
  participantName,
  yellowThresholdMins,
  onClose,
}: Props) {
  const [hhmm, setHhmm] = useState("09:00");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setHhmm(isoToSydneyClock(row.expectedArrivalAt));
      setReasonCode("");
      setDetail("");
      setPin("");
      setPinError(null);
    }
  }, [row]);

  const updateMut = useMutation({
    mutationFn: async () => {
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
      if (!row) throw new Error("No row");
      const reason = ABSENCE_REASONS.find((r) => r.code === reasonCode);
      if (!reason) throw new Error("Select an absence reason.");
      if (!/^\d{4}$/.test(pin)) throw new Error("Enter your 4-digit PIN.");

      // Verify the operator PIN. Records who authorised the absence.
      let profile;
      try {
        profile = await loginWithPin(pin);
      } catch (e) {
        if (e instanceof GuardianPinError) throw new Error(e.message);
        throw e;
      }
      if (!profile) throw new Error("Incorrect PIN. Please try again.");

      return markAttendanceAbsent(row, {
        reasonCode: reason.code,
        reasonLabel: reason.label,
        detail: detail.trim() || null,
        operatorStaffId: profile.staffId ?? null,
      });
    },
    onSuccess: (res) => {
      const closed = res.closedIssueId
        ? ` Closed ${res.prevSeverity?.toUpperCase() ?? "active"} anomaly.`
        : "";
      toast.success(`${participantName} marked absent for today.`, {
        description: `Stays visible on the roll, flagged as absent.${closed}`,
      });
      onClose(true);
    },
    onError: (e: Error) => {
      setPinError(e.message);
      toast.error("Could not mark absent", { description: e.message });
    },
  });

  const busy = updateMut.isPending || absentMut.isPending;
  const canMarkAbsent = !!reasonCode && /^\d{4}$/.test(pin) && !busy;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && !busy && onClose(false)}>
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
          <input
            id="adjust-time"
            type="time"
            value={hhmm}
            onChange={(e) => setHhmm(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-slate-900"
          />
        </div>

        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
              Or record this client as absent
            </div>
            <p className="text-xs text-muted-foreground">
              Stays on the visible roll in a neutral “Absent” colour so staff
              can still confirm they were expected, and auto-closes any active
              YELLOW or RED anomaly. Requires a reason code and your PIN —
              both are written to the permanent ledger.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Absence reason
            </Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => {
                setReasonCode(v);
                setPinError(null);
              }}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select reason…" />
              </SelectTrigger>
              <SelectContent>
                {ABSENCE_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              htmlFor="absent-pin"
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Operator PIN
            </Label>
            <Input
              id="absent-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                setPinError(null);
              }}
              placeholder="••••"
              className="h-11 text-center text-xl tracking-[0.6em] font-mono"
              disabled={busy}
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

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onClose(false)}
            disabled={busy}
          >
            Cancel
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

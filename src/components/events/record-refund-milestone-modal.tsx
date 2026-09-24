import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
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
import { useRecordEventRefundMilestone } from "@/hooks/use-supabase-data";
import type { EventManifest, EventRosterBooking } from "@/lib/data-store";
import { todayLocalIso, parseIsoDateLocal, toIsoDateString, cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventManifest;
  booking: EventRosterBooking | null;
}

export function RecordRefundMilestoneModal({
  open,
  onOpenChange,
  event,
  booking,
}: Props) {
  const [amount, setAmount] = useState("0.00");
  const [refundDate, setRefundDate] = useState(todayLocalIso());
  const [reason, setReason] = useState("Refund");
  const mutation = useRecordEventRefundMilestone();

  const baselineCost = (booking?.customPrice ?? event.ticketPrice) || 0;
  const paid = booking?.amountPaid ?? 0;

  useEffect(() => {
    if (open && booking) {
      setAmount(Math.max(0, paid).toFixed(2));
      setRefundDate(todayLocalIso());
      setReason(
        booking.bookingStatus === "Cancelled"
          ? "Refund · Event Cancelled"
          : "Refund · Overpayment / adjustment",
      );
    }
  }, [open, booking, paid]);

  if (!booking) return null;

  const amountNum = Number(amount);
  const amountInvalid =
    !Number.isFinite(amountNum) || amountNum <= 0 || amountNum > paid + 0.001;
  const dateInvalid = refundDate.length !== 10;
  const reasonInvalid = reason.trim().length < 3;
  const valid = !amountInvalid && !dateInvalid && !reasonInvalid;
  const canSubmit = valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        bookingId: booking.id,
        eventId: event.id,
        eventTitle: event.title,
        participantId: booking.participantId,
        ticketPrice: baselineCost,
        refundAmount: amountNum,
        refundDate,
        reason: reason.trim(),
      });
      toast.success("Refund recorded", {
        description: `${booking.participantName} · −$${amountNum.toFixed(2)}`,
      });
      onOpenChange(false);
    } catch {
      /* hook toast */
    }
  };

  const missing: string[] = [];
  if (amountInvalid) missing.push("Refund amount");
  if (dateInvalid) missing.push("Refund date");
  if (reasonInvalid) missing.push("Reason");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Record refund</DialogTitle>
          <DialogDescription>
            <strong>{booking.participantName}</strong> · {event.title}
            <br />
            Paid so far{" "}
            <span className="tabular-nums">${paid.toFixed(2)}</span>
            {booking.bookingStatus === "Cancelled" && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                (cancelled)
              </span>
            )}
            . Refund cannot exceed amount paid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {!valid && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Required: {missing.join(" · ")}
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Refund amount (AUD)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              max={paid}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cn("tabular-nums", requiredFieldOutline(amountInvalid))}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Refund date
            </Label>
            <DatePicker
              value={parseIsoDateLocal(refundDate)}
              onChange={(d) => setRefundDate(d ? toIsoDateString(d) : "")}
              dateFormat="dd-MMM-yy"
              className={cn("h-9 text-sm", requiredFieldOutline(dateInvalid))}
            />
          </div>

          <CharacterCountedInput
            label="Reason"
            value={reason}
            onValueChange={setReason}
            minChars={3}
            maxChars={120}
            required
          />
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <RotateCcw className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Record refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

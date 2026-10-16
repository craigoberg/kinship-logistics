/**
 * Record a payment or refund against a non-participant roster row.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { DatePicker } from "@/components/ui/date-picker";
import {
  EVENT_SUPPORT_KEY,
  EVENT_SUPPORT_PAYMENTS_KEY,
  recordEventSupportPayment,
  recordEventSupportRefund,
  supportBookingCost,
  type EventSupportBooking,
} from "@/lib/api/event-support";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn, parseIsoDateLocal, todayLocalIso, toIsoDateString } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: EventSupportBooking | null;
  eventTitle: string;
  eventTicketPrice: number;
  mode: "payment" | "refund";
}

export function RecordSupportMoneyModal({
  open,
  onOpenChange,
  booking,
  eventTitle,
  eventTicketPrice,
  mode,
}: Props) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("0.00");
  const [when, setWhen] = useState(todayLocalIso());
  const [saving, setSaving] = useState(false);

  const baseline = booking ? supportBookingCost(booking, eventTicketPrice) : 0;
  const collected = booking?.amountPaid ?? 0;
  const owing = Math.max(0, baseline - collected);

  useEffect(() => {
    if (!open || !booking) return;
    const start = mode === "refund" ? collected : owing;
    setAmount(start.toFixed(2));
    setWhen(todayLocalIso());
  }, [open, booking, mode, collected, owing]);

  if (!booking) return null;

  const amountNum = Number(amount);
  const amountInvalid =
    !Number.isFinite(amountNum) ||
    amountNum <= 0 ||
    (mode === "refund" && amountNum > collected + 0.001);
  const dateInvalid = when.length !== 10;
  const canSave = !amountInvalid && !dateInvalid && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (mode === "payment") {
        await recordEventSupportPayment({
          booking,
          eventTitle,
          ticketPrice: eventTicketPrice,
          amount: amountNum,
          paymentDate: when,
        });
        toast.success("Payment recorded", { description: booking.displayName });
      } else {
        await recordEventSupportRefund({
          booking,
          eventTitle,
          ticketPrice: eventTicketPrice,
          amount: amountNum,
          refundDate: when,
        });
        toast.success("Refund recorded", { description: booking.displayName });
      }
      await qc.invalidateQueries({ queryKey: EVENT_SUPPORT_KEY(booking.eventId) });
      await qc.invalidateQueries({ queryKey: EVENT_SUPPORT_PAYMENTS_KEY(booking.eventId) });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>{mode === "payment" ? "Record payment" : "Record refund"}</DialogTitle>
          <DialogDescription>
            {booking.displayName}. Cost ${baseline.toFixed(2)}. Paid ${collected.toFixed(2)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Amount ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cn("tabular-nums", requiredFieldOutline(amountInvalid))}
            />
          </div>
          <div className="space-y-1">
            <Label>Date</Label>
            <DatePicker
              value={parseIsoDateLocal(when)}
              onChange={(d) => setWhen(d ? toIsoDateString(d) : "")}
              dateFormat="dd-MMM-yy"
              className={cn("h-9", requiredFieldOutline(dateInvalid))}
            />
          </div>
          {(amountInvalid || dateInvalid) && (
            <p className="text-sm text-destructive">
              Need:{" "}
              {[amountInvalid ? "Amount" : null, dateInvalid ? "Date" : null]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

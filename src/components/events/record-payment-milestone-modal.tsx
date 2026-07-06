import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleDollarSign } from "lucide-react";
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
import { useRecordEventPaymentMilestone } from "@/hooks/use-supabase-data";
import type { EventManifest, EventRosterBooking } from "@/lib/data-store";
import { todayLocalIso } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventManifest;
  booking: EventRosterBooking | null;
}


export function RecordPaymentMilestoneModal({ open, onOpenChange, event, booking }: Props) {
  const [amount, setAmount] = useState("0.00");
  const [paymentDate, setPaymentDate] = useState(todayLocalIso());
  const mutation = useRecordEventPaymentMilestone();

  const baselineCost = (booking?.customPrice ?? event.ticketPrice) || 0;

  useEffect(() => {
    if (open && booking) {
      const balance = Math.max(0, baselineCost - booking.amountPaid);
      setAmount(balance.toFixed(2));
      setPaymentDate(todayLocalIso());
    }
  }, [open, booking, baselineCost]);

  if (!booking) return null;

  const amountNum = Number(amount);
  const balance = Math.max(0, baselineCost - booking.amountPaid);
  const valid =
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    paymentDate.length === 10;
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
        currentAmountPaid: booking.amountPaid,
        paymentAmount: amountNum,
        paymentDate,
      });
      toast.success("Payment milestone recorded", {
        description: `${booking.participantName} · $${amountNum.toFixed(2)} added to ledger.`,
      });
      onOpenChange(false);
    } catch {
      /* surfaced via hook onError */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Record payment milestone</DialogTitle>
          <DialogDescription>
            <strong>{booking.participantName}</strong> · {event.title}
            <br />
            Paid so far <span className="tabular-nums">${booking.amountPaid.toFixed(2)}</span> of{" "}
            <span className="tabular-nums">${baselineCost.toFixed(2)}</span>
            {booking.customPrice != null && booking.customPrice !== event.ticketPrice && (
              <span className="ml-1 text-[10px] uppercase tracking-wide text-info">(custom)</span>
            )}{" "}
            (balance <span className="tabular-nums">${balance.toFixed(2)}</span>).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Amount (AUD)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Payment date
            </Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Writes a positive income line to <code>participant_financial_ledger</code> and updates
            the booking's cumulative <code>amount_paid</code>.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <CircleDollarSign className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

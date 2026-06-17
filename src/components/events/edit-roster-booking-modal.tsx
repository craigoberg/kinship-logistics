import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, AlertTriangle } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateEventBooking } from "@/hooks/use-supabase-data";
import type { EventRosterBooking } from "@/lib/data-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: EventRosterBooking | null;
  eventTitle?: string;
}

const STATUS_OPTIONS = ["Confirmed", "Waitlisted", "Cancelled"] as const;

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function EditRosterBookingModal({ open, onOpenChange, booking, eventTitle }: Props) {
  const [bookingStatus, setBookingStatus] = useState<string>("Confirmed");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [issueRefund, setIssueRefund] = useState(true);
  const [refundAmount, setRefundAmount] = useState<string>("0");
  const [refundDate, setRefundDate] = useState<string>(todayISO());
  const mutation = useUpdateEventBooking();

  const collected = booking?.amountPaid ?? 0;

  useEffect(() => {
    if (open && booking) {
      setBookingStatus(booking.bookingStatus || "Confirmed");
      setNotes(booking.notes ?? "");
      setDirty(false);
      setIssueRefund(collected > 0);
      setRefundAmount(collected > 0 ? collected.toFixed(2) : "0");
      setRefundDate(todayISO());
    }
  }, [open, booking, collected]);

  const showRefundPanel = bookingStatus === "Cancelled" && collected > 0;
  const parsedRefund = useMemo(() => {
    const n = Number(refundAmount);
    return Number.isFinite(n) ? n : 0;
  }, [refundAmount]);

  const refundInvalid =
    showRefundPanel && issueRefund && (parsedRefund <= 0 || parsedRefund > collected);

  if (!booking) return null;

  const canSubmit =
    dirty && !mutation.isPending && bookingStatus.length > 0 && !refundInvalid;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const willRefund = showRefundPanel && issueRefund && parsedRefund > 0;
      const result = await mutation.mutateAsync({
        bookingId: booking.id,
        bookingStatus,
        notes: notes.trim() ? notes.trim() : null,
        refund: willRefund
          ? {
              amount: parsedRefund,
              date: refundDate,
              eventId: booking.eventId,
              eventTitle: eventTitle ?? "Event",
              participantId: booking.participantId,
            }
          : null,
      });
      toast.success("Booking updated", {
        description: result.refundLedger
          ? `${booking.participantName} → Cancelled · Refund $${fmtMoney(parsedRefund)} posted`
          : `${booking.participantName} → ${bookingStatus}`,
      });
      onOpenChange(false);
    } catch {
      /* raw error surfaced via hook onError toast */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            Update <strong>{booking.participantName}</strong>'s booking status and billing notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Booking status
            </Label>
            <Select
              value={bookingStatus}
              onValueChange={(v) => {
                setBookingStatus(v);
                setDirty(true);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showRefundPanel && (
            <div className="space-y-3 rounded-lg border-2 border-destructive/60 bg-destructive/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div>
                    <div className="text-sm font-bold text-destructive">
                      Issue Refund for Collected Funds
                    </div>
                    <div className="text-[11px] text-destructive/80">
                      Total Collected to Date:{" "}
                      <span className="font-bold tabular-nums">${fmtMoney(collected)}</span>
                    </div>
                  </div>
                </div>
                <Switch
                  checked={issueRefund}
                  onCheckedChange={(v) => {
                    setIssueRefund(v);
                    setDirty(true);
                  }}
                />
              </div>

              {issueRefund && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      Refund Amount ($)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max={collected}
                      value={refundAmount}
                      onChange={(e) => {
                        setRefundAmount(e.target.value);
                        setDirty(true);
                      }}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      Refund Date
                    </Label>
                    <Input
                      type="date"
                      value={refundDate}
                      onChange={(e) => {
                        setRefundDate(e.target.value);
                        setDirty(true);
                      }}
                      className="bg-background"
                    />
                  </div>
                  {refundInvalid && (
                    <div className="col-span-2 text-[11px] font-medium text-destructive">
                      Refund must be &gt; $0 and ≤ ${fmtMoney(collected)}.
                    </div>
                  )}
                  <div className="col-span-2 text-[11px] text-destructive/80">
                    Posts a negative <code>participant_financial_ledger</code> row and zeros{" "}
                    <code>amount_paid</code> on the booking.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes / Billing arrangements
            </Label>
            <Textarea
              rows={4}
              value={notes}
              placeholder="Billing arrangement, payment plan, ability-to-pay context…"
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <Save className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

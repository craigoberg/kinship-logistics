import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useInsertEventBooking, useParticipants } from "@/hooks/use-supabase-data";
import type { EventManifest, EventRosterBooking } from "@/lib/data-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventManifest;
  existingBookings: EventRosterBooking[];
}

export function AddRosterBookingModal({ open, onOpenChange, event, existingBookings }: Props) {
  const [participantId, setParticipantId] = useState("");
  const [amountPaid, setAmountPaid] = useState("0.00");
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertEventBooking();
  const { data: participants = [] } = useParticipants();

  useEffect(() => {
    if (open) {
      setParticipantId("");
      setAmountPaid("0.00");
      setDirty(false);
    }
  }, [open]);

  const booked = useMemo(() => new Set(existingBookings.map((b) => b.participantId)), [existingBookings]);
  const available = useMemo(
    () =>
      [...participants]
        .filter((p) => !booked.has(p.id))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [participants, booked],
  );

  const paidNumber = Number(amountPaid);
  const valid =
    participantId.length > 0 &&
    Number.isFinite(paidNumber) &&
    paidNumber >= 0;
  const canSubmit = dirty && valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        eventId: event.id,
        participantId,
        bookingStatus: "Confirmed",
        amountPaid: paidNumber,
        ticketPrice: event.ticketPrice,
      });
      toast.success("Participant added to roster");
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Database error: ${msg}`, {
        className: "bg-destructive text-destructive-foreground border-destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>Add participant to roster</DialogTitle>
          <DialogDescription>
            Link an existing participant to <strong>{event.title}</strong>. Ticket price{" "}
            <span className="tabular-nums">${event.ticketPrice.toFixed(2)}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Participant
            </Label>
            <Select
              value={participantId || undefined}
              onValueChange={(v) => {
                setParticipantId(v);
                setDirty(true);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={available.length === 0 ? "All participants already on roster" : "Select participant"} />
              </SelectTrigger>
              <SelectContent>
                {available.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Amount paid (AUD)
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => {
                setAmountPaid(e.target.value);
                setDirty(true);
              }}
              className="tabular-nums"
            />
            <p className="text-[11px] text-muted-foreground">
              Marked <strong>Paid</strong> when amount ≥ ticket price.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              rows={2}
              value={notes}
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
            <UserPlus className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Add to Roster"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
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
}

const STATUS_OPTIONS = ["Confirmed", "Waitlisted", "Cancelled"] as const;

export function EditRosterBookingModal({ open, onOpenChange, booking }: Props) {
  const [bookingStatus, setBookingStatus] = useState<string>("Confirmed");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const mutation = useUpdateEventBooking();

  useEffect(() => {
    if (open && booking) {
      setBookingStatus(booking.bookingStatus || "Confirmed");
      setNotes(booking.notes ?? "");
      setDirty(false);
    }
  }, [open, booking]);

  if (!booking) return null;

  const canSubmit = dirty && !mutation.isPending && bookingStatus.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        bookingId: booking.id,
        bookingStatus,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Booking updated", {
        description: `${booking.participantName} → ${bookingStatus}`,
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

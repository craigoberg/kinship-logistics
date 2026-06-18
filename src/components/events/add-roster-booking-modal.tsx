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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  useInsertEventBooking,
  useParticipants,
  useCarersForParticipant,
} from "@/hooks/use-supabase-data";
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
  const [notes, setNotes] = useState("");
  const [bringsCarer, setBringsCarer] = useState(false);
  const [carerId, setCarerId] = useState<string>("");
  const [carerTransport, setCarerTransport] = useState(false);
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertEventBooking();
  const { data: participants = [] } = useParticipants();
  const { data: carers = [] } = useCarersForParticipant(participantId || null);

  useEffect(() => {
    if (open) {
      setParticipantId("");
      setAmountPaid("0.00");
      setNotes("");
      setBringsCarer(false);
      setCarerId("");
      setCarerTransport(false);
      setDirty(false);
    }
  }, [open]);

  // Default to the primary carer once carers load.
  useEffect(() => {
    if (bringsCarer && !carerId && carers.length > 0) {
      const primary = carers.find((c) => c.isPrimaryContact) ?? carers[0];
      setCarerId(primary.id);
    }
  }, [bringsCarer, carerId, carers]);

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
    paidNumber >= 0 &&
    (!bringsCarer || carerId.length > 0);
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
        eventTitle: event.title,
        notes: notes.trim() || null,
        bringsCarer,
        carerId: bringsCarer ? carerId || null : null,
        carerTransportRequired: bringsCarer ? carerTransport : false,
      });
      toast.success("Participant added to roster");
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Database error: ${msg}`, {
        className: "!bg-red-600 !text-white !border-red-700",
        duration: 12_000,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto border-border bg-card">
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
              value={participantId === "" ? undefined : participantId}
              onValueChange={(v) => {
                setParticipantId(v ?? "");
                setCarerId("");
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
              Initial funds are written to the payment ledger for this event.
            </p>
          </div>

          {/* ----- Carer companion ----- */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Carer attending event?
              </Label>
              <Switch
                checked={bringsCarer}
                onCheckedChange={(v) => {
                  setBringsCarer(v);
                  if (!v) {
                    setCarerId("");
                    setCarerTransport(false);
                  }
                  setDirty(true);
                }}
                disabled={!participantId}
              />
            </div>
            {bringsCarer && (
              <>
                <Select
                  value={carerId || undefined}
                  onValueChange={(v) => {
                    setCarerId(v);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        carers.length === 0
                          ? "No carers registered for this participant"
                          : "Select carer"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {carers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName}
                        {c.isPrimaryContact ? " · Primary" : ""}
                        {c.relationship ? ` · ${c.relationship}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Carer requires bus transport seat?
                  </Label>
                  <Switch
                    checked={carerTransport}
                    onCheckedChange={(v) => {
                      setCarerTransport(v);
                      setDirty(true);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes / Billing arrangements
            </Label>
            <Textarea
              rows={2}
              value={notes}
              placeholder="e.g. paying via plan manager; split with sibling…"
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

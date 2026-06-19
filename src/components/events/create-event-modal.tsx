import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Copy } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { useInsertEvent, usePriorEventOfType } from "@/hooks/use-supabase-data";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CreateEventModal({ open, onOpenChange }: Props) {
  const [title, setTitle] = useState("");
  const [eventTypeCode, setEventTypeCode] = useState("");
  const [venue, setVenue] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [ticketPrice, setTicketPrice] = useState("0.00");
  const [description, setDescription] = useState("");
  const [cloneEnabled, setCloneEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertEvent();
  const { data: priorEvent, isLoading: priorLoading } = usePriorEventOfType(
    cloneEnabled ? eventTypeCode : null,
  );

  useEffect(() => {
    if (open) {
      setTitle("");
      setEventTypeCode("");
      setVenue("");
      setStartDate(todayIso());
      setEndDate("");
      setTicketPrice("0.00");
      setDescription("");
      setCloneEnabled(false);
      setDirty(false);
    }
  }, [open]);

  const priceNumber = Number(ticketPrice);
  const valid = useMemo(
    () =>
      title.trim().length > 0 &&
      eventTypeCode.trim().length > 0 &&
      venue.trim().length > 0 &&
      startDate.length === 10 &&
      Number.isFinite(priceNumber) &&
      priceNumber >= 0,
    [title, eventTypeCode, venue, startDate, priceNumber],
  );
  const canSubmit = dirty && valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      // end_date is NOT NULL in event_manifest — mirror start_date when blank
      // (covers single-day events where the operator leaves the end-date field empty).
      const resolvedEndDate = endDate && endDate.length === 10 ? endDate : startDate;
      await mutation.mutateAsync({
        title: title.trim(),
        eventTypeCode, // canonical lookup code, e.g. EVT-SINGLE / EVT-MULTI
        venue: venue.trim(),
        startDate, // already YYYY-MM-DD from <input type="date">
        endDate: resolvedEndDate,
        ticketPrice: priceNumber,
        description: description.trim() || null,
      });
      toast.success("Event created", { description: title.trim() });
      onOpenChange(false);
    } catch (err) {
      // Keep the modal OPEN so the operator can correct the payload.
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Event NOT saved — fix and retry", {
        description: msg,
        duration: 12000,
        className: "border-red-500 bg-red-600 text-white font-medium",
      });
    }
  };

  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    setDirty(true);
    fn(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-card">
        <DialogHeader>
          <DialogTitle>Create new event</DialogTitle>
          <DialogDescription>
            All fields are stored against <span className="font-mono">event_manifest</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Event title
            </Label>
            <Input
              value={title}
              onChange={(e) => mark(setTitle)(e.target.value)}
              placeholder="e.g. Coastal Picnic Day"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Event type
              </Label>
              <LookupSelect
                category="event_types"
                value={eventTypeCode}
                onChange={(code) => mark(setEventTypeCode)(code)}
                placeholder="Select event type"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ticket price (AUD)
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={ticketPrice}
                onChange={(e) => mark(setTicketPrice)(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Venue
            </Label>
            <Input
              value={venue}
              onChange={(e) => mark(setVenue)(e.target.value)}
              placeholder="e.g. Bondi Pavilion"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Start date
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => mark(setStartDate)(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                End date (optional)
              </Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => mark(setEndDate)(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Description (optional)
            </Label>
            <Textarea
              value={description}
              onChange={(e) => mark(setDescription)(e.target.value)}
              rows={3}
              placeholder="Short briefing for coordinators…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

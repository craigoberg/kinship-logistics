import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { useUpdateEvent } from "@/hooks/use-supabase-data";
import type { EventManifest } from "@/lib/data-store";

interface Props {
  event: EventManifest;
  onSuccess?: () => void;
}

export function EventDetailsTab({ event, onSuccess }: Props) {
  const [title, setTitle] = useState(event.title);
  const [eventTypeCode, setEventTypeCode] = useState(event.eventTypeCode);
  const [venue, setVenue] = useState(event.venue);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate ?? "");
  const [ticketPrice, setTicketPrice] = useState(event.ticketPrice.toFixed(2));
  const [description, setDescription] = useState(event.description ?? "");
  const mutation = useUpdateEvent();

  // Re-hydrate when the active event changes.
  useEffect(() => {
    setTitle(event.title);
    setEventTypeCode(event.eventTypeCode);
    setVenue(event.venue);
    setStartDate(event.startDate);
    setEndDate(event.endDate ?? "");
    setTicketPrice(event.ticketPrice.toFixed(2));
    setDescription(event.description ?? "");
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceNumber = Number(ticketPrice);

  const valid =
    title.trim().length > 0 &&
    eventTypeCode.trim().length > 0 &&
    venue.trim().length > 0 &&
    startDate.length === 10 &&
    Number.isFinite(priceNumber) &&
    priceNumber >= 0;

  const dirty = useMemo(
    () =>
      title !== event.title ||
      eventTypeCode !== event.eventTypeCode ||
      venue !== event.venue ||
      startDate !== event.startDate ||
      (endDate || null) !== (event.endDate ?? null) ||
      Number(ticketPrice) !== event.ticketPrice ||
      (description || null) !== (event.description ?? null),
    [title, eventTypeCode, venue, startDate, endDate, ticketPrice, description, event],
  );

  const canSubmit = valid && dirty && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    // Strict rule: empty end_date mirrors start_date.
    const resolvedEnd = endDate && endDate.length === 10 ? endDate : startDate;
    try {
      await mutation.mutateAsync({
        id: event.id,
        title: title.trim(),
        eventTypeCode,
        venue: venue.trim(),
        startDate,
        endDate: resolvedEnd,
        ticketPrice: priceNumber,
        description: description.trim() || null,
      });
      toast.success("Event logistics updated", { description: title.trim() });
      onSuccess?.();
    } catch {
      /* surfaced via mutation.onError */
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Event title
          </Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Event type
            </Label>
            <LookupSelect
              category="event_types"
              value={eventTypeCode}
              onChange={(code) => setEventTypeCode(code)}
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
              onChange={(e) => setTicketPrice(e.target.value)}
              className="tabular-nums"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Venue name
          </Label>
          <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Start date
            </Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              End date (optional · mirrors start date if blank)
            </Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Short briefing for coordinators…"
          />
        </div>
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
          <Save className="h-4 w-4" />
          {mutation.isPending ? "Saving…" : "Update Event Logistics"}
        </Button>
      </div>
    </div>
  );
}

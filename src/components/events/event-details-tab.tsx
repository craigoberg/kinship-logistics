import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { useUpdateEvent, useLookupParameters } from "@/hooks/use-supabase-data";
import { useQuery } from "@tanstack/react-query";
import type { EventManifest } from "@/lib/data-store";
import { listVenues } from "@/lib/api/venues";
import { ensureEventItineraryStops, inferEventKind, seedEventDaySessions } from "@/lib/api/event-outing";
import { invalidateEventDayCaches } from "@/lib/query/invalidation";
import { formatDate, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";

interface Props {
  event: EventManifest;
  onSuccess?: () => void;
  onClose?: () => void;
}

const SCOPE_LABELS: Record<string, string> = {
  legacy: "Centre-linked event (no trip-day rolls)",
  single_day_outing: "Single-day outing — one trip day from start date",
  multi_day_tour: "Multi-day tour — one trip day per date in range",
};

export function EventDetailsTab({ event, onSuccess, onClose }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(event.title);
  const [eventTypeCode, setEventTypeCode] = useState(event.eventTypeCode);
  const [venue, setVenue] = useState(event.venue);
  const [primaryVenueId, setPrimaryVenueId] = useState<string | null>(event.primaryVenueId ?? null);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate ?? "");
  const [ticketPrice, setTicketPrice] = useState(event.ticketPrice.toFixed(2));
  const [description, setDescription] = useState(event.description ?? "");
  const mutation = useUpdateEvent();
  const { data: eventTypes = [] } = useLookupParameters("event_types");
  const { data: venues = [] } = useQuery({
    queryKey: ["venues", "active"],
    queryFn: () => listVenues("active"),
    staleTime: 60_000,
  });

  const resolvedEnd = endDate && endDate.length === 10 ? endDate : startDate;

  const eventTypeDisplayName =
    eventTypes.find((t) => t.code === eventTypeCode)?.displayName ?? "";

  const scopeKind = useMemo(
    () =>
      inferEventKind({
        startDate,
        endDate: resolvedEnd,
        eventTypeCode,
        eventTypeDisplayName,
        primaryVenueId,
        storedEventKind: event.eventKind,
      }),
    [startDate, resolvedEnd, eventTypeCode, eventTypeDisplayName, primaryVenueId, event.eventKind],
  );

  const isOuting = scopeKind !== "legacy";

  // Re-hydrate when the active event changes.
  useEffect(() => {
    setTitle(event.title);
    setEventTypeCode(event.eventTypeCode);
    setVenue(event.venue);
    setPrimaryVenueId(event.primaryVenueId ?? null);
    setStartDate(event.startDate);
    setEndDate(event.endDate ?? "");
    setTicketPrice(event.ticketPrice.toFixed(2));
    setDescription(event.description ?? "");
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Link free-text venue label to registry when names match (legacy rows).
  useEffect(() => {
    if (primaryVenueId || !venue.trim() || venues.length === 0) return;
    const match = venues.find(
      (v) => v.name.trim().toLowerCase() === venue.trim().toLowerCase(),
    );
    if (match) setPrimaryVenueId(match.id);
  }, [venues, venue, primaryVenueId]);

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
      scopeKind !== (event.eventKind ?? "legacy") ||
      venue !== event.venue ||
      primaryVenueId !== (event.primaryVenueId ?? null) ||
      startDate !== event.startDate ||
      (endDate || null) !== (event.endDate ?? null) ||
      Number(ticketPrice) !== event.ticketPrice ||
      (description || null) !== (event.description ?? null),
    [title, eventTypeCode, scopeKind, venue, primaryVenueId, startDate, endDate, ticketPrice, description, event],
  );

  const canSubmit = valid && dirty && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
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
        eventKind: scopeKind,
        primaryVenueId,
      });
      if (isOuting) {
        await seedEventDaySessions(event.id, startDate, resolvedEnd);
        await ensureEventItineraryStops(event.id);
        invalidateEventDayCaches(qc, { eventId: event.id });
        qc.invalidateQueries({ queryKey: ["trip-report", event.id] });
      }
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

        <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Trip scope (from dates + event type)
          </p>
          <p className="mt-1 font-medium">{SCOPE_LABELS[scopeKind]}</p>
          {isOuting && (
            <p className="mt-1 text-xs text-muted-foreground">
              {scopeKind === "multi_day_tour"
                ? `${formatDate(startDate)} → ${formatDate(resolvedEnd)} — assign a trip leader on each day in Trip days.`
                : `${formatDate(startDate)} — assign a trip leader on Trip days before Confirm.`}
            </p>
          )}
        </div>

        {isOuting && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Primary venue
            </Label>
            <Select
              value={primaryVenueId ?? ""}
              onValueChange={(v) => {
                setPrimaryVenueId(v || null);
                const picked = venues.find((x) => x.id === v);
                if (picked) setVenue(picked.name);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select from registry…" />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}{v.venue_type ? ` · ${v.venue_type}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isOuting ? "Venue display label" : "Venue name"}
          </Label>
          <Input
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder={isOuting ? "Leave blank to use registry name" : ""}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Start date
            </Label>
            <DatePicker
              value={parseIsoDateLocal(startDate)}
              onChange={(d) => d && setStartDate(toIsoDateString(d))}
              placeholder="Pick start date"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              End date (optional · mirrors start if blank)
            </Label>
            <DatePicker
              value={parseIsoDateLocal(endDate || undefined)}
              onChange={(d) => setEndDate(d ? toIsoDateString(d) : "")}
              placeholder={formatDate(startDate)}
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

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
        <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
          <Save className="h-4 w-4" />
          {mutation.isPending ? "Saving…" : "Update Event Logistics"}
        </Button>
      </div>
    </div>
  );
}

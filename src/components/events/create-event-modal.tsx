import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Copy, Check, ChevronsUpDown, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LookupSelect } from "@/components/lookups/lookup-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn, formatDate, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import { useInsertEvent, usePriorEventsForClone } from "@/hooks/use-supabase-data";
import { useQuery } from "@tanstack/react-query";
import { listVenues } from "@/lib/api/venues";
import { inferEventKind } from "@/lib/api/event-outing";
import { DatePicker } from "@/components/ui/date-picker";

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
  const [primaryVenueId, setPrimaryVenueId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [ticketPrice, setTicketPrice] = useState("0.00");
  const [description, setDescription] = useState("");
  const [sourceEventId, setSourceEventId] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertEvent();
  const { data: priorEvents = [], isLoading: priorLoading } = usePriorEventsForClone();
  const { data: venues = [] } = useQuery({
    queryKey: ["venues", "active"],
    queryFn: () => listVenues("active"),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setTitle("");
      setEventTypeCode("");
      setVenue("");
      setPrimaryVenueId(null);
      setStartDate(todayIso());
      setEndDate("");
      setTicketPrice("0.00");
      setDescription("");
      setSourceEventId(null);
      setDirty(false);
    }
  }, [open]);

  const selectedSource = useMemo(
    () => priorEvents.find((e) => e.id === sourceEventId) ?? null,
    [priorEvents, sourceEventId],
  );

  const resolvedEndDate = endDate && endDate.length === 10 ? endDate : startDate;

  const scopeKind = useMemo(
    () =>
      inferEventKind({
        startDate,
        endDate: resolvedEndDate,
        eventTypeCode,
        primaryVenueId,
      }),
    [startDate, resolvedEndDate, eventTypeCode, primaryVenueId],
  );

  const isOuting = scopeKind !== "legacy";

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
      await mutation.mutateAsync({
        title: title.trim(),
        eventTypeCode,
        venue: venue.trim() || (venues.find((v) => v.id === primaryVenueId)?.name ?? ""),
        startDate,
        endDate: resolvedEndDate,
        ticketPrice: priceNumber,
        description: description.trim() || null,
        status: "Planning",
        cloneFromEventId: sourceEventId,
        eventKind: scopeKind,
        primaryVenueId,
      });
      toast.success(
        selectedSource
          ? `Event created · Roster cloned from "${selectedSource.title}"`
          : "Event created",
        { description: title.trim() },
      );
      onOpenChange(false);
    } catch (err) {
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
      <DialogContent className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border-border bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle>Create new event</DialogTitle>
          <DialogDescription>
            All fields are stored against <span className="font-mono">event_manifest</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 flex-1 overflow-y-auto px-6">
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

            {/* ----- Clone roster from any prior event (searchable) ----- */}
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Copy className="h-3.5 w-3.5" /> Clone roster from prior event
              </Label>

              <div className="flex items-center gap-2">
                <Popover open={cloneOpen} onOpenChange={setCloneOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={cloneOpen}
                      className="h-9 flex-1 justify-between bg-background font-normal"
                    >
                      <span className={cn("truncate", !selectedSource && "text-muted-foreground")}>
                        {selectedSource
                          ? `${selectedSource.title} · ${selectedSource.startDate}`
                          : priorLoading
                            ? "Loading events…"
                            : "Pick a past event to clone its roster…"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by title or date…" />
                      <CommandList>
                        <CommandEmpty>No matching events.</CommandEmpty>
                        <CommandGroup>
                          {priorEvents.map((ev) => (
                            <CommandItem
                              key={ev.id}
                              value={`${ev.title} ${ev.startDate} ${ev.venue ?? ""}`}
                              onSelect={() => {
                                setSourceEventId(ev.id);
                                setDirty(true);
                                setCloneOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  sourceEventId === ev.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                <span className="truncate font-medium">{ev.title}</span>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                  {ev.startDate}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {selectedSource && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => {
                      setSourceEventId(null);
                      setDirty(true);
                    }}
                    aria-label="Clear cloned source"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {selectedSource ? (
                <div className="rounded bg-background/60 px-2 py-1.5 text-[11px]">
                  <span className="font-semibold">Source:</span> {selectedSource.title}{" "}
                  <span className="text-muted-foreground">· {selectedSource.startDate}</span>
                  <div className="mt-0.5 text-muted-foreground">
                    Roster will be copied · financials reset · medical snapshots refreshed · status forced to{" "}
                    <strong>Planning</strong>.
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Leave empty for a blank roster, or pick any past event as a template.
                </p>
              )}
            </div>

            {/* Trip scope — derived from dates + event type (§12.3.1) */}
            <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Trip scope
              </p>
              <p className="mt-1 font-medium">
                {scopeKind === "multi_day_tour"
                  ? "Multi-day tour"
                  : scopeKind === "single_day_outing"
                    ? "Single-day outing"
                    : "Centre-linked event"}
              </p>
              {isOuting && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Outing types use the Venue Registry, itinerary, and trip-day rolls (§12).
                </p>
              )}
            </div>

            {/* Primary venue (outings) */}
            {isOuting && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Primary venue
                </Label>
                <Select
                  value={primaryVenueId ?? ""}
                  onValueChange={(v) => { mark(setPrimaryVenueId)(v || null); }}
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

            {/* Venue name (free-text fallback for legacy / display label override) */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isOuting ? "Venue display label (optional override)" : "Venue"}
              </Label>
              <Input
                value={venue}
                onChange={(e) => mark(setVenue)(e.target.value)}
                placeholder={isOuting ? "Leave blank to use registry name" : "e.g. Bondi Pavilion"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Start date
                </Label>
                <DatePicker
                  value={parseIsoDateLocal(startDate)}
                  onChange={(d) => d && mark(setStartDate)(toIsoDateString(d))}
                  placeholder="Pick start date"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  End date (optional)
                </Label>
                <DatePicker
                  value={parseIsoDateLocal(endDate || undefined)}
                  onChange={(d) => mark(setEndDate)(d ? toIsoDateString(d) : "")}
                  placeholder={formatDate(startDate)}
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
        </div>

        <DialogFooter className="shrink-0 border-t border-border pt-3">
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

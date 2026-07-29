/**
 * ItineraryTab — event_venue_stops editor (§12.3.3)
 *
 * Shown only for single_day_outing / multi_day_tour events.
 * Each row in the ordered list becomes one transport_trip at runtime (Phase 3).
 *
 * Per §12.1: each adjacent stop pair = one hop = one transport_trip.
 * The UI shows them as an ordered chain: Stop 0 → Stop 1 → Stop 2 → …
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  BedDouble,
  GripVertical,
  Loader2,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PointerSortableList } from "@/components/manifest/manage-pickups-panel";
import { cn, formatDate, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import { listVenues } from "@/lib/api/venues";
import { useVenueGate } from "@/lib/hooks/use-venue-gate";
import {
  assessOvernightHotelStops,
  deleteEventVenueStop,
  inferEventKind,
  isAccommodationVenueType,
  listEventVenueStops,
  reorderEventVenueStops,
  upsertEventVenueStop,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import type { EventManifest } from "@/lib/data-store";
import {
  CAUTION_BADGE_CLASS,
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
  CAUTION_OK_BADGE_CLASS,
  CAUTION_STRIP_CLASS,
} from "@/lib/ui/caution-callout";

interface Props {
  event: EventManifest;
}

const stopsKey = (eventId: string) => ["event-venue-stops", eventId] as const;

/** All calendar dates between start and end inclusive (local calendar days). */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = parseIsoDateLocal(start.slice(0, 10));
  const last = parseIsoDateLocal((end ?? start).slice(0, 10));
  while (cur <= last) {
    dates.push(toIsoDateString(cur));
    const next = new Date(cur);
    next.setDate(next.getDate() + 1);
    cur = next;
  }
  return dates;
}

function fmtDate(iso: string): string {
  return formatDate(iso);
}

export function ItineraryTab({ event }: Props) {
  const qc = useQueryClient();
  const days = useMemo(
    () => dateRange(event.startDate, event.endDate ?? event.startDate),
    [event.startDate, event.endDate],
  );

  const { data: stops = [], isLoading } = useQuery({
    queryKey: stopsKey(event.id),
    queryFn: () => listEventVenueStops(event.id),
    staleTime: 30_000,
  });

  const { data: venues = [] } = useQuery({
    queryKey: ["venues", "active"],
    queryFn: () => listVenues("active"),
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: stopsKey(event.id) });

  const stopsByDay = useMemo(() => {
    const m = new Map<string, EventVenueStop[]>();
    days.forEach((d) => m.set(d, []));
    stops.forEach((s) => {
      const arr = m.get(s.session_date) ?? [];
      arr.push(s);
      m.set(s.session_date, arr);
    });
    return m;
  }, [stops, days]);

  const eventKind = useMemo(
    () =>
      inferEventKind({
        startDate: event.startDate,
        endDate: event.endDate,
        eventTypeCode: event.eventTypeCode,
        primaryVenueId: event.primaryVenueId,
        storedEventKind: event.eventKind,
      }),
    [event],
  );

  const hotelGate = useMemo(
    () =>
      assessOvernightHotelStops({
        eventKind,
        sessionDates: days,
        stops,
      }),
    [eventKind, days, stops],
  );

  const failingSet = useMemo(
    () => new Set(hotelGate.failingDates),
    [hotelGate.failingDates],
  );
  const finalDate = days.length > 0 ? days[days.length - 1]! : null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Each adjacent stop pair becomes one bus hop when the day goes active.
          First stop = origin; last stop = end of day.
          {eventKind === "multi_day_tour" && (
            <>
              {" "}
              Non-final nights <strong>must</strong> end at a venue typed{" "}
              <strong>Hotel / accommodation</strong> (Confirm / Open are blocked until fixed).
              Final day is exempt.
            </>
          )}
        </p>
        {!hotelGate.ok && (
          <div className={cn("flex items-start gap-2 px-3 py-2.5 text-sm", CAUTION_CALLOUT_CLASS)}>
            <AlertTriangle className={cn("mt-0.5 h-4 w-4", CAUTION_CALLOUT_ICON_CLASS)} />
            <div>
              <p className="font-semibold">Overnight hotel required</p>
              <p className={cn("mt-0.5 text-xs leading-relaxed", CAUTION_CALLOUT_BODY_CLASS)}>
                {hotelGate.blockers[0]}
              </p>
            </div>
          </div>
        )}
      </div>

      {days.map((date) => (
        <DayItinerary
          key={date}
          event={event}
          date={date}
          stops={stopsByDay.get(date) ?? []}
          venues={venues}
          onInvalidate={invalidate}
          requiresOvernightHotel={
            eventKind === "multi_day_tour" && finalDate != null && date !== finalDate
          }
          overnightMissing={failingSet.has(date)}
        />
      ))}
    </div>
  );
}

// ─── One-day itinerary block ─────────────────────────────────────────────────

interface DayItineraryProps {
  event: EventManifest;
  date: string;
  stops: EventVenueStop[];
  venues: Array<{ id: string; name: string; venue_type: string }>;
  onInvalidate: () => void;
  /** Multi-day non-final night — last stop must be hotel. */
  requiresOvernightHotel: boolean;
  overnightMissing: boolean;
}

function DayItinerary({
  event,
  date,
  stops,
  venues,
  onInvalidate,
  requiresOvernightHotel,
  overnightMissing,
}: DayItineraryProps) {
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a.stop_order - b.stop_order),
    [stops],
  );

  const [addVenueId, setAddVenueId] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addKind, setAddKind] = useState<"venue" | "meal">("venue");
  const [addMealSlot, setAddMealSlot] = useState("lunch");
  const [addMealSource, setAddMealSource] = useState("delivered_by_us");
  const [addMenuNotes, setAddMenuNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventVenueStop | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const gate = useVenueGate();

  const handleAdd = async () => {
    if (addKind === "venue") {
      if (!addVenueId) return;
      const ok = await gate.checkVenue(addVenueId);
      if (!ok) return;
    }
    setAdding(true);
    try {
      if (addKind === "meal") {
        const slotLabel = addMealSlot.replace(/_/g, " ");
        await upsertEventVenueStop({
          event_id: event.id,
          session_date: date,
          venue_id: addVenueId || null,
          stop_order: sorted.length,
          label_override:
            addLabel.trim() ||
            slotLabel.charAt(0).toUpperCase() + slotLabel.slice(1),
          activity_kind: "meal",
          meal_slot: addMealSlot as
            | "breakfast"
            | "morning_tea"
            | "lunch"
            | "dinner",
          meal_source: addMealSource as
            | "delivered_by_us"
            | "own_food"
            | "venue_provided"
            | "packed"
            | "purchase",
          menu_notes: addMenuNotes.trim() || null,
        });
        toast.success("Meal activity added.");
      } else {
        await upsertEventVenueStop({
          event_id: event.id,
          session_date: date,
          venue_id: addVenueId,
          stop_order: sorted.length,
          label_override: addLabel.trim() || null,
          activity_kind: "venue",
        });
        toast.success("Stop added.");
      }
      setAddVenueId("");
      setAddLabel("");
      setAddMenuNotes("");
      setAddKind("venue");
      setAddOpen(false);
      onInvalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteEventVenueStop(deleteTarget.id);
      toast.success("Stop removed.");
      setDeleteTarget(null);
      onInvalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const handleReorder = async (nextIds: string[]) => {
    setReordering(true);
    try {
      await reorderEventVenueStops(event.id, date, nextIds);
      onInvalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReordering(false);
    }
  };

  const stopById = useMemo(() => new Map(sorted.map((s) => [s.id, s])), [sorted]);

  const hopCount = Math.max(0, sorted.length - 1);

  return (
    <div
      className={cn(
        "rounded-lg border",
        overnightMissing && "border-amber-500/60 ring-1 ring-amber-400/40 dark:border-amber-400/50",
      )}
    >
      {/* Day header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm">{fmtDate(date)}</span>
          {hopCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {hopCount} hop{hopCount === 1 ? "" : "s"}
            </Badge>
          )}
          {requiresOvernightHotel && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[10px]",
                overnightMissing ? CAUTION_BADGE_CLASS : CAUTION_OK_BADGE_CLASS,
              )}
            >
              <BedDouble className="h-3 w-3" />
              {overnightMissing ? "Needs overnight hotel" : "Overnight OK"}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen((p) => !p)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add stop / meal
        </Button>
      </div>

      {overnightMissing && (
        <div className={cn("flex items-start gap-1.5 px-4 py-2 text-xs", CAUTION_STRIP_CLASS)}>
          <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5", CAUTION_CALLOUT_ICON_CLASS)} />
          <span>
            Last stop must be a <strong>Hotel / accommodation</strong> venue. Add one or drag it to
            the end of this day.
          </span>
        </div>
      )}

      {/* Add stop / meal inline form */}
      {addOpen && (
        <div className="border-b bg-muted/10 px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={addKind === "venue" ? "default" : "outline"}
              onClick={() => setAddKind("venue")}
            >
              Venue stop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={addKind === "meal" ? "default" : "outline"}
              onClick={() => setAddKind("meal")}
            >
              Meal activity
            </Button>
          </div>
          {addKind === "meal" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Select value={addMealSlot} onValueChange={setAddMealSlot}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Meal slot" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="breakfast">Breakfast</SelectItem>
                    <SelectItem value="morning_tea">Morning tea</SelectItem>
                    <SelectItem value="lunch">Lunch</SelectItem>
                    <SelectItem value="dinner">Dinner</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={addMealSource} onValueChange={setAddMealSource}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delivered_by_us">Cooked / delivered by us</SelectItem>
                    <SelectItem value="own_food">Brought own food</SelectItem>
                    <SelectItem value="venue_provided">Venue provided</SelectItem>
                    <SelectItem value="packed">Packed from centre</SelectItem>
                    <SelectItem value="purchase">Takeaway / purchase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={addMenuNotes}
                onChange={(e) => setAddMenuNotes(e.target.value)}
                placeholder="Optional hint — enter what it is at Open"
                className="h-8 text-sm"
              />
              <Select value={addVenueId || "__none__"} onValueChange={(v) => setAddVenueId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Where (optional venue)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No venue / on site</SelectItem>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="w-full"
                disabled={adding}
                onClick={handleAdd}
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add meal"}
              </Button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select value={addVenueId} onValueChange={setAddVenueId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Pick venue from registry…" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}{v.venue_type ? ` · ${v.venue_type}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!addVenueId || adding || gate.checking}
                  onClick={handleAdd}
                >
                  {adding || gate.checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>
              {gate.warningMessage && (
                <p className="text-xs text-amber-600">{gate.warningMessage}</p>
              )}
              <Input
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Label override (optional — e.g. Return to base)"
                className="h-8 text-sm"
              />
            </>
          )}
        </div>
      )}

      {/* Stop list */}
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 py-6 text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-1.5 h-4 w-4 opacity-40" />
          No stops yet — add the departure point first.
        </div>
      ) : (
        <div className="px-2 py-2">
          {sorted.length >= 2 && (
            <p className="mb-2 px-2 text-xs text-muted-foreground">
              Press and drag any row to reorder — works on iPhone and iPad.
            </p>
          )}
          <PointerSortableList
            itemIds={sorted.map((s) => s.id)}
            onReorder={handleReorder}
            disabled={reordering}
          >
            {({ ids, bindRow }) => (
              <div className="space-y-1">
                {ids.map((id, idx) => {
                  const stop = stopById.get(id);
                  if (!stop) return null;
                  const bind = bindRow(id);
                  const nextStop = idx < ids.length - 1 ? stopById.get(ids[idx + 1]!) : null;
                  const isLast = idx === ids.length - 1;
                  const showOvernight =
                    requiresOvernightHotel && isLast && isAccommodationVenueType(stop.venue_type);

                  return (
                    <div
                      key={id}
                      ref={bind.rowRef}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 touch-manipulation select-none",
                        reordering ? "opacity-70" : "cursor-grab active:cursor-grabbing",
                        bind.isDragging && "z-10 bg-muted/60 shadow-md ring-2 ring-primary/40",
                        showOvernight && "bg-emerald-500/5",
                      )}
                      onPointerDown={bind.onGripPointerDown}
                    >
                      <GripVertical
                        className="h-5 w-5 shrink-0 text-muted-foreground pointer-events-none"
                        aria-hidden
                      />

                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                        {idx}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">
                            {stop.label_override ?? stop.venue_name ?? "Unknown venue"}
                          </span>
                          {stop.venue_type && (
                            <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
                              {stop.venue_type}
                            </span>
                          )}
                          {showOvernight && (
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                CAUTION_OK_BADGE_CLASS,
                              )}
                            >
                              <BedDouble className="h-3 w-3" />
                              Overnight
                            </span>
                          )}
                        </div>
                        {nextStop && (
                          <p className="ml-5 text-[10px] text-muted-foreground">
                            ↳ Hop {idx + 1} to{" "}
                            {nextStop.label_override ?? nextStop.venue_name ?? "next stop"}
                          </p>
                        )}
                      </div>

                      <IconActionButton
                        className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                        tooltip="Remove stop"
                        disabled={reordering}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setDeleteTarget(stop)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconActionButton>
                    </div>
                  );
                })}
              </div>
            )}
          </PointerSortableList>
        </div>
      )}

      {/* Compliance block dialog */}
      <AlertDialog
        open={!!gate.blockedMessage}
        onOpenChange={(o) => !o && gate.clearMessages()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Venue cannot be used</AlertDialogTitle>
            <AlertDialogDescription>{gate.blockedMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={gate.clearMessages}>OK</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove stop?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.label_override ?? deleteTarget?.venue_name}" will be removed from
              the {fmtDate(date)} itinerary. Adjacent hops will be re-indexed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

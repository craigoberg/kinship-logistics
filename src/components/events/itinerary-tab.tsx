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
  GripVertical,
  Loader2,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { listVenues } from "@/lib/api/venues";
import { useVenueGate } from "@/lib/hooks/use-venue-gate";
import {
  deleteEventVenueStop,
  listEventVenueStops,
  reorderEventVenueStops,
  upsertEventVenueStop,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import type { EventManifest } from "@/lib/data-store";

interface Props {
  event: EventManifest;
}

const stopsKey = (eventId: string) => ["event-venue-stops", eventId] as const;

/** All calendar dates between start and end inclusive. */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const last = new Date(end ?? start);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
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

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          Each adjacent stop pair becomes one bus hop (one{" "}
          <code className="text-xs">transport_trip</code>) when the day session goes active.
          First stop = bus origin; last stop = return destination.
        </p>
      </div>

      {days.map((date) => (
        <DayItinerary
          key={date}
          event={event}
          date={date}
          stops={stopsByDay.get(date) ?? []}
          venues={venues}
          onInvalidate={invalidate}
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
}

function DayItinerary({ event, date, stops, venues, onInvalidate }: DayItineraryProps) {
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a.stop_order - b.stop_order),
    [stops],
  );

  const [addVenueId, setAddVenueId] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventVenueStop | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const gate = useVenueGate();

  const handleAdd = async () => {
    if (!addVenueId) return;
    const ok = await gate.checkVenue(addVenueId);
    if (!ok) return; // gate.blockedMessage set — dialog renders below
    setAdding(true);
    try {
      await upsertEventVenueStop({
        event_id: event.id,
        session_date: date,
        venue_id: addVenueId,
        stop_order: sorted.length,
        label_override: addLabel.trim() || null,
      });
      toast.success("Stop added.");
      setAddVenueId("");
      setAddLabel("");
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
    <div className="rounded-lg border">
      {/* Day header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{fmtDate(date)}</span>
          {hopCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {hopCount} hop{hopCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen((p) => !p)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add stop
        </Button>
      </div>

      {/* Add stop inline form */}
      {addOpen && (
        <div className="border-b bg-muted/10 px-4 py-3 space-y-2">
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
        </div>
      )}

      {/* Stop list */}
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No stops yet — add the departure point first.
        </p>
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

                  return (
                    <div
                      key={id}
                      ref={bind.rowRef}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 touch-manipulation select-none",
                        reordering ? "opacity-70" : "cursor-grab active:cursor-grabbing",
                        bind.isDragging && "z-10 bg-muted/60 shadow-md ring-2 ring-primary/40",
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
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">
                            {stop.label_override ?? stop.venue_name ?? "Unknown venue"}
                          </span>
                          {stop.venue_type && (
                            <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
                              {stop.venue_type}
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

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                        title="Remove stop"
                        disabled={reordering}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setDeleteTarget(stop)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

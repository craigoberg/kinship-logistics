/**
 * ItineraryTab — event_venue_stops editor (§12.3.3)
 *
 * Shown only for single_day_outing / multi_day_tour events.
 * Each row in the ordered list becomes one transport_trip at runtime (Phase 3).
 *
 * Per §12.1: each adjacent stop pair = one hop = one transport_trip.
 * The UI shows them as an ordered chain: Stop 0 → Stop 1 → Stop 2 → …
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  BedDouble,
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Lock,
  Trash2,
  UserCheck,
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
import { cn, formatDateWithWeekday, parseIsoDateLocal, toIsoDateString } from "@/lib/utils";
import { listVenues } from "@/lib/api/venues";
import { stopVenueTypeName, venueTypeLabel } from "@/lib/api/venue-types";
import { useVenueTypes } from "@/components/admin/venue-types-panel";
import { useVenueGate } from "@/lib/hooks/use-venue-gate";
import {
  assessItineraryDayAnchors,
  assessOvernightHotelStops,
  deleteEventVenueStop,
  isPassengerStop,
  isAccommodationVenueType,
  isVenueTransportStop,
  listEventDaySessions,
  listEventVenueStops,
  reorderEventVenueStops,
  resetEventDaySessions,
  seedEventDaySessions,
  upsertEventVenueStop,
  type EventDaySession,
  type EventKind,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import { invalidateEventDayCaches } from "@/lib/query/invalidation";
import { useStaffRegistry } from "@/hooks/use-supabase-data";
import { isManagerOrAssistantAccess } from "@/lib/access-roles";
import type { EventManifest } from "@/lib/data-store";
import { ItineraryDayPlan } from "./itinerary-day-plan";
import { VenueBaselineSignoffHost } from "@/components/admin/venues-workspace";
import { batchVenueBaselineCurrent } from "@/lib/api/venues";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
  CAUTION_STRIP_CLASS,
} from "@/lib/ui/caution-callout";

/** Green when the check passes, red when it is missing or wrong. */
function ItineraryStatusChip({
  ok,
  children,
  onClick,
  compact = false,
  pending = false,
}: {
  ok: boolean;
  children: ReactNode;
  onClick?: () => void;
  compact?: boolean;
  /** Still reading the check. Stays quiet until the answer arrives. */
  pending?: boolean;
}) {
  const className = cn(
    "inline-flex shrink-0 items-center gap-1 border font-semibold",
    compact ? "rounded px-1.5 py-0.5 text-[10px]" : "rounded-full px-2 py-0.5 text-[11px]",
    pending
      ? "border-border bg-muted/40 text-muted-foreground"
      : ok
        ? "border-emerald-600/50 bg-emerald-500/15 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100"
        : "border-red-600/60 bg-red-500/15 text-red-900 dark:border-red-400/55 dark:bg-red-500/20 dark:text-red-100",
    onClick && !pending && (ok ? "hover:bg-emerald-500/25" : "hover:bg-red-500/25"),
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {children}
      </button>
    );
  }
  return <span className={className}>{children}</span>;
}

interface Props {
  event: EventManifest;
  /** Same scope the event dialog header uses, including the type's display name. */
  eventKind: EventKind;
}

const stopsKey = (eventId: string) => ["event-venue-stops", eventId] as const;
const daySessionsKey = (eventId: string) => ["event-day-sessions", eventId] as const;

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
  return formatDateWithWeekday(iso);
}

export function ItineraryTab({ event, eventKind }: Props) {
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

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: daySessionsKey(event.id),
    queryFn: () => listEventDaySessions(event.id),
    staleTime: 30_000,
  });

  const { data: staff = [] } = useStaffRegistry();
  const managers = useMemo(
    () =>
      staff
        .filter((s) => s.active && isManagerOrAssistantAccess(s.personnelType))
        .map((s) => ({ id: s.id, fullName: s.fullName })),
    [staff],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: stopsKey(event.id) });
  const invalidateDays = () => {
    void qc.invalidateQueries({ queryKey: daySessionsKey(event.id) });
    invalidateEventDayCaches(qc, { eventId: event.id });
  };

  const seedMut = useMutation({
    mutationFn: () =>
      seedEventDaySessions(event.id, event.startDate, event.endDate ?? event.startDate),
    onSuccess: (seeded) => {
      qc.setQueryData(daySessionsKey(event.id), seeded);
      invalidateEventDayCaches(qc, { eventId: event.id });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => {
      const toDelete = sessions.filter((s) => s.phase === "planning").map((s) => s.id);
      return resetEventDaySessions(event.id, toDelete);
    },
    onSuccess: (seeded) => {
      qc.setQueryData(daySessionsKey(event.id), seeded);
      invalidateEventDayCaches(qc, { eventId: event.id });
      toast.success(
        `Trip days reset — ${seeded.length} day${seeded.length !== 1 ? "s" : ""} from event dates.`,
      );
    },
    onError: (e: Error) => toast.error(`Reset failed: ${e.message}`),
  });

  const [confirmReset, setConfirmReset] = useState(false);
  const autoSeedFor = useRef<string | null>(null);
  useEffect(() => {
    autoSeedFor.current = null;
  }, [event.id]);
  useEffect(() => {
    if (sessionsLoading || sessions.length > 0 || seedMut.isPending) return;
    if (autoSeedFor.current === event.id) return;
    autoSeedFor.current = event.id;
    seedMut.mutate();
  }, [event.id, sessionsLoading, sessions.length, seedMut.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionByDate = useMemo(() => {
    const m = new Map<string, EventDaySession>();
    sessions.forEach((s) => m.set(s.session_date.slice(0, 10), s));
    return m;
  }, [sessions]);

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

  const hotelGate = useMemo(
    () =>
      assessOvernightHotelStops({
        eventKind,
        sessionDates: days,
        stops,
      }),
    [eventKind, days, stops],
  );

  const anchorGate = useMemo(
    () => assessItineraryDayAnchors({ sessionDates: days, stops }),
    [days, stops],
  );
  const failingSet = useMemo(
    () => new Set(hotelGate.failingDates),
    [hotelGate.failingDates],
  );
  const multiDay = eventKind === "multi_day_tour" || days.length > 1;
  const firstDate = days[0] ?? null;
  const finalDate = days.length > 0 ? days[days.length - 1]! : null;
  const hasMeeting = anchorGate.meetFailingDates.length === 0;
  const hasDeparture = anchorGate.departFailingDates.length === 0;
  const placeVenueIds = useMemo(
    () =>
      [...new Set(stops.flatMap((stop) => (stop.venue_id && !isPassengerStop(stop) ? [stop.venue_id] : [])))].sort(),
    [stops],
  );
  const baselineQ = useQuery({
    queryKey: ["venue-baseline-current", placeVenueIds.join(",")],
    queryFn: () => batchVenueBaselineCurrent(placeVenueIds),
    enabled: placeVenueIds.length > 0,
    staleTime: 15_000,
  });

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
          Each date names the <strong>trip leader</strong>
          {multiDay ? " and the morning and evening roll times" : ""}.
          Places sit under that. The first item each day is a <strong>place</strong> — the
          meeting point, where people arrive and where a multi-day roll call happens. A meal cannot
          be first. The last item is a <strong>hotel</strong> on an overnight night, or a{" "}
          <strong>departure place</strong> on the final day. Dinner cannot end the day.
          {eventKind === "multi_day_tour" && (
            <>
              {" "}
              Confirm / Open stay blocked until each day starts at a place and each overnight night
              ends at a Hotel / accommodation place.
            </>
          )}
        </p>
        {(!hasMeeting || !hasDeparture) && (
          <div className={cn("flex items-start gap-2 px-3 py-2.5 text-sm", CAUTION_CALLOUT_CLASS)}>
            <AlertTriangle className={cn("mt-0.5 h-4 w-4", CAUTION_CALLOUT_ICON_CLASS)} />
            <div>
              <p className="font-semibold">Each day needs a meeting place, and the last day a departure place</p>
              <p className={cn("mt-0.5 text-xs leading-relaxed", CAUTION_CALLOUT_BODY_CLASS)}>
                {anchorGate.blockers.join(" ")}
              </p>
            </div>
          </div>
        )}
        {sessions.length > 0 && !confirmReset && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmReset(true)}
            disabled={resetMut.isPending}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Reset trip days
          </Button>
        )}
        {confirmReset && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="text-xs text-destructive">
              Remove {sessions.filter((s) => s.phase === "planning").length} planning day(s) and
              reseed leaders from the event dates? Stops stay.
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-[11px]"
              disabled={resetMut.isPending}
              onClick={() => {
                setConfirmReset(false);
                resetMut.mutate();
              }}
            >
              {resetMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, reset"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </Button>
          </div>
        )}
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
          isFirstDay={date === firstDate}
          isLastDay={date === finalDate}
          session={sessionByDate.get(date) ?? null}
          managers={managers}
          multiDay={multiDay}
          onPlanSaved={invalidateDays}
          baselineCurrent={baselineQ.data}
          baselinePending={baselineQ.isLoading}
        />
      ))}
    </div>
  );
}

// ─── One-day itinerary block ─────────────────────────────────────────────────

function ItineraryRollRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-lg bg-muted/40 px-2 py-2">
      <span className="h-5 w-5 shrink-0" aria-hidden />
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-800 dark:text-violet-100">
        <UserCheck className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[10px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

interface DayItineraryProps {
  event: EventManifest;
  date: string;
  stops: EventVenueStop[];
  venues: Array<{ id: string; name: string; venue_type: string }>;
  onInvalidate: () => void;
  /** Multi-day non-final night — last stop must be hotel. */
  requiresOvernightHotel: boolean;
  overnightMissing: boolean;
  /** First calendar day — its first stop is the trip meeting point. */
  isFirstDay: boolean;
  /** Last calendar day — its last stop is the trip departure point. */
  isLastDay: boolean;
  session: EventDaySession | null;
  managers: Array<{ id: string; fullName: string }>;
  multiDay: boolean;
  onPlanSaved: () => void;
  /** venue id → baseline is signed and the annual review has not passed. */
  baselineCurrent?: Map<string, boolean>;
  baselinePending?: boolean;
}

function DayItinerary({
  event,
  date,
  stops,
  venues,
  onInvalidate,
  requiresOvernightHotel,
  overnightMissing,
  isFirstDay,
  isLastDay,
  session,
  managers,
  multiDay,
  onPlanSaved,
  baselineCurrent,
  baselinePending = false,
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
  const [leaderEditOpen, setLeaderEditOpen] = useState(false);
  const [pendingLeaderId, setPendingLeaderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [baselineVenueId, setBaselineVenueId] = useState<string | null>(null);
  const qc = useQueryClient();
  const gate = useVenueGate();
  const typesQ = useVenueTypes();

  useEffect(() => {
    if (session?.manager_staff_id) setPendingLeaderId(null);
  }, [session?.manager_staff_id]);

  const leaderId = session?.manager_staff_id ?? pendingLeaderId;
  const leaderName = leaderId
    ? (session?.manager_staff_id === leaderId ? session.manager_name : null) ??
      managers.find((m) => m.id === leaderId)?.fullName ??
      "Trip leader"
    : null;
  const eveningLabel = (session?.curfew_time ?? "").slice(0, 5);
  const morningLabel = (session?.morning_roll_time ?? "").slice(0, 5);

  const handleAdd = async () => {
    if (addKind === "venue") {
      if (!addVenueId) return;
      const ok = await gate.checkVenue(addVenueId);
      if (!ok) return;
    }
    setAdding(true);
    try {
      // Orders are not always 0..n-1. A deleted stop leaves a gap, so the
      // row count can already be in use (day 2 is 1–4, and 4 is the med round).
      const nextOrder =
        sorted.reduce((max, stop) => Math.max(max, stop.stop_order), -1) + 1;
      if (addKind === "meal") {
        const slotLabel = addMealSlot.replace(/_/g, " ");
        await upsertEventVenueStop({
          event_id: event.id,
          session_date: date,
          venue_id: addVenueId || null,
          stop_order: nextOrder,
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
          stop_order: nextOrder,
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

  const places = sorted.filter((stop) => !isPassengerStop(stop));
  const hopCount = Math.max(0, places.length - 1);
  const firstStop = places[0];
  const lastStop = places[places.length - 1];
  const meetOk = !!firstStop && isVenueTransportStop(firstStop);
  const departOk = !isLastDay || (!!lastStop && isVenueTransportStop(lastStop));
  const dayShapeBad = !meetOk || (isLastDay && !departOk) || overnightMissing;
  const meetName = meetOk
    ? (firstStop?.label_override ?? firstStop?.venue_name ?? "the meeting place")
    : null;
  const hotelLast =
    !!lastStop &&
    isVenueTransportStop(lastStop) &&
    isAccommodationVenueType(lastStop.venue_type);
  const startRollLabel = isFirstDay ? "Check-in" : "Morning roll";
  const startRollDetail = meetName
    ? `At ${meetName}`
    : "At the meeting place — the first item must be a place";
  const eveningRollDetail = hotelLast
    ? `Before ${lastStop?.label_override ?? lastStop?.venue_name ?? "the hotel"}`
    : "Before the hotel — the night must end at a hotel";

  return (
    <div
      className={cn(
        "rounded-lg border",
        dayShapeBad && "border-amber-500/60 ring-1 ring-amber-400/40 dark:border-amber-400/50",
      )}
    >
      {/* Day header — date, hops, and lights stay visible when collapsed */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 bg-muted/30 px-3 py-2.5",
          expanded && "border-b",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 flex-wrap items-center gap-2 rounded-md text-left hover:bg-muted/60"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${fmtDate(date)}` : `Expand ${fmtDate(date)}`}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="font-semibold text-sm">{fmtDate(date)}</span>
            <Badge variant="outline" className="text-[10px]">
              {hopCount} hop{hopCount === 1 ? "" : "s"}
            </Badge>
          <ItineraryStatusChip ok={meetOk}>
            <MapPin className="h-3 w-3" />
            {meetOk ? "Meeting point" : "Needs a meeting place"}
          </ItineraryStatusChip>
          {requiresOvernightHotel && (
            <ItineraryStatusChip ok={!overnightMissing}>
              <BedDouble className="h-3 w-3" />
              {overnightMissing ? "Needs a hotel" : "Hotel"}
            </ItineraryStatusChip>
          )}
          {isLastDay && (
            <ItineraryStatusChip ok={departOk}>
              <MapPin className="h-3 w-3" />
              {departOk ? "Departure place" : "Needs a departure place"}
            </ItineraryStatusChip>
          )}
          </button>
          <ItineraryStatusChip ok={!!leaderName} onClick={() => setLeaderEditOpen(true)}>
            <ShieldCheck className="h-3 w-3" />
            {leaderName ?? "No trip leader"}
          </ItineraryStatusChip>
          {multiDay && leaderName && eveningLabel && (
            <button
              type="button"
              onClick={() => setLeaderEditOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Clock className="h-3 w-3" />
              Evening {eveningLabel}
            </button>
          )}
          {multiDay && leaderName && morningLabel && (
            <button
              type="button"
              onClick={() => setLeaderEditOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Clock className="h-3 w-3" />
              Morning {morningLabel}
            </button>
          )}
        </div>
        {expanded && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddOpen((p) => !p)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add stop / meal
          </Button>
        )}
      </div>

      <ItineraryDayPlan
        event={event}
        session={session}
        managers={managers}
        multiDay={multiDay}
        isFirstDay={isFirstDay}
        editOpen={leaderEditOpen}
        onEditOpenChange={setLeaderEditOpen}
        showDetails={expanded}
        onLeaderPicked={setPendingLeaderId}
        onSaved={onPlanSaved}
      />

      {expanded && !meetOk && (
        <div className={cn("flex items-start gap-1.5 px-4 py-2 text-xs", CAUTION_STRIP_CLASS)}>
          <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5", CAUTION_CALLOUT_ICON_CLASS)} />
          <span>
            The first item must be a <strong>place</strong> — where people meet
            {multiDay ? " and roll call happens" : ""}. A meal or medication round cannot be first.
          </span>
        </div>
      )}

      {expanded && overnightMissing && (
        <div className={cn("flex items-start gap-1.5 px-4 py-2 text-xs", CAUTION_STRIP_CLASS)}>
          <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5", CAUTION_CALLOUT_ICON_CLASS)} />
          <span>
            The last item must be a <strong>Hotel / accommodation</strong> place. A meal cannot end
            the night. Add one or drag it to the end of this day.
          </span>
        </div>
      )}

      {expanded && isLastDay && !departOk && (
        <div className={cn("flex items-start gap-1.5 px-4 py-2 text-xs", CAUTION_STRIP_CLASS)}>
          <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5", CAUTION_CALLOUT_ICON_CLASS)} />
          <span>
            The last item must be a <strong>departure place</strong>. Dinner or a medication round
            cannot end the day.
          </span>
        </div>
      )}

      {/* Add stop / meal inline form */}
      {expanded && addOpen && (
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
                        {v.name}{v.venue_type ? ` · ${venueTypeLabel(typesQ.data?.types, v.venue_type)}` : ""}
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
      {expanded && (sorted.length === 0 ? (
        <div className="space-y-1 px-2 py-2">
          {multiDay && (
            <ItineraryRollRow label={startRollLabel} detail={startRollDetail} />
          )}
          {requiresOvernightHotel && (
            <ItineraryRollRow label="Evening roll" detail={eveningRollDetail} />
          )}
          <div className="rounded-lg border border-dashed bg-muted/30 py-6 text-center text-sm text-muted-foreground">
            <MapPin className="mx-auto mb-1.5 h-4 w-4 opacity-40" />
            {isFirstDay && isLastDay
              ? "No stops yet. Add the meeting place — people arrive there by bus or self, and can leave from the same place for home."
              : isFirstDay
                ? "No meeting place yet. Add a place where people arrive by bus or self."
                : isLastDay
                  ? "No departure place yet. Add a place where people leave by bus or self for home."
                  : "No stops yet for this day. Start with a place."}
          </div>
        </div>
      ) : (
        <div className="space-y-1 px-2 py-2">
          {multiDay && (
            <ItineraryRollRow label={startRollLabel} detail={startRollDetail} />
          )}
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
                  const isPlace = isVenueTransportStop(stop);
                  const passenger = isPassengerStop(stop);
                  const isMeeting = !!firstStop && stop.id === firstStop.id;
                  const isDeparture = isLastDay && !!lastStop && stop.id === lastStop.id;
                  const hotelOk =
                    requiresOvernightHotel && isLast && isPlace && isAccommodationVenueType(stop.venue_type);
                  const hotelBad = requiresOvernightHotel && isLast && !hotelOk;
                  const showOvernight = hotelOk;

                  return (
                    <div key={id} className="space-y-1">
                      {requiresOvernightHotel && isLast && (
                        <ItineraryRollRow label="Evening roll" detail={eveningRollDetail} />
                      )}
                    <div
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
                        {idx + 1}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">
                            {stop.label_override ?? stop.venue_name ?? "Unknown venue"}
                          </span>
                          {stopVenueTypeName(stop, typesQ.data?.types) && stop.venue_id && !passenger && (
                            <ItineraryStatusChip
                              ok={baselineCurrent?.get(stop.venue_id) === true}
                              pending={baselinePending && baselineCurrent?.get(stop.venue_id) == null}
                              compact
                              onClick={() => setBaselineVenueId(stop.venue_id)}
                            >
                              {stopVenueTypeName(stop, typesQ.data?.types)}
                            </ItineraryStatusChip>
                          )}
                          {stopVenueTypeName(stop, typesQ.data?.types) && (!stop.venue_id || passenger) && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {stopVenueTypeName(stop, typesQ.data?.types)}
                            </span>
                          )}
                          {passenger && (
                            <ItineraryStatusChip ok compact>
                              {stop.activity_kind === "passenger_dropoff" ? "Drop-off" : "Pickup"}
                            </ItineraryStatusChip>
                          )}
                          {isMeeting && meetOk && (
                            <ItineraryStatusChip ok compact>
                              {isDeparture && departOk ? "Meeting point · Departure point" : "Meeting point"}
                            </ItineraryStatusChip>
                          )}
                          {isDeparture && departOk && !(isMeeting && meetOk) && (
                            <ItineraryStatusChip ok compact>
                              Departure point
                            </ItineraryStatusChip>
                          )}
                          {!meetOk && isMeeting && (
                            <ItineraryStatusChip ok={false} compact>
                              Needs a meeting place
                            </ItineraryStatusChip>
                          )}
                          {isLastDay && !departOk && isLast && (
                            <ItineraryStatusChip ok={false} compact>
                              Needs a departure place
                            </ItineraryStatusChip>
                          )}
                          {hotelOk && (
                            <ItineraryStatusChip ok compact>
                              <BedDouble className="h-3 w-3" />
                              Hotel
                            </ItineraryStatusChip>
                          )}
                          {hotelBad && (
                            <ItineraryStatusChip ok={false} compact>
                              <BedDouble className="h-3 w-3" />
                              Needs a hotel
                            </ItineraryStatusChip>
                          )}
                        </div>
                        {passenger && stop.street_address ? (
                          <p className="ml-5 truncate text-[10px] text-muted-foreground">
                            {stop.street_address}
                          </p>
                        ) : nextStop ? (
                          <p className="ml-5 text-[10px] text-muted-foreground">
                            ↳ Hop {idx + 1} to{" "}
                            {nextStop.label_override ?? nextStop.venue_name ?? "next stop"}
                          </p>
                        ) : null}
                      </div>

                      {passenger ? (
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground"
                          title="Stays while someone is picked up or dropped off here"
                        >
                          <Lock className="h-4 w-4" />
                        </span>
                      ) : (
                      <IconActionButton
                        className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                        tooltip="Remove stop"
                        disabled={reordering}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setDeleteTarget(stop)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconActionButton>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            )}
          </PointerSortableList>
        </div>
      ))}

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

      <VenueBaselineSignoffHost
        venueId={baselineVenueId}
        open={!!baselineVenueId}
        onOpenChange={(open) => {
          if (!open) setBaselineVenueId(null);
        }}
        onSigned={() => {
          setBaselineVenueId(null);
          void qc.invalidateQueries({ queryKey: ["venue-baseline-current"] });
        }}
      />
    </div>
  );
}

/**
 * ActivityLoopTab — Event Deliver Phase B (GUARDRAILS §12.13 / BL-068)
 *
 * Future activities stay closed until Open. Open stamps the time (safe to go)
 * and then asks how the group travels there from where they are now.
 *   • Open → method → confirm (Method + Undo). Bus confirm = Release.
 *   • Walk / Other / On-site confirm opens the activity. Meals then set up food.
 *   • Final stop of day: plain Complete (evening / check-out)
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  BedDouble,
  Flag,
  Footprints,
  Loader2,
  MapPin,
  Pill,
  Play,
  RotateCcw,
  TrainFront,
  UserCheck,
  UserX,
  UtensilsCrossed,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeaveMovementConfirmPanel } from "@/components/events/leave-movement-confirm-panel";
import { EventDayVerbalAnomalyFlow } from "@/components/events/event-day-verbal-anomaly-flow";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  ProgrammeAbsentDialog,
  TripReinstateDialog,
  type ProgrammeAbsentResult,
} from "@/components/events/trip-absent-disposition-dialog";
import { cn, formatTime } from "@/lib/utils";
import { sortByParticipantSurname } from "@/lib/ui/sort-participants";
import {
  isAccommodationVenueType,
  isMealStop,
  isPassengerStop,
  isMedicationStop,
  isVenueTransportStop,
  listEventVenueStops,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import { MealServiceRoll } from "@/components/events/meal-service-roll";
import { MealServiceSummary } from "@/components/meals/meal-service-summary";
import { OpenMealSheet } from "@/components/meals/open-meal-sheet";
import { TodaysMedicationCard } from "@/components/medication/todays-medication-card";
import { AlternateMedPlanSheet } from "@/components/events/alternate-med-plan-sheet";
import type { MealSource, PreparerCertStatus } from "@/lib/meal-open";
import {
  listAllActiveSchedules,
  listParticipants,
  listTodaysComplianceLogs,
  type Participant,
} from "@/lib/data-store";
import {
  ensureEventDayMedicationRound,
  listTripMedicationPresenceIds,
} from "@/lib/api/event-medication-round";
import { useMedicationRound } from "@/hooks/use-medication-round";
import { assertMedicationRoundManaged } from "@/lib/medication/todays-medication-round";
import {
  listActivityRoll,
  openVenueStop,
  declareProgrammeStopOpen,
  leaveVenueForNext,
  closeVenueStop,
  reopenVenueActivityCheckIn,
  countOutstandingActivityExpected,
  toggleActivityCheckIn,
  markActivitySkip,
  clearActivityAbsent,
  activityRollKey,
  type ActivityRollRow,
  type MovementMethod,
  type StopPhase,
} from "@/lib/api/event-activity-roll";
import {
  eventTransportRunsKey,
  listEventTransportRuns,
} from "@/lib/api/event-hop-transport";
import {
  countOutstandingMealServes,
  openMealVenueStop,
} from "@/lib/api/event-meal-service";
import type { MealOpenPayload } from "@/lib/meal-open";
import {
  getEventAttendanceRow,
  listEventAttendanceRoll,
  listFloorAbsentNotes,
  markEventAttendanceAbsent,
  reinstateLeftTripEverywhere,
} from "@/lib/api/event-attendance";
import {
  EVENT_SUPPORT_ROLL_KEY,
  listEventSupportAttendance,
} from "@/lib/api/event-support";
import {
  PERSON_KIND_CHIP_CLASS,
  type PersonKindChip,
} from "@/lib/ui/person-kind-chip";
import {
  formatActivitySkipDisplay,
  formatActivitySkipShortLabel,
  formatLeftTripDisplay,
  formatLeftTripShortLabel,
  isActivitySkipNotes,
} from "@/lib/trip-absent";
import {
  eventDeliverStatusKey,
  buildProgrammeHops,
  fetchEventDeliverGroupStatus,
  resolveOvernightWakeBase,
} from "@/lib/api/event-deliver-status";
import { listEventDayIssues } from "@/lib/api/site-issues";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { stopVenueTypeName } from "@/lib/api/venue-types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  eventId: string;
  eventTitle: string;
  eventDaySessionId: string;
  sessionDate: string;
}

const stopsKey = (eventId: string) => ["event-venue-stops", eventId] as const;
const participantsKey = () => ["participants"] as const;

function OvernightChip({ className }: { className?: string }) {
  return (
    <Badge className={cn("gap-0.5 bg-indigo-600 text-[10px] text-white", className)}>
      <BedDouble className="h-3 w-3" />
      Overnight
    </Badge>
  );
}

function ActivityChip() {
  return (
    <Badge className="gap-0.5 bg-cyan-700 text-[10px] text-white">
      <Flag className="h-3 w-3" />
      Activity
    </Badge>
  );
}

function MeetingPointChip({ name }: { name?: string }) {
  return (
    <Badge className="max-w-full gap-1 bg-sky-700 text-[10px] text-white">
      <MapPin className="h-3 w-3 shrink-0" />
      <span className="truncate">{name ? `Meeting point · ${name}` : "Meeting point"}</span>
    </Badge>
  );
}

function PartyCountChip({ kind, count }: { kind: PersonKindChip; count: number }) {
  const word =
    kind === "participant"
      ? count === 1
        ? "Participant"
        : "Participants"
      : kind === "carer"
        ? count === 1
          ? "Carer"
          : "Carers"
        : kind === "volunteer"
          ? count === 1
            ? "Volunteer"
            : "Volunteers"
          : "Staff";
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[10px] font-semibold", PERSON_KIND_CHIP_CLASS[kind])}
    >
      <span className="tabular-nums">{count}</span>
      {word}
    </Badge>
  );
}

function ProgrammePartyBar({
  meetingPoint,
  counts,
}: {
  meetingPoint: string;
  counts: { participants: number; carers: number; volunteers: number; staff: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <MeetingPointChip name={meetingPoint} />
      <PartyCountChip kind="participant" count={counts.participants} />
      <PartyCountChip kind="carer" count={counts.carers} />
      <PartyCountChip kind="volunteer" count={counts.volunteers} />
      <PartyCountChip kind="staff" count={counts.staff} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ActivityLoopTab({
  eventId,
  eventTitle,
  eventDaySessionId,
  sessionDate,
}: Props) {
  const qc = useQueryClient();
  const [issueActivityLabel, setIssueActivityLabel] = useState<string | null>(
    null,
  );
  const [issueFlowOpen, setIssueFlowOpen] = useState(false);
  /** After walk/other leave — expand destination so check-in is obvious. */
  const [focusStopId, setFocusStopId] = useState<string | null>(null);

  const openActivityIssue = (activityLabel: string) => {
    setIssueActivityLabel(activityLabel);
    setIssueFlowOpen(true);
  };

  const { data: allStops = [], isLoading: stopsLoading } = useQuery({
    queryKey: stopsKey(eventId),
    queryFn: () => listEventVenueStops(eventId),
    staleTime: 20_000,
  });

  const { data: participants = [] } = useQuery({
    queryKey: participantsKey(),
    queryFn: listParticipants,
    staleTime: 120_000,
  });

  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const { data: attendanceRoll = [] } = useQuery({
    queryKey: ["event-attendance-log", eventDaySessionId],
    queryFn: () => listEventAttendanceRoll(eventDaySessionId),
    staleTime: 20_000,
  });
  const { data: supportRoll = [] } = useQuery({
    queryKey: EVENT_SUPPORT_ROLL_KEY(eventDaySessionId),
    queryFn: () => listEventSupportAttendance(eventDaySessionId),
    staleTime: 20_000,
  });
  const partyCounts = useMemo(() => {
    const onSite = supportRoll.filter((r) => r.status === "checked_in");
    return {
      participants: attendanceRoll.filter((r) => r.status === "checked_in").length,
      carers: onSite.filter((r) => r.personKind === "carer").length,
      volunteers: onSite.filter((r) => r.personKind === "volunteer").length,
      staff: onSite.filter((r) => r.personKind === "staff").length,
    };
  }, [attendanceRoll, supportRoll]);

  const { data: groupStatus } = useQuery({
    queryKey: eventDeliverStatusKey(eventDaySessionId),
    queryFn: () =>
      fetchEventDeliverGroupStatus({
        eventId,
        sessionId: eventDaySessionId,
        sessionDate,
      }),
    staleTime: 10_000,
  });
  const morningRollBlocksProgramme = groupStatus?.morningRollBlocksProgramme ?? false;

  // Only today's stops, in order
  const todayStops = useMemo(
    () => allStops.filter((s) => s.session_date === sessionDate).sort((a, b) => a.stop_order - b.stop_order),
    [allStops, sessionDate],
  );

  const overnightWake = useMemo(
    () => resolveOvernightWakeBase(allStops, sessionDate, todayStops),
    [allStops, sessionDate, todayStops],
  );
  const hotelOmitted = overnightWake.hotelOmitted;
  const wakeOriginStop = overnightWake.priorLastStop;
  const programmeHops = useMemo(
    () => buildProgrammeHops(todayStops, overnightWake),
    [todayStops, overnightWake],
  );

  const meetingPointName = useMemo(() => {
    const place =
      hotelOmitted && wakeOriginStop
        ? wakeOriginStop
        : (todayStops.find((s) => isVenueTransportStop(s)) ?? todayStops[0] ?? null);
    if (!place) return overnightWake.label || "Meeting point";
    return place.label_override?.trim() || place.venue_name?.trim() || "Meeting point";
  }, [hotelOmitted, wakeOriginStop, todayStops, overnightWake.label]);

  /** Where the group is: the open activity, else the latest one they finished. */
  const hereStop = useMemo(() => {
    const active = todayStops.find((s) => (s.phase ?? "pending") === "active");
    if (active) return active;
    const completed = todayStops
      .filter((s) => (s.phase ?? "pending") === "completed")
      .sort((a, b) => {
        const byClose = (b.closed_at ?? "").localeCompare(a.closed_at ?? "");
        if (byClose !== 0) return byClose;
        return b.stop_order - a.stop_order;
      });
    if (completed[0]) return completed[0];
    if (hotelOmitted && wakeOriginStop) return wakeOriginStop;
    return todayStops.find((stop) => !isPassengerStop(stop)) ?? null;
  }, [todayStops, hotelOmitted, wakeOriginStop]);

  const invalidateStops = () => {
    void qc.invalidateQueries({ queryKey: stopsKey(eventId) });
    void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(eventDaySessionId) });
    void qc.invalidateQueries({
      queryKey: ["event-transport-runs", eventId, sessionDate, eventDaySessionId],
    });
  };

  // BL-077 — ensure Programme always has a Medication round row (Day Centre parity).
  useEffect(() => {
    void ensureEventDayMedicationRound(eventId, sessionDate).then((created) => {
      if (created) void qc.invalidateQueries({ queryKey: stopsKey(eventId) });
    });
  }, [eventId, sessionDate, qc]);

  if (stopsLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (todayStops.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 py-8 text-center text-sm text-muted-foreground">
        <MapPin className="mx-auto mb-2 h-5 w-5 opacity-40" />
        No stops in today's itinerary — add them in Events › Itinerary.
      </div>
    );
  }

  // Sole stop that is also the overnight wake venue — no outbound programme.
  const soleStopIsWakeOnly =
    todayStops.length === 1 &&
    !hotelOmitted &&
    (!overnightWake.priorVenueId ||
      todayStops[0]!.venue_id === overnightWake.priorVenueId);

  if (soleStopIsWakeOnly) {
    return (
      <div className="space-y-3">
        {morningRollBlocksProgramme && (
          <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2.5 text-sm text-foreground">
            Complete <span className="font-semibold">Morning Roll Call</span> before starting
            activities. Use the Morning Roll tab.
          </div>
        )}
        <ProgrammePartyBar meetingPoint={meetingPointName} counts={partyCounts} />
        <StopCard
          key={todayStops[0]!.id}
          stop={todayStops[0]!}
          stopIndex={0}
          isOrigin
          hereStop={hereStop}
          eventId={eventId}
          eventDaySessionId={eventDaySessionId}
          participantMap={participantMap}
          programmeBlocked={morningRollBlocksProgramme}
          forceExpanded={focusStopId === todayStops[0]!.id}
          onChanged={invalidateStops}
          onWalkOpened={(id) => setFocusStopId(id)}
          onLogIssue={openActivityIssue}
        />
        <div className="rounded-lg border border-dashed bg-muted/30 py-6 text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-1.5 h-4 w-4 opacity-40" />
          No destination stops yet — add venues in Events › Itinerary to unlock the activity loop.
        </div>
        <EventDayVerbalAnomalyFlow
          eventId={eventId}
          eventTitle={eventTitle}
          eventDaySessionId={eventDaySessionId}
          sessionDate={sessionDate}
          activityLabel={issueActivityLabel}
          open={issueFlowOpen}
          onOpenChange={(open) => {
            setIssueFlowOpen(open);
            if (!open) setIssueActivityLabel(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {morningRollBlocksProgramme && (
        <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2.5 text-sm text-foreground">
          Complete <span className="font-semibold">Morning Roll Call</span> before starting
          activities or releasing the bus. Use the Morning Roll tab.
        </div>
      )}

      <ProgrammePartyBar meetingPoint={meetingPointName} counts={partyCounts} />

      {/* Hotel omitted from today's itinerary — still the boarding / leave origin */}
      {hotelOmitted && wakeOriginStop && (
        <WakeLeaveCard
          wakeLabel={overnightWake.label}
          fromStop={wakeOriginStop}
          nextStop={
            todayStops.find((s) => isVenueTransportStop(s)) ?? null
          }
          outboundHopIndex={0}
          eventId={eventId}
          eventDaySessionId={eventDaySessionId}
          programmeBlocked={morningRollBlocksProgramme}
          onChanged={invalidateStops}
          onWalkOpened={(id) => setFocusStopId(id)}
        />
      )}

      {todayStops.map((stop, idx) => {
        if (isPassengerStop(stop)) return null;
        const meal = isMealStop(stop);
        const med = isMedicationStop(stop);
        const hopOut = programmeHops.find((h) => h.from.id === stop.id);
        const hopIn = programmeHops.find((h) => h.to.id === stop.id);
        // First bus venue is the origin only when the day does not start at a meeting-point meal.
        const isOrigin =
          !hotelOmitted &&
          !meal &&
          !med &&
          !hopIn &&
          todayStops.findIndex((s) => isVenueTransportStop(s)) === idx;
        const prevStop =
          meal || med ? null : ((hopIn?.from as EventVenueStop | undefined) ?? null);
        const nextStop =
          meal || med ? null : ((hopOut?.to as EventVenueStop | undefined) ?? null);
        const inboundHopIndex = meal || med || !hopIn ? null : hopIn.hopIndex;
        const outboundHopIndex = meal || med || !hopOut ? null : hopOut.hopIndex;

        return (
          <StopCard
            key={stop.id}
            stop={stop}
            stopIndex={idx}
            isOrigin={isOrigin}
            hereStop={hereStop}
            eventId={eventId}
            eventDaySessionId={eventDaySessionId}
            participantMap={participantMap}
            prevStop={prevStop}
            nextStop={nextStop}
            inboundHopIndex={
              inboundHopIndex != null && inboundHopIndex >= 0
                ? inboundHopIndex
                : null
            }
            outboundHopIndex={outboundHopIndex}
            programmeBlocked={morningRollBlocksProgramme}
            forceExpanded={focusStopId === stop.id}
            onChanged={invalidateStops}
            onWalkOpened={(id) => setFocusStopId(id)}
            onLogIssue={openActivityIssue}
          />
        );
      })}

      <EventDayVerbalAnomalyFlow
        eventId={eventId}
        eventTitle={eventTitle}
        eventDaySessionId={eventDaySessionId}
        sessionDate={sessionDate}
        activityLabel={issueActivityLabel}
        open={issueFlowOpen}
        onOpenChange={(open) => {
          setIssueFlowOpen(open);
          if (!open) setIssueActivityLabel(null);
        }}
      />
    </div>
  );
}

// ─── Leave helpers ────────────────────────────────────────────────────────────

function stopDisplayName(s: EventVenueStop, fallback = "Stop"): string {
  return s.label_override ?? s.venue_name ?? fallback;
}

function LeaveMethodButtons({
  nextName,
  fromName,
  disabled,
  onPick,
}: {
  nextName: string;
  fromName?: string | null;
  disabled?: boolean;
  onPick: (method: MovementMethod) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">
        {fromName
          ? `How are you travelling from ${fromName} to ${nextName}?`
          : `How are you travelling to ${nextName}?`}
      </p>
      <p className="text-xs text-muted-foreground">
        Asked every hop — bus, walk, on-site, or other (train / tram / public).
      </p>
      {(
        [
          {
            method: "bus" as const,
            label: "By Bus",
            sub: "Release here → driver boards via Manifest (§11)",
            icon: <Bus className="h-5 w-5" />,
          },
          {
            method: "walk" as const,
            label: "Walking",
            sub: "Opens next stop with individual check-in roll",
            icon: <Footprints className="h-5 w-5" />,
          },
          {
            method: "other" as const,
            label: "Other (train / tram / public…)",
            sub: "Not the trip bus — individual check-in at the next stop",
            icon: <TrainFront className="h-5 w-5" />,
          },
          {
            method: "on_site" as const,
            label: "On-site / Already there",
            sub: "Next activity is at the same place — check-in roll",
            icon: <MapPin className="h-5 w-5" />,
          },
        ] as const
      ).map((opt) => (
        <MobileFieldButton
          key={opt.method}
          title={opt.label}
          subtitle={opt.sub}
          icon={opt.icon}
          onClick={() => onPick(opt.method)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/** Hotel-omitted wake base — the group is here until they open the next activity. */
function WakeLeaveCard({
  wakeLabel,
  nextStop,
  programmeBlocked,
}: {
  wakeLabel: string;
  fromStop: EventVenueStop;
  nextStop: EventVenueStop | null;
  outboundHopIndex: number;
  eventId: string;
  eventDaySessionId: string;
  programmeBlocked: boolean;
  onChanged: () => void;
  onWalkOpened?: (stopId: string) => void;
}) {
  const nextName = nextStop ? stopDisplayName(nextStop, "next stop") : null;
  const declared = !!nextStop?.opened_at;
  const leftAlready =
    !!nextStop && (nextStop.phase ?? "pending") !== "pending";

  if (!nextStop) {
    return (
      <div className="rounded-xl border-2 border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-600 text-[11px] font-bold text-white">
            ★
          </div>
          <div className="min-w-0 flex-1">
            <span className="truncate font-semibold text-sm">{wakeLabel}</span>
            <OvernightChip className="ml-2" />
          </div>
        </div>
      </div>
    );
  }

  const hereLine = programmeBlocked
    ? "Morning roll must be complete before opening the next activity."
    : leftAlready
      ? `Left for ${nextName}`
      : declared
        ? `Ready to leave for ${nextName}. How you travel is on that card.`
        : `You are here. Open ${nextName} when it is safe to move.`;

  return (
    <div className="rounded-xl border-2 border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-600 text-[11px] font-bold text-white">
          {leftAlready ? <CheckCircle2 className="h-4 w-4" /> : "★"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-sm">{wakeLabel}</span>
            <OvernightChip />
          </div>
          <p className="text-[11px] text-muted-foreground">{hereLine}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Stop card ────────────────────────────────────────────────────────────────

interface StopCardProps {
  stop: EventVenueStop;
  stopIndex: number;
  isOrigin: boolean;
  /** Where the group is now. Travel to this card starts from here. */
  hereStop?: EventVenueStop | null;
  eventId: string;
  eventDaySessionId: string;
  participantMap: Map<string, Participant>;
  prevStop?: EventVenueStop | null;
  nextStop?: EventVenueStop | null;
  /** Inbound hop index (Manifest hop that arrives here). */
  inboundHopIndex?: number | null;
  /** Outbound hop index (leave here → next). */
  outboundHopIndex?: number | null;
  programmeBlocked?: boolean;
  forceExpanded?: boolean;
  onChanged: () => void;
  onWalkOpened?: (stopId: string) => void;
  onLogIssue?: (activityLabel: string) => void;
}

function StopCard({
  stop,
  stopIndex,
  isOrigin,
  hereStop = null,
  eventId,
  eventDaySessionId,
  participantMap,
  prevStop = null,
  nextStop = null,
  inboundHopIndex = null,
  outboundHopIndex = null,
  programmeBlocked = false,
  forceExpanded = false,
  onChanged,
  onWalkOpened,
  onLogIssue,
}: StopCardProps) {
  const phase = (stop.phase ?? "pending") as StopPhase;
  const [expanded, setExpanded] = useState(phase === "active");

  const qc = useQueryClient();

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const [mealSheetOpen, setMealSheetOpen] = useState(false);
  const [altMedOpen, setAltMedOpen] = useState(false);

  const meal = isMealStop(stop);
  const med = isMedicationStop(stop);
  const venue = !meal && !med;
  const overnight = venue && isAccommodationVenueType(stop.venue_type);
  const activity = venue && !overnight;

  const presenceQ = useQuery({
    queryKey: ["trip-med-presence", eventDaySessionId],
    queryFn: () => listTripMedicationPresenceIds(eventDaySessionId),
    enabled: med,
    staleTime: 15_000,
  });
  const emptyPresence = useMemo(() => new Set<string>(), []);
  const medRound = useMedicationRound(
    med ? (presenceQ.data ?? null) : emptyPresence,
  );

  const openMut = useMutation({
    mutationFn: (method: Exclude<MovementMethod, "bus">) =>
      openVenueStop(
        {
          id: stop.id,
          eventId,
          sessionDate: stop.session_date,
          venueName: stop.label_override ?? stop.venue_name ?? null,
          movementMethod: method,
        },
        eventDaySessionId,
      ),
    onSuccess: () => {
      toast.success(med ? "Medication round started." : "Activity started.");
      setExpanded(true);
      onChanged();
      qc.invalidateQueries({ queryKey: activityRollKey(stop.id) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openMealMut = useMutation({
    mutationFn: (mealOpen: MealOpenPayload) =>
      openMealVenueStop({
        stopId: stop.id,
        eventId,
        sessionDate: stop.session_date,
        eventDaySessionId,
        mealOpen,
      }),
    onSuccess: () => {
      toast.success("Meal service started.");
      setExpanded(true);
      setMealSheetOpen(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      if (isMealStop(stop)) {
        const outstanding = await countOutstandingMealServes(stop.id);
        if (outstanding > 0) {
          throw new Error(
            `${outstanding} person${outstanding === 1 ? "" : "s"} still expected on the meal roll. Mark Served / Modified / Own order / Declined / N/A before completing.`,
          );
        }
      }
      if (isMedicationStop(stop)) {
        const [schedules, logs, presence] = await Promise.all([
          listAllActiveSchedules(),
          listTodaysComplianceLogs(),
          listTripMedicationPresenceIds(eventDaySessionId),
        ]);
        assertMedicationRoundManaged({
          schedules,
          logs,
          checkedInIds: presence,
        });
      }
      return closeVenueStop({
        id: stop.id,
        eventId,
        venueName: stop.label_override ?? stop.venue_name ?? null,
        sessionDate: stop.session_date,
      });
    },
    onSuccess: () => {
      toast.success(
        med
          ? "Medication round completed."
          : "Activity completed — group assumed done.",
      );
      setExpanded(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopName = stopDisplayName(
    stop,
    meal
      ? (stop.meal_slot ?? "meal").replace(/_/g, " ")
      : med
        ? "Medication round"
        : `Stop ${stopIndex + 1}`,
  );
  const hereName = hereStop ? stopDisplayName(hereStop, "here") : null;
  const isHere = !!hereStop && hereStop.id === stop.id;
  const declaredOpen = !!stop.opened_at;
  const movementRaw = stop.movement_method as MovementMethod | null | undefined;
  const movement = (movementRaw ??
    (meal || med ? "on_site" : "bus")) as MovementMethod;
  const isBus = venue && movement === "bus";
  const hasNext = venue && !!nextStop && outboundHopIndex != null;
  const canLeaveHere =
    venue &&
    hasNext &&
    (isOrigin || phase === "active") &&
    phase !== "completed";

  const { data: transportRuns = [] } = useQuery({
    queryKey: eventTransportRunsKey(
      eventId,
      stop.session_date,
      eventDaySessionId,
    ),
    queryFn: () =>
      listEventTransportRuns({
        eventId,
        sessionId: eventDaySessionId,
        sessionDate: stop.session_date,
      }),
    enabled: phase === "pending" && !isHere,
    staleTime: 10_000,
  });
  const inboundHop = transportRuns.find(
    (r) => r.kind === "venue_hop" && r.toStopId === stop.id,
  );
  const inTransit =
    inboundHop?.status === "active" || inboundHop?.status === "released";
  const arrivedByHop = inboundHop?.status === "completed";
  /** Future activity, still closed. Open declares it safe to head there. */
  const awaitingDeclare =
    phase === "pending" &&
    !isHere &&
    !declaredOpen &&
    !inTransit &&
    !arrivedByHop;
  /** Opened, not yet moving. Ask how to get here from where the group is. */
  const readyToTravel =
    phase === "pending" &&
    !isHere &&
    declaredOpen &&
    !!hereStop &&
    !inTransit &&
    !arrivedByHop;
  const cardTitle =
    readyToTravel && hereName ? `${hereName} → ${stopName}` : stopName;
  const travelPlanned = readyToTravel && !!movementRaw;
  const travelHopIndex =
    inboundHopIndex != null && prevStop?.id === hereStop?.id
      ? inboundHopIndex
      : 1000 + (stop.stop_order ?? stopIndex);

  const declareMut = useMutation({
    mutationFn: () =>
      declareProgrammeStopOpen({
        stopId: stop.id,
        eventId,
        sessionDate: stop.session_date,
        venueName: stop.label_override ?? stop.venue_name ?? stopName,
        eventDaySessionId,
      }),
    onSuccess: () => {
      setExpanded(true);
      toast.success(
        hereName
          ? `Opened ${stopName}. Choose how you are travelling from ${hereName}.`
          : `Opened ${stopName}. Choose how you are travelling.`,
      );
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveMut = useMutation({
    mutationFn: (method: MovementMethod) => {
      if (!hereStop) throw new Error("Where the group is now is not known.");
      return leaveVenueForNext({
        fromStop: {
          id: hereStop.id,
          eventId,
          sessionDate: hereStop.session_date,
          venueName: hereStop.label_override ?? hereStop.venue_name ?? null,
        },
        toStop: {
          id: stop.id,
          eventId,
          sessionDate: stop.session_date,
          venueName: stop.label_override ?? stop.venue_name ?? stopName,
        },
        method,
        eventDaySessionId,
      });
    },
    onSuccess: (result) => {
      setExpanded(true);
      const how =
        result.method === "bus"
          ? "Bus"
          : result.method === "walk"
            ? "Walk"
            : result.method === "other"
              ? "Other"
              : "On-site";
      toast.success(`${how} to ${stopName} — confirm when ready.`);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: outstandingActivity = 0 } = useQuery({
    queryKey: [...activityRollKey(stop.id), "outstanding-expected"],
    queryFn: () => countOutstandingActivityExpected(stop.id),
    enabled: venue && phase === "active" && !isOrigin,
    staleTime: 5_000,
  });
  const activityCheckInBlocksLeave =
    venue && phase === "active" && !isOrigin && outstandingActivity > 0;

  const flashRed = med && phase === "active" && medRound.urgency === "red";
  const flashAmber = med && phase === "active" && medRound.urgency === "amber";

  const phaseConfig = PHASE_CONFIG[phase];
  const stopWithOps = stop as EventVenueStop & {
    phase?: string | null;
    movement_method?: string | null;
    opened_at?: string | null;
    closed_at?: string | null;
  };

  const statusBusy =
    openMut.isPending ||
    openMealMut.isPending ||
    closeMut.isPending ||
    leaveMut.isPending ||
    declareMut.isPending;

  useEffect(() => {
    if (phase === "active" || readyToTravel) setExpanded(true);
  }, [phase, readyToTravel]);

  const startArrivedActivity = () => {
    if (programmeBlocked) {
      toast.error("Morning roll must be complete first.");
      return;
    }
    if (meal) {
      setMealSheetOpen(true);
      return;
    }
    const method: MovementMethod =
      movementRaw === "walk" ||
      movementRaw === "other" ||
      movementRaw === "on_site"
        ? movementRaw
        : "on_site";
    openMut.mutate(method);
  };

  const handleStatusAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (phase === "completed") {
      setExpanded((p) => !p);
      return;
    }
    if (awaitingDeclare) {
      if (programmeBlocked) {
        toast.error("Morning roll must be complete first.");
        return;
      }
      declareMut.mutate();
      return;
    }
    if (readyToTravel) {
      setExpanded(true);
      return;
    }
    if (phase === "pending" && (arrivedByHop || isHere) && (meal || med || venue)) {
      startArrivedActivity();
      return;
    }
    if (phase === "pending") {
      if (inTransit) {
        toast.message("This opens when the group arrives.");
        return;
      }
      toast.message("Open this activity when you are ready to go there.");
      return;
    }
    if (meal && phase === "active" && !stop.meal_source) {
      setMealSheetOpen(true);
      return;
    }
    if (
      phase === "active" &&
      med &&
      (!medRound.canCompleteRound || medRound.isLoading)
    ) {
      return;
    }
    if (phase === "active") {
      if (activityCheckInBlocksLeave) {
        toast.error(
          `${outstandingActivity} still outstanding — check in (or Not at activity) before completing.`,
        );
        setExpanded(true);
        return;
      }
      closeMut.mutate();
    }
  };

  const ctaLabel = (() => {
    if (phase === "completed") return "Done";
    if (phase === "pending") return "Open";
    if (meal && !stop.meal_source) return "Set up meal";
    return "Complete";
  })();

  const hideSideButton =
    readyToTravel || (isHere && phase === "pending" && venue);

  const ctaDisabled =
    statusBusy ||
    (phase === "pending" && !awaitingDeclare && !arrivedByHop && !isHere) ||
    (phase === "pending" && programmeBlocked) ||
    activityCheckInBlocksLeave ||
    (phase === "active" &&
      med &&
      (!medRound.canCompleteRound || medRound.isLoading));

  return (
    <div
      className={cn(
        "rounded-xl border-2 transition-colors",
        phase === "active" && !flashRed && !flashAmber
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-card",
        flashAmber &&
          "animate-pulse border-amber-500 bg-amber-500/15 dark:border-amber-400",
        flashRed && "animate-pulse border-red-600 bg-red-600/15",
        phase === "completed" && !expanded && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-3"
          onClick={() => setExpanded((p) => !p)}
          role="button"
          aria-expanded={expanded}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
              phase === "completed"
                ? "bg-emerald-600 text-white"
                : phase === "active" || declaredOpen || (isHere && phase === "pending")
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {phase === "completed" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              stopIndex + 1
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-sm">{cardTitle}</span>
              {readyToTravel ? (
                <Badge className="bg-primary text-[10px] text-primary-foreground">
                  Open
                </Badge>
              ) : isHere && phase === "pending" ? (
                <Badge className="bg-slate-600 text-[10px] text-white">
                  You are here
                </Badge>
              ) : (
                <Badge
                  className={cn("text-[10px] font-bold", phaseConfig.badgeClass)}
                >
                  {phaseConfig.label}
                </Badge>
              )}
              {meal && (
                <Badge className="gap-0.5 bg-amber-600 text-[10px] text-white">
                  <UtensilsCrossed className="h-3 w-3" />
                  Meal
                </Badge>
              )}
              {med && (
                <Badge className="gap-0.5 bg-violet-600 text-[10px] text-white">
                  <Pill className="h-3 w-3" />
                  Meds
                </Badge>
              )}
              {isOrigin && <MeetingPointChip />}
              {overnight && <OvernightChip />}
              {activity && <ActivityChip />}
              {flashRed && (
                <Badge className="bg-red-600 text-[10px] uppercase text-white">
                  Overdue
                </Badge>
              )}
              {flashAmber && (
                <Badge className="bg-amber-500 text-[10px] uppercase text-white">
                  Due soon
                </Badge>
              )}
              {venue &&
                (phase === "active" || phase === "completed") &&
                movementRaw && <MethodBadge method={movement} />}
            </div>
            {readyToTravel ? (
              <p className="text-[11px] text-muted-foreground">
                {travelPlanned
                  ? `Ready to leave for ${stopName}`
                  : "How are you travelling?"}
              </p>
            ) : awaitingDeclare ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-200">
                Waiting to be opened
              </p>
            ) : inTransit ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-200">
                {inboundHop?.status === "active"
                  ? "In transit — opens when you arrive"
                  : "Released to the bus — opens when you arrive"}
              </p>
            ) : arrivedByHop && phase === "pending" ? (
              <p className="text-[11px] text-muted-foreground">
                Arrived — open to run this activity
              </p>
            ) : (
              stopVenueTypeName(stop) &&
              venue && (
                <p className="text-[11px] text-muted-foreground">{stopVenueTypeName(stop)}</p>
              )
            )}
            {declaredOpen && phase === "pending" && stop.opened_at && (
              <p className="text-[11px] text-muted-foreground">
                Opened {formatTime(stop.opened_at)}
              </p>
            )}
            {meal && stop.menu_notes && (
              <p className="line-clamp-2 text-[11px] text-muted-foreground">
                {stop.menu_notes}
              </p>
            )}
            {med && phase === "active" && (
              <p className="text-[11px] text-muted-foreground">
                {medRound.isLoading
                  ? "Loading medication requirements…"
                  : medRound.outstandingCount > 0
                    ? `${medRound.outstandingCount} dose${
                        medRound.outstandingCount === 1 ? "" : "s"
                      } still to manage before Complete`
                    : "All timed doses managed — ready to complete"}
              </p>
            )}
            {phase === "completed" &&
              (stopWithOps.opened_at || stopWithOps.closed_at) && (
              <p className="text-[11px] text-muted-foreground">
                {stopWithOps.opened_at && (
                  <>Opened {formatTime(stopWithOps.opened_at)}</>
                )}
                {stopWithOps.opened_at && stopWithOps.closed_at && " · "}
                {stopWithOps.closed_at && (
                  <>Completed {formatTime(stopWithOps.closed_at)}</>
                )}
                {!expanded ? " · tap row to review" : ""}
              </p>
            )}
            {phase === "active" && stopWithOps.opened_at && (
              <p className="text-[11px] text-muted-foreground">
                Opened {formatTime(stopWithOps.opened_at)}
              </p>
            )}
            {isHere && phase === "pending" && (
              <p className="text-[11px] text-muted-foreground">
                Open the next activity when it is safe to move.
              </p>
            )}
          </div>

          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </div>

        {!hideSideButton && (
        <Button
          type="button"
          size="sm"
          variant={
            phase === "pending"
              ? "default"
              : phase === "active"
                ? "secondary"
                : "outline"
          }
          className="h-11 min-h-11 shrink-0 gap-1 max-w-[10.5rem] whitespace-normal text-left leading-tight"
          disabled={ctaDisabled}
          title={
            inTransit
              ? "Opens when the group arrives"
              : awaitingDeclare
                ? "Declare this activity safe to head to"
                : phase === "active" && med && !medRound.canCompleteRound
                  ? "Administer or resolve every outstanding timed dose first"
                  : undefined
          }
          onClick={handleStatusAction}
        >
          {statusBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : phase === "pending" ? (
            <>
              <Play className="h-3.5 w-3.5 shrink-0" />
              Open
            </>
          ) : phase === "completed" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Done
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {ctaLabel}
            </>
          )}
        </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t px-4 pb-4 pt-3">
          {phase === "pending" && programmeBlocked && (
            <p className="text-xs text-muted-foreground">
              Morning roll must be complete before programme continues.
            </p>
          )}

          {awaitingDeclare && !programmeBlocked && (
            <p className="text-xs text-muted-foreground">
              Open when you are ready to go here. How you travel stays hidden until
              then.
            </p>
          )}
          {inTransit && !programmeBlocked && (
            <p className="text-xs text-muted-foreground">
              On the way. This activity opens when you arrive
              {inboundHop ? " (bus hop via Manifest)." : "."}
            </p>
          )}
          {isHere && phase === "pending" && !programmeBlocked && (
            <p className="text-xs text-muted-foreground">
              You are here. Open the next activity when it is safe to move.
            </p>
          )}

          {/* Top → bottom: Log issue → check-in / activity → leave for next */}
          {phase !== "completed" &&
            onLogIssue &&
            (phase === "active" || readyToTravel) && (
              <FieldActionButton
                variant="caution"
                size="sm"
                className="w-full gap-2"
                onClick={() => onLogIssue(stopName)}
              >
                <AlertTriangle className="h-4 w-4" />
                Log issue — {stopName}
              </FieldActionButton>
            )}

          {phase === "active" && (
            <>
              {med ? (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-11"
                      onClick={() => setAltMedOpen(true)}
                    >
                      Alternate med plan…
                    </Button>
                  </div>
                  <TodaysMedicationCard
                    embedded
                    presenceIds={presenceQ.data ?? null}
                    presenceLabel="on trip"
                    allowSoleCarer
                    source="trip_programme_med_round"
                    eventId={eventId}
                    eventDaySessionId={eventDaySessionId}
                  />
                </div>
              ) : meal ? (
                stop.meal_source ? (
                  <MealServiceRoll
                    venueStopId={stop.id}
                    eventId={eventId}
                    eventDaySessionId={eventDaySessionId}
                    editable
                  />
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      You are here. Set up the meal before serving.
                    </p>
                    <Button
                      type="button"
                      className="h-11 w-full"
                      onClick={() => setMealSheetOpen(true)}
                    >
                      Set up meal
                    </Button>
                  </div>
                )
              ) : !isBus && !canLeaveHere ? (
                <ActivityRollPanel
                  venueStopId={stop.id}
                  eventId={eventId}
                  eventDaySessionId={eventDaySessionId}
                  participantMap={participantMap}
                />
              ) : !canLeaveHere && isBus ? (
                <p className="text-xs text-muted-foreground">
                  Group arrived — activity open. Final stop: Complete when done.
                </p>
              ) : !isBus && canLeaveHere ? (
                <ActivityRollPanel
                  venueStopId={stop.id}
                  eventId={eventId}
                  eventDaySessionId={eventDaySessionId}
                  participantMap={participantMap}
                />
              ) : null}
            </>
          )}

          {phase === "active" && venue && activityCheckInBlocksLeave && (
            <p className="text-xs text-amber-700 dark:text-amber-200">
              Check everyone in (or Not at activity) before completing —
              {outstandingActivity} outstanding.
            </p>
          )}

          {readyToTravel && !programmeBlocked && hereStop && (
            <>
              {travelPlanned && movementRaw ? (
                <LeaveMovementConfirmPanel
                  eventId={eventId}
                  sessionId={eventDaySessionId}
                  sessionDate={stop.session_date}
                  hopIndex={travelHopIndex}
                  fromStopId={hereStop.id}
                  toStopId={stop.id}
                  fromLabel={hereName ?? "Here"}
                  toLabel={stopName}
                  method={movementRaw}
                  fromVenueName={hereStop.label_override ?? hereStop.venue_name ?? null}
                  toVenueName={stop.label_override ?? stop.venue_name ?? null}
                  onChanged={onChanged}
                  onNonBusConfirmed={(id) => onWalkOpened?.(id)}
                />
              ) : (
                <LeaveMethodButtons
                  fromName={hereName}
                  nextName={stopName}
                  disabled={leaveMut.isPending}
                  onPick={(m) => leaveMut.mutate(m)}
                />
              )}
            </>
          )}

          {phase === "completed" && meal && (
            <MealServiceSummary
              kind="trip"
              venueStopId={stop.id}
              title={stopName}
              mealSource={(stop.meal_source as MealSource | null) ?? null}
              menuNotes={stop.menu_notes ?? null}
              preparedByStaffId={stop.prepared_by_staff_id ?? null}
              preparerCertStatus={
                (stop.preparer_cert_status as PreparerCertStatus | null) ?? null
              }
              preparerAckNote={stop.preparer_ack_note ?? null}
              prepChecksCompleted={
                Array.isArray(stop.prep_checks_completed)
                  ? stop.prep_checks_completed.filter(
                      (v): v is string => typeof v === "string",
                    )
                  : []
              }
              prepAttestationMode={
                (stop.prep_attestation_mode as
                  | "preparer_pin"
                  | "manager_guest_override"
                  | null) ?? null
              }
              prepAttestedByStaffId={stop.prep_attested_by_staff_id ?? null}
              guestPreparerName={stop.guest_preparer_name ?? null}
              prepAttestationNote={stop.prep_attestation_note ?? null}
              openedAt={stopWithOps.opened_at ?? null}
              closedAt={stopWithOps.closed_at ?? null}
            />
          )}

          {phase === "completed" && !meal && (
            <CompletedActivityDetail
              stop={stopWithOps}
              stopName={stopName}
              movement={movement}
              isBus={isBus}
              prevStop={prevStop}
              nextStop={nextStop}
              eventId={eventId}
              eventDaySessionId={eventDaySessionId}
              participantMap={participantMap}
              onChanged={onChanged}
            />
          )}
        </div>
      )}

      {meal && (
        <OpenMealSheet
          open={mealSheetOpen}
          onOpenChange={setMealSheetOpen}
          title={stopName}
          initialSource={stop.meal_source ?? null}
          initialMenuNotes={stop.menu_notes ?? null}
          pending={openMealMut.isPending}
          onConfirm={(payload) => openMealMut.mutate(payload)}
        />
      )}

      {med && (
        <AlternateMedPlanSheet
          open={altMedOpen}
          onOpenChange={setAltMedOpen}
          eventId={eventId}
          eventDaySessionId={eventDaySessionId}
          participantMap={participantMap}
        />
      )}
    </div>
  );
}

// ─── Completed activity (read-only) — BL-091 ───────────────────────────────────

function CompletedActivityDetail({
  stop,
  stopName,
  movement,
  isBus,
  prevStop,
  nextStop,
  eventId,
  eventDaySessionId,
  participantMap,
  onChanged,
}: {
  stop: EventVenueStop & {
    opened_at?: string | null;
    closed_at?: string | null;
  };
  stopName: string;
  movement: MovementMethod;
  isBus: boolean;
  prevStop: EventVenueStop | null;
  nextStop: EventVenueStop | null;
  eventId: string;
  eventDaySessionId: string;
  participantMap: Map<string, Participant>;
  onChanged: () => void;
}) {
  const openedAt = stop.opened_at ?? null;
  const closedAt = stop.closed_at ?? null;
  const qc = useQueryClient();

  const { data: roll = [], isLoading: rollLoading } = useQuery({
    queryKey: activityRollKey(stop.id),
    queryFn: () =>
      listActivityRoll(stop.id, { eventDaySessionId }),
    staleTime: 60_000,
    enabled: !isBus,
  });

  const resumeMut = useMutation({
    mutationFn: () =>
      reopenVenueActivityCheckIn({
        stopId: stop.id,
        eventId,
        sessionDate: stop.session_date,
        nextStopId: nextStop?.id ?? null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: activityRollKey(stop.id) });
      if (nextStop) {
        void qc.invalidateQueries({ queryKey: activityRollKey(nextStop.id) });
      }
      toast.success(`Resumed check-in at ${stopName}.`);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: floorAbsentNotes = {} } = useQuery({
    queryKey: ["event-attendance-absent-notes", eventDaySessionId],
    queryFn: () => listFloorAbsentNotes(eventDaySessionId),
    staleTime: 30_000,
    enabled: !isBus,
  });

  const { data: dayIssues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ["event-day-issues", eventDaySessionId],
    queryFn: () => listEventDayIssues(eventDaySessionId),
    staleTime: 30_000,
  });

  const issuesInWindow = useMemo(() => {
    const openMs = openedAt ? Date.parse(openedAt) : NaN;
    const closeMs = closedAt ? Date.parse(closedAt) : NaN;
    if (!Number.isFinite(openMs)) return dayIssues;
    return dayIssues.filter((issue) => {
      const t = Date.parse(issue.occurredAt || issue.createdAt);
      if (!Number.isFinite(t)) return false;
      if (t < openMs) return false;
      if (Number.isFinite(closeMs) && t > closeMs + 5 * 60_000) return false; // +5 min grace after close
      return true;
    });
  }, [dayIssues, openedAt, closedAt]);

  const checkedIn = roll.filter((r) => r.status === "checked_in").length;
  const absent = roll.filter((r) => r.status === "absent").length;
  const expected = roll.filter((r) => r.status === "expected").length;

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Activity summary — read only
      </p>

      <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{stopName}</span>
          <MethodBadge method={movement} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {openedAt ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Opened {formatTime(openedAt)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-200">
              <Clock className="h-3 w-3" />
              Opened time not recorded
            </span>
          )}
          {closedAt ? (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Completed {formatTime(closedAt)}
            </span>
          ) : null}
        </div>
        {isBus && prevStop && (
          <p className="text-xs text-muted-foreground">
            Bus hop from {prevStop.label_override ?? prevStop.venue_name ?? "previous stop"} — boarding
            was managed on Manifest.
          </p>
        )}
        {isBus && !prevStop && (
          <p className="text-xs text-muted-foreground">Bus hop — boarding was managed on Manifest.</p>
        )}
      </div>

      {!isBus && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Activity check-in
            </p>
            {!rollLoading && roll.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {checkedIn} confirmed · {absent} absent
                {expected > 0 ? ` · ${expected} outstanding` : ""}
              </Badge>
            )}
          </div>
          {expected > 0 && (
            <FieldActionButton
              variant="primary"
              size="sm"
              className="w-full"
              disabled={resumeMut.isPending}
              onClick={() => resumeMut.mutate()}
            >
              {resumeMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Resume activity check-in
            </FieldActionButton>
          )}
          {rollLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : roll.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/30 py-3 text-center text-xs text-muted-foreground">
              No activity roll recorded for this stop.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {sortByParticipantSurname(
                roll,
                (r) => r.participantId,
                participantMap,
              ).map((row) => {
                const participant = participantMap.get(row.participantId);
                const name = participant?.fullName ?? row.participantId.slice(0, 8);
                const isIn = row.status === "checked_in";
                const isAbsent = row.status === "absent";
                const floorNotes = floorAbsentNotes[row.participantId];
                const isLeftTrip = Object.prototype.hasOwnProperty.call(
                  floorAbsentNotes,
                  row.participantId,
                );
                const badge = !isAbsent
                  ? isIn
                    ? "Confirmed"
                    : "Not confirmed"
                  : isLeftTrip
                    ? formatLeftTripShortLabel(floorNotes)
                    : formatActivitySkipShortLabel(row.notes);
                const detail = !isAbsent
                  ? null
                  : isLeftTrip
                    ? formatLeftTripDisplay(floorNotes)
                    : formatActivitySkipDisplay(row.notes);
                return (
                  <li
                    key={row.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      isIn && "border-emerald-600/40 bg-emerald-600/10",
                      isAbsent && "border-muted bg-muted/40",
                      !isIn && !isAbsent && "border-border bg-card",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{name}</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          isIn && "bg-emerald-600 text-white",
                          isAbsent && "bg-muted text-muted-foreground",
                        )}
                      >
                        {badge}
                      </Badge>
                    </div>
                    {detail && (
                      <p className="mt-1 text-[11px] italic text-muted-foreground">
                        {detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Issues during this activity
        </p>
        <p className="text-[11px] text-muted-foreground">
          Trip-day issues logged while this stop was open (plus 5 minutes after
          complete). Use <span className="font-medium">Log issue</span> on the
          Active card to add one during the activity.
        </p>
        {issuesLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : issuesInWindow.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 py-3 text-center text-xs text-muted-foreground">
            No issues logged during this activity.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {issuesInWindow.map((issue) => {
              const chip = RYGE_SEVERITY_CHIPS.find((c) => c.value === issue.severity);
              return (
                <li
                  key={issue.id}
                  className="rounded-lg border px-3 py-2 text-sm space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                        chip?.idleClass ?? "border-border",
                      )}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatTime(issue.occurredAt || issue.createdAt)} · {issue.status}
                    </span>
                  </div>
                  <p className="text-xs whitespace-pre-wrap">{issue.issueDescription}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Activity roll panel (walk / on-site) ─────────────────────────────────────

interface ActivityRollPanelProps {
  venueStopId: string;
  eventId: string;
  eventDaySessionId: string;
  participantMap: Map<string, Participant>;
}

function ActivityRollPanel({
  venueStopId,
  eventId,
  eventDaySessionId,
  participantMap,
}: ActivityRollPanelProps) {
  const qc = useQueryClient();
  const [absentTarget, setAbsentTarget] = useState<{
    row: ActivityRollRow;
    name: string;
  } | null>(null);
  const [reinstateTarget, setReinstateTarget] = useState<{
    row: ActivityRollRow;
    name: string;
  } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: activityRollKey(venueStopId),
    queryFn: () =>
      listActivityRoll(venueStopId, { eventDaySessionId }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: floorAbsentNotes = {} } = useQuery({
    queryKey: ["event-attendance-absent-notes", eventDaySessionId],
    queryFn: () => listFloorAbsentNotes(eventDaySessionId),
    staleTime: 30_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: activityRollKey(venueStopId) });
    qc.invalidateQueries({ queryKey: ["event-attendance-absent-notes", eventDaySessionId] });
    qc.invalidateQueries({ queryKey: ["event-attendance-log", eventDaySessionId] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-accountability-roll" });
    qc.invalidateQueries({ queryKey: eventDeliverStatusKey(eventDaySessionId) });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-issues" });
  };

  const toggleMut = useMutation({
    mutationFn: (row: ActivityRollRow) => toggleActivityCheckIn(row),
    onSuccess: () => qc.invalidateQueries({ queryKey: activityRollKey(venueStopId) }),
    onError: (e: Error) => toast.error(e.message),
  });

  const undoSkipMut = useMutation({
    mutationFn: (row: ActivityRollRow) => clearActivityAbsent(row),
    onSuccess: () => {
      toast.success("Back on activity check-in.");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const programmeAbsentMut = useMutation({
    mutationFn: async ({
      row,
      name,
      result,
    }: {
      row: ActivityRollRow;
      name: string;
      result: ProgrammeAbsentResult;
    }) => {
      if (result.mode === "skip") {
        await markActivitySkip(row, { reason: result.reason, note: result.note });
        return { kind: "skip" as const };
      }
      const floor = await getEventAttendanceRow(eventDaySessionId, row.participantId);
      if (!floor) {
        throw new Error("No floor attendance row — complete Check-In first.");
      }
      if (floor.status === "checked_out") {
        throw new Error("Already handed to return transport — cannot mark left trip.");
      }
      if (floor.status === "absent") {
        throw new Error("Already left the trip — use Reinstate first if correcting.");
      }
      const hub = await markEventAttendanceAbsent({
        row: floor,
        disposition: result.disposition,
        safetyPlan: result.safetyPlan,
        severity: result.severity,
        eventId,
        participantName: name,
      });
      return { kind: "left_trip" as const, hubIssueCreated: hub.hubIssueCreated };
    },
    onSuccess: (result) => {
      if (result.kind === "skip") {
        toast.success("Not at this activity — still on the trip.");
      } else if (!result.hubIssueCreated) {
        toast.warning("Left trip recorded — Hub issue could not be created automatically.");
      } else {
        toast.success("Left trip — Hub welfare issue raised.");
      }
      setAbsentTarget(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reinstateMut = useMutation({
    mutationFn: async ({
      row,
      name,
      reason,
    }: {
      row: ActivityRollRow;
      name: string;
      reason: string;
    }) => {
      await reinstateLeftTripEverywhere({
        eventDaySessionId,
        participantId: row.participantId,
        participantName: name,
        reason,
      });
    },
    onSuccess: () => {
      toast.success("Reinstated to the trip — can confirm for activities again.");
      setReinstateTarget(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkedIn = rows.filter((r) => r.status === "checked_in").length;
  const absentCount = rows.filter((r) => r.status === "absent").length;
  const outstanding = rows.filter((r) => r.status === "expected").length;
  const assignable = rows.filter((r) => r.status !== "absent").length;
  const allAccounted = rows.length > 0 && outstanding === 0;
  const busy =
    toggleMut.isPending ||
    undoSkipMut.isPending ||
    programmeAbsentMut.isPending ||
    reinstateMut.isPending;

  /** List may collapse only when everyone is accounted for. */
  const [listExpanded, setListExpanded] = useState(true);
  useEffect(() => {
    if (!allAccounted) {
      setListExpanded(true);
      return;
    }
    setListExpanded(false);
  }, [allAccounted]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 py-4 text-center text-xs text-muted-foreground">
        No participants seeded — ensure the arrival roll is complete first.
      </div>
    );
  }

  // Surname A–Z; absent / confirmed only change style — do not push absent to bottom.
  const ordered = sortByParticipantSurname(
    rows,
    (r) => r.participantId,
    participantMap,
  );

  const statusLabel = allAccounted
    ? `${checkedIn} / ${assignable} confirmed${
        absentCount > 0 ? ` · ${absentCount} not here` : ""
      }`
    : `${outstanding} outstanding · ${checkedIn} / ${assignable}`;

  const showList = !allAccounted || listExpanded;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Activity check-in
        </p>
        <button
          type="button"
          disabled={!allAccounted}
          aria-expanded={showList}
          aria-label={
            allAccounted
              ? listExpanded
                ? "Collapse activity check-in list"
                : "Expand activity check-in list"
              : `${outstanding} people still outstanding on activity check-in`
          }
          title={
            allAccounted
              ? listExpanded
                ? "Collapse list"
                : "Expand list to change check-ins"
              : "Finish check-in before the list can collapse"
          }
          onClick={() => {
            if (!allAccounted) return;
            setListExpanded((v) => !v);
          }}
          className={cn(
            "inline-flex h-11 min-h-11 items-center gap-1.5 rounded-lg border-2 px-2.5 text-xs font-bold touch-manipulation",
            "disabled:cursor-default",
            allAccounted
              ? "border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40"
              : "border-destructive bg-destructive text-destructive-foreground shadow-md ring-2 ring-destructive/40",
          )}
        >
          {statusLabel}
          {allAccounted ? (
            listExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            )
          ) : null}
        </button>
      </div>

      {showList
        ? ordered.map((row) => {
        const participant = participantMap.get(row.participantId);
        const name = participant?.fullName ?? row.participantId.slice(0, 8);
        const isIn = row.status === "checked_in";
        const isAbsent = row.status === "absent";
        const floorNotes = floorAbsentNotes[row.participantId];
        const isLeftTrip = Object.prototype.hasOwnProperty.call(
          floorAbsentNotes,
          row.participantId,
        );
        const isSkip =
          !isLeftTrip &&
          (isActivitySkipNotes(row.notes) || (isAbsent && !isLeftTrip));

        const badge = isLeftTrip
          ? formatLeftTripShortLabel(floorNotes)
          : formatActivitySkipShortLabel(row.notes);
        const detail = isLeftTrip
          ? formatLeftTripDisplay(floorNotes) || "Left trip — not on hotel Safe list"
          : formatActivitySkipDisplay(row.notes) ||
            "Not at this activity — still on the trip";

        if (isAbsent) {
          return (
            <div
              key={row.id}
              className="rounded-xl border-2 border-muted bg-muted/20 px-3 py-2.5 space-y-1.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-sm font-semibold">{name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {badge}
                </Badge>
                {isLeftTrip ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1.5 touch-manipulation"
                    disabled={busy}
                    onClick={() => setReinstateTarget({ row, name })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reinstate
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1.5 touch-manipulation"
                    disabled={busy}
                    onClick={() => undoSkipMut.mutate(row)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Back to activity
                  </Button>
                )}
              </div>
              {detail && (
                <p className="whitespace-pre-wrap text-[11px] italic text-muted-foreground">
                  {detail}
                </p>
              )}
              {isSkip && (
                <p className="text-[10px] text-muted-foreground">
                  Still on the trip — mark Safe on Evening / Morning roll at the hotel.
                </p>
              )}
            </div>
          );
        }

        return (
          <MobileFieldButton
            key={row.id}
            title={name}
            subtitle={isIn ? "Confirmed — tap to undo" : "Tap to confirm"}
            tone="success"
            active={isIn}
            disabled={busy}
            onClick={() => toggleMut.mutate(row)}
            icon={
              busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isIn ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <UserCheck className="h-5 w-5" />
              )
            }
            trailing={
              !isIn ? (
                <button
                  type="button"
                  disabled={busy}
                  title="Absent — still on trip or left trip"
                  aria-label={`Mark ${name} absent`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAbsentTarget({ row, name });
                  }}
                  className="inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg border-2 border-destructive/40 text-destructive transition hover:bg-destructive/10 active:scale-[0.99] disabled:opacity-50"
                >
                  <UserX className="h-5 w-5" />
                </button>
              ) : undefined
            }
          />
        );
      })
        : null}

      <ProgrammeAbsentDialog
        open={absentTarget != null}
        onOpenChange={(o) => {
          if (!o) setAbsentTarget(null);
        }}
        participantName={absentTarget?.name ?? ""}
        pending={programmeAbsentMut.isPending}
        onConfirm={async (result) => {
          if (!absentTarget) return;
          await programmeAbsentMut.mutateAsync({
            row: absentTarget.row,
            name: absentTarget.name,
            result,
          });
        }}
      />

      <TripReinstateDialog
        open={reinstateTarget != null}
        onOpenChange={(o) => {
          if (!o) setReinstateTarget(null);
        }}
        participantName={reinstateTarget?.name ?? ""}
        pending={reinstateMut.isPending}
        onConfirm={async (reason) => {
          if (!reinstateTarget) return;
          await reinstateMut.mutateAsync({
            row: reinstateTarget.row,
            name: reinstateTarget.name,
            reason,
          });
        }}
      />
    </div>
  );
}

// ─── Method badge ─────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: MovementMethod }) {
  if (method === "bus") {
    return (
      <Badge className="bg-blue-600 text-white text-[10px]">
        <Bus className="mr-1 h-3 w-3" />
        Bus
      </Badge>
    );
  }
  if (method === "walk") {
    return (
      <Badge className="bg-teal-600 text-white text-[10px]">
        <Footprints className="mr-1 h-3 w-3" />
        Walk
      </Badge>
    );
  }
  if (method === "other") {
    return (
      <Badge className="bg-violet-600 text-white text-[10px]">
        <TrainFront className="mr-1 h-3 w-3" />
        Other
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-600 text-white text-[10px]">
      <MapPin className="mr-1 h-3 w-3" />
      On-site
    </Badge>
  );
}

// ─── Phase config ─────────────────────────────────────────────────────────────

const PHASE_CONFIG: Record<StopPhase, { label: string; badgeClass: string }> = {
  pending:   { label: "Pending",    badgeClass: "bg-muted text-muted-foreground" },
  active:    { label: "Active",     badgeClass: "bg-primary text-primary-foreground" },
  completed: { label: "Completed",  badgeClass: "bg-emerald-600 text-white" },
};

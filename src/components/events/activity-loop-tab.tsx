/**
 * ActivityLoopTab — Event Deliver Phase B (GUARDRAILS §12.13 / BL-068)
 *
 * Shows today's venue stops in order. For each stop after Stop 0 (origin):
 *   • Trip leader picks movement method (Bus / Walk / On-site)
 *   • Bus: confirms bus departed; §11 Manifest handles individual boarding
 *   • Walk / On-site: individual per-person check-in roll (same UI as arrival roll)
 *   • Close: group assumed done — no per-person close-out
 *
 * Multiple stops can be Active simultaneously (e.g. free time with split groups).
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
  Footprints,
  Loader2,
  MapPin,
  Pill,
  Play,
  RotateCcw,
  UserCheck,
  UserX,
  UtensilsCrossed,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventHopReleasePanel } from "@/components/events/event-hop-release-panel";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  ProgrammeAbsentDialog,
  TripReinstateDialog,
  type ProgrammeAbsentResult,
} from "@/components/events/trip-absent-disposition-dialog";
import { cn, formatTime } from "@/lib/utils";
import {
  isMealStop,
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
  closeVenueStop,
  toggleActivityCheckIn,
  markActivitySkip,
  clearActivityAbsent,
  activityRollKey,
  type ActivityRollRow,
  type MovementMethod,
  type StopPhase,
} from "@/lib/api/event-activity-roll";
import {
  countOutstandingMealServes,
  openMealVenueStop,
} from "@/lib/api/event-meal-service";
import type { MealOpenPayload } from "@/lib/meal-open";
import {
  getEventAttendanceRow,
  listFloorAbsentNotes,
  markEventAttendanceAbsent,
  reinstateLeftTripEverywhere,
} from "@/lib/api/event-attendance";
import {
  formatActivitySkipDisplay,
  formatActivitySkipShortLabel,
  formatLeftTripDisplay,
  formatLeftTripShortLabel,
  isActivitySkipNotes,
} from "@/lib/trip-absent";
import {
  eventDeliverStatusKey,
  fetchEventDeliverGroupStatus,
  resolveOvernightWakeBase,
} from "@/lib/api/event-deliver-status";
import { listEventDayIssues } from "@/lib/api/site-issues";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  eventId: string;
  eventDaySessionId: string;
  sessionDate: string;
}

const stopsKey = (eventId: string) => ["event-venue-stops", eventId] as const;
const participantsKey = () => ["participants"] as const;

// ─── Main component ───────────────────────────────────────────────────────────

export function ActivityLoopTab({ eventId, eventDaySessionId, sessionDate }: Props) {
  const qc = useQueryClient();

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

  const invalidateStops = () => {
    void qc.invalidateQueries({ queryKey: stopsKey(eventId) });
    void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(eventDaySessionId) });
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
        <StopCard
          key={todayStops[0]!.id}
          stop={todayStops[0]!}
          stopIndex={0}
          isOrigin
          eventId={eventId}
          eventDaySessionId={eventDaySessionId}
          participantMap={participantMap}
          programmeBlocked={morningRollBlocksProgramme}
          onChanged={invalidateStops}
        />
        <div className="rounded-lg border border-dashed bg-muted/30 py-6 text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-1.5 h-4 w-4 opacity-40" />
          No destination stops yet — add venues in Events › Itinerary to unlock the activity loop.
        </div>
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

      {/* Hotel omitted from today's itinerary — still the boarding origin */}
      {hotelOmitted && (
        <div className="rounded-xl border-2 border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-600 text-[11px] font-bold text-white">
              ★
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold text-sm">{overnightWake.label}</span>
                <Badge className="bg-slate-600 text-white text-[10px]">Overnight / wake</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leave here for the first activity — boarding origin (not listed as a stop today)
              </p>
            </div>
          </div>
        </div>
      )}

      {todayStops.map((stop, idx) => {
        const meal = isMealStop(stop);
        const med = isMedicationStop(stop);
        // Origin is first venue stop only — meals/meds never start the hop chain.
        const isOrigin =
          !hotelOmitted &&
          !meal &&
          !med &&
          todayStops.findIndex((s) => isVenueTransportStop(s)) === idx;
        let prevStop: EventVenueStop | null = null;
        if (!meal && !med) {
          if (hotelOmitted && idx === 0) {
            prevStop = wakeOriginStop;
          } else {
            for (let i = idx - 1; i >= 0; i--) {
              if (isVenueTransportStop(todayStops[i]!)) {
                prevStop = todayStops[i]!;
                break;
              }
            }
            if (!prevStop && hotelOmitted) prevStop = wakeOriginStop;
          }
        }
        const venueHopIdx = todayStops
          .slice(0, idx + 1)
          .filter((s) => isVenueTransportStop(s)).length - 1;
        const hopIndex =
          meal || med
            ? null
            : hotelOmitted
              ? venueHopIdx
              : venueHopIdx - 1;

        return (
          <StopCard
            key={stop.id}
            stop={stop}
            stopIndex={hotelOmitted ? idx + 1 : idx}
            isOrigin={isOrigin}
            eventId={eventId}
            eventDaySessionId={eventDaySessionId}
            participantMap={participantMap}
            prevStop={prevStop}
            hopIndex={hopIndex != null && hopIndex >= 0 ? hopIndex : null}
            programmeBlocked={morningRollBlocksProgramme}
            onChanged={invalidateStops}
          />
        );
      })}
    </div>
  );
}

// ─── Stop card ────────────────────────────────────────────────────────────────

interface StopCardProps {
  stop: EventVenueStop;
  stopIndex: number;
  isOrigin: boolean;
  eventId: string;
  eventDaySessionId: string;
  participantMap: Map<string, Participant>;
  prevStop?: EventVenueStop | null;
  /** Explicit hop index for Manifest release (required when hotel is omitted). */
  hopIndex?: number | null;
  programmeBlocked?: boolean;
  onChanged: () => void;
}

function StopCard({
  stop,
  stopIndex,
  isOrigin,
  eventId,
  eventDaySessionId,
  participantMap,
  prevStop = null,
  hopIndex = null,
  programmeBlocked = false,
  onChanged,
}: StopCardProps) {
  const phase = (stop.phase ?? "pending") as StopPhase;
  const [methodSheetOpen, setMethodSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(phase === "active");

  const qc = useQueryClient();

  const [mealSheetOpen, setMealSheetOpen] = useState(false);
  const [altMedOpen, setAltMedOpen] = useState(false);

  const meal = isMealStop(stop);
  const med = isMedicationStop(stop);

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
    mutationFn: (method: MovementMethod) =>
      openVenueStop(
        {
          id: stop.id,
          eventId,
          sessionDate: stop.session_date,
          venueName: stop.label_override ?? stop.venue_name,
          movementMethod: method,
        },
        eventDaySessionId,
      ),
    onSuccess: () => {
      toast.success(med ? "Medication round started." : "Activity started.");
      setExpanded(true);
      setMethodSheetOpen(false);
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
        venueName: stop.label_override ?? stop.venue_name,
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

  const stopName =
    stop.label_override ??
    stop.venue_name ??
    (meal
      ? (stop.meal_slot ?? "meal").replace(/_/g, " ")
      : med
        ? "Medication round"
        : `Stop ${stopIndex}`);
  const movement = (stop.movement_method ??
    (meal || med ? "on_site" : "bus")) as MovementMethod;
  const isBus = !meal && !med && movement === "bus";
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
    openMut.isPending || openMealMut.isPending || closeMut.isPending;

  // Day Centre parity: when active, show the roll without hunting in a dropdown.
  useEffect(() => {
    if (phase === "active" && !isOrigin) setExpanded(true);
  }, [phase, isOrigin]);

  const handleStatusAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOrigin) return;
    if (phase === "pending") {
      if (programmeBlocked) {
        toast.error("Morning roll must be complete before this activity can start.");
        return;
      }
      if (meal) setMealSheetOpen(true);
      else if (med) openMut.mutate("on_site");
      else setMethodSheetOpen(true);
      return;
    }
    if (phase === "active") {
      closeMut.mutate();
      return;
    }
    if (phase === "completed") {
      setExpanded((p) => !p);
    }
  };

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
      {/* Header row — Centre-style status button on the right */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-3"
          onClick={() => {
            if (!isOrigin) setExpanded((p) => !p);
          }}
          role="button"
          aria-expanded={expanded}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
              phase === "completed"
                ? "bg-emerald-600 text-white"
                : phase === "active"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {phase === "completed" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              stopIndex
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-sm">{stopName}</span>
              {isOrigin ? (
                <Badge className="bg-slate-600 text-[10px] text-white">
                  Departure base
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
              {!meal &&
                !med &&
                (phase === "active" || phase === "completed") &&
                movement && <MethodBadge method={movement} />}
            </div>
            {stop.venue_type && !meal && !med && (
              <p className="text-[11px] text-muted-foreground">{stop.venue_type}</p>
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
            {phase === "completed" && stopWithOps.closed_at && (
              <p className="text-[11px] text-muted-foreground">
                Completed {formatTime(stopWithOps.closed_at)}
                {!expanded ? " · tap row to review" : ""}
              </p>
            )}
            {phase === "active" && stopWithOps.opened_at && (
              <p className="text-[11px] text-muted-foreground">
                Opened {formatTime(stopWithOps.opened_at)}
              </p>
            )}
            {phase === "pending" && programmeBlocked && !isOrigin && (
              <p className="text-[11px] text-amber-700 dark:text-amber-200">
                Morning roll required before Open
              </p>
            )}
          </div>

          {!isOrigin && (
            expanded ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )
          )}
        </div>

        {!isOrigin && (
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
            className="h-11 min-h-11 shrink-0 gap-1"
            disabled={
              statusBusy ||
              (phase === "pending" && programmeBlocked) ||
              (phase === "active" &&
                med &&
                (!medRound.canCompleteRound || medRound.isLoading))
            }
            title={
              phase === "active" && med && !medRound.canCompleteRound
                ? "Administer or resolve every outstanding timed dose first"
                : undefined
            }
            onClick={handleStatusAction}
          >
            {statusBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : phase === "pending" ? (
              <>
                <Play className="h-3.5 w-3.5" />
                Open
              </>
            ) : phase === "active" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Complete
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Done
              </>
            )}
          </Button>
        )}
      </div>

      {/* Expanded body — rolls / review (status CTAs live on the header) */}
      {expanded && !isOrigin && (
        <div className="space-y-3 border-t px-4 pb-4 pt-3">
          {phase === "pending" && programmeBlocked && (
            <p className="text-xs text-muted-foreground">
              Morning roll must be complete before this activity can start.
            </p>
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
                <MealServiceRoll
                  venueStopId={stop.id}
                  eventId={eventId}
                  eventDaySessionId={eventDaySessionId}
                  editable
                />
              ) : isBus ? (
                prevStop && hopIndex != null ? (
                  <EventHopReleasePanel
                    eventId={eventId}
                    sessionId={eventDaySessionId}
                    sessionDate={stop.session_date}
                    hopIndex={hopIndex}
                    fromStopId={prevStop.id}
                    toStopId={stop.id}
                    label={`${prevStop.label_override ?? prevStop.venue_name ?? "Origin"} → ${stopName}`}
                  />
                ) : (
                  <BusHopPanel />
                )
              ) : (
                <ActivityRollPanel
                  venueStopId={stop.id}
                  eventId={eventId}
                  eventDaySessionId={eventDaySessionId}
                  participantMap={participantMap}
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
              eventDaySessionId={eventDaySessionId}
              participantMap={participantMap}
            />
          )}
        </div>
      )}

      {/* Movement method picker */}
      <BottomSheet
        open={methodSheetOpen}
        onOpenChange={setMethodSheetOpen}
        title="How are people getting there?"
        description={`Movement method for ${stopName}`}
      >
        <div className="space-y-2 pb-2">
          {(
            [
              { method: "bus" as MovementMethod, label: "By Bus", sub: "Driver manages boarding via Manifest (§11)", icon: <Bus className="h-5 w-5" /> },
              { method: "walk" as MovementMethod, label: "Walking", sub: "Individual tap check-in before the walk", icon: <Footprints className="h-5 w-5" /> },
              { method: "on_site" as MovementMethod, label: "On-site / Already there", sub: "All present at this location — individual check-in roll", icon: <MapPin className="h-5 w-5" /> },
            ] as const
          ).map((opt) => (
            <MobileFieldButton
              key={opt.method}
              title={opt.label}
              subtitle={opt.sub}
              icon={opt.icon}
              onClick={() => openMut.mutate(opt.method)}
              disabled={openMut.isPending}
            />
          ))}
        </div>
      </BottomSheet>

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
  eventDaySessionId,
  participantMap,
}: {
  stop: EventVenueStop & {
    opened_at?: string | null;
    closed_at?: string | null;
  };
  stopName: string;
  movement: MovementMethod;
  isBus: boolean;
  prevStop: EventVenueStop | null;
  eventDaySessionId: string;
  participantMap: Map<string, Participant>;
}) {
  const openedAt = stop.opened_at ?? null;
  const closedAt = stop.closed_at ?? null;

  const { data: roll = [], isLoading: rollLoading } = useQuery({
    queryKey: activityRollKey(stop.id),
    queryFn: () =>
      listActivityRoll(stop.id, { eventDaySessionId }),
    staleTime: 60_000,
    enabled: !isBus,
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
      const t = Date.parse(issue.createdAt);
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
          {openedAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Opened {formatTime(openedAt)}
            </span>
          )}
          {closedAt && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Closed {formatTime(closedAt)}
            </span>
          )}
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
              {roll.map((row) => {
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
        {issuesLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : issuesInWindow.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 py-3 text-center text-xs text-muted-foreground">
            No trip-day issues logged while this activity was open.
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
                      {formatTime(issue.createdAt)} · {issue.status}
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

// ─── Bus hop panel ────────────────────────────────────────────────────────────

function BusHopPanel() {
  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-1">
      <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
        <Bus className="h-4 w-4" />
        Bus hop — individual boarding managed by driver via Manifest
      </div>
      <p className="text-xs text-blue-200/70">
        The driver runs the §11 boarding roll for each passenger. Once the bus has departed,
        close this activity to proceed.
      </p>
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
  const assignable = rows.filter((r) => r.status !== "absent").length;
  const busy =
    toggleMut.isPending ||
    undoSkipMut.isPending ||
    programmeAbsentMut.isPending ||
    reinstateMut.isPending;

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

  const ordered = [
    ...rows.filter((r) => r.status !== "absent"),
    ...rows.filter((r) => r.status === "absent"),
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Activity check-in
        </p>
        <Badge variant="outline" className="text-xs">
          {checkedIn} / {assignable} confirmed
          {absentCount > 0 ? ` · ${absentCount} not here` : ""}
        </Badge>
      </div>

      {ordered.map((row) => {
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
      })}

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
  if (method === "bus") return <Badge className="bg-blue-600 text-white text-[10px]"><Bus className="mr-1 h-3 w-3" />Bus</Badge>;
  if (method === "walk") return <Badge className="bg-teal-600 text-white text-[10px]"><Footprints className="mr-1 h-3 w-3" />Walk</Badge>;
  return <Badge className="bg-slate-600 text-white text-[10px]"><MapPin className="mr-1 h-3 w-3" />On-site</Badge>;
}

// ─── Phase config ─────────────────────────────────────────────────────────────

const PHASE_CONFIG: Record<StopPhase, { label: string; badgeClass: string }> = {
  pending:   { label: "Pending",    badgeClass: "bg-muted text-muted-foreground" },
  active:    { label: "Active",     badgeClass: "bg-primary text-primary-foreground" },
  completed: { label: "Completed",  badgeClass: "bg-emerald-600 text-white" },
};

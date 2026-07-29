/**
 * Event Deliver — Active events list + Trip Day execution view
 * Mobile-first field execution for trip leaders (GUARDRAILS §12.13)
 *
 * Tabs per trip day (Phase D — multi-day aware):
 *   [Morning Roll] — non-first days: accountability roll at start of day
 *   Check-In       — individual arrival roll at venue (always)
 *   [Programme]    — activity loop per venue stop (hidden on single-venue events)
 *   Curfew Roll    — non-final days: evening accountability; OR
 *   Check-Out      — final/single day: departure handover + Close Trip (Manager PIN)
 *   Issues         — active trip-day issues (always)
 *
 * BL-068 / BL-089 — Deliver = field floor; Manage = office Setup/Report.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Compass,
  LogOut,
  Loader2,
  Moon,
  ShieldCheck,
  Sunrise,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { EmergencyOpsBanner } from "@/components/ops/emergency-ops-banner";
import {
  clearProgrammeSuspend,
  getProgrammeSuspend,
} from "@/lib/api/operational-emergency";
import { EventLocationPanel } from "@/components/events/event-location-panel";
import { EventArrivalRollPanel } from "@/components/events/event-arrival-roll-panel";
import { EventCheckOutPanel } from "@/components/events/event-checkout-panel";
import { AccountabilityRollPanel } from "@/components/events/accountability-roll-panel";
import { EventIssuesCard } from "@/components/events/event-issues-card";
import { ActivityLoopTab } from "@/components/events/activity-loop-tab";
import { EventDeliverStatusPanel } from "@/components/events/event-deliver-status-panel";
import { EventDeliverRollAlertBanner } from "@/components/events/event-deliver-roll-alert-banner";
import { EventDayVerbalAnomalyFlow } from "@/components/events/event-day-verbal-anomaly-flow";
import { ResetEventDayButton } from "@/components/events/reset-event-day-button";
import { EventCloseDayPanel } from "@/components/events/event-close-day-panel";
import { supabase } from "@/integrations/supabase/client";
import {
  listEventDaySessions,
  type EventDaySession,
} from "@/lib/api/event-outing";
import { countTodayVenueStops } from "@/lib/api/event-activity-roll";
import {
  deriveEventDeliverSuggestedTab,
  eventDeliverStatusKey,
  fetchEventDeliverGroupStatus,
  shouldHideEventDeliverCheckIn,
  type EventDeliverSuggestedTab,
} from "@/lib/api/event-deliver-status";
import { reconcileOvernightAttendanceContinuity } from "@/lib/api/event-day-continuity";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import { listManifestPickerEvents, type EventManifest, type StaffMember } from "@/lib/data-store";
import { useStaffRegistry } from "@/hooks/use-supabase-data";
import { OperationalTodayLabel } from "@/components/dev/operational-today-label";
import {
  getOperationalClockOverride,
  getOperationalNow,
  setOperationalClockOverride,
  useOperationalTodayIso,
} from "@/lib/operational-clock";
import { IS_TEST_BUILD } from "@/lib/test-mode";
import { cn, formatDate, todayLocalIso } from "@/lib/utils";
import { getEventDayPhaseDisplay } from "@/lib/event-day-phase-display";

export const Route = createFileRoute("/event-deliver")({
  validateSearch: (s: Record<string, unknown>) => ({
    eventId: typeof s.eventId === "string" ? s.eventId : undefined,
  }),
  component: EventDeliverPage,
});

// ─── State machine ────────────────────────────────────────────────────────────

type Screen =
  | { kind: "list" }
  | { kind: "session"; event: EventManifest; session: EventDaySession };

/** Keys used by GlobalIncidentIntakeDrawer to harvest event context. */
function setActiveEventContext(event: EventManifest, session: EventDaySession) {
  localStorage.setItem("yada.activeEventId", event.id);
  localStorage.setItem("yada.activeEventTitle", event.title);
  localStorage.setItem("yada.activeEventDaySessionId", session.id);
}

function clearActiveEventContext() {
  localStorage.removeItem("yada.activeEventId");
  localStorage.removeItem("yada.activeEventTitle");
  localStorage.removeItem("yada.activeEventDaySessionId");
}

function EventDeliverPage() {
  const { eventId: launchEventId } = Route.useSearch();
  const [screen, setScreen] = useState<Screen>({ kind: "list" });

  if (screen.kind === "session") {
    return (
      <TripDayView
        key={screen.session.id}
        event={screen.event}
        session={screen.session}
        onBack={() => {
          clearActiveEventContext();
          setScreen({ kind: "list" });
        }}
        onSessionChange={(next) => {
          setActiveEventContext(screen.event, next);
          setScreen({ kind: "session", event: screen.event, session: next });
        }}
      />
    );
  }

  return (
    <EventPicker
      preferEventId={launchEventId}
      onSelect={(event, session) => {
        setActiveEventContext(event, session);
        setScreen({ kind: "session", event, session });
      }}
    />
  );
}

// ─── Screen 1 — Active events list ───────────────────────────────────────────

interface EventPickerProps {
  onSelect: (event: EventManifest, session: EventDaySession) => void;
  /** Deep-link from Event Manage “Run this event”. */
  preferEventId?: string;
}

/** Fetch all event_day_sessions rows for today, with manager name resolved. */
async function listTodaySessions(): Promise<EventDaySession[]> {
  const today = todayLocalIso();

  // Step 1: fetch sessions.
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("*")
    .eq("session_date", today);
  if (error) throw error;

  const rows = (data ?? []) as EventDaySession[];

  // Step 2: resolve manager names from staff_registry.
  const managerIds = [
    ...new Set(rows.map((r) => r.manager_staff_id).filter((id): id is string => !!id)),
  ];
  if (managerIds.length === 0) return rows;

  const { data: staffRows, error: staffErr } = await supabase
    .from("staff_registry")
    .select("id, full_name")
    .in("id", managerIds);

  if (staffErr) {
    console.warn("[listTodaySessions] staff lookup failed:", staffErr.message);
    return rows;
  }

  const nameById = new Map(
    (staffRows ?? []).map((s: { id: string; full_name?: string | null }) => [
      s.id,
      (s.full_name ?? "").trim() || null,
    ]),
  );

  return rows.map((r) => ({
    ...r,
    manager_name: r.manager_staff_id ? (nameById.get(r.manager_staff_id) ?? null) : null,
  }));
}

const todaySessionsKey = () => ["event-deliver-today-sessions"] as const;
const pickerKey = () => ["event-deliver-picker"] as const;

function EventPicker({ onSelect, preferEventId }: EventPickerProps) {
  // Subscribe so SIM TIME after hydrate updates the header (avoids 17 vs 18 mismatch).
  const today = useOperationalTodayIso();
  const autoOpenedRef = useRef(false);

  const { data: picker, isLoading: pickerLoading } = useQuery({
    queryKey: [...pickerKey(), today],
    queryFn: () => listManifestPickerEvents(today),
    staleTime: 30_000,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: [...todaySessionsKey(), today],
    queryFn: listTodaySessions,
    staleTime: 0, // Always refetch — leader assignment may have changed in Events admin.
  });

  // Staff registry for client-side leader name resolution (same source as Trip Days tab).
  const { data: staff = [] } = useStaffRegistry();
  const staffById = new Map<string, StaffMember>(staff.map((s) => [s.id, s]));

  // Show loading only until the picker resolves — sessions finishing after that
  // just hydrates the session map without re-showing the spinner.
  const isLoading = pickerLoading;

  // Build a session map: eventId → today's session
  const sessionByEventId = new Map<string, EventDaySession>(
    sessions.map((s) => [s.event_id, s]),
  );

  // "Running today" = Open events OR any event whose today-session is already active on the field.
  // This handles the case where a Confirmed event's day session was opened by the leader before
  // the office formally set the event to "Open".
  const allEvents = picker?.events ?? [];
  const openEvents = allEvents.filter(
    (e) => e.status === "Open" || sessionByEventId.get(e.id)?.phase === "active",
  );

  // Deep-link: Event Manage → Run this event (?eventId=)
  useEffect(() => {
    if (!preferEventId || autoOpenedRef.current || isLoading) return;
    const event = allEvents.find((e) => e.id === preferEventId);
    const session = sessions.find((s) => s.event_id === preferEventId);
    if (event && session) {
      autoOpenedRef.current = true;
      onSelect(event, session);
      return;
    }
    autoOpenedRef.current = true;
    toast.message("No trip day session for today", {
      description: "Open the event in Event Manage and ensure today’s trip day exists.",
    });
  }, [preferEventId, isLoading, allEvents, sessions, onSelect]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-2 pb-1">
        <Compass className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold tracking-tight">Event Deliver</h1>
          <OperationalTodayLabel
            suffix="field execution interface"
            className="text-xs text-muted-foreground"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : openEvents.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 py-12 text-center">
          <CalendarRange className="mx-auto mb-2 h-6 w-6 opacity-40" />
          <p className="text-sm font-medium text-muted-foreground">
            No events running today
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Events need an "Open" status and a trip day session for today.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Running today
          </p>
          {openEvents.map((event) => {
            const session = sessionByEventId.get(event.id);
            return (
              <EventCard
                key={event.id}
                event={event}
                session={session}
                staffById={staffById}
                onSelect={() => {
                  if (session) onSelect(event, session);
                }}
              />
            );
          })}
        </div>
      )}

      {/* Confirmed events with a today session but not yet promoted to Running today */}
      {!isLoading && (() => {
        const openEventIds = new Set(openEvents.map((e) => e.id));
        const confirmedWithSession = allEvents.filter(
          (e) => e.status === "Confirmed" && sessionByEventId.has(e.id) && !openEventIds.has(e.id),
        );
        if (confirmedWithSession.length === 0) return null;
        return (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Confirmed — session ready, awaiting open
            </p>
            {confirmedWithSession.map((event) => {
              const session = sessionByEventId.get(event.id);
              return (
                <EventCard
                  key={event.id}
                  event={event}
                  session={session}
                  staffById={staffById}
                  onSelect={() => { if (session) onSelect(event, session); }}
                  dim
                />
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Event card in picker ─────────────────────────────────────────────────────

function EventCard({
  event,
  session,
  staffById,
  onSelect,
  dim = false,
}: {
  event: EventManifest;
  session: EventDaySession | undefined;
  staffById: Map<string, StaffMember>;
  onSelect: () => void;
  dim?: boolean;
}) {
  const phase = session?.phase ?? "planning";
  // Resolve leader name client-side from staffById (same source as Trip Days tab).
  const leaderName = session?.manager_staff_id
    ? (staffById.get(session.manager_staff_id)?.fullName ?? session.manager_name ?? null)
    : (session?.manager_name ?? null);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!session}
      className={cn(
        "flex min-h-[4.5rem] w-full touch-manipulation items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition active:scale-[0.99]",
        !session ? "cursor-not-allowed opacity-40" : "hover:bg-muted/40 active:bg-muted/60",
        phase === "active"
          ? "border-emerald-500/60 bg-emerald-500/5"
          : "border-border bg-card",
        dim && "opacity-70",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-sm">{event.title}</span>
          <PhaseBadge phase={phase} eventStatus={event.status} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {event.venue && <span>{event.venue}</span>}
          {leaderName && (
            <span className="flex items-center gap-0.5">
              <ShieldCheck className="h-3 w-3" />
              {leaderName}
            </span>
          )}
          {!leaderName && (
            <span className="flex items-center gap-0.5 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              No trip leader assigned
            </span>
          )}
        </div>
      </div>
      <span className="text-muted-foreground text-xs">▶</span>
    </button>
  );
}

// ─── Screen 2 — Trip Day view ─────────────────────────────────────────────────

type TripDayTab = "morning-roll" | "checkin" | "activities" | "curfew-roll" | "checkout" | "issues";

interface TripDayViewProps {
  event: EventManifest;
  session: EventDaySession;
  onBack: () => void;
  /** Multi-day field scroller — switch trip day without leaving Event Deliver. */
  onSessionChange: (session: EventDaySession) => void;
}

// ─── Day-position helpers ─────────────────────────────────────────────────────

function isMultiDayTrip(sessions: EventDaySession[]): boolean {
  return sessions.length > 1;
}

/** True when today is the very first session date of the trip. */
function isFirstDay(sessions: EventDaySession[], sessionDate: string): boolean {
  if (sessions.length === 0) return true;
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date));
  return sorted[0].session_date === sessionDate;
}

/** True when today is the very last session date of the trip. */
function isFinalDay(sessions: EventDaySession[], sessionDate: string): boolean {
  if (sessions.length === 0) return true;
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date));
  return sorted[sorted.length - 1].session_date === sessionDate;
}

function TripDayView({
  event,
  session: initialSession,
  onBack,
  onSessionChange,
}: TripDayViewProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const isManager = isActiveUserManager();

  // Keep all session data fresh after location open/close
  const { data: sessions = [] } = useQuery({
    queryKey: ["event-day-sessions", event.id],
    queryFn: () => listEventDaySessions(event.id),
    staleTime: 10_000,
  });
  const session = sessions.find((s) => s.id === initialSession.id) ?? initialSession;
  const sortedSessions = [...sessions].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  );
  const dayIndex = sortedSessions.findIndex((s) => s.id === session.id);

  // Day-position flags
  const multiDay = isMultiDayTrip(sessions);
  const firstDay  = isFirstDay(sessions, session.session_date);
  const finalDay  = isFinalDay(sessions, session.session_date);
  const showMorningRoll  = multiDay && !firstDay;  // day 2+: morning accountability
  const showCurfewRoll   = multiDay && !finalDay;  // non-final nights: curfew roll
  const showCheckOut     = !showCurfewRoll;         // final or single day: departure

  // Show Programme when there's at least one venue stop today
  const { data: stopCount = 0 } = useQuery({
    queryKey: ["event-stop-count", event.id, session.session_date],
    queryFn: () => countTodayVenueStops(event.id, session.session_date),
    staleTime: 60_000,
  });
  const hasProgramme = stopCount >= 1;

  const isLocationOpen =
    session.phase === "active" ||
    session.phase === "in_transit" ||
    session.phase === "at_base" ||
    session.phase === "pre_departure";

  const isClosed =
    session.phase === "closed_orderly" || session.phase === "closed_incident";

  const showTabs = isLocationOpen || isClosed;

  const { data: groupStatus } = useQuery({
    queryKey: eventDeliverStatusKey(session.id),
    queryFn: () =>
      fetchEventDeliverGroupStatus({
        eventId: event.id,
        sessionId: session.id,
        sessionDate: session.session_date,
      }),
    enabled: showTabs,
    staleTime: 10_000,
    refetchInterval: showTabs ? 30_000 : false,
  });

  const suggestedTab: EventDeliverSuggestedTab = groupStatus
    ? deriveEventDeliverSuggestedTab(groupStatus, {
        showMorningRoll,
        showEveningRoll: showCurfewRoll,
        showCheckOut,
        hasProgramme,
      })
    : showMorningRoll
      ? "morning-roll"
      : "checkin";

  const hideCheckIn =
    !!groupStatus && shouldHideEventDeliverCheckIn(groupStatus, showMorningRoll);

  const [tab, setTab] = useState<TripDayTab>(suggestedTab);
  const userPickedTabRef = useRef(false);

  // Steer to the journey step until the operator manually switches tabs.
  useEffect(() => {
    userPickedTabRef.current = false;
  }, [session.id]);

  useEffect(() => {
    if (!showTabs || !groupStatus) return;
    if (userPickedTabRef.current) return;
    const next =
      hideCheckIn && suggestedTab === "checkin" ? "morning-roll" : suggestedTab;
    setTab(next);
  }, [showTabs, groupStatus, suggestedTab, hideCheckIn, session.id]);

  // If Check-In is hidden while still selected, leave that tab.
  useEffect(() => {
    if (!hideCheckIn || tab !== "checkin") return;
    setTab(suggestedTab === "checkin" ? "morning-roll" : suggestedTab);
  }, [hideCheckIn, tab, suggestedTab]);

  const selectTab = (next: TripDayTab) => {
    userPickedTabRef.current = true;
    setTab(next);
  };

  const activeTab: TripDayTab =
    hideCheckIn && tab === "checkin"
      ? suggestedTab === "checkin"
        ? "morning-roll"
        : suggestedTab
      : tab;

  const handleChanged = () => {
    void qc.invalidateQueries({ queryKey: ["event-day-sessions", event.id] });
    void qc.invalidateQueries({ queryKey: todaySessionsKey() });
    void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(session.id) });
  };

  // Heal Day 2+ sessions opened before overnight continuity ran on Open location.
  const overnightReconcileRef = useRef(false);
  useEffect(() => {
    overnightReconcileRef.current = false;
  }, [session.id]);

  useEffect(() => {
    if (!showMorningRoll || !isLocationOpen || overnightReconcileRef.current) return;
    overnightReconcileRef.current = true;
    const profile = getActiveUserProfile();
    void reconcileOvernightAttendanceContinuity({
      sessionId: session.id,
      eventId: event.id,
      sessionDate: session.session_date,
      actorStaffId: session.manager_staff_id ?? profile?.staffId ?? null,
    }).then((healed) => {
      if (healed) {
        handleChanged();
        void qc.invalidateQueries({ queryKey: ["event-attendance-log", session.id] });
        void qc.invalidateQueries({
          predicate: (q) => q.queryKey?.[0] === "event-accountability-roll",
        });
        void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(session.id) });
        userPickedTabRef.current = false;
        setTab("morning-roll");
      }
    });
  }, [
    showMorningRoll,
    isLocationOpen,
    session.id,
    session.session_date,
    session.manager_staff_id,
    event.id,
    qc,
  ]);

  const handleTripClosed = () => {
    handleChanged();
    // BL-068 Phase E — office Trip Report after field close
    void navigate({
      to: "/events",
      search: { manage: event.id, tab: "report" },
    });
  };

  const handleOvernightClosed = () => {
    handleChanged();
    userPickedTabRef.current = true;
    setTab("curfew-roll");
  };

  // Day label e.g. "Day 2 of 3"
  const dayNumber = dayIndex >= 0 ? dayIndex + 1 : 1;
  const dayLabel = multiDay ? `Day ${dayNumber} of ${sortedSessions.length}` : null;
  const canPrevDay = multiDay && dayIndex > 0;
  const canNextDay = multiDay && dayIndex >= 0 && dayIndex < sortedSessions.length - 1;

  const goToAdjacentDay = (delta: -1 | 1) => {
    const next = sortedSessions[dayIndex + delta];
    if (!next) return;
    // Test builds: keep SIM clock time, move calendar to the selected trip day
    // so Open location / rolls match the day on screen.
    if (IS_TEST_BUILD) {
      const existing = getOperationalClockOverride();
      let time = existing?.time;
      if (!time) {
        const parts = new Intl.DateTimeFormat("en-AU", {
          timeZone: "Australia/Sydney",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(getOperationalNow());
        const hh = parts.find((p) => p.type === "hour")?.value ?? "07";
        const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
        time = `${hh}:${mm}`;
      }
      setOperationalClockOverride({ date: next.session_date, time });
    }
    onSessionChange(next);
    toast.message(`${formatDate(next.session_date)} · Day ${dayIndex + delta + 1} of ${sortedSessions.length}`, {
      description: IS_TEST_BUILD
        ? "SIM clock date updated to this trip day."
        : "Switched trip day — close prior days before opening a later one.",
    });
  };

  const suspendQ = useQuery({
    queryKey: ["programme-suspend", session.id],
    queryFn: () => getProgrammeSuspend(session.id),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <EmergencyOpsBanner eventDaySessionId={session.id} />
      {suspendQ.data?.active ? (
        <div className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-bold uppercase tracking-wide text-[11px]">
            Programme suspended
          </p>
          <p className="font-semibold">{suspendQ.data.reason}</p>
          <p className="text-xs opacity-80">
            Hop / programme start blocked until a manager clears this.
          </p>
          {isManager ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-9"
              onClick={async () => {
                try {
                  const staffId = getActiveUserProfile()?.staffId ?? "";
                  await clearProgrammeSuspend({
                    eventDaySessionId: session.id,
                    managerStaffId: staffId,
                  });
                  void qc.invalidateQueries({
                    queryKey: ["programme-suspend", session.id],
                  });
                  toast.success("Programme suspend cleared");
                } catch (e) {
                  toast.error("Could not clear suspend", {
                    description: (e as Error).message,
                  });
                }
              }}
            >
              Clear programme suspend
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* Back + header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="mt-0.5 h-8 shrink-0 px-2"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold tracking-tight">{event.title}</h1>
          {/* Trip-day scroller — field nav across multi-day sessions */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {multiDay ? (
              <div className="inline-flex items-center rounded-lg border bg-muted/40">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 touch-manipulation px-0"
                  disabled={!canPrevDay}
                  aria-label="Previous trip day"
                  onClick={() => goToAdjacentDay(-1)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-[7.5rem] px-1 text-center">
                  <div className="text-sm font-semibold tabular-nums text-foreground">
                    {formatDate(session.session_date)}
                  </div>
                  {dayLabel && (
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {dayLabel}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 shrink-0 touch-manipulation px-0"
                  disabled={!canNextDay}
                  aria-label="Next trip day"
                  onClick={() => goToAdjacentDay(1)}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <span className="text-sm font-semibold text-foreground">
                {formatDate(session.session_date)}
              </span>
            )}
            <PhaseBadge phase={session.phase} eventStatus={event.status} />
            {event.status === "Open" && session.phase === "planning" && (
              <Badge variant="outline" className="border-emerald-500/50 text-[10px] text-emerald-600">
                Event open
              </Badge>
            )}
            {session.manager_name && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />
                {session.manager_name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Location status panel — close button hidden; Close Trip lives in Check-Out tab */}
      <EventLocationPanel
        session={session}
        onChanged={handleChanged}
        hideCloseAction
        eventStatus={event.status}
        isFirstDay={firstDay}
        onLogVenueIssue={() => setAnomalyOpen(true)}
      />

      <ResetEventDayButton
        sessionId={session.id}
        eventId={event.id}
        sessionDate={session.session_date}
        onReset={() => {
          userPickedTabRef.current = false;
          handleChanged();
          setTab(showMorningRoll ? "morning-roll" : "checkin");
        }}
      />

      {/* Pre-open issues register — same role as Day Centre walkthrough register */}
      {!isLocationOpen && !isClosed && (
        <EventIssuesCard eventId={event.id} eventDaySessionId={session.id} />
      )}

      {(isLocationOpen || isClosed) && (
        <EventDeliverStatusPanel
          eventId={event.id}
          sessionId={session.id}
          sessionDate={session.session_date}
        />
      )}

      {isLocationOpen && (showMorningRoll || showCurfewRoll) && (
        <EventDeliverRollAlertBanner
          eventId={event.id}
          sessionId={session.id}
          sessionDate={session.session_date}
          showMorningRoll={showMorningRoll}
          showEveningRoll={showCurfewRoll}
          onOpenTab={(t) => selectTab(t)}
        />
      )}

      {/* Venue issue (pre-open Log Venue is on EventLocationPanel). H&S via Big Red §13.2. */}
      <div className="flex flex-col gap-2">
        {isLocationOpen && (
          <FieldActionButton
            variant="caution"
            size="sm"
            onClick={() => setAnomalyOpen(true)}
            className="gap-2"
          >
            <AlertTriangle className="h-4 w-4" />
            Log Venue Issue (trip-day)
          </FieldActionButton>
        )}
      </div>

      {/* ── Tabs ── */}
      {showTabs && (
        <Tabs value={activeTab} onValueChange={(v) => selectTab(v as TripDayTab)}>
          <TabsList className="w-full">
            {/* Morning Roll — day 2+ only */}
            {showMorningRoll && (
              <TabsTrigger value="morning-roll" className="flex-1 gap-1">
                <Sunrise className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Morning Roll</span>
                <span className="sm:hidden">Morn</span>
              </TabsTrigger>
            )}

            {/* Check-In — Day 1 / late arrivals; hidden on Day 2+ once overnight check-in is done */}
            {!hideCheckIn && (
              <TabsTrigger value="checkin" className="flex-1 gap-1">
                <UserCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Check-In</span>
                <span className="sm:hidden">In</span>
              </TabsTrigger>
            )}

            {/* Programme — when venue stops exist */}
            {hasProgramme && (
              <TabsTrigger value="activities" className="flex-1 gap-1">
                <Compass className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Programme</span>
                <span className="sm:hidden">Prog</span>
              </TabsTrigger>
            )}

            {/* Evening Roll — non-final nights */}
            {showCurfewRoll && (
              <TabsTrigger value="curfew-roll" className="flex-1 gap-1">
                <Moon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Evening Roll</span>
                <span className="sm:hidden">Eve</span>
              </TabsTrigger>
            )}

            {/* Check-Out — final or single day */}
            {showCheckOut && (
              <TabsTrigger value="checkout" className="flex-1 gap-1">
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Check-Out</span>
                <span className="sm:hidden">Out</span>
              </TabsTrigger>
            )}

            {/* Issues — always */}
            <TabsTrigger value="issues" className="flex-1 gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Issues</span>
            </TabsTrigger>
          </TabsList>

          {/* Morning Roll content */}
          {showMorningRoll && (
            <TabsContent value="morning-roll" className="mt-3">
              <AccountabilityRollPanel
                event={event}
                sessionId={session.id}
                sessionDate={session.session_date}
                rollTimeClock={session.morning_roll_time ?? null}
                mode="morning"
              />
            </TabsContent>
          )}

          {/* Check-In content — omitted on Day 2+ once overnight arrival is complete */}
          {!hideCheckIn && (
            <TabsContent value="checkin" className="mt-3">
              <EventArrivalRollPanel
                sessionId={session.id}
                eventId={event.id}
                sessionDate={session.session_date}
                editable={isLocationOpen}
                hideDeparture
                isMultiDay={multiDay}
                isFinalDay={finalDay}
                priorSessions={sortedSessions
                  .slice(0, Math.max(0, dayIndex))
                  .map((s) => ({ id: s.id, session_date: s.session_date }))}
              />
            </TabsContent>
          )}

          {/* Programme content */}
          {hasProgramme && (
            <TabsContent value="activities" className="mt-3">
              <ActivityLoopTab
                eventId={event.id}
                eventDaySessionId={session.id}
                sessionDate={session.session_date}
              />
            </TabsContent>
          )}

          {/* Evening Roll + overnight Close day (BL-089) */}
          {showCurfewRoll && (
            <TabsContent value="curfew-roll" className="mt-3 space-y-4">
              <AccountabilityRollPanel
                event={event}
                sessionId={session.id}
                sessionDate={session.session_date}
                rollTimeClock={session.curfew_time ?? null}
                mode="curfew"
              />
              {(isLocationOpen || isClosed) && (
                <EventCloseDayPanel
                  session={session}
                  requireEveningRoll
                  closeLabel="Close day"
                  onClosed={handleOvernightClosed}
                />
              )}
            </TabsContent>
          )}

          {/* Check-Out content */}
          {showCheckOut && (
            <TabsContent value="checkout" className="mt-3">
              <EventCheckOutPanel
                session={session}
                onTripClosed={handleTripClosed}
              />
            </TabsContent>
          )}

          {/* Issues content */}
          <TabsContent value="issues" className="mt-3">
            <EventIssuesCard eventId={event.id} eventDaySessionId={session.id} />
          </TabsContent>
        </Tabs>
      )}

      {/* Location not yet open hint */}
      {!isLocationOpen && !isClosed && session.phase === "planning" && (
        <div className="rounded-lg border border-dashed bg-muted/30 py-6 text-center text-sm text-muted-foreground">
          <UserCheck className="mx-auto mb-2 h-5 w-5 opacity-40" />
          {event.status === "Open" && !firstDay
            ? "Open the location above to start today's floor."
            : "Open the location above to start check-in."}
        </div>
      )}

      {/* Anomaly / RED flow */}
      <EventDayVerbalAnomalyFlow
        eventId={event.id}
        eventTitle={event.title}
        eventDaySessionId={session.id}
        sessionDate={session.session_date}
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
      />
    </div>
  );
}

// ─── Phase badge ──────────────────────────────────────────────────────────────

function PhaseBadge({ phase, eventStatus }: { phase: string; eventStatus?: string | null }) {
  const { label, classes } = getEventDayPhaseDisplay(phase, eventStatus);
  return (
    <Badge className={cn("text-[10px] font-bold uppercase tracking-wide", classes)}>
      {label}
    </Badge>
  );
}

/**
 * TripDaysTab — office Setup only (BL-089): trip leader, roll-call times, issues.
 * Field execution (open/close, rolls, boarding) lives in Event Deliver.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Compass,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { cn, formatDate } from "@/lib/utils";
import { useStaffRegistry } from "@/hooks/use-supabase-data";
import { invalidateEventDayCaches } from "@/lib/query/invalidation";
import {
  listEventDaySessions,
  resetEventDaySessions,
  seedEventDaySessions,
  updateEventDaySession,
  propagateTripLeaderToUnassignedDays,
  propagateTripRollTimesToUnsetDays,
  type EventDaySession,
} from "@/lib/api/event-outing";
import { EventIssuesCard } from "./event-issues-card";
import { EventDayVerbalAnomalyFlow } from "./event-day-verbal-anomaly-flow";
import { isEventLocationClosed, isEventLocationOpen } from "@/lib/api/event-location";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import { isValidClockTime } from "@/lib/tour-roll-call";
import type { EventManifest } from "@/lib/data-store";

interface Props {
  event: EventManifest;
}

const daySessionsKey = (eventId: string) => ["event-day-sessions", eventId] as const;

function fmtDate(iso: string): string {
  return formatDate(iso);
}

const PHASE_LABELS: Record<string, string> = {
  planning: "Not open",
  pre_departure: "Legacy open",
  active: "Open — live",
  in_transit: "In transit",
  at_base: "At base",
  closed_orderly: "Closed",
  closed_incident: "Closed — incident",
};

function phaseBadge(phase: string) {
  if (phase === "active")
    return <Badge className="bg-emerald-600 text-white text-[10px]">{PHASE_LABELS[phase]}</Badge>;
  if (phase === "closed_orderly")
    return <Badge className="bg-zinc-600 text-white text-[10px]">{PHASE_LABELS[phase]}</Badge>;
  if (phase === "closed_incident")
    return <Badge className="bg-destructive text-destructive-foreground text-[10px]">{PHASE_LABELS[phase]}</Badge>;
  if (phase === "in_transit" || phase === "pre_departure")
    return <Badge className="bg-yellow-500 text-black text-[10px]">{PHASE_LABELS[phase] ?? phase}</Badge>;
  return <Badge variant="secondary" className="text-[10px]">{PHASE_LABELS[phase] ?? phase}</Badge>;
}

const isMultiDay = (event: EventManifest) =>
  event.eventKind === "multi_day_tour" ||
  (event.endDate && event.endDate !== event.startDate);

/** Radix Select rejects empty string values — use a sentinel for "unassigned". */
const UNASSIGNED_LEADER = "__unassigned__";

function normalizeRollTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isValidClockTime(trimmed) ? trimmed : null;
}

export function DaySessionsTab({ event: ev }: Props) {
  const qc = useQueryClient();

  const { data: sessions = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: daySessionsKey(ev.id),
    queryFn: () => listEventDaySessions(ev.id),
    staleTime: 30_000,
    retry: 1,
  });

  const { data: staff = [] } = useStaffRegistry();
  const managers = useMemo(
    () => staff.filter((s) => (s.role ?? "").toLowerCase().includes("manager") && s.active),
    [staff],
  );

  const seedMut = useMutation({
    mutationFn: () =>
      seedEventDaySessions(ev.id, ev.startDate, ev.endDate ?? ev.startDate),
    onSuccess: (seeded) => {
      qc.setQueryData(daySessionsKey(ev.id), seeded);
      invalidateEventDayCaches(qc, { eventId: ev.id });
      if (seeded.length > 0) toast.success("Trip days ready.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => {
      // Only delete planning-phase sessions — never ones with floor activity.
      const toDelete = sessions
        .filter((s) => s.phase === "planning")
        .map((s) => s.id);
      return resetEventDaySessions(ev.id, toDelete);
    },
    onSuccess: (seeded) => {
      qc.setQueryData(daySessionsKey(ev.id), seeded);
      invalidateEventDayCaches(qc, { eventId: ev.id });
      toast.success(`Trip days reset — ${seeded.length} day${seeded.length !== 1 ? "s" : ""} from event dates.`);
    },
    onError: (e: Error) => toast.error(`Reset failed: ${e.message}`),
  });

  const [confirmReset, setConfirmReset] = useState(false);

  const autoSeedFor = useRef<string | null>(null);

  // Auto-seed once per event when the tab opens and the list is empty.
  useEffect(() => {
    autoSeedFor.current = null;
  }, [ev.id]);

  useEffect(() => {
    if (isLoading || isError || sessions.length > 0 || seedMut.isPending) return;
    if (autoSeedFor.current === ev.id) return;
    autoSeedFor.current = ev.id;
    seedMut.mutate();
  }, [ev.id, isLoading, isError, sessions.length, seedMut.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const invalidate = () => {
    void refetch();
    invalidateEventDayCaches(qc, { eventId: ev.id });
  };

  if (isError) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-destructive">
          Could not load trip days{(error as Error)?.message ? `: ${(error as Error).message}` : "."}
        </p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          One <strong>trip day</strong> per calendar date. Assign trip leader and roll-call times here.
          Run the day in <strong>Event Deliver</strong> (open, rolls, close). Multi-day tours need evening
          and morning times.
        </p>
        <div className="flex shrink-0 gap-1.5">
          {sessions.length === 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => seedMut.mutate()}
              disabled={seedMut.isPending}
            >
              {seedMut.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Seed trip days
            </Button>
          )}
          {sessions.length > 0 && !confirmReset && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmReset(true)}
              disabled={resetMut.isPending}
              title="Remove stale trip days and reseed from event dates"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reset trip days
            </Button>
          )}
          {confirmReset && (
            <div className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="text-xs text-destructive">
                Remove {sessions.filter(s => s.phase === "planning").length} planning day(s) and reseed from event dates?
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="ml-1 h-6 px-2 text-[11px]"
                disabled={resetMut.isPending}
                onClick={() => { setConfirmReset(false); resetMut.mutate(); }}
              >
                {resetMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, reset"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {sessions.length === 0 ? (
        seedMut.isPending ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/30 py-8 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto mb-2 h-5 w-5 opacity-50" />
            No trip days yet — use Seed trip days or save dates on Details &amp; Config.
          </div>
        )
      ) : (
        <div className="divide-y rounded-lg border">
          {sessions.map((session) => (
            <DaySessionRow
              key={session.id}
              event={ev}
              session={session}
              managers={managers}
              multiDay={!!isMultiDay(ev)}
              onSaved={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single day session row (expandable with inner tabs) ─────────────────────

interface RowProps {
  event: EventManifest;
  session: EventDaySession;
  managers: Array<{ id: string; fullName: string }>;
  multiDay: boolean;
  onSaved: () => void;
}

function DaySessionRow({ event, session, managers, multiDay, onSaved }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);

  // Config state
  const [managerId, setManagerId] = useState(session.manager_staff_id ?? UNASSIGNED_LEADER);
  // PostgreSQL time columns return "HH:mm:ss" — strip seconds so isValidClockTime passes.
  const [curfewTime, setCurfewTime] = useState((session.curfew_time ?? "").slice(0, 5));
  const [morningTime, setMorningTime] = useState((session.morning_roll_time ?? "").slice(0, 5));

  useEffect(() => {
    setManagerId(session.manager_staff_id ?? UNASSIGNED_LEADER);
    setCurfewTime((session.curfew_time ?? "").slice(0, 5));
    setMorningTime((session.morning_roll_time ?? "").slice(0, 5));
  }, [session.id, session.manager_staff_id, session.curfew_time, session.morning_roll_time]);

  const dirty =
    managerId !== (session.manager_staff_id ?? UNASSIGNED_LEADER) ||
    curfewTime !== (session.curfew_time ?? "") ||
    morningTime !== (session.morning_roll_time ?? "");

  const rollTimesValid =
    !multiDay ||
    ((!curfewTime.trim() || isValidClockTime(curfewTime)) &&
      (!morningTime.trim() || isValidClockTime(morningTime)));

  const mut = useMutation({
    mutationFn: async () => {
      const leaderId = managerId === UNASSIGNED_LEADER ? null : managerId;
      const eveningRoll = multiDay ? normalizeRollTime(curfewTime) : null;
      const morningRoll = multiDay ? normalizeRollTime(morningTime) : null;

      if (multiDay && curfewTime.trim() && !eveningRoll) {
        throw new Error("Evening roll call must be a valid 24-hour time (HH:mm).");
      }
      if (multiDay && morningTime.trim() && !morningRoll) {
        throw new Error("Morning roll call must be a valid 24-hour time (HH:mm).");
      }

      const updated = await updateEventDaySession({
        id: session.id,
        manager_staff_id: leaderId,
        curfew_time: eveningRoll,
        morning_roll_time: morningRoll,
      });
      const propagated =
        multiDay && leaderId
          ? await propagateTripLeaderToUnassignedDays(event.id, leaderId, session.id)
          : 0;
      const rollPropagated = multiDay
        ? await propagateTripRollTimesToUnsetDays(event.id, session.id, {
            curfew_time: eveningRoll,
            morning_roll_time: morningRoll,
          })
        : { evening: 0, morning: 0 };
      return { updated, propagated, rollPropagated };
    },
    onSuccess: ({ propagated, rollPropagated }) => {
      const parts: string[] = ["Trip day saved."];
      if (propagated > 0) {
        parts.push(
          `Leader applied to ${propagated} other unassigned day${propagated === 1 ? "" : "s"}.`,
        );
      }
      const rollParts: string[] = [];
      if (rollPropagated.evening > 0) {
        rollParts.push(
          `evening roll to ${rollPropagated.evening} day${rollPropagated.evening === 1 ? "" : "s"}`,
        );
      }
      if (rollPropagated.morning > 0) {
        rollParts.push(
          `morning roll to ${rollPropagated.morning} day${rollPropagated.morning === 1 ? "" : "s"}`,
        );
      }
      if (rollParts.length > 0) {
        parts.push(`Copied ${rollParts.join(" and ")}.`);
      }
      toast.success(parts.join(" "));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaderName = useMemo(() => {
    if (session.manager_name) return session.manager_name;
    const id =
      managerId !== UNASSIGNED_LEADER ? managerId : session.manager_staff_id;
    if (!id) return null;
    return managers.find((m) => m.id === id)?.fullName ?? null;
  }, [session.manager_name, session.manager_staff_id, managerId, managers]);

  const floorLive = isEventLocationOpen(session.phase);
  const floorClosed = isEventLocationClosed(session.phase);

  return (
    <div>
      {/* Collapsed row */}
      <div
        className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/30"
        onClick={() => setExpanded((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((p) => !p);
          }
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">{fmtDate(session.session_date)}</span>
            {phaseBadge(session.phase)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {leaderName ? (
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Leader: {leaderName}
              </span>
            ) : (
              <span className="flex items-center gap-1 font-medium text-yellow-600">
                <UserCog className="h-3 w-3" />
                No trip leader assigned
              </span>
            )}
            {multiDay && session.curfew_time && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Evening {session.curfew_time}
              </span>
            )}
            {multiDay && session.morning_roll_time && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Morning {session.morning_roll_time}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded — office config only (BL-089) */}
      {expanded && (
        <div className="border-t bg-muted/10 px-4 py-4 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">
              Floor status:{" "}
              {floorClosed ? "Closed" : floorLive ? "Open — live in Event Deliver" : "Not open yet"}
            </p>
            <p className="mt-1">
              Open location, rolls, programme, and close day run in{" "}
              <strong>Event Deliver</strong> — not here.
            </p>
            {(event.status === "Open" || event.status === "Confirmed" || floorLive) && (
              <Button asChild size="sm" variant="outline" className="mt-2 gap-1.5">
                <Link to="/event-deliver" search={{ eventId: event.id }}>
                  <Compass className="h-3.5 w-3.5" />
                  Run this event
                </Link>
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Trip leader <span className="text-destructive">*</span>
            </Label>
            <div className="space-y-1.5">
              {[
                { id: UNASSIGNED_LEADER, fullName: "— Unassigned —" },
                ...managers,
              ].map((m) => (
                <MobileFieldButton
                  key={m.id}
                  title={m.fullName}
                  active={managerId === m.id}
                  onClick={() => setManagerId(m.id)}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Required before Confirm or Open. Trip leader opens the day in Event Deliver with their PIN.
              {multiDay && (
                <> Saving a leader or roll times here also fills days still unassigned.</>
              )}
            </p>
          </div>

          {multiDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Evening roll call</Label>
                <HalfHourTimeField
                  id={`evening-roll-${session.id}`}
                  value={curfewTime}
                  onChange={setCurfewTime}
                />
                <p className="text-[10px] text-muted-foreground">
                  Bedtime accountability — YELLOW → RED + SMS if unaccounted (§12.5).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Morning roll call</Label>
                <HalfHourTimeField
                  id={`morning-roll-${session.id}`}
                  value={morningTime}
                  onChange={setMorningTime}
                />
                <p className="text-[10px] text-muted-foreground">
                  Breakfast / morning muster at base hotel.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="border-yellow-500/40 text-yellow-700 hover:bg-yellow-500/10 dark:text-yellow-300"
              onClick={() => setAnomalyOpen(true)}
            >
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              Log Venue Issue
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setExpanded(false)}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={!dirty || !rollTimesValid || mut.isPending}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>

          <EventIssuesCard eventId={event.id} eventDaySessionId={session.id} />

          <EventDayVerbalAnomalyFlow
            eventId={event.id}
            eventTitle={event.title}
            eventDaySessionId={session.id}
            sessionDate={session.session_date}
            open={anomalyOpen}
            onOpenChange={setAnomalyOpen}
          />
        </div>
      )}
    </div>
  );
}


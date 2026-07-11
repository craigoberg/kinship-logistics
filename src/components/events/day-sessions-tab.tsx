/**
 * TripDaysTab — event_day_sessions: trip leader, open/close location, arrival roll,
 * bus boarding, curfew/morning. (§12.4 / §12.5 GUARDRAILS)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bus, CheckCircle2, Clock, Loader2, Moon, Plus, RefreshCw, ShieldCheck, Sunrise, UserCheck, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useStaffRegistry } from "@/hooks/use-supabase-data";
import { invalidateEventDayCaches } from "@/lib/query/invalidation";
import {
  listEventDaySessions,
  listEventVenueStops,
  resetEventDaySessions,
  seedEventDaySessions,
  updateEventDaySession,
  type EventDaySession,
} from "@/lib/api/event-outing";
import { BusCheckOnPanel } from "./bus-check-on-panel";
import { AccountabilityRollPanel } from "./accountability-roll-panel";
import { EventIssuesCard } from "./event-issues-card";
import { EventLocationPanel } from "./event-location-panel";
import { EventArrivalRollPanel } from "./event-arrival-roll-panel";
import { EventDayVerbalAnomalyFlow } from "./event-day-verbal-anomaly-flow";
import { isEventLocationOpen } from "@/lib/api/event-location";
import type { EventManifest } from "@/lib/data-store";

interface Props {
  event: EventManifest;
}

const daySessionsKey = (eventId: string) => ["event-day-sessions", eventId] as const;

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
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
          One <strong>trip day</strong> per calendar date between start and end. Assign a trip leader,
          then open the location when the event floor starts. Multi-day tours also need curfew and
          morning times.
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
          <p className="py-8 text-center text-sm text-muted-foreground">
            No trip days yet — use Seed trip days or save dates on Details &amp; Config.
          </p>
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

type InnerTab = "config" | "arrival" | "bus" | "curfew" | "morning";

interface RowProps {
  event: EventManifest;
  session: EventDaySession;
  managers: Array<{ id: string; fullName: string }>;
  multiDay: boolean;
  onSaved: () => void;
}

function DaySessionRow({ event, session, managers, multiDay, onSaved }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [innerTab, setInnerTab] = useState<InnerTab>("config");
  const [anomalyOpen, setAnomalyOpen] = useState(false);

  // Config state
  const [managerId, setManagerId] = useState(session.manager_staff_id ?? UNASSIGNED_LEADER);
  const [curfewTime, setCurfewTime] = useState(session.curfew_time ?? "");
  const [morningTime, setMorningTime] = useState(session.morning_roll_time ?? "");

  useEffect(() => {
    setManagerId(session.manager_staff_id ?? UNASSIGNED_LEADER);
    setCurfewTime(session.curfew_time ?? "");
    setMorningTime(session.morning_roll_time ?? "");
  }, [session.id, session.manager_staff_id, session.curfew_time, session.morning_roll_time]);

  const dirty =
    managerId !== (session.manager_staff_id ?? UNASSIGNED_LEADER) ||
    curfewTime !== (session.curfew_time ?? "") ||
    morningTime !== (session.morning_roll_time ?? "");

  // Day stops (needed by BusCheckOnPanel).
  const { data: allStops = [] } = useQuery({
    queryKey: ["event-venue-stops", event.id],
    queryFn: () => listEventVenueStops(event.id),
    enabled: expanded && innerTab === "bus",
    staleTime: 60_000,
  });
  const dayStops = allStops.filter((s) => s.session_date === session.session_date);

  const mut = useMutation({
    mutationFn: () =>
      updateEventDaySession({
        id: session.id,
        manager_staff_id: managerId === UNASSIGNED_LEADER ? null : managerId,
        curfew_time: multiDay ? curfewTime || null : null,
        morning_roll_time: multiDay ? morningTime || null : null,
      }),
    onSuccess: () => { toast.success("Trip day saved."); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const locationLive = isEventLocationOpen(session.phase);

  const leaderName = useMemo(() => {
    if (session.manager_name) return session.manager_name;
    const id =
      managerId !== UNASSIGNED_LEADER ? managerId : session.manager_staff_id;
    if (!id) return null;
    return managers.find((m) => m.id === id)?.fullName ?? null;
  }, [session.manager_name, session.manager_staff_id, managerId, managers]);

  const innerTabs: Array<{ key: InnerTab; label: string; icon: React.ReactNode }> = [
    { key: "config", label: "Config", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { key: "arrival", label: "Arrival roll", icon: <UserCheck className="h-3.5 w-3.5" /> },
    { key: "bus", label: "Bus boarding", icon: <Bus className="h-3.5 w-3.5" /> },
    ...(multiDay ? [
      { key: "curfew" as InnerTab, label: "Curfew Roll", icon: <Moon className="h-3.5 w-3.5" /> },
      { key: "morning" as InnerTab, label: "Morning Roll", icon: <Sunrise className="h-3.5 w-3.5" /> },
    ] : []),
  ];

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
                Curfew {session.curfew_time}
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

      {/* Expanded inner tabs */}
      {expanded && (
        <div className="border-t bg-muted/10">
          {/* Inner tab bar — same active treatment as manage-event modal tabs */}
          <div className="overflow-x-auto border-b border-border bg-background/60 px-3 pt-2">
            <div className="flex min-w-max items-center gap-2">
              {innerTabs.map((t) => {
                const active = innerTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setInnerTab(t.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-semibold transition-colors",
                      active
                        ? "bg-tab-active text-tab-active-foreground"
                        : "bg-transparent text-muted-foreground hover:text-foreground",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-4 py-4">
            {innerTab === "config" && (
              <>
              <div className="space-y-4">
                <EventLocationPanel session={session} onChanged={onSaved} />

                <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    Trip leader <span className="text-destructive">*</span>
                  </Label>
                  <Select value={managerId} onValueChange={setManagerId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Assign trip leader…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_LEADER}>— Unassigned —</SelectItem>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Required before Confirm or Open. The trip leader opens the location with Manager PIN on this Config tab.
                  </p>
                </div>

                {multiDay && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Curfew time</Label>
                      <Input type="time" value={curfewTime} onChange={(e) => setCurfewTime(e.target.value)} className="h-8 text-sm" />
                      <p className="text-[10px] text-muted-foreground">YELLOW → RED + SMS if unaccounted (§12.5).</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Morning roll time</Label>
                      <Input type="time" value={morningTime} onChange={(e) => setMorningTime(e.target.value)} className="h-8 text-sm" />
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-yellow-700 border-yellow-500/40 hover:bg-yellow-500/10"
                    onClick={() => setAnomalyOpen(true)}
                  >
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                    Log Venue Issue
                  </Button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setExpanded(false)}>Close</Button>
                    <Button size="sm" disabled={!dirty || mut.isPending} onClick={() => mut.mutate()}>
                      {mut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                      Save
                    </Button>
                  </div>
                </div>

                {/* Active Issues Register for this day session */}
                <EventIssuesCard eventId={event.id} eventDaySessionId={session.id} />
                </div>
              </div>

              {/* Log Anomaly Modal — event-day context (§12.6) + verbal RED (§3) */}
              <EventDayVerbalAnomalyFlow
                eventId={event.id}
                eventTitle={event.title}
                eventDaySessionId={session.id}
                sessionDate={session.session_date}
                open={anomalyOpen}
                onOpenChange={setAnomalyOpen}
              />
              </>
            )}

            {innerTab === "arrival" && (
              session.phase === "closed_orderly" || session.phase === "closed_incident" ? (
                <EventArrivalRollPanel sessionId={session.id} editable={false} />
              ) : locationLive ? (
                <EventArrivalRollPanel
                  sessionId={session.id}
                  editable={
                    session.phase === "active" ||
                    session.phase === "in_transit" ||
                    session.phase === "at_base" ||
                    session.phase === "pre_departure"
                  }
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Open the location on the Config tab to start the arrival roll.
                </p>
              )
            )}

            {innerTab === "bus" && (
              <BusCheckOnPanel
                event={event}
                sessionId={session.id}
                sessionDate={session.session_date}
                stops={dayStops}
              />
            )}

            {innerTab === "curfew" && multiDay && (
              <AccountabilityRollPanel
                event={event}
                sessionId={session.id}
                sessionDate={session.session_date}
                rollTimeClock={curfewTime || session.curfew_time}
                mode="curfew"
              />
            )}

            {innerTab === "morning" && multiDay && (
              <AccountabilityRollPanel
                event={event}
                sessionId={session.id}
                sessionDate={session.session_date}
                rollTimeClock={morningTime || session.morning_roll_time}
                mode="morning"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}


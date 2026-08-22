/**
 * Event Manage Live tab — office read-only watch of a running outing (BL-120).
 * No floor actions (board / check-in / open location / resolve).
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  Loader2,
  MapPin,
  Moon,
  Sunrise,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ClientTime } from "@/components/ui/client-time";
import { EventDeliverStatusPanel } from "@/components/events/event-deliver-status-panel";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { listEventDaySessions } from "@/lib/api/event-outing";
import {
  eventWatchKey,
  fetchEventWatchSnapshot,
  pickEventWatchSession,
  type EventWatchPerson,
  type EventWatchPersonState,
  type EventWatchProgrammeStop,
  type EventWatchRoll,
  type EventWatchSnapshot,
  type EventWatchTransportGroup,
} from "@/lib/api/event-watch";
import type { EventManifest } from "@/lib/data-store";
import { useOperationalTodayIso } from "@/lib/operational-clock";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { cn, formatDate } from "@/lib/utils";

interface Props {
  event: EventManifest;
}

const STATE_LABEL: Record<EventWatchPersonState, string> = {
  waiting: "Waiting",
  picked_up: "Picked up",
  on_bus: "On bus",
  cancelled: "Cancelled",
  self_arriving: "Self-arriving",
  expected: "Expected",
  checked_in: "Checked in",
  absent: "Absent",
  checked_out: "Checked out",
  not_travelling: "Not travelling",
  accounted: "Accounted",
};

const RUN_STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  active: "Active",
  released: "Released",
  ready: "Ready",
  waiting: "Waiting",
  blocked: "Blocked",
  n_a: "",
};

function stateChipClass(state: EventWatchPersonState): string {
  switch (state) {
    case "on_bus":
    case "checked_in":
    case "accounted":
      return "bg-success text-success-foreground";
    case "picked_up":
      return "bg-info text-info-foreground";
    case "cancelled":
    case "absent":
    case "not_travelling":
      return "bg-destructive text-destructive-foreground";
    case "checked_out":
      return "bg-zinc-600 text-white";
    case "self_arriving":
      return "border border-border bg-muted text-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function phaseLabel(phase: string): string {
  if (phase === "active") return "Open now";
  if (phase === "completed") return "Done";
  return "Pending";
}

export function EventLiveWatchTab({ event }: Props) {
  const todayIso = useOperationalTodayIso();
  const [pickedSessionId, setPickedSessionId] = useState<string | null>(null);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["event-day-sessions", event.id],
    queryFn: () => listEventDaySessions(event.id),
    staleTime: 15_000,
  });

  const session = useMemo(() => {
    if (pickedSessionId) {
      const hit = sessions.find((s) => s.id === pickedSessionId);
      if (hit) return hit;
    }
    return pickEventWatchSession(sessions, todayIso);
  }, [sessions, todayIso, pickedSessionId]);

  const watchKey = session ? eventWatchKey(event.id, session.id) : eventWatchKey(event.id, "");

  useRealtimeInvalidate({
    table: "site_issues_register",
    queryKeys: [watchKey],
    enabled: !!session,
  });

  const { data: snap, isLoading: snapLoading } = useQuery({
    queryKey: watchKey,
    queryFn: () =>
      fetchEventWatchSnapshot({
        eventId: event.id,
        sessionId: session!.id,
        sessionDate: session!.session_date,
      }),
    enabled: !!session,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  return (
    <>
      {sessionsLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading trip days…
        </div>
      ) : !session ? (
        <div className="rounded-lg border border-dashed bg-muted/30 py-8 text-center text-sm text-muted-foreground">
          No trip days yet. Add Trip Days before the office can watch this event.
        </div>
      ) : (
        <div className="space-y-5">
          {sessions.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {sessions.map((s, i) => {
                const active = s.id === session.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPickedSessionId(s.id)}
                    className={cn(
                      "inline-flex min-h-11 touch-manipulation items-center rounded-md px-3 text-sm font-semibold",
                      active
                        ? "bg-tab-active text-tab-active-foreground"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Day {i + 1} · {formatDate(s.session_date)}
                  </button>
                );
              })}
            </div>
          )}

          <EventDeliverStatusPanel
            eventId={event.id}
            sessionId={session.id}
            sessionDate={session.session_date}
            extraQueryKeys={[watchKey]}
          />

          {snapLoading && !snap ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading live rolls…
            </div>
          ) : snap && !snap.floorStarted ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              Not started — no floor data yet.
            </div>
          ) : snap ? (
            <WatchBody snap={snap} />
          ) : null}

          <p className="text-[11px] leading-snug text-muted-foreground">
            Updates when the field tablet syncs. A bus on weak signal (Manifest offline
            queue) can look behind until it reconnects.
          </p>
        </div>
      )}
    </>
  );
}

function WatchBody({ snap }: { snap: EventWatchSnapshot }) {
  return (
    <div className="space-y-5">
      <WatchSection icon={<Bus className="h-4 w-4" />} title="People — Transport IN">
        {snap.inbound.length === 0 ? (
          <EmptyLine>No inbound bus planned for this day.</EmptyLine>
        ) : (
          snap.inbound.map((g) => <TransportGroupBlock key={g.key} group={g} />)
        )}
      </WatchSection>

      <WatchSection icon={<Users className="h-4 w-4" />} title="People — at the event">
        {snap.attendance.length === 0 ? (
          <EmptyLine>Check-in roll not seeded yet.</EmptyLine>
        ) : (
          <PersonList people={snap.attendance} />
        )}
      </WatchSection>

      <WatchSection icon={<MapPin className="h-4 w-4" />} title="Programme">
        {snap.programme.length === 0 ? (
          <EmptyLine>No itinerary stops for this day.</EmptyLine>
        ) : (
          <ProgrammeList stops={snap.programme} />
        )}
      </WatchSection>

      {(snap.hops.length > 0 || snap.home.length > 0) && (
        <WatchSection icon={<Bus className="h-4 w-4" />} title="In-day hops / HOME">
          {snap.hops.map((g) => (
            <TransportGroupBlock key={g.key} group={g} />
          ))}
          {snap.home.map((g) => (
            <TransportGroupBlock key={g.key} group={g} />
          ))}
        </WatchSection>
      )}

      {snap.morningRoll && <RollBlock roll={snap.morningRoll} />}
      {snap.eveningRoll && <RollBlock roll={snap.eveningRoll} />}

      <WatchSection icon={<AlertTriangle className="h-4 w-4" />} title="Open issues">
        {snap.openIssues.length === 0 ? (
          <EmptyLine>No open issues for this day.</EmptyLine>
        ) : (
          <ul className="divide-y rounded-md border">
            {snap.openIssues.map((issue) => {
              const chip = RYGE_SEVERITY_CHIPS.find((c) => c.value === issue.severity);
              return (
                <li key={issue.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                      chip?.idleClass,
                    )}
                  >
                    {issue.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium leading-snug">{issue.title}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {issue.status.replace(/_/g, " ")}
                      {issue.createdAt ? (
                        <>
                          {" · "}
                          <ClientTime iso={issue.createdAt} />
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </WatchSection>
    </div>
  );
}

function WatchSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function TransportGroupBlock({ group }: { group: EventWatchTransportGroup }) {
  const status = RUN_STATUS_LABEL[group.runStatus] ?? group.runStatus;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-foreground">{group.label}</span>
        {status ? (
          <Badge variant="secondary" className="h-5 text-[10px]">
            {status}
          </Badge>
        ) : null}
      </div>
      {group.people.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No boarding names yet.</p>
      ) : (
        <PersonList people={group.people} />
      )}
    </div>
  );
}

function PersonList({ people }: { people: EventWatchPerson[] }) {
  return (
    <ul className="divide-y rounded-md border">
      {people.map((p) => (
        <li
          key={p.participantId}
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
        >
          <div className="min-w-0">
            <div className="font-medium leading-snug">{p.name}</div>
            {p.detail ? (
              <div className="text-[11px] text-muted-foreground">{p.detail}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
              {p.stamp ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  <ClientTime iso={p.stamp} options={{ hour: "2-digit", minute: "2-digit" }} />
                </span>
              ) : null}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                stateChipClass(p.state),
              )}
            >
              {STATE_LABEL[p.state] ?? p.state}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProgrammeList({ stops }: { stops: EventWatchProgrammeStop[] }) {
  return (
    <ol className="divide-y rounded-md border">
      {stops.map((stop) => (
        <li
          key={stop.id}
          className={cn(
            "flex items-start justify-between gap-3 px-3 py-2 text-sm",
            stop.current && "bg-primary/10 ring-1 ring-inset ring-primary/30",
          )}
        >
          <div className="min-w-0">
            <div className="font-medium leading-snug">{stop.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {stop.openedAt ? (
                <>
                  Opened{" "}
                  <ClientTime iso={stop.openedAt} options={{ hour: "2-digit", minute: "2-digit" }} />
                </>
              ) : null}
              {stop.openedAt && stop.closedAt ? " · " : null}
              {stop.closedAt ? (
                <>
                  Closed{" "}
                  <ClientTime iso={stop.closedAt} options={{ hour: "2-digit", minute: "2-digit" }} />
                </>
              ) : null}
              {stop.movementMethod
                ? `${stop.openedAt || stop.closedAt ? " · " : ""}${stop.movementMethod.replace(/_/g, " ")}`
                : null}
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
              stop.phase === "active" && "bg-success text-success-foreground",
              stop.phase === "completed" && "bg-muted text-muted-foreground",
              stop.phase !== "active" &&
                stop.phase !== "completed" &&
                "border border-border text-muted-foreground",
            )}
          >
            {phaseLabel(stop.phase)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RollBlock({ roll }: { roll: EventWatchRoll }) {
  const Icon = roll.kind === "morning" ? Sunrise : Moon;
  const title = roll.kind === "morning" ? "Morning roll" : "Evening roll";
  return (
    <WatchSection icon={<Icon className="h-4 w-4" />} title={title}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {roll.complete ? (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Complete
          </span>
        ) : (
          <span>
            {roll.resolved}/{roll.total} accounted
            {roll.pending > 0 ? ` · ${roll.pending} still to mark` : ""}
          </span>
        )}
      </div>
      {roll.people.length === 0 ? (
        <EmptyLine>Roll not started — nobody checked in yet.</EmptyLine>
      ) : (
        <PersonList people={roll.people} />
      )}
    </WatchSection>
  );
}

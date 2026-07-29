/**
 * Sticky morning/evening roll alerts across all Event Deliver tabs.
 *
 * Bands follow Deferred until (pushed `expected_accounted_at`), not only Config clock:
 *   grace → quiet "Deferred until" (no Yellow)
 *   Yellow → past Deferred until until + redMinsAfter (Admin, default 30)
 *   Red → Deferred until + redMinsAfter
 *
 * Group defer (Option A): primary CTA here; reason on banner only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Moon, Sunrise } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  fetchEventDeliverRollAlerts,
  sweepEventDeliverRolls,
  type RollAlertBand,
  type RollAlertState,
  type RollDeferGraceState,
} from "@/lib/api/event-roll-alerts";
import { fetchRollGroupDeferNotes } from "@/lib/api/event-day-ops";
import { listParticipants } from "@/lib/data-store";
import { eventDeliverStatusKey } from "@/lib/api/event-deliver-status";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { RollCallDeferDialog } from "@/components/events/roll-call-defer-dialog";

interface Props {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  showMorningRoll: boolean;
  showEveningRoll: boolean;
  onOpenTab?: (tab: "morning-roll" | "curfew-roll") => void;
}

const alertsKey = (sessionId: string) =>
  ["event-deliver-roll-alerts", sessionId] as const;

const groupNotesKey = (sessionId: string) =>
  ["event-deliver-roll-group-notes", sessionId] as const;

const BAND_CLASS: Record<RollAlertBand, string> = {
  green: "border-emerald-500/50 bg-emerald-500/15 text-foreground",
  yellow: "border-amber-500/50 bg-amber-500/15 text-foreground",
  red: "border-destructive/60 bg-destructive/15 text-foreground",
};

const TOAST_INTERVAL_MS = 5 * 60_000;

export function EventDeliverRollAlertBanner({
  eventId,
  sessionId,
  sessionDate,
  showMorningRoll,
  showEveningRoll,
  onOpenTab,
}: Props) {
  const qc = useQueryClient();
  const enabled = showMorningRoll || showEveningRoll;
  const [defer, setDefer] = useState<{
    mode: "curfew" | "morning";
    band: "YELLOW" | "RED";
    contextHint?: string;
  } | null>(null);

  useRealtimeInvalidate({
    table: "event_morning_log",
    queryKeys: [alertsKey(sessionId), eventDeliverStatusKey(sessionId), groupNotesKey(sessionId)],
    enabled,
  });
  useRealtimeInvalidate({
    table: "event_curfew_log",
    queryKeys: [alertsKey(sessionId), eventDeliverStatusKey(sessionId), groupNotesKey(sessionId)],
    enabled,
  });
  useRealtimeInvalidate({
    table: "event_day_sessions",
    queryKeys: [groupNotesKey(sessionId)],
    enabled,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 120_000,
    enabled,
  });

  const nameMap = useMemo(
    () =>
      Object.fromEntries(
        participants.map((p) => [
          p.id,
          `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
        ]),
      ),
    [participants],
  );

  const { data: rollAlertBundle } = useQuery({
    queryKey: alertsKey(sessionId),
    queryFn: () =>
      fetchEventDeliverRollAlerts({
        eventId,
        sessionId,
        sessionDate,
        showMorningRoll,
        showEveningRoll,
      }),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const alerts = rollAlertBundle?.alerts ?? [];
  const grace = rollAlertBundle?.grace ?? [];

  const { data: groupNotes } = useQuery({
    queryKey: groupNotesKey(sessionId),
    queryFn: () => fetchRollGroupDeferNotes(sessionId),
    enabled,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => {
      void sweepEventDeliverRolls({
        eventId,
        sessionId,
        sessionDate,
        showMorningRoll,
        showEveningRoll,
        participantNames: nameMap,
      })
        .then(() => {
          if (cancelled) return;
          void qc.invalidateQueries({ queryKey: alertsKey(sessionId) });
          void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(sessionId) });
          void qc.invalidateQueries({
            queryKey: ["event-accountability-roll"],
          });
        })
        .catch((e) => console.error("[roll-alert] sweep failed", e));
    };
    run();
    const id = window.setInterval(run, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, eventId, sessionId, sessionDate, showMorningRoll, showEveningRoll, nameMap, qc]);

  const lastToastRef = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const a of alerts) {
      if (a.band === "green") {
        const key = `${a.kind}:green`;
        const last = lastToastRef.current[key] ?? 0;
        if (Date.now() - last > TOAST_INTERVAL_MS) {
          lastToastRef.current[key] = Date.now();
          toast.message(`${a.label} due`, { description: a.detail });
        }
        continue;
      }
      if (a.band !== "yellow" && a.band !== "red") continue;
      const key = `${a.kind}:${a.band}`;
      const last = lastToastRef.current[key] ?? 0;
      if (Date.now() - last < TOAST_INTERVAL_MS) continue;
      lastToastRef.current[key] = Date.now();
      if (a.band === "red") {
        toast.error(`${a.label} — RED`, { description: a.detail });
      } else {
        toast.warning(`${a.label} overdue`, { description: a.detail });
      }
    }
  }, [alerts]);

  const invalidateAfterDefer = () => {
    void qc.invalidateQueries({ queryKey: alertsKey(sessionId) });
    void qc.invalidateQueries({ queryKey: groupNotesKey(sessionId) });
    void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(sessionId) });
    void qc.invalidateQueries({ queryKey: ["event-accountability-roll"] });
  };

  const noteForKind = (kind: "morning" | "evening") =>
    kind === "morning" ? groupNotes?.morning ?? null : groupNotes?.evening ?? null;

  if (!enabled) return null;

  if (alerts.length === 0 && grace.length === 0) {
    return (
      <>
        {defer && (
          <RollCallDeferDialog
            open
            onOpenChange={(o) => !o && setDefer(null)}
            mode={defer.mode}
            sessionId={sessionId}
            band={defer.band}
            contextHint={defer.contextHint}
            onDeferred={invalidateAfterDefer}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-2">
      {grace.map((g) => (
        <GraceRow
          key={`grace-${g.kind}`}
          grace={g}
          groupNote={noteForKind(g.kind)}
          onOpenTab={onOpenTab}
        />
      ))}

      {alerts.map((a) => (
        <AlertRow
          key={`${a.kind}-${a.band}`}
          alert={a}
          groupNote={noteForKind(a.kind)}
          onOpenTab={onOpenTab}
          onDeferYellow={() =>
            setDefer({
              mode: a.kind === "evening" ? "curfew" : "morning",
              band: "YELLOW",
              contextHint: a.notAtBaseYet
                ? "Group not yet back at the overnight venue (e.g. delayed bus)."
                : undefined,
            })
          }
          onDeferRed={() =>
            setDefer({
              mode: a.kind === "evening" ? "curfew" : "morning",
              band: "RED",
              contextHint: a.notAtBaseYet
                ? "Group not yet back at the overnight venue — manager must agree next steps."
                : undefined,
            })
          }
        />
      ))}

      {defer && (
        <RollCallDeferDialog
          open
          onOpenChange={(o) => !o && setDefer(null)}
          mode={defer.mode}
          sessionId={sessionId}
          band={defer.band}
          contextHint={defer.contextHint}
          onDeferred={invalidateAfterDefer}
        />
      )}
    </div>
  );
}

function GraceRow({
  grace,
  groupNote,
  onOpenTab,
}: {
  grace: RollDeferGraceState;
  groupNote: string | null;
  onOpenTab?: (tab: "morning-roll" | "curfew-roll") => void;
}) {
  const Icon = grace.kind === "morning" ? Sunrise : Moon;
  return (
    <button
      type="button"
      onClick={() => onOpenTab?.(grace.tabHint)}
      className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-left"
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold leading-snug">{grace.label}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Clock className="h-3.5 w-3.5" />
              Deferred until {grace.deferredUntilLabel}
            </span>
            <span className="text-muted-foreground">
              · due in {grace.minsUntil} min · Red if still open {grace.redMinsAfter} min after that
            </span>
          </div>
          {groupNote && (
            <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{groupNote}</p>
          )}
        </div>
      </div>
    </button>
  );
}

function AlertRow({
  alert,
  groupNote,
  onOpenTab,
  onDeferYellow,
  onDeferRed,
}: {
  alert: RollAlertState;
  groupNote: string | null;
  onOpenTab?: (tab: "morning-roll" | "curfew-roll") => void;
  onDeferYellow: () => void;
  onDeferRed: () => void;
}) {
  const Icon = alert.kind === "morning" ? Sunrise : Moon;
  const showDefer = alert.band === "yellow" || alert.band === "red";

  return (
    <div
      className={cn(
        "rounded-xl border-2 px-3 py-2.5",
        BAND_CLASS[alert.band],
      )}
    >
      <button
        type="button"
        onClick={() => onOpenTab?.(alert.tabHint)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        {alert.band === "red" || alert.band === "yellow" ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        ) : (
          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold leading-snug">
            {alert.band === "red" ? "RED · " : alert.band === "yellow" ? "YELLOW · " : ""}
            {alert.label}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</div>
          {alert.deferredUntilLabel && (alert.band === "yellow" || alert.band === "red") && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-background/70 px-2 py-1 text-xs font-semibold">
              <Clock className="h-3.5 w-3.5" />
              Deferred until {alert.deferredUntilLabel}
            </div>
          )}
        </div>
      </button>

      {groupNote && (
        <div className="mt-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 pl-7">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Group
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs font-medium leading-snug">
            {groupNote}
          </p>
        </div>
      )}

      {showDefer && (
        <div className="mt-2 flex flex-wrap gap-2 pl-7">
          {alert.band === "yellow" && (
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-11 min-w-[10rem] flex-1 font-semibold sm:flex-none"
              onClick={onDeferYellow}
            >
              {alert.notAtBaseYet ? "Defer everyone (not at venue)…" : "Defer everyone…"}
            </Button>
          )}
          {alert.band === "red" && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-11 min-w-[10rem] flex-1 font-semibold sm:flex-none"
              onClick={onDeferRed}
            >
              Manager defer everyone…
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11"
            onClick={() => onOpenTab?.(alert.tabHint)}
          >
            Open roll
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * AccountabilityRollPanel — curfew AND morning roll sweeper UI (§12.5)
 *
 * Re-used for both `event_curfew_log` and `event_morning_log` by passing
 * the `mode` prop. Only displayed for multi-day tours.
 *
 * Background sweep: every 60 s the panel calls `sweepAccountabilityRoll`.
 * YELLOW→RED+SMS is automatic per GUARDRAILS §12.5 / §1.1.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Moon,
  RefreshCw,
  RotateCcw,
  Sunrise,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RYGE_SEVERITY_CHIPS } from "@/lib/ui/ryge-severity-chips";
import { Button } from "@/components/ui/button";
import {
  listAccountabilityRoll,
  markAbsent,
  toggleAccounted,
  countUnreconciledCheckins,
  seedAccountabilityRoll,
  sweepAccountabilityRoll,
  isEveningRollMarkingUnlocked,
  type EventAccountabilityRow,
} from "@/lib/api/event-day-ops";
import { loadRollAlertThresholds } from "@/lib/api/event-roll-alerts";
import type { EventManifest } from "@/lib/data-store";
import { listParticipants } from "@/lib/data-store";
import { formatTime } from "@/lib/utils";
import { operationalNowMs } from "@/lib/operational-clock";
import { sydneyWallClockToUtcDate } from "@/lib/operational-time";
import { eventDeliverStatusKey } from "@/lib/api/event-deliver-status";
import { RollCallDeferDialog } from "@/components/events/roll-call-defer-dialog";
import {
  TripAbsentDispositionDialog,
  TripReinstateDialog,
} from "@/components/events/trip-absent-disposition-dialog";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { formatLeftTripDisplay } from "@/lib/trip-absent";
import { reinstateLeftTripEverywhere } from "@/lib/api/event-attendance";
import {
  sortByParticipantSurname,
  surnameMapFromParticipants,
} from "@/lib/ui/sort-participants";

type Mode = "curfew" | "morning";
type LogTable = "event_curfew_log" | "event_morning_log";

const TABLE: Record<Mode, LogTable> = {
  curfew: "event_curfew_log",
  morning: "event_morning_log",
};

interface Props {
  event: EventManifest;
  sessionId: string;
  sessionDate: string;
  /** Clock string from event_day_sessions, e.g. "22:00". null = roll not configured yet. */
  rollTimeClock: string | null;
  mode: Mode;
}

const rollKey = (mode: Mode, sessionId: string) =>
  ["event-accountability-roll", mode, sessionId] as const;

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return formatTime(iso);
}

const RYGE_MAP = new Map(RYGE_SEVERITY_CHIPS.map((c) => [c.value, c]));

function severityBadge(sev: string | null) {
  const chip = RYGE_MAP.get(sev ?? "");
  if (!chip) return null;
  return (
    <Badge className={`${chip.activeClass} text-[10px]`}>
      {sev?.toUpperCase()}
    </Badge>
  );
}

/** Row band from this person's Deferred until (= expected_accounted_at). */
function personDeferBand(
  expectedAt: string | null | undefined,
  redMinsAfter: number,
): "grace" | "yellow" | "red" | null {
  if (!expectedAt) return null;
  const due = Date.parse(expectedAt);
  if (!Number.isFinite(due)) return null;
  const mins = Math.floor((operationalNowMs() - due) / 60_000);
  if (mins >= redMinsAfter) return "red";
  if (mins >= 1) return "yellow";
  if (mins < 0) return "grace";
  return "grace"; // due now — still pending
}

function hasDeferNote(notes: string | null | undefined): boolean {
  return /\[(YELLOW|RED) DEFER/i.test(notes ?? "");
}

/** True when this person's deadline was pushed past the Config roll clock. */
function isDeadlinePushed(
  expectedAt: string | null | undefined,
  sessionDate: string,
  rollTimeClock: string | null,
): boolean {
  if (!expectedAt || !rollTimeClock?.trim()) return false;
  try {
    const original = sydneyWallClockToUtcDate(
      sessionDate,
      rollTimeClock.trim().slice(0, 5),
    ).getTime();
    const expected = Date.parse(expectedAt);
    if (!Number.isFinite(original) || !Number.isFinite(expected)) return false;
    return expected > original + 2 * 60_000;
  } catch {
    return false;
  }
}

export function AccountabilityRollPanel({ event, sessionId, sessionDate, rollTimeClock, mode }: Props) {
  const qc = useQueryClient();
  const table = TABLE[mode];
  const [seeding, setSeeding] = useState(false);
  const [lastSweep, setLastSweep] = useState<{ yellow: number; red: number } | null>(null);

  const { data: roll = [], isLoading } = useQuery({
    queryKey: rollKey(mode, sessionId),
    queryFn: () => listAccountabilityRoll(table, sessionId),
    staleTime: 15_000,
    refetchInterval: 60_000, // auto sweep cadence
  });

  // Participant name lookup — used for virtual rows that have no DB record yet.
  const { data: participants = [] } = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 120_000,
  });
  const nameMap = useMemo(
    () => Object.fromEntries(participants.map((p) => [p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()])),
    [participants],
  );
  const surnameById = useMemo(
    () => surnameMapFromParticipants(participants),
    [participants],
  );
  /** Surname A–Z; accounted / left-trip status must not reorder the list. */
  const sortedRoll = useMemo(
    () =>
      sortByParticipantSurname(roll, (r) => r.participant_id, surnameById),
    [roll, surnameById],
  );

  // How many check-in entries are still "expected" (not yet arrived or reconciled)?
  const { data: unreconciledCount = 0 } = useQuery({
    queryKey: ["event-unreconciled-checkins", sessionId],
    queryFn: () => countUnreconciledCheckins(sessionId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: eveningGate } = useQuery({
    queryKey: ["evening-roll-gate", sessionId],
    queryFn: () =>
      isEveningRollMarkingUnlocked({
        eventId: event.id,
        sessionId,
        sessionDate,
      }),
    enabled: mode === "curfew",
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
  const eveningLocked = mode === "curfew" && eveningGate != null && !eveningGate.unlocked;

  const { data: rollThresholds } = useQuery({
    queryKey: ["roll-alert-thresholds", mode],
    queryFn: () => loadRollAlertThresholds(mode === "curfew" ? "evening" : "morning"),
    staleTime: 60_000,
  });
  const redMinsAfter = rollThresholds?.redMinsAfter ?? 30;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: rollKey(mode, sessionId) });
    qc.invalidateQueries({ queryKey: ["event-unreconciled-checkins", sessionId] });
    qc.invalidateQueries({ queryKey: ["evening-roll-gate", sessionId] });
    qc.invalidateQueries({ queryKey: eventDeliverStatusKey(sessionId) });
    qc.invalidateQueries({ queryKey: ["event-deliver-roll-group-notes", sessionId] });
    qc.invalidateQueries({ queryKey: ["event-deliver-roll-alerts", sessionId] });
    // Left-trip Absent syncs floor attendance — refresh Check-In / Check-Out / activity.
    qc.invalidateQueries({ queryKey: ["event-attendance-log", sessionId] });
    qc.invalidateQueries({ queryKey: ["event-attendance-absent-notes", sessionId] });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-activity-roll" });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-issues" });
  };

  const autoSeedAttemptedRef = useRef(false);
  useEffect(() => {
    autoSeedAttemptedRef.current = false;
  }, [sessionId, mode]);

  // Persist virtual rows before sweep — checked-in attendees without a log row yet.
  useEffect(() => {
    if (!rollTimeClock || isLoading || roll.length === 0) return;
    if (!roll.some((r) => r.isVirtual)) return;
    if (autoSeedAttemptedRef.current) return;
    autoSeedAttemptedRef.current = true;
    void seedAccountabilityRoll(table, {
      eventId: event.id,
      sessionId,
      rollTimeClock,
      sessionDate,
    })
      .then(() => invalidate())
      .catch((e) => console.error("[accountability-roll] auto-seed failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll, rollTimeClock, isLoading, sessionId, sessionDate, table, event.id]);

  // Tab-local sweep (global sweep also runs from EventDeliverRollAlertBanner).
  useEffect(() => {
    if (!roll.length) return;
    if (roll.some((r) => r.isVirtual)) return;
    const names: Record<string, string> = { ...nameMap };
    roll.forEach((r) => {
      if (r.participant_name) names[r.participant_id] = r.participant_name;
    });
    const kind = mode === "curfew" ? "evening" : "morning";
    void loadRollAlertThresholds(kind)
      .then((t) =>
        sweepAccountabilityRoll(table, sessionId, 0, t.redMinsAfter, names),
      )
      .then((res) => {
        if (res.redRaised > 0 || res.yellowRaised > 0) {
          setLastSweep({ yellow: res.yellowRaised, red: res.redRaised });
          invalidate();
        }
      })
      .catch((e) => console.error("[accountability-roll] sweep failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll]);

  const handleSeed = async () => {
    if (!rollTimeClock) {
      toast.error(
        "Set the " +
          (mode === "curfew" ? "evening roll call time" : "morning roll call time") +
          " in Trip Days → Config first.",
      );
      return;
    }
    setSeeding(true);
    try {
      const n = await seedAccountabilityRoll(table, {
        eventId: event.id,
        sessionId,
        rollTimeClock,
        sessionDate,
      });
      toast.success(`${n} participant${n === 1 ? "" : "s"} seeded onto ${mode} roll.`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const accounted = roll.filter((r) => r.status === "accounted").length;
  const absent = roll.filter((r) => r.status === "absent").length;
  const outstanding = roll.filter((r) => r.status === "expected").length;
  const redCount = roll.filter((r) => r.escalation_severity === "red").length;
  const yellowCount = roll.filter((r) => r.escalation_severity === "yellow").length;

  const Icon = mode === "curfew" ? Moon : Sunrise;
  const label = mode === "curfew" ? "Evening roll call" : "Morning roll call";

  const [deferState, setDeferState] = useState<{
    band: "YELLOW" | "RED";
    participantId?: string | null;
    participantName?: string | null;
  } | null>(null);

  return (
    <div className="space-y-3">
      {/* Reconciliation gate — shown when check-in roll has unresolved "expected" entries */}
      {unreconciledCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{unreconciledCount} participant{unreconciledCount === 1 ? "" : "s"}</strong> still expected on
            the check-in roll — reconcile all arrivals before closing the {mode} roll.
          </span>
        </div>
      )}

      {eveningLocked && (
        <div className="space-y-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2.5 text-sm">
          <div className="flex items-start gap-2">
            <Moon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {eveningGate?.reason ??
                "Finish today's programme and return to base before marking Evening Roll."}
              {" "}
              If delayed (traffic etc.), defer the roll deadline instead of forcing Accounted on the bus.
            </span>
          </div>
          {outstanding > 0 && (
            <div className="flex flex-wrap gap-2 pl-6">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-11 font-semibold"
                onClick={() => setDeferState({ band: "YELLOW" })}
              >
                Defer everyone…
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-11 font-semibold"
                onClick={() => setDeferState({ band: "RED" })}
              >
                Manager defer everyone…
              </Button>
            </div>
          )}
          <p className="pl-6 text-[11px] text-muted-foreground">
            Group defer reason appears on the Yellow/Red banner only — not on each person.
          </p>
        </div>
      )}

      {/* Header — proactive Defer all anytime (not only Yellow banner); Re-sync recovery */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4" />
          {label}
          {rollTimeClock && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Clock className="h-3 w-3" /> {rollTimeClock}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {redCount > 0 && (
            <span className="flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle className="h-3 w-3" /> {redCount} RED
            </span>
          )}
          {yellowCount > 0 && (
            <span className="flex items-center gap-1 rounded bg-yellow-500/15 px-2 py-0.5 text-[11px] font-semibold text-yellow-700">
              {yellowCount} YELLOW
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {accounted} accounted · {absent} absent · {outstanding} outstanding
          </span>
          {outstanding > 0 && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setDeferState({ band: "YELLOW" })}
                title="Push Deferred until for everyone still outstanding (bus late, etc.) — available anytime"
              >
                Defer all…
              </Button>
              {redCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => setDeferState({ band: "RED" })}
                  title="Manager verbal defer for everyone still outstanding"
                >
                  Manager defer…
                </Button>
              )}
            </>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSeed} disabled={seeding} title="Recovery: re-sync roll from current check-ins">
            {seeding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Re-sync
          </Button>
        </div>
      </div>

      {lastSweep && (lastSweep.red > 0 || lastSweep.yellow > 0) && (
        <div className="rounded bg-yellow-500/10 px-3 py-2 text-[11px] font-medium text-yellow-700">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          Auto-sweep: {lastSweep.yellow > 0 ? `${lastSweep.yellow} YELLOW raised` : ""}
          {lastSweep.yellow > 0 && lastSweep.red > 0 ? " · " : ""}
          {lastSweep.red > 0 ? `${lastSweep.red} RED escalated + SMS dispatched` : ""}
        </div>
      )}

      {!rollTimeClock && (
        <p className="rounded border border-dashed py-3 text-center text-sm text-muted-foreground">
          No {mode === "curfew" ? "evening roll call" : "morning roll call"} time set on this trip day.
          Set it in Trip Days → expand the row → Config.
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : roll.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No participants checked in yet — check in attendees on the Check-In tab first.
        </p>
      ) : (
        <ul className="space-y-2">
          {sortedRoll.map((row) => (
            <AccountabilityRow
              key={row.id}
              row={row}
              table={table}
              nameMap={nameMap}
              sessionDate={sessionDate}
              rollTimeClock={rollTimeClock}
              redMinsAfter={redMinsAfter}
              markingDisabled={eveningLocked}
              onDeferPerson={(band) =>
                setDeferState({
                  band,
                  participantId: row.participant_id,
                  participantName:
                    row.participant_name || nameMap[row.participant_id] || "Participant",
                })
              }
              onChanged={invalidate}
            />
          ))}
        </ul>
      )}

      {deferState && (
        <RollCallDeferDialog
          open
          onOpenChange={(o) => !o && setDeferState(null)}
          mode={mode}
          sessionId={sessionId}
          band={deferState.band}
          participantId={deferState.participantId}
          participantName={deferState.participantName}
          contextHint={
            eveningLocked
              ? "Group not yet back at the overnight venue."
              : undefined
          }
          onDeferred={invalidate}
        />
      )}
    </div>
  );
}

// ─── Individual accountability row ───────────────────────────────────────────

interface AccRowProps {
  row: EventAccountabilityRow;
  table: LogTable;
  nameMap: Record<string, string>;
  sessionDate: string;
  rollTimeClock: string | null;
  redMinsAfter: number;
  markingDisabled?: boolean;
  onDeferPerson?: (band: "YELLOW" | "RED") => void;
  onChanged: () => void;
}

function AccountabilityRow({
  row,
  table,
  nameMap,
  sessionDate,
  rollTimeClock,
  redMinsAfter,
  markingDisabled = false,
  onDeferPerson,
  onChanged,
}: AccRowProps) {
  const [absentOpen, setAbsentOpen] = useState(false);
  const [reinstateOpen, setReinstateOpen] = useState(false);
  const name = row.participant_name || nameMap[row.participant_id] || "Participant";

  const toggleMut = useMutation({
    mutationFn: () => toggleAccounted(table, row, ""),
    onSuccess: (next) => {
      toast.success(next.status === "accounted" ? "Accounted" : "Back to awaiting roll");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const absentMut = useMutation({
    mutationFn: (params: Parameters<typeof markAbsent>[2]) =>
      markAbsent(table, row, params),
    onSuccess: () => {
      toast.success("Marked absent — Hub welfare issue raised.");
      setAbsentOpen(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reinstateMut = useMutation({
    mutationFn: (reason: string) =>
      reinstateLeftTripEverywhere({
        eventDaySessionId: row.event_day_session_id,
        participantId: row.participant_id,
        participantName: name,
        reason,
      }),
    onSuccess: () => {
      toast.success("Reinstated — back on active roll.");
      setReinstateOpen(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const isAccounted = row.status === "accounted";
  const isAbsent = row.status === "absent";
  const isPending = !isAccounted && !isAbsent;
  const absentReason = formatLeftTripDisplay(row.notes);
  const deadlinePushed =
    hasDeferNote(row.notes) ||
    isDeadlinePushed(row.expected_accounted_at, sessionDate, rollTimeClock);
  const timingBand = isPending
    ? personDeferBand(row.expected_accounted_at, redMinsAfter)
    : null;
  const isRed =
    row.escalation_severity === "red" || timingBand === "red";
  const isYellow =
    !isRed && (row.escalation_severity === "yellow" || timingBand === "yellow");
  const inDeferGrace = isPending && deadlinePushed && timingBand === "grace";
  const deferredUntilLabel = fmtTime(row.expected_accounted_at);
  const pendingTone = isRed ? "danger" : isYellow ? "warning" : "success";
  const pendingSubtitle = inDeferGrace
    ? `Deferred until ${deferredUntilLabel} — tap to mark accounted`
    : deadlinePushed && isYellow
      ? `Yellow · past ${deferredUntilLabel} — tap to mark accounted`
      : deadlinePushed && isRed
        ? `Red · past ${deferredUntilLabel} — tap to mark accounted`
        : "Awaiting roll — tap to mark accounted";
  const accountedSubtitle = row.accounted_at
    ? `Accounted ${fmtTime(row.accounted_at)} — tap to undo`
    : "Accounted — tap to undo";

  return (
    <>
      <li className="space-y-1.5">
        {isAbsent ? (
          <div className="rounded-xl border-2 border-muted bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-base font-semibold">{name}</span>
              <Badge variant="secondary" className="text-[10px]">Left trip</Badge>
              {!markingDisabled && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5 touch-manipulation"
                  disabled={reinstateMut.isPending}
                  onClick={() => setReinstateOpen(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reinstate
                </Button>
              )}
            </div>
            {absentReason && (
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] italic text-muted-foreground">
                {absentReason}
              </p>
            )}
          </div>
        ) : (
          <MobileFieldButton
            title={name}
            subtitle={isAccounted ? accountedSubtitle : pendingSubtitle}
            tone={isAccounted ? "success" : pendingTone}
            active={isAccounted}
            disabled={toggleMut.isPending || markingDisabled}
            onClick={() => toggleMut.mutate()}
            icon={
              toggleMut.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )
            }
            trailing={
              isPending ? (
                <div className="flex items-center gap-1.5">
                  {severityBadge(isRed ? "red" : isYellow ? "yellow" : row.escalation_severity)}
                  {onDeferPerson && (
                    <button
                      type="button"
                      disabled={markingDisabled}
                      className="inline-flex h-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border-2 border-border bg-background/90 px-3 text-xs font-semibold text-foreground transition hover:bg-muted active:scale-[0.99] disabled:opacity-50"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeferPerson(
                          isRed || row.escalation_severity === "red" ? "RED" : "YELLOW",
                        );
                      }}
                    >
                      Defer
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={markingDisabled}
                    title="No show / absent"
                    aria-label={`Mark ${name} absent`}
                    className="inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg border-2 border-destructive/40 text-destructive transition hover:bg-destructive/10 active:scale-[0.99] disabled:opacity-50"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAbsentOpen(true);
                    }}
                  >
                    <UserX className="h-5 w-5" />
                  </button>
                </div>
              ) : undefined
            }
          />
        )}

        {isPending && deadlinePushed && (
          <p className="flex items-center gap-1 px-1 text-[11px] font-medium text-sky-800 dark:text-sky-200">
            <Clock className="h-3 w-3 shrink-0" />
            Still pending · Deferred until {deferredUntilLabel}
            {isYellow || isRed
              ? ` · Red if still open +${redMinsAfter}m after Deferred until`
              : ` · Yellow after that · Red +${redMinsAfter}m`}
          </p>
        )}

        {!isAbsent && row.notes?.trim() && (
          <p className="whitespace-pre-wrap px-1 text-[11px] italic text-muted-foreground">
            {row.notes.trim()}
          </p>
        )}
      </li>

      <TripAbsentDispositionDialog
        open={absentOpen}
        onOpenChange={setAbsentOpen}
        participantName={name}
        title="Left the trip"
        description={`Record how ${name} left the trip. They stay as a Left trip placeholder until reinstated — not for “still in room” skips.`}
        pending={absentMut.isPending}
        onConfirm={async (result) => {
          await absentMut.mutateAsync({
            disposition: result.disposition,
            safetyPlan: result.safetyPlan,
            severity: result.severity,
            participantName: name,
          });
        }}
      />

      <TripReinstateDialog
        open={reinstateOpen}
        onOpenChange={setReinstateOpen}
        participantName={name}
        pending={reinstateMut.isPending}
        onConfirm={async (reason) => {
          await reinstateMut.mutateAsync(reason);
        }}
      />
    </>
  );
}

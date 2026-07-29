/**
 * Event Deliver — morning/evening roll call alert bands (GUARDRAILS §12.5 / §12.13.8)
 *
 * Bands use each outstanding person's `expected_accounted_at` (pushed by defer),
 * not only the Config clock. After a group defer:
 *   Yellow = past Deferred until → until Deferred until + redMinsAfter (Admin, default 30)
 *   Red    = at/after Deferred until + redMinsAfter
 * Further defers push Deferred until again, so Red moves with it.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  isEveningRollMarkingUnlocked,
  listAccountabilityRoll,
  sweepAccountabilityRoll,
} from "@/lib/api/event-day-ops";
import { getAccountabilityProgress } from "@/lib/api/event-deliver-status";
import { listSystemParameters } from "@/lib/api/system-parameters";
import { operationalNowMs } from "@/lib/operational-clock";
import { sydneyWallClockToUtcDate } from "@/lib/operational-time";
import { formatTime } from "@/lib/utils";

export type RollAlertKind = "morning" | "evening";
export type RollAlertBand = "green" | "yellow" | "red";

export interface RollAlertThresholds {
  /** Minutes before deadline for approaching Green nudge. Default 0. */
  greenMinsBefore: number;
  /** Minutes after deadline when Yellow soft-overdue starts. Default 0 (at deadline). */
  yellowMinsAfter: number;
  /** Minutes after Deferred until when Red + SMS. Default 30 (Admin). */
  redMinsAfter: number;
}

export interface RollAlertState {
  kind: RollAlertKind;
  band: RollAlertBand;
  label: string;
  detail: string;
  /** Config clock from trip day (e.g. 21:30) — original roll time. */
  deadlineClock: string;
  /**
   * Effective deadline for outstanding people (may be pushed by defer).
   * Display as "Deferred until HH:mm" when later than Config clock.
   */
  deferredUntilLabel: string | null;
  /** True when effective deadline was pushed past the Config clock. */
  isDeferred: boolean;
  minsRelative: number;
  outstanding: number;
  total: number;
  tabHint: "morning-roll" | "curfew-roll";
  /**
   * Evening only: group not yet back at overnight base — prefer deferral;
   * hotel Accounted taps remain gated.
   */
  notAtBaseYet?: boolean;
}

/** Quiet strip while Deferred until is still in the future (no Yellow/Red). */
export interface RollDeferGraceState {
  kind: RollAlertKind;
  label: string;
  deferredUntilLabel: string;
  minsUntil: number;
  redMinsAfter: number;
  tabHint: "morning-roll" | "curfew-roll";
}

export const DEFAULT_ROLL_THRESHOLDS: RollAlertThresholds = {
  greenMinsBefore: 0,
  yellowMinsAfter: 0,
  redMinsAfter: 30,
};

function readParamNumber(
  rows: Array<{ key: string; value: unknown }>,
  key: string,
  fallback: number,
): number {
  const row = rows.find((r) => r.key === key);
  if (!row) return fallback;
  const n = typeof row.value === "number" ? row.value : Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadRollAlertThresholds(kind: RollAlertKind): Promise<RollAlertThresholds> {
  const yellowBeforeKey =
    kind === "evening" ? "event_curfew_yellow_mins_before" : "event_morning_yellow_mins_before";
  const redAfterKey =
    kind === "evening" ? "event_curfew_red_mins_after" : "event_morning_red_mins_after";

  let rows: Array<{ key: string; value: unknown }> = [];
  try {
    rows = await listSystemParameters();
  } catch {
    rows = [];
  }

  const yellowBefore = readParamNumber(rows, yellowBeforeKey, 0);
  const redAfter = readParamNumber(rows, redAfterKey, 30);

  return {
    greenMinsBefore: Math.max(0, yellowBefore),
    yellowMinsAfter: 0,
    redMinsAfter: Math.max(1, redAfter),
  };
}

function formatClock(clock: string | null | undefined): string | null {
  if (!clock?.trim()) return null;
  return clock.trim().slice(0, 5);
}

function deadlineMs(sessionDate: string, clock: string): number {
  const [hh, mm] = clock.split(":").map(Number);
  return sydneyWallClockToUtcDate(
    sessionDate,
    `${String(hh).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}`,
  ).getTime();
}

/**
 * Band rules relative to effective deadline (Config clock or Deferred until):
 * - Green: within greenMinsBefore before deadline, or first minute at deadline
 * - Yellow: from ~1 min after deadline until redMinsAfter
 * - Red: at/after redMinsAfter (Admin; default 30 after Deferred until)
 */
function bandFor(minsRelative: number, t: RollAlertThresholds): RollAlertBand | null {
  if (minsRelative >= t.redMinsAfter) return "red";
  if (minsRelative >= 0) {
    if (minsRelative < 1) return "green";
    return "yellow";
  }
  if (t.greenMinsBefore > 0 && minsRelative >= -t.greenMinsBefore) return "green";
  return null;
}

/**
 * Most urgent outstanding deadline (= Deferred until when the group was deferred together).
 * Falls back to Config clock when the roll has no expected rows yet.
 */
async function resolveEffectiveDeadline(opts: {
  table: "event_morning_log" | "event_curfew_log";
  sessionId: string;
  sessionDate: string;
  configuredClock: string;
}): Promise<{
  effectiveDueMs: number;
  originalDueMs: number;
  isDeferred: boolean;
  deferredUntilLabel: string | null;
}> {
  const originalDueMs = deadlineMs(opts.sessionDate, opts.configuredClock);
  const roll = await listAccountabilityRoll(opts.table, opts.sessionId);
  const pendingTimes = roll
    .filter((r) => r.status === "expected")
    .map((r) => Date.parse(r.expected_accounted_at))
    .filter((t) => Number.isFinite(t));

  if (pendingTimes.length === 0) {
    return {
      effectiveDueMs: originalDueMs,
      originalDueMs,
      isDeferred: false,
      deferredUntilLabel: null,
    };
  }

  // Earliest outstanding deadline = next accountability moment for the group.
  const effectiveDueMs = Math.min(...pendingTimes);
  // Treat as deferred when pushed ≥ 2 minutes past Config clock.
  const isDeferred = effectiveDueMs > originalDueMs + 2 * 60_000;
  return {
    effectiveDueMs,
    originalDueMs,
    isDeferred,
    deferredUntilLabel: isDeferred ? formatTime(effectiveDueMs) : null,
  };
}

export async function fetchEventDeliverRollAlerts(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  showMorningRoll: boolean;
  showEveningRoll: boolean;
}): Promise<{ alerts: RollAlertState[]; grace: RollDeferGraceState[] }> {
  const { data: sessionRow, error } = await supabase
    .from("event_day_sessions")
    .select("morning_roll_time, curfew_time, phase")
    .eq("id", opts.sessionId)
    .single();
  if (error) throw error;

  const phase = (sessionRow?.phase as string) ?? "";
  if (phase === "closed_orderly" || phase === "closed_incident" || phase === "planning") {
    return { alerts: [], grace: [] };
  }

  const now = operationalNowMs();
  const alerts: RollAlertState[] = [];
  const grace: RollDeferGraceState[] = [];

  const candidates: Array<{
    kind: RollAlertKind;
    enabled: boolean;
    clock: string | null;
    table: "event_morning_log" | "event_curfew_log";
    label: string;
    tabHint: "morning-roll" | "curfew-roll";
  }> = [
    {
      kind: "morning",
      enabled: opts.showMorningRoll,
      clock: formatClock(sessionRow?.morning_roll_time as string | null),
      table: "event_morning_log",
      label: "Morning roll call",
      tabHint: "morning-roll",
    },
    {
      kind: "evening",
      enabled: opts.showEveningRoll,
      clock: formatClock(sessionRow?.curfew_time as string | null),
      table: "event_curfew_log",
      label: "Evening roll call",
      tabHint: "curfew-roll",
    },
  ];

  for (const c of candidates) {
    if (!c.enabled || !c.clock) continue;

    const thresholds = await loadRollAlertThresholds(c.kind);
    const { effectiveDueMs, isDeferred, deferredUntilLabel } = await resolveEffectiveDeadline({
      table: c.table,
      sessionId: opts.sessionId,
      sessionDate: opts.sessionDate,
      configuredClock: c.clock,
    });
    if (!Number.isFinite(effectiveDueMs)) continue;

    const progress = await getAccountabilityProgress(c.table, opts.sessionId);
    if (progress.complete) continue;
    if (progress.total === 0 && progress.pending === 0) continue;

    // Evening is tonight's job — do not raise Yellow/Red while still on morning/programme.
    let notAtBaseYet = false;
    if (c.kind === "evening") {
      const gate = await isEveningRollMarkingUnlocked({
        eventId: opts.eventId,
        sessionId: opts.sessionId,
        sessionDate: opts.sessionDate,
      });
      notAtBaseYet = !gate.unlocked;
      if (notAtBaseYet) continue;
    }

    const minsRelative = Math.floor((now - effectiveDueMs) / 60_000);
    const band = bandFor(minsRelative, thresholds);

    // Still inside Deferred-until grace → no Yellow/Red; show quiet "Deferred until".
    if (!band && isDeferred && minsRelative < 0) {
      grace.push({
        kind: c.kind,
        label: c.label,
        deferredUntilLabel: deferredUntilLabel ?? formatTime(effectiveDueMs),
        minsUntil: Math.abs(minsRelative),
        redMinsAfter: thresholds.redMinsAfter,
        tabHint: c.tabHint,
      });
      continue;
    }

    if (!band) continue;

    const outstanding = progress.pending > 0 ? progress.pending : Math.max(progress.total, 1);
    const when =
      minsRelative < 0
        ? `due in ${Math.abs(minsRelative)} min`
        : minsRelative === 0
          ? "due now"
          : `${minsRelative} min overdue`;

    const overdueVs =
      isDeferred && deferredUntilLabel
        ? `Deferred until ${deferredUntilLabel}`
        : `deadline ${c.clock}`;

    const baseDetail = `${outstanding} still to account · ${when} (${overdueVs})`;
    alerts.push({
      kind: c.kind,
      band,
      label: c.label,
      detail: baseDetail,
      deadlineClock: c.clock,
      deferredUntilLabel: isDeferred ? deferredUntilLabel : null,
      isDeferred,
      minsRelative,
      outstanding,
      total: progress.total,
      tabHint: c.tabHint,
      notAtBaseYet,
    });
  }

  const order: Record<RollAlertBand, number> = { red: 0, yellow: 1, green: 2 };
  alerts.sort((a, b) => order[a.band] - order[b.band]);
  return { alerts, grace };
}

/** Background sweep for both rolls while Event Deliver is open. */
export async function sweepEventDeliverRolls(opts: {
  eventId?: string;
  sessionId: string;
  sessionDate?: string;
  showMorningRoll: boolean;
  showEveningRoll: boolean;
  participantNames?: Record<string, string>;
}): Promise<void> {
  const names = opts.participantNames ?? {};

  if (opts.showMorningRoll) {
    const t = await loadRollAlertThresholds("morning");
    // Sweep uses each row's expected_accounted_at (= Deferred until after a push).
    await sweepAccountabilityRoll(
      "event_morning_log",
      opts.sessionId,
      0,
      t.redMinsAfter,
      names,
    );
  }

  if (opts.showEveningRoll) {
    // Do not escalate tonight's evening roll while still on morning/programme.
    if (opts.eventId && opts.sessionDate) {
      const gate = await isEveningRollMarkingUnlocked({
        eventId: opts.eventId,
        sessionId: opts.sessionId,
        sessionDate: opts.sessionDate,
      });
      if (!gate.unlocked) return;
    }
    const t = await loadRollAlertThresholds("evening");
    await sweepAccountabilityRoll(
      "event_curfew_log",
      opts.sessionId,
      0,
      t.redMinsAfter,
      names,
    );
  }
}

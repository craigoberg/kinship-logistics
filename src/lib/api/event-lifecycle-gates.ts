/**
 * BL-088 — multi-day lifecycle sequencing gates (GUARDRAILS §12.4).
 *
 * High-trust: day may close once evening roll is complete even before the
 * scheduled curfew clock; close_declared_at / ledger keep leaders accountable.
 */
import { listEventAttendanceRoll, listStillCheckedIn } from "@/lib/api/event-attendance";
import {
  getAccountabilityProgress,
  sessionRequiresEveningRoll,
} from "@/lib/api/event-deliver-status";
import { listEventDaySessions } from "@/lib/api/event-outing";
import { formatDate } from "@/lib/utils";

export function isDaySessionClosed(phase: string): boolean {
  return phase === "closed_orderly" || phase === "closed_incident";
}

/** BL-088 §2 — cannot open Day N+1 while Day N is still open. */
export async function assertPriorDayClosedBeforeOpen(opts: {
  eventId: string;
  sessionId: string;
}): Promise<void> {
  const sessions = await listEventDaySessions(opts.eventId);
  if (sessions.length <= 1) return;

  const sorted = [...sessions].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  );
  const idx = sorted.findIndex((s) => s.id === opts.sessionId);
  if (idx <= 0) return;

  const prior = sorted[idx - 1];
  if (!isDaySessionClosed(prior.phase)) {
    const priorLabel = formatDate(prior.session_date);
    if (prior.phase === "planning" || prior.phase === "pre_departure") {
      throw new Error(
        `Previous trip day (${priorLabel}) was never opened. Open and run that day (then Close day) before opening this one — or set the SIM clock back to ${priorLabel}.`,
      );
    }
    throw new Error(
      `Close the previous trip day (${priorLabel}) before opening this day — it is still ${prior.phase.replace(/_/g, " ")}.`,
    );
  }
}

/**
 * BL-088 §1 — day close readiness.
 * Intermediate multi-day nights: evening roll complete (clock may still be early).
 * Final / single day: departure handover (nobody still checked in).
 */
export async function assertDaySessionCloseable(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<void> {
  const needsEvening = await sessionRequiresEveningRoll(opts.eventId, opts.sessionDate);

  if (needsEvening) {
    const progress = await getAccountabilityProgress("event_curfew_log", opts.sessionId);
    if (progress.complete) return;

    if (progress.total === 0) {
      const attendance = await listEventAttendanceRoll(opts.sessionId);
      const pendingArrival = attendance.filter((r) => r.status === "expected").length;
      const checkedIn = attendance.filter((r) => r.status === "checked_in").length;
      // Vacuous: never opened / everyone absent — office may close the day.
      if (pendingArrival === 0 && checkedIn === 0) return;
      throw new Error(
        "Complete Evening Roll Call before closing this day (Evening Roll tab).",
      );
    }

    throw new Error(
      `Evening roll incomplete — ${progress.pending} still to account (Evening Roll tab).`,
    );
  }

  const stillIn = await listStillCheckedIn(opts.sessionId);
  if (stillIn.length > 0) {
    throw new Error(
      `Departure handover incomplete — still checked in: ${stillIn.join(", ")}. Check out each participant first.`,
    );
  }
}

/**
 * BL-088 §3 — final-day floor must be cleared before the whole event closes.
 * (Return bus completion stays in assessEventReturnTransport.)
 */
export async function assertFinalDayDepartureComplete(eventId: string): Promise<void> {
  const sessions = await listEventDaySessions(eventId);
  if (sessions.length === 0) return;

  const sorted = [...sessions].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  );
  const final = sorted[sorted.length - 1];
  const roll = await listEventAttendanceRoll(final.id);
  if (roll.length === 0) return;

  const stillCheckedIn = roll.filter((r) => r.status === "checked_in");
  if (stillCheckedIn.length > 0) {
    throw new Error(
      `Final day still has ${stillCheckedIn.length} participant${stillCheckedIn.length === 1 ? "" : "s"} checked in — finish Check-Out before closing the event.`,
    );
  }

  const stillExpected = roll.filter((r) => r.status === "expected");
  if (stillExpected.length > 0) {
    throw new Error(
      `Final day still has ${stillExpected.length} expected arrival${stillExpected.length === 1 ? "" : "s"} unresolved — mark absent or check in/out before closing the event.`,
    );
  }
}

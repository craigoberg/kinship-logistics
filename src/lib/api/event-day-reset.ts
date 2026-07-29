/**
 * Test-only rewind of one Event Deliver trip day to Start of Day.
 *
 * Keeps the same session row (date, leader, roll times, itinerary stops).
 * Wipes floor ops. Sets DEV clock to session_date @ 07:00 Sydney.
 *
 * Day 1: ends in planning — Open Location + arrival Check-In as usual.
 * Day 2+: overnight continuity — location left open, roster checked in at
 * the overnight base (first stop active) so Morning Roll is available.
 */
import { supabase } from "@/integrations/supabase/client";
import { seedEventAttendanceRoll } from "@/lib/api/event-attendance";
import { applyOvernightDayStartContinuity } from "@/lib/api/event-day-continuity";
import { writeToLedger } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import {
  operationalNowIso,
  setOperationalClockOverride,
} from "@/lib/operational-clock";
import { IS_TEST_BUILD } from "@/lib/test-mode";
import type { EventDaySession } from "@/lib/api/event-outing";

const START_OF_DAY_CLOCK = "07:00";

/** Clear group-defer banner notes when columns exist (pre-migration safe). */
async function updateSessionResetPatch(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<EventDaySession> {
  const withNotes = {
    ...patch,
    morning_group_defer_note: null,
    evening_group_defer_note: null,
  };
  const first = await supabase
    .from("event_day_sessions")
    .update(withNotes)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (!first.error) return first.data as EventDaySession;

  if (!/morning_group_defer_note|evening_group_defer_note|column/i.test(first.error.message)) {
    throw new Error(`event_day_sessions reset: ${first.error.message}`);
  }

  const second = await supabase
    .from("event_day_sessions")
    .update(patch)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (second.error) throw new Error(`event_day_sessions reset: ${second.error.message}`);
  return second.data as EventDaySession;
}

async function collectEscalationIssueIds(sessionId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const table of [
    "event_attendance_log",
    "event_morning_log",
    "event_curfew_log",
  ] as const) {
    const { data, error } = await supabase
      .from(table)
      .select("escalation_issue_id")
      .eq("event_day_session_id", sessionId)
      .not("escalation_issue_id", "is", null);
    if (error) {
      console.warn(`[resetEventDayToStartOfDay:${table}]`, error.message);
      continue;
    }
    for (const row of data ?? []) {
      const id = (row as { escalation_issue_id?: string | null }).escalation_issue_id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function deleteOrThrow(
  label: string,
  run: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const { error } = await run();
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function isNonFirstTripDay(eventId: string, sessionDate: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("session_date")
    .eq("event_id", eventId)
    .order("session_date", { ascending: true });
  if (error) throw new Error(`list sessions: ${error.message}`);
  const dates = (data ?? []).map((r) => (r as { session_date: string }).session_date);
  if (dates.length <= 1) return false;
  return dates[0] !== sessionDate;
}

/**
 * Day 2+ overnight: wake at base — checked in + first stop active + location open.
 * Morning roll seeds from checked_in; programme still gated until morning complete.
 */
async function restoreOvernightStartOfDay(opts: {
  sessionId: string;
  eventId: string;
  sessionDate: string;
  managerStaffId: string | null;
  actorStaffId: string;
}): Promise<EventDaySession> {
  const nowIso = operationalNowIso();

  const seeded = await seedEventAttendanceRoll(
    opts.sessionId,
    opts.eventId,
    opts.sessionDate,
  );
  if (seeded <= 0) {
    const { count, error: cntErr } = await supabase
      .from("event_attendance_log")
      .select("id", { count: "exact", head: true })
      .eq("event_day_session_id", opts.sessionId);
    if (cntErr) throw new Error(`attendance count: ${cntErr.message}`);
    if ((count ?? 0) === 0) {
      throw new Error("Overnight reset: no attendance rows to check in (roster empty?).");
    }
  }

  const continuity = await applyOvernightDayStartContinuity({
    sessionId: opts.sessionId,
    eventId: opts.eventId,
    sessionDate: opts.sessionDate,
    actorStaffId: opts.managerStaffId || opts.actorStaffId,
    source: "test_reset",
  });
  if (!continuity.applied && continuity.checkedInCount === 0) {
    const { count } = await supabase
      .from("event_attendance_log")
      .select("id", { count: "exact", head: true })
      .eq("event_day_session_id", opts.sessionId)
      .eq("status", "checked_in");
    if ((count ?? 0) === 0) {
      throw new Error(
        "Overnight reset: check-in wrote 0 rows. Morning Roll will stay empty.",
      );
    }
  }

  const opener = opts.managerStaffId || opts.actorStaffId || null;
  return updateSessionResetPatch(opts.sessionId, {
    phase: "active",
    opened_by_id: opener,
    open_declared_at: nowIso,
    open_leader_notes: "test reset: overnight start of day",
    closed_by_id: null,
    close_declared_at: null,
    close_leader_notes: null,
    expected_arrival_by: null,
    updated_at: nowIso,
  });
}

/**
 * Full ops wipe for one `event_day_sessions` row.
 * Always sets DEV operational clock to the session date at 07:00 (no-op outside test builds).
 */
export async function resetEventDayToStartOfDay(
  sessionId: string,
): Promise<EventDaySession> {
  if (!IS_TEST_BUILD) {
    throw new Error("Reset Start of Day is only available in test builds.");
  }

  const { data: sessionRow, error: sessionErr } = await supabase
    .from("event_day_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) throw sessionErr;
  if (!sessionRow) throw new Error("Trip day session not found.");

  const prior = sessionRow as EventDaySession;
  const eventId = prior.event_id;
  const sessionDate = prior.session_date;
  const actor = await resolveStaffIdWithFallback();
  const overnightDay = await isNonFirstTripDay(eventId, sessionDate);

  const escalationIds = await collectEscalationIssueIds(sessionId);

  if (escalationIds.length > 0) {
    await deleteOrThrow("site_issues (escalation ids)", () =>
      supabase.from("site_issues_register").delete().in("id", escalationIds),
    );
  }
  await deleteOrThrow("site_issues (session)", () =>
    supabase
      .from("site_issues_register")
      .delete()
      .in("event_day_session_id", [sessionId]),
  );

  await deleteOrThrow("event_activity_rolls", () =>
    supabase
      .from("event_activity_rolls")
      .delete()
      .eq("event_day_session_id", sessionId),
  );

  await deleteOrThrow("event_bus_manifest", () =>
    supabase
      .from("event_bus_manifest")
      .delete()
      .eq("event_day_session_id", sessionId),
  );

  const tripIdSet = new Set<string>();
  const { data: bySession, error: bySessionErr } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("event_day_session_id", sessionId);
  if (bySessionErr) throw new Error(`transport_trips (session): ${bySessionErr.message}`);
  for (const r of bySession ?? []) tripIdSet.add((r as { id: string }).id);

  const { data: byDate, error: byDateErr } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("event_id", eventId)
    .eq("trip_date", sessionDate);
  if (byDateErr) throw new Error(`transport_trips (date): ${byDateErr.message}`);
  for (const r of byDate ?? []) tripIdSet.add((r as { id: string }).id);

  const tripIds = [...tripIdSet];
  if (tripIds.length > 0) {
    await deleteOrThrow("transport_trips", () =>
      supabase.from("transport_trips").delete().in("id", tripIds),
    );
  }

  // Manifest walkaround is one-per-vehicle-per-calendar-date. Resetting the
  // trip day without clearing these orphans "already recorded" and blocks
  // re-running the bus to the next hop under the DEV clock.
  await deleteOrThrow("asset_daily_clearance", () =>
    supabase.from("asset_daily_clearance").delete().eq("clearance_date", sessionDate),
  );

  await deleteOrThrow("event_attendance_log", () =>
    supabase
      .from("event_attendance_log")
      .delete()
      .eq("event_day_session_id", sessionId),
  );
  await deleteOrThrow("event_morning_log", () =>
    supabase
      .from("event_morning_log")
      .delete()
      .eq("event_day_session_id", sessionId),
  );
  await deleteOrThrow("event_curfew_log", () =>
    supabase
      .from("event_curfew_log")
      .delete()
      .eq("event_day_session_id", sessionId),
  );

  const { error: stopErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "pending",
      movement_method: "bus",
      opened_at: null,
      closed_at: null,
      opened_by_id: null,
    })
    .eq("event_id", eventId)
    .eq("session_date", sessionDate);
  if (stopErr) throw new Error(`event_venue_stops reset: ${stopErr.message}`);

  // SIM clock first so overnight open / check-in stamps match trip-day morning.
  setOperationalClockOverride({ date: sessionDate, time: START_OF_DAY_CLOCK });

  let next: EventDaySession;
  if (overnightDay) {
    next = await restoreOvernightStartOfDay({
      sessionId,
      eventId,
      sessionDate,
      managerStaffId: prior.manager_staff_id,
      actorStaffId: actor,
    });
  } else {
    next = await updateSessionResetPatch(sessionId, {
      phase: "planning",
      opened_by_id: null,
      open_declared_at: null,
      open_leader_notes: null,
      closed_by_id: null,
      close_declared_at: null,
      close_leader_notes: null,
      expected_arrival_by: null,
      updated_at: new Date().toISOString(),
    });
  }

  await writeToLedger({
    staff_id: actor,
    category: "TRIP",
    severity: "YELLOW",
    action_type: "EVENT_RESET_START_OF_DAY",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      session_id: sessionId,
      event_id: eventId,
      session_date: sessionDate,
      prior_phase: prior.phase,
      trips_deleted: tripIds.length,
      overnight_continuity: overnightDay,
      test_only: true,
      operational_clock: { date: sessionDate, time: START_OF_DAY_CLOCK },
    },
  });

  return next;
}

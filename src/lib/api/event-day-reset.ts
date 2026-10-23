/**
 * Rewind Event Deliver for one trip day, or the whole trip.
 *
 * Keeps the session rows (date, leader, roll times) and the itinerary.
 * Wipes floor ops. Moves the clock to that morning at 07:00 Sydney.
 * While the exercise clock is on, everyone moves with it.
 *
 * One day — Day 1: planning, Open Location + arrival Check-In.
 * One day — Day 2+: overnight continuity so Morning Roll is available.
 * Whole trip: every day back to planning so Day 1 can be run again.
 */
import { supabase } from "@/integrations/supabase/client";
import { clearBusDayClearance } from "@/lib/deliver-offline/bus-day-clearance";
import { clearDeliverDayOnTablet } from "@/lib/deliver-offline/outbox";
import { seedEventAttendanceRoll } from "@/lib/api/event-attendance";
import { applyOvernightDayStartContinuity } from "@/lib/api/event-day-continuity";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { writeToLedger } from "@/lib/api/ledger";
import { withAuditActorMeta } from "@/lib/api/office-change-log";
import { canUseDevTools } from "@/lib/dev-tools-access";
import { getActiveUserProfile, resolveStaffIdWithFallback } from "@/lib/data-store";
import { applyOperationalClock, operationalNowIso } from "@/lib/operational-clock";
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
    programme_suspended: false,
    programme_suspend_reason: null,
    programme_suspend_severity: null,
    programme_suspend_hub_issue_id: null,
    programme_suspended_at: null,
    programme_suspended_by_staff_id: null,
  };
  const first = await supabase
    .from("event_day_sessions")
    .update(withNotes)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (!first.error) return first.data as EventDaySession;

  if (!/column|schema cache|does not exist/i.test(first.error.message)) {
    throw new Error(`event_day_sessions reset: ${first.error.message}`);
  }

  const withDeferOnly = {
    ...patch,
    morning_group_defer_note: null,
    evening_group_defer_note: null,
  };
  const second = await supabase
    .from("event_day_sessions")
    .update(withDeferOnly)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (!second.error) return second.data as EventDaySession;
  if (!/column|schema cache|does not exist/i.test(second.error.message)) {
    throw new Error(`event_day_sessions reset: ${second.error.message}`);
  }

  const third = await supabase
    .from("event_day_sessions")
    .update(patch)
    .eq("id", sessionId)
    .select("*")
    .single();
  if (third.error) throw new Error(`event_day_sessions reset: ${third.error.message}`);
  return third.data as EventDaySession;
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

/** Newer deliver tables may be absent on an older database. */
async function deleteIfPresent(
  label: string,
  run: () => PromiseLike<{ error: { message: string; code?: string } | null }>,
): Promise<void> {
  const { error } = await run();
  if (error && !isSchemaMismatchError(error)) throw new Error(`${label}: ${error.message}`);
}

async function resetVenueStopsToWaiting(eventId: string, sessionDate: string): Promise<void> {
  const { error: stopErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "pending",
      opened_at: null,
      closed_at: null,
      opened_by_id: null,
    })
    .eq("event_id", eventId)
    .eq("session_date", sessionDate);
  if (stopErr) throw new Error(`event_venue_stops reset: ${stopErr.message}`);

  const { error: clearMoveErr } = await supabase
    .from("event_venue_stops")
    .update({ movement_method: null })
    .eq("event_id", eventId)
    .eq("session_date", sessionDate)
    .or("activity_kind.eq.venue,activity_kind.is.null");
  if (clearMoveErr) {
    throw new Error(
      `event_venue_stops clear movement: ${clearMoveErr.message}. Run docs/sql/2026-08-07_venue_stop_movement_ask_other.sql`,
    );
  }
  const { error: onSiteErr } = await supabase
    .from("event_venue_stops")
    .update({ movement_method: "on_site" })
    .eq("event_id", eventId)
    .eq("session_date", sessionDate)
    .in("activity_kind", ["meal", "medication_round"]);
  if (onSiteErr) {
    throw new Error(`event_venue_stops meal/med reset: ${onSiteErr.message}`);
  }
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
  let attendanceCount = seeded;
  if (seeded <= 0) {
    const { count, error: cntErr } = await supabase
      .from("event_attendance_log")
      .select("id", { count: "exact", head: true })
      .eq("event_day_session_id", opts.sessionId);
    if (cntErr) throw new Error(`attendance count: ${cntErr.message}`);
    attendanceCount = count ?? 0;
  }

  // Cancelled bookings are not seeded. Finish the rewind anyway so the
  // confirm window can close. Leave the day unopened until someone is confirmed.
  if (attendanceCount === 0) {
    return updateSessionResetPatch(opts.sessionId, {
      phase: "planning",
      opened_by_id: null,
      open_declared_at: null,
      open_leader_notes: "test reset: no confirmed roster",
      closed_by_id: null,
      close_declared_at: null,
      close_leader_notes: null,
      expected_arrival_by: null,
      updated_at: nowIso,
    });
  }

  await applyOvernightDayStartContinuity({
    sessionId: opts.sessionId,
    eventId: opts.eventId,
    sessionDate: opts.sessionDate,
    actorStaffId: opts.managerStaffId || opts.actorStaffId,
    source: "test_reset",
  });

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

export interface ResetEventDayOptions {
  /** Default true. Whole-trip unwind sets the clock once, then passes false. */
  moveClock?: boolean;
  /** Every day back to planning. Skips Day 2+ overnight check-in. */
  forcePlanning?: boolean;
  /** Skip the per-day ledger row. The whole-trip unwind writes one summary. */
  quiet?: boolean;
}

/**
 * Full ops wipe for one `event_day_sessions` row.
 * Moves the clock to the session date at 07:00 unless `moveClock` is false.
 */
export async function resetEventDayToStartOfDay(
  sessionId: string,
  opts?: ResetEventDayOptions,
): Promise<EventDaySession> {
  if (!canUseDevTools()) {
    throw new Error("Unwind Deliver is only available to Craig on a test build.");
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
  const profile = getActiveUserProfile();
  const actor = profile?.staffId || (await resolveStaffIdWithFallback());
  const overnightDay =
    !opts?.forcePlanning && (await isNonFirstTripDay(eventId, sessionDate));

  if (opts?.moveClock !== false) {
    await applyOperationalClock({ date: sessionDate, time: START_OF_DAY_CLOCK });
  }

  await clearDeliverDayOnTablet(eventId, sessionId);
  await clearBusDayClearance(eventId, sessionDate);

  const escalationIds = await collectEscalationIssueIds(sessionId);
  const issueIds = new Set(escalationIds);
  const { data: sessionIssues, error: issueReadErr } = await supabase
    .from("site_issues_register")
    .select("id")
    .eq("event_day_session_id", sessionId);
  if (issueReadErr) throw new Error(`site_issues (read): ${issueReadErr.message}`);
  for (const row of sessionIssues ?? []) issueIds.add((row as { id: string }).id);

  const { data: emergencies, error: emergencyErr } = await supabase
    .from("operational_emergencies")
    .select("id")
    .eq("event_day_session_id", sessionId);
  if (emergencyErr && !isSchemaMismatchError(emergencyErr)) {
    throw new Error(`operational_emergencies: ${emergencyErr.message}`);
  }
  const emergencyIds = (emergencies ?? []).map((row) => (row as { id: string }).id);
  if (emergencyIds.length > 0) {
    await deleteIfPresent("operational_emergency_muster", () =>
      supabase.from("operational_emergency_muster").delete().in("emergency_id", emergencyIds),
    );
    await deleteIfPresent("operational_emergencies", () =>
      supabase.from("operational_emergencies").delete().in("id", emergencyIds),
    );
  }

  const issueIdList = [...issueIds];
  if (issueIdList.length > 0) {
    await deleteIfPresent("hub_issue_notes", () =>
      supabase
        .from("hub_issue_notes")
        .delete()
        .eq("source", "event")
        .in("source_row_id", issueIdList),
    );
  }

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
    await deleteIfPresent("trip_run_notices", () =>
      supabase.from("trip_run_notices").delete().in("trip_id", tripIds),
    );
    await deleteIfPresent("trip_legs", () =>
      supabase.from("trip_legs").delete().in("trip_id", tripIds),
    );
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
  await deleteOrThrow("event_support_attendance_log", () =>
    supabase
      .from("event_support_attendance_log")
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

  await deleteIfPresent("event_day_med_alternate_plans", () =>
    supabase.from("event_day_med_alternate_plans").delete().eq("event_day_session_id", sessionId),
  );

  const { data: stopRows, error: stopReadErr } = await supabase
    .from("event_venue_stops")
    .select("id")
    .eq("event_id", eventId)
    .eq("session_date", sessionDate);
  if (stopReadErr) throw new Error(`event_venue_stops (read): ${stopReadErr.message}`);
  const stopIds = (stopRows ?? []).map((row) => (row as { id: string }).id);
  if (stopIds.length > 0) {
    await deleteIfPresent("event_meal_service_rolls", () =>
      supabase.from("event_meal_service_rolls").delete().in("venue_stop_id", stopIds),
    );
  }

  const { data: doseRows, error: doseErr } = await supabase
    .from("compliance_audit_logs")
    .select("id")
    .filter("metadata->>event_day_session_id", "eq", sessionId);
  if (doseErr) throw new Error(`medication logs: ${doseErr.message}`);
  const doseIds = (doseRows ?? []).map((row) => (row as { id: string }).id);
  if (doseIds.length > 0) {
    await deleteOrThrow("compliance_audit_logs", () =>
      supabase.from("compliance_audit_logs").delete().in("id", doseIds),
    );
  }

  // Clear runtime; unset movement so Programme asks Bus/Walk/On-site/Other each leave.
  // Meals/meds → on_site. Requires docs/sql/2026-08-07_venue_stop_movement_ask_other.sql
  // (NULL allowed on movement_method).
  await resetVenueStopsToWaiting(eventId, sessionDate);

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
      updated_at: operationalNowIso(),
    });
  }

  await clearDeliverDayOnTablet(eventId, sessionId);
  if (!overnightDay) {
    await resetVenueStopsToWaiting(eventId, sessionDate);
  }

  if (!opts?.quiet) {
    const { repairEventStatusIfDaysStillOpen } = await import("@/lib/api/event-lifecycle");
    await repairEventStatusIfDaysStillOpen(eventId);
    await writeToLedger({
      staff_id: actor,
      category: "TRIP",
      severity: "YELLOW",
      action_type: "EVENT_RESET_START_OF_DAY",
      gps_lat: null,
      gps_lng: null,
      metadata: await withAuditActorMeta({
        session_id: sessionId,
        event_id: eventId,
        session_date: sessionDate,
        prior_phase: prior.phase,
        trips_deleted: tripIds.length,
        overnight_continuity: overnightDay,
        test_only: true,
        operational_clock: { date: sessionDate, time: START_OF_DAY_CLOCK },
        summary: `Reset start of day for trip on ${sessionDate} (cleared ${tripIds.length} trip${tripIds.length === 1 ? "" : "s"}) — deliver rewind`,
      }),
    });
  }

  return next;
}

/**
 * Clear Event Deliver for every day of the trip.
 * Roster, itinerary, leaders, and roll times stay.
 * Every day ends ready to Open location, starting from day 1 at 07:00.
 * A Closed event is set back to Open so Deliver can run.
 */
export async function unwindEventDeliver(eventId: string): Promise<{
  days: number;
  firstDate: string;
  reopened: boolean;
}> {
  if (!canUseDevTools()) {
    throw new Error("Unwind Deliver is only available to Craig on a test build.");
  }

  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("id, session_date")
    .eq("event_id", eventId)
    .order("session_date", { ascending: true });
  if (error) throw new Error(`list trip days: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; session_date: string }>;
  if (rows.length === 0) throw new Error("This event has no trip days.");

  const firstDate = rows[0].session_date;
  await applyOperationalClock({ date: firstDate, time: START_OF_DAY_CLOCK });

  for (const row of rows) {
    await resetEventDayToStartOfDay(row.id, {
      moveClock: false,
      forcePlanning: true,
      quiet: true,
    });
  }

  const { repairEventStatusIfDaysStillOpen } = await import("@/lib/api/event-lifecycle");
  const reopened = (await repairEventStatusIfDaysStillOpen(eventId)) === "Open";

  const profile = getActiveUserProfile();
  const actor = profile?.staffId || (await resolveStaffIdWithFallback());
  await writeToLedger({
    staff_id: actor,
    category: "TRIP",
    severity: "YELLOW",
    action_type: "EVENT_DELIVER_UNWOUND",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      event_id: eventId,
      days: rows.length,
      first_date: firstDate,
      reopened,
      summary: `Unwound Event Deliver for ${rows.length} day${rows.length === 1 ? "" : "s"} starting ${firstDate}. Roster and itinerary kept.`,
    }),
  });

  return { days: rows.length, firstDate, reopened };
}

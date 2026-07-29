/**
 * Day 2+ overnight continuity — group stayed at the hotel; no arrival Check-In.
 *
 * GUARDRAILS §12.13.8: Morning roll is the first accountable step after open.
 * Applies on Open location (production) and Reset Start of Day (test).
 *
 * BL-090 cross-day: prior-day Left trip (floor absent + [LEFT TRIP:…] notes)
 * is carried onto today's attendance as absent before expected→checked_in,
 * so they do not reappear on Morning Roll / Check-Out / Transport HOME.
 */
import { supabase } from "@/integrations/supabase/client";
import { seedEventAttendanceRoll } from "@/lib/api/event-attendance";
import { sessionRequiresMorningRoll } from "@/lib/api/event-deliver-status";
import { resolveOvernightWakeBase } from "@/lib/api/event-deliver-status";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { listEventVenueStops } from "@/lib/api/event-outing";
import { operationalNowIso } from "@/lib/operational-clock";
import { isLeftTripJoiningDay2, isLeftTripNotes } from "@/lib/trip-absent";

export interface OvernightContinuityInput {
  sessionId: string;
  eventId: string;
  sessionDate: string;
  /** Trip leader or actor for check-in / stop open stamps. */
  actorStaffId: string | null;
  /** Ledger metadata tag — e.g. "location_open" vs "test_reset". */
  source: "location_open" | "test_reset" | "reconcile";
}

/**
 * Copy prior calendar day's Left-trip floor absents onto today's session
 * (status=absent + notes). Skips [Joining Day 2]. Idempotent.
 * Also demotes wrongly checked_in rows after a pre-fix open.
 */
export async function carryPriorDayLeftTripAbsences(opts: {
  sessionId: string;
  eventId: string;
  sessionDate: string;
}): Promise<{ carried: number }> {
  const required = await sessionRequiresMorningRoll(opts.eventId, opts.sessionDate);
  if (!required) return { carried: 0 };

  const { data: sessions, error: sessErr } = await supabase
    .from("event_day_sessions")
    .select("id, session_date")
    .eq("event_id", opts.eventId)
    .order("session_date", { ascending: true });
  if (sessErr) throw new Error(`Left-trip carry: sessions ${sessErr.message}`);

  const prior = (sessions ?? [])
    .map((s) => s as { id: string; session_date: string })
    .filter((s) => s.session_date < opts.sessionDate)
    .sort((a, b) => b.session_date.localeCompare(a.session_date))[0];
  if (!prior) return { carried: 0 };

  const { data: priorRows, error: priorErr } = await supabase
    .from("event_attendance_log")
    .select("participant_id, notes, status")
    .eq("event_day_session_id", prior.id)
    .eq("status", "absent");
  if (priorErr) throw new Error(`Left-trip carry: prior absents ${priorErr.message}`);

  const toCarry = (priorRows ?? [])
    .map((r) => r as { participant_id: string; notes: string | null; status: string })
    .filter(
      (r) =>
        isLeftTripNotes(r.notes) && !isLeftTripJoiningDay2(r.notes) && !!r.participant_id,
    );
  if (toCarry.length === 0) return { carried: 0 };

  let carried = 0;
  for (const row of toCarry) {
    const { data: updated, error: updErr } = await supabase
      .from("event_attendance_log")
      .update({
        status: "absent",
        notes: row.notes,
        checked_in_at: null,
        checked_in_by: null,
        checked_out_at: null,
        checked_out_by: null,
      })
      .eq("event_day_session_id", opts.sessionId)
      .eq("participant_id", row.participant_id)
      .in("status", ["expected", "checked_in"])
      .select("id");
    if (updErr) {
      console.error("[carryPriorDayLeftTripAbsences]", updErr);
      continue;
    }
    if ((updated?.length ?? 0) > 0) carried += 1;
  }

  return { carried };
}

/**
 * After attendance is seeded, mark everyone still `expected` as checked in at the
 * overnight base. Activates today's overnight stop when listed on the itinerary.
 */
export async function applyOvernightDayStartContinuity(
  input: OvernightContinuityInput,
): Promise<{ applied: boolean; checkedInCount: number; leftTripCarried: number }> {
  const required = await sessionRequiresMorningRoll(input.eventId, input.sessionDate);
  if (!required) return { applied: false, checkedInCount: 0, leftTripCarried: 0 };

  // Before expected→checked_in: keep prior-day Left trip people as absent.
  const { carried: leftTripCarried } = await carryPriorDayLeftTripAbsences({
    sessionId: input.sessionId,
    eventId: input.eventId,
    sessionDate: input.sessionDate,
  });

  const nowIso = operationalNowIso();
  const checker = input.actorStaffId;

  const { data: checkedInRows, error: checkInErr } = await supabase
    .from("event_attendance_log")
    .update({
      status: "checked_in",
      checked_in_at: nowIso,
      checked_in_by: checker,
      checked_out_at: null,
      checked_out_by: null,
    })
    .eq("event_day_session_id", input.sessionId)
    .eq("status", "expected")
    .select("id, participant_id");
  if (checkInErr) throw new Error(`Overnight continuity check-in: ${checkInErr.message}`);

  const checkedInCount = checkedInRows?.length ?? 0;
  if (checkedInCount === 0) {
    // Already reconciled, or nobody on roster — still report left-trip heal.
    if (leftTripCarried > 0) {
      return { applied: true, checkedInCount: 0, leftTripCarried };
    }
    const { count } = await supabase
      .from("event_attendance_log")
      .select("id", { count: "exact", head: true })
      .eq("event_day_session_id", input.sessionId)
      .eq("status", "checked_in");
    if ((count ?? 0) > 0) return { applied: false, checkedInCount: 0, leftTripCarried: 0 };
    return { applied: false, checkedInCount: 0, leftTripCarried: 0 };
  }

  const allStops = await listEventVenueStops(input.eventId);
  const todayStops = allStops
    .filter((s) => s.session_date === input.sessionDate)
    .sort((a, b) => a.stop_order - b.stop_order);
  const wake = resolveOvernightWakeBase(allStops, input.sessionDate, todayStops);

  if (wake.todayStop?.id) {
    await supabase
      .from("event_venue_stops")
      .update({
        phase: "pending",
        opened_at: null,
        closed_at: null,
        opened_by_id: null,
      })
      .eq("event_id", input.eventId)
      .eq("session_date", input.sessionDate);

    await supabase
      .from("event_venue_stops")
      .update({
        phase: "active",
        movement_method: "bus",
        opened_at: nowIso,
        opened_by_id: checker,
        closed_at: null,
      })
      .eq("id", wake.todayStop.id);
  }

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: checker ?? "",
    category: "CLIENT",
    severity: "GREEN",
    action_type: "EVENT_OVERNIGHT_CONTINUITY_CHECKIN",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: input.sessionId,
      event_id: input.eventId,
      session_date: input.sessionDate,
      overnight_base: wake.label,
      participant_count: checkedInCount,
      left_trip_carried: leftTripCarried,
      source: input.source,
    },
  });

  return { applied: true, checkedInCount, leftTripCarried };
}

/**
 * Heal Day 2+ sessions:
 * 1) Always re-apply prior-day Left trip carry (demotes wrong checked_in).
 * 2) If everyone is still `expected`, run full overnight check-in.
 */
export async function reconcileOvernightAttendanceContinuity(
  input: Omit<OvernightContinuityInput, "source">,
): Promise<boolean> {
  const required = await sessionRequiresMorningRoll(input.eventId, input.sessionDate);
  if (!required) return false;

  const { data: rows, error } = await supabase
    .from("event_attendance_log")
    .select("status")
    .eq("event_day_session_id", input.sessionId);
  if (error) throw error;
  if (!rows?.length) return false;

  const statuses = rows.map((r) => (r as { status: string }).status);
  const allExpected = statuses.every((s) => s === "expected");

  if (allExpected) {
    const result = await applyOvernightDayStartContinuity({
      ...input,
      source: "reconcile",
    });
    return result.applied || result.leftTripCarried > 0;
  }

  // Already opened / continuity applied — still heal Left trip carry for Day N+1.
  const { carried } = await carryPriorDayLeftTripAbsences({
    sessionId: input.sessionId,
    eventId: input.eventId,
    sessionDate: input.sessionDate,
  });
  return carried > 0;
}

/** Seed roster then apply overnight continuity when Day 2+. */
export async function seedAttendanceWithOvernightContinuity(opts: {
  sessionId: string;
  eventId: string;
  sessionDate: string;
  actorStaffId: string | null;
  source: OvernightContinuityInput["source"];
}): Promise<void> {
  await seedEventAttendanceRoll(opts.sessionId, opts.eventId, opts.sessionDate);
  await applyOvernightDayStartContinuity({
    sessionId: opts.sessionId,
    eventId: opts.eventId,
    sessionDate: opts.sessionDate,
    actorStaffId: opts.actorStaffId,
    source: opts.source,
  });
}

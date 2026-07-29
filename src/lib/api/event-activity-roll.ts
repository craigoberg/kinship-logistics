/**
 * Event Deliver Phase B — Activity loop API (GUARDRAILS §12.13 / BL-068)
 *
 * Manages per-stop activity state (open/close) and per-person check-in rolls
 * for non-bus activities (walk, on-site). Bus hops are tracked via §11 Manifest.
 *
 * Tables:
 *   event_venue_stops   — phase / movement_method / opened_at / closed_at
 *   event_activity_rolls — per-person status per stop
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";
import { assertMorningRollCompleteBeforeProgramme } from "@/lib/api/event-deliver-status";
import {
  encodeActivitySkipNotes,
  type ActivitySkipReason,
} from "@/lib/trip-absent";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StopPhase = "pending" | "active" | "completed";
export type MovementMethod = "bus" | "walk" | "on_site";
export type ActivityRollStatus = "expected" | "checked_in" | "absent";

export interface ActivityRollRow {
  id: string;
  venueStopId: string;
  eventDaySessionId: string;
  participantId: string;
  status: ActivityRollStatus;
  checkedInAt: string | null;
  checkedInById: string | null;
  markedAbsentAt: string | null;
  markedAbsentById: string | null;
  /** Activity-skip reason text (`[ACTIVITY SKIP:…]`). Null when left-trip placeholder. */
  notes: string | null;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const activityRollKey = (venueStopId: string) =>
  ["event-activity-roll", venueStopId] as const;

// ─── Expected arrival gate ────────────────────────────────────────────────────

/**
 * Returns the expected_arrival_by timestamp for the given session, or null
 * if it has not been set yet (no venue stop has been opened for this session).
 */
export async function getExpectedArrivalBy(sessionId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("expected_arrival_by")
    .eq("id", sessionId)
    .maybeSingle();
  // Non-fatal: column may not exist yet (migration pending) — degrade gracefully.
  if (error) { console.warn("[getExpectedArrivalBy] non-fatal:", error.message); return null; }
  if (!data || !data.expected_arrival_by) return null;
  return new Date(data.expected_arrival_by as string);
}

/**
 * Persists the expected_arrival_by deadline on the session row.
 * Called automatically when the first venue stop opens (openVenueStop).
 */
export async function setExpectedArrivalBy(
  sessionId: string,
  expectedArrivalBy: Date,
): Promise<void> {
  const { error } = await supabase
    .from("event_day_sessions")
    .update({ expected_arrival_by: expectedArrivalBy.toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

// ─── Fetch activity roll for a stop ──────────────────────────────────────────

/**
 * Ensure floor-absent (left-trip) people appear as read-only Absent placeholders
 * on this activity roll — even when the stop was opened after they left the trip.
 */
export async function ensureActivityRollLeftTripPlaceholders(
  venueStopId: string,
  eventDaySessionId: string,
): Promise<void> {
  const { data: leftTrip, error: attErr } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "absent");
  if (attErr) {
    console.warn("[ensureActivityRollLeftTripPlaceholders] attendance read failed:", attErr.message);
    return;
  }
  if (!leftTrip?.length) return;

  const now = new Date().toISOString();
  const rows = leftTrip.map((r) => ({
    venue_stop_id: venueStopId,
    event_day_session_id: eventDaySessionId,
    participant_id: (r as { participant_id: string }).participant_id,
    status: "absent" as const,
    marked_absent_at: now,
  }));

  // Insert missing only — do not overwrite checked_in / already-seeded rows.
  const { error: seedErr } = await supabase.from("event_activity_rolls").upsert(rows, {
    onConflict: "venue_stop_id,participant_id",
    ignoreDuplicates: true,
  });
  if (seedErr) {
    console.warn("[ensureActivityRollLeftTripPlaceholders] seed failed:", seedErr.message);
  }

  // Promote expected → absent for anyone already on the roll who left the trip.
  const pids = leftTrip.map((r) => (r as { participant_id: string }).participant_id);
  const { error: updErr } = await supabase
    .from("event_activity_rolls")
    .update({ status: "absent", marked_absent_at: now })
    .eq("venue_stop_id", venueStopId)
    .eq("status", "expected")
    .in("participant_id", pids);
  if (updErr) {
    console.warn("[ensureActivityRollLeftTripPlaceholders] promote failed:", updErr.message);
  }
}

export async function listActivityRoll(
  venueStopId: string,
  opts?: { eventDaySessionId?: string },
): Promise<ActivityRollRow[]> {
  if (opts?.eventDaySessionId) {
    await ensureActivityRollLeftTripPlaceholders(venueStopId, opts.eventDaySessionId);
  }

  const { data, error } = await supabase
    .from("event_activity_rolls")
    .select("*")
    .eq("venue_stop_id", venueStopId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toRow);
}

function toRow(r: Record<string, unknown>): ActivityRollRow {
  return {
    id: String(r.id),
    venueStopId: String(r.venue_stop_id),
    eventDaySessionId: String(r.event_day_session_id),
    participantId: String(r.participant_id),
    status: (r.status ?? "expected") as ActivityRollStatus,
    checkedInAt: (r.checked_in_at as string | null) ?? null,
    checkedInById: (r.checked_in_by_id as string | null) ?? null,
    markedAbsentAt: (r.marked_absent_at as string | null) ?? null,
    markedAbsentById: (r.marked_absent_by_id as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

// ─── Open a stop (start activity) ────────────────────────────────────────────
/**
 * Seed the activity roll from all currently checked-in participants in the
 * event_attendance_log for this session, then mark the stop as active.
 *
 * Called by trip leader when starting an activity (walk, on-site).
 * For bus hops, the stop is opened with movement_method='bus' and no roll is seeded.
 */
export async function openVenueStop(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
    movementMethod: MovementMethod;
  },
  eventDaySessionId: string,
): Promise<void> {
  await assertMorningRollCompleteBeforeProgramme({
    eventId: stop.eventId,
    sessionId: eventDaySessionId,
    sessionDate: stop.sessionDate,
  });

  const { getProgrammeSuspend } = await import("@/lib/api/operational-emergency");
  const suspended = await getProgrammeSuspend(eventDaySessionId);
  if (suspended?.active) {
    throw new Error(
      `Programme suspended${suspended.reason ? `: ${suspended.reason}` : ""}. Manager must clear before opening activities.`,
    );
  }

  const staffId = await resolveStaffIdWithFallback();
  const now = new Date().toISOString();

  // 1. Mark stop active
  const { error: phaseErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "active",
      movement_method: stop.movementMethod,
      opened_at: now,
      opened_by_id: staffId || null,
    })
    .eq("id", stop.id);
  if (phaseErr) throw phaseErr;

  // 2. For walk/on-site: seed checked-in as expected + left-trip Absent as placeholders
  if (stop.movementMethod !== "bus") {
    const { data: floor, error: attErr } = await supabase
      .from("event_attendance_log")
      .select("participant_id, status")
      .eq("event_day_session_id", eventDaySessionId)
      .in("status", ["checked_in", "absent"]);
    if (attErr) throw attErr;

    const participants = (floor ?? []).map((r) => {
      const status = (r as { status: string }).status;
      const isAbsent = status === "absent";
      return {
        venue_stop_id: stop.id,
        event_day_session_id: eventDaySessionId,
        participant_id: (r as { participant_id: string }).participant_id,
        status: isAbsent ? ("absent" as const) : ("expected" as const),
        ...(isAbsent ? { marked_absent_at: now } : {}),
      };
    });

    if (participants.length > 0) {
      const { error: seedErr } = await supabase
        .from("event_activity_rolls")
        .upsert(participants, {
          onConflict: "venue_stop_id,participant_id",
          ignoreDuplicates: true,
        });
      if (seedErr) throw seedErr;
    }
  }

  // 3. Auto-set expected_arrival_by on first venue open (if not already set)
  try {
    const existing = await getExpectedArrivalBy(eventDaySessionId);
    if (existing === null) {
      await setExpectedArrivalBy(
        eventDaySessionId,
        new Date(Date.now() + 60 * 60 * 1000),
      );
    }
  } catch {
    // Non-fatal: gate is a soft UX feature; do not block the open flow
  }

  // 4. Ledger entry
  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_OPEN",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      description: `Activity started — ${stop.venueName ?? "stop"} (${stop.movementMethod})`,
      venue_stop_id: stop.id,
      event_id: stop.eventId,
      session_date: stop.sessionDate,
      movement_method: stop.movementMethod,
    },
  });
}

// ─── Close a stop (complete activity) ────────────────────────────────────────

export async function closeVenueStop(
  stop: { id: string; eventId: string; venueName: string | null },
): Promise<void> {
  const staffId = await resolveStaffIdWithFallback();
  const now = new Date().toISOString();

  const prior = await supabase
    .from("event_venue_stops")
    .select("id, activity_kind")
    .eq("id", stop.id)
    .maybeSingle();
  if (prior.error) throw prior.error;
  if ((prior.data as { activity_kind?: string } | null)?.activity_kind === "meal") {
    const { countOutstandingMealServes } = await import(
      "@/lib/api/event-meal-service"
    );
    const outstanding = await countOutstandingMealServes(stop.id);
    if (outstanding > 0) {
      throw new Error(
        `${outstanding} person${outstanding === 1 ? "" : "s"} still expected on the meal roll. Mark Served / Modified / Own order / Declined / N/A before completing.`,
      );
    }
  }

  const { error } = await supabase
    .from("event_venue_stops")
    .update({ phase: "completed", closed_at: now })
    .eq("id", stop.id);
  if (error) throw error;

  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_CLOSE",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      description: `Activity completed — ${stop.venueName ?? "stop"} (group assumed done)`,
      venue_stop_id: stop.id,
      event_id: stop.eventId,
    },
  });
}

// ─── Venue stop count for a session day ──────────────────────────────────────

/**
 * Returns the number of venue stops planned for a given event + session date.
 * Used to guard "Open location" — at least one stop must exist before the
 * event floor can be started.
 */
export async function countTodayVenueStops(
  eventId: string,
  sessionDate: string,
): Promise<number> {
  const { count } = await supabase
    .from("event_venue_stops")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("session_date", sessionDate);
  return count ?? 0;
}

// ─── Toggle individual check-in in activity roll ──────────────────────────────

export async function toggleActivityCheckIn(row: ActivityRollRow): Promise<ActivityRollRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = new Date().toISOString();
  const isIn = row.status === "checked_in";

  const patch = isIn
    ? { status: "expected", checked_in_at: null, checked_in_by_id: null }
    : { status: "checked_in", checked_in_at: now, checked_in_by_id: staffId || null };

  const { data, error } = await supabase
    .from("event_activity_rolls")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;
  return toRow(data as Record<string, unknown>);
}

/**
 * Not at this activity — still on the trip (floor stays checked_in).
 * Does NOT open Hub Left-trip welfare and does NOT remove from hotel rolls.
 */
export async function markActivitySkip(
  row: ActivityRollRow,
  opts: { reason: ActivitySkipReason; note?: string },
): Promise<ActivityRollRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = new Date().toISOString();
  const notes = encodeActivitySkipNotes(opts);

  const patch: Record<string, unknown> = {
    status: "absent",
    marked_absent_at: now,
    marked_absent_by_id: staffId || null,
    checked_in_at: null,
    checked_in_by_id: null,
    notes,
  };

  const { data, error } = await supabase
    .from("event_activity_rolls")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();

  // Pre-migration: notes column missing — retry without notes.
  if (error && /notes|column/i.test(error.message)) {
    const { notes: _n, ...withoutNotes } = patch;
    void _n;
    const retry = await supabase
      .from("event_activity_rolls")
      .update(withoutNotes)
      .eq("id", row.id)
      .select("*")
      .single();
    if (retry.error) throw retry.error;
    return toRow(retry.data as Record<string, unknown>);
  }
  if (error) throw error;

  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_SKIP",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      venue_stop_id: row.venueStopId,
      participant_id: row.participantId,
      reason: opts.reason,
      notes,
    },
  });

  return toRow(data as Record<string, unknown>);
}

/** @deprecated Use markActivitySkip or left-trip dialog. */
export async function markActivityAbsent(row: ActivityRollRow): Promise<ActivityRollRow> {
  return markActivitySkip(row, { reason: "other", note: "Not attending this activity" });
}

/** Restore an activity-skip row to expected (still on trip — no PIN). */
export async function clearActivityAbsent(row: ActivityRollRow): Promise<ActivityRollRow> {
  const patch: Record<string, unknown> = {
    status: "expected",
    marked_absent_at: null,
    marked_absent_by_id: null,
    checked_in_at: null,
    checked_in_by_id: null,
    notes: null,
  };

  const { data, error } = await supabase
    .from("event_activity_rolls")
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single();

  if (error && /notes|column/i.test(error.message)) {
    const { notes: _n, ...withoutNotes } = patch;
    void _n;
    const retry = await supabase
      .from("event_activity_rolls")
      .update(withoutNotes)
      .eq("id", row.id)
      .select("*")
      .single();
    if (retry.error) throw retry.error;
    return toRow(retry.data as Record<string, unknown>);
  }
  if (error) throw error;
  return toRow(data as Record<string, unknown>);
}

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
import { operationalNowIso } from "@/lib/operational-clock";
import {
  encodeActivitySkipNotes,
  type ActivitySkipReason,
} from "@/lib/trip-absent";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StopPhase = "pending" | "active" | "completed";
/** How the group moves TO a venue stop — null/unset until leave-from-current asks. */
export type MovementMethod = "bus" | "walk" | "on_site" | "other";
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

type ActivityRollSeedRow = {
  venue_stop_id: string;
  event_day_session_id: string;
  participant_id: string;
  status: ActivityRollStatus;
  marked_absent_at?: string;
};

function isMissingOnConflictTarget(err: {
  code?: string;
  message?: string;
}): boolean {
  return (
    err.code === "42P10" ||
    /no unique|exclusion constraint matching the ON CONFLICT/i.test(
      err.message ?? "",
    )
  );
}

/** Upsert activity roll rows; insert-missing when UNIQUE is absent (TEST bootstrap). */
export async function upsertActivityRollIgnoreDuplicates(
  rows: ActivityRollSeedRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("event_activity_rolls").upsert(rows, {
    onConflict: "venue_stop_id,participant_id",
    ignoreDuplicates: true,
  });
  if (!error) return;
  if (!isMissingOnConflictTarget(error)) throw error;

  const byStop = new Map<string, ActivityRollSeedRow[]>();
  for (const r of rows) {
    const list = byStop.get(r.venue_stop_id) ?? [];
    list.push(r);
    byStop.set(r.venue_stop_id, list);
  }
  for (const [stopId, stopRows] of byStop) {
    const { data: existing, error: listErr } = await supabase
      .from("event_activity_rolls")
      .select("participant_id")
      .eq("venue_stop_id", stopId);
    if (listErr) throw listErr;
    const have = new Set(
      (existing ?? []).map((r) => (r as { participant_id: string }).participant_id),
    );
    const missing = stopRows.filter((r) => !have.has(r.participant_id));
    if (missing.length === 0) continue;
    const { error: insErr } = await supabase
      .from("event_activity_rolls")
      .insert(missing);
    if (insErr) throw insErr;
  }
}

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

  const now = operationalNowIso();
  const rows = leftTrip.map((r) => ({
    venue_stop_id: venueStopId,
    event_day_session_id: eventDaySessionId,
    participant_id: (r as { participant_id: string }).participant_id,
    status: "absent" as const,
    marked_absent_at: now,
  }));

  // Insert missing only — do not overwrite checked_in / already-seeded rows.
  try {
    await upsertActivityRollIgnoreDuplicates(rows);
  } catch (seedErr) {
    const msg = seedErr instanceof Error ? seedErr.message : String(seedErr);
    console.warn("[ensureActivityRollLeftTripPlaceholders] seed failed:", msg);
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

// ─── Plan leave movement (destination stays pending until confirm) ───────────

const MOVEMENT_PLAN_LABEL: Record<MovementMethod, string> = {
  bus: "Bus",
  walk: "Walk",
  other: "Other",
  on_site: "On-site",
};

/**
 * Trip leader picks how to reach a pending destination. Does **not** open the
 * activity or create a Manifest — confirm (Release / Leave) does that next.
 * Reversible via `clearPlannedVenueMovement` until confirm.
 */
export async function planVenueMovement(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
  },
  method: MovementMethod,
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
      `Programme suspended${suspended.reason ? `: ${suspended.reason}` : ""}. Manager must clear before planning movement.`,
    );
  }

  const { data: row, error: loadErr } = await supabase
    .from("event_venue_stops")
    .select("id, phase, movement_method")
    .eq("id", stop.id)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!row) throw new Error("Venue stop not found.");
  const phase = (row as { phase?: string | null }).phase ?? "pending";
  if (phase !== "pending") {
    throw new Error("Movement is already underway or this stop is open.");
  }
  const current = (row as { movement_method?: string | null }).movement_method;
  if (current === method) return;

  const { error } = await supabase
    .from("event_venue_stops")
    .update({ movement_method: method })
    .eq("id", stop.id)
    .eq("phase", "pending");
  if (error) throw error;

  const staffId = await resolveStaffIdWithFallback();
  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_MOVEMENT_PLANNED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      description: `${MOVEMENT_PLAN_LABEL[method]} movement planned — ${stop.venueName ?? "stop"}`,
      venue_stop_id: stop.id,
      event_id: stop.eventId,
      session_date: stop.sessionDate,
      movement_method: method,
    },
  });
}

/** @deprecated Prefer planVenueMovement(..., "bus") */
export async function planVenueBusMovement(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
  },
  eventDaySessionId: string,
): Promise<void> {
  await planVenueMovement(stop, "bus", eventDaySessionId);
}

/**
 * Undo planned leave method before confirm. Manifest/trip only exists after
 * bus Release — clearing `movement_method` re-opens the picker.
 */
export async function clearPlannedVenueMovement(opts: {
  toStopId: string;
  eventId: string;
  sessionDate: string;
  hopIndex: number;
  eventDaySessionId: string;
  venueName?: string | null;
}): Promise<void> {
  const { listEventTransportRuns } = await import(
    "@/lib/api/event-hop-transport"
  );
  const runs = await listEventTransportRuns({
    eventId: opts.eventId,
    sessionId: opts.eventDaySessionId,
    sessionDate: opts.sessionDate,
  });
  const hop = runs.find(
    (r) => r.kind === "venue_hop" && r.hopIndex === opts.hopIndex,
  );
  if (
    hop?.tripId ||
    hop?.status === "released" ||
    hop?.status === "active" ||
    hop?.status === "completed"
  ) {
    throw new Error(
      "Group already released to the bus — movement can’t be changed.",
    );
  }

  const { data: row, error: loadErr } = await supabase
    .from("event_venue_stops")
    .select("id, phase, movement_method")
    .eq("id", opts.toStopId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!row) throw new Error("Destination stop not found.");
  const phase = (row as { phase?: string | null }).phase ?? "pending";
  const method = (row as { movement_method?: string | null }).movement_method;
  if (phase !== "pending") {
    throw new Error("Destination is already open — can’t change movement.");
  }
  if (!method) return;

  const { error } = await supabase
    .from("event_venue_stops")
    .update({ movement_method: null })
    .eq("id", opts.toStopId)
    .eq("phase", "pending");
  if (error) throw error;

  const staffId = await resolveStaffIdWithFallback();
  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_MOVEMENT_CLEARED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      description: `${MOVEMENT_PLAN_LABEL[method as MovementMethod] ?? "Leave"} cancelled — re-choose how to reach ${opts.venueName ?? "next stop"}`,
      venue_stop_id: opts.toStopId,
      event_id: opts.eventId,
      session_date: opts.sessionDate,
      hop_index: opts.hopIndex,
      cleared_method: method,
    },
  });
}

/** @deprecated Prefer clearPlannedVenueMovement */
export async function clearPlannedVenueBusMovement(
  opts: Parameters<typeof clearPlannedVenueMovement>[0],
): Promise<void> {
  await clearPlannedVenueMovement(opts);
}

// ─── Open a stop (start activity) ────────────────────────────────────────────
/**
 * Seed the activity roll from all currently checked-in participants in the
 * event_attendance_log for this session, then mark the stop as active.
 *
 * Walk / on-site / meal / med: trip leader opens here.
 * Bus hops: do **not** call this — destination opens on hop arrive via
 * `finalizeEventVenueHop` after Release + Manifest.
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
  if (stop.movementMethod === "bus") {
    throw new Error(
      "Bus destinations open when the hop arrives. Choose By Bus, Release group to bus, then complete the Manifest hop.",
    );
  }

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
  const now = operationalNowIso();

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

  // 2. Walk/on-site: seed checked-in as expected + left-trip Absent as placeholders
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
    await upsertActivityRollIgnoreDuplicates(participants);
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

// ─── Leave current venue for next (leave-from-current handoff) ───────────────

export type LeaveVenueResult = {
  mode: "planned";
  method: MovementMethod;
};

/** People still `expected` on the activity check-in roll (blocks leave/complete). */
export async function countOutstandingActivityExpected(
  venueStopId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("event_activity_rolls")
    .select("id", { count: "exact", head: true })
    .eq("venue_stop_id", venueStopId)
    .eq("status", "expected");
  if (error) throw error;
  return count ?? 0;
}

async function assertActivityRollClearToLeave(venueStopId: string): Promise<void> {
  const outstanding = await countOutstandingActivityExpected(venueStopId);
  if (outstanding <= 0) return;
  throw new Error(
    `${outstanding} person${outstanding === 1 ? "" : "s"} still outstanding on the activity check-in. Confirm or mark Not at activity before leaving.`,
  );
}

/**
 * Plan leave method only (all modes). Confirm is separate:
 * - Bus → Release (`prepareEventHopManifest`)
 * - Walk / other / on_site → `confirmNonBusLeave`
 */
export async function leaveVenueForNext(opts: {
  fromStop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
  };
  toStop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
  };
  method: MovementMethod;
  eventDaySessionId: string;
}): Promise<LeaveVenueResult> {
  await assertActivityRollClearToLeave(opts.fromStop.id);
  await planVenueMovement(
    {
      id: opts.toStop.id,
      eventId: opts.toStop.eventId,
      sessionDate: opts.toStop.sessionDate,
      venueName: opts.toStop.venueName,
    },
    opts.method,
    opts.eventDaySessionId,
  );
  return { mode: "planned", method: opts.method };
}

/**
 * Confirm walk / other / on_site leave: open next activity + complete current.
 * Bus confirm is Release → Manifest.
 */
export async function confirmNonBusLeave(opts: {
  fromStop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
  };
  toStop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
  };
  eventDaySessionId: string;
}): Promise<{ openedStopId: string }> {
  await assertActivityRollClearToLeave(opts.fromStop.id);

  const { data: row, error } = await supabase
    .from("event_venue_stops")
    .select("id, phase, movement_method")
    .eq("id", opts.toStop.id)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Destination stop not found.");
  const phase = (row as { phase?: string | null }).phase ?? "pending";
  const method = (row as { movement_method?: string | null })
    .movement_method as MovementMethod | null;
  if (phase !== "pending") {
    throw new Error("Destination is already open or completed.");
  }
  if (!method || method === "bus") {
    throw new Error("Choose Walk, Other, or On-site before confirming leave.");
  }

  await openVenueStop(
    {
      id: opts.toStop.id,
      eventId: opts.toStop.eventId,
      sessionDate: opts.toStop.sessionDate,
      venueName: opts.toStop.venueName,
      movementMethod: method,
    },
    opts.eventDaySessionId,
  );
  await closeVenueStop({
    id: opts.fromStop.id,
    eventId: opts.fromStop.eventId,
    venueName: opts.fromStop.venueName,
    sessionDate: opts.fromStop.sessionDate,
  });
  return { openedStopId: opts.toStop.id };
}

// ─── Close a stop (complete activity) ────────────────────────────────────────

export async function closeVenueStop(
  stop: {
    id: string;
    eventId: string;
    venueName: string | null;
    sessionDate?: string;
  },
): Promise<void> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();

  const prior = await supabase
    .from("event_venue_stops")
    .select("id, activity_kind, session_date, phase")
    .eq("id", stop.id)
    .maybeSingle();
  if (prior.error) throw prior.error;
  const priorRow = prior.data as {
    activity_kind?: string;
    session_date?: string;
    phase?: string | null;
  } | null;
  if (priorRow?.activity_kind === "meal") {
    const { countOutstandingMealServes } = await import(
      "@/lib/api/event-meal-service"
    );
    const outstanding = await countOutstandingMealServes(stop.id);
    if (outstanding > 0) {
      throw new Error(
        `${outstanding} person${outstanding === 1 ? "" : "s"} still expected on the meal roll. Mark Served / Modified / Own order / Declined / N/A before completing.`,
      );
    }
  } else if (
    priorRow?.activity_kind !== "medication_round" &&
    (priorRow?.phase ?? "pending") === "active"
  ) {
    // Walk / other / on-site venue: individual activity check-in required (§12.13).
    // Origin with no seeded roll → count 0 (allowed).
    await assertActivityRollClearToLeave(stop.id);
  }

  // Already completed by hop finalize / Release — idempotent success.
  if ((priorRow?.phase ?? "pending") === "completed") {
    return;
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

/**
 * Undo a premature Complete / Close & leave so activity check-in can finish.
 * If the next venue was opened by that leave and still has no confirmed
 * check-ins, reset it to pending (waiting).
 */
export async function reopenVenueActivityCheckIn(opts: {
  stopId: string;
  eventId: string;
  sessionDate: string;
  nextStopId?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from("event_venue_stops")
    .update({ phase: "active", closed_at: null })
    .eq("id", opts.stopId)
    .eq("phase", "completed");
  if (error) throw error;

  if (!opts.nextStopId) return;

  const { data: next, error: nextErr } = await supabase
    .from("event_venue_stops")
    .select("id, phase, movement_method")
    .eq("id", opts.nextStopId)
    .maybeSingle();
  if (nextErr) throw nextErr;
  const nextRow = next as {
    phase?: string | null;
    movement_method?: string | null;
  } | null;
  if ((nextRow?.phase ?? "pending") !== "active") return;
  if (nextRow?.movement_method === "bus") return;

  const { count: confirmed, error: rollErr } = await supabase
    .from("event_activity_rolls")
    .select("id", { count: "exact", head: true })
    .eq("venue_stop_id", opts.nextStopId)
    .eq("status", "checked_in");
  if (rollErr) throw rollErr;
  if ((confirmed ?? 0) > 0) return;

  const { error: resetErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "pending",
      movement_method: null,
      opened_at: null,
      opened_by_id: null,
      closed_at: null,
    })
    .eq("id", opts.nextStopId);
  if (resetErr) throw resetErr;

  await supabase.from("event_activity_rolls").delete().eq("venue_stop_id", opts.nextStopId);
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
  const now = operationalNowIso();
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
  const now = operationalNowIso();
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

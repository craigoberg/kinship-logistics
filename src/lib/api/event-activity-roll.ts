/**
 * Event Deliver Phase B — Activity loop API (GUARDRAILS §12.13 / BL-068)
 *
 * Manages per-stop activity state (open/close) and per-person check-in rolls
 * for walk, other, and on-site. A bus hop between venues is the leader's
 * headcount on this tablet, then the next place opens. Manifest stays the
 * door runs: to the meeting point, and home from the departure point.
 *
 * Tables:
 *   event_venue_stops   — phase / movement_method / opened_at / closed_at
 *   event_activity_rolls — per-person status per stop
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";
import { withAuditActorMeta } from "@/lib/api/office-change-log";
import { assertMorningRollCompleteBeforeProgramme } from "@/lib/api/event-deliver-status";
import {
  isMealStop,
  isMedicationStop,
  isPassengerStop,
  isSkippedStop,
  withoutSkippedStopNotes,
  withSkippedStopNotes,
} from "@/lib/api/event-outing";
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
    .select("participant_id, notes")
    .eq("event_day_session_id", eventDaySessionId)
    .eq("status", "absent");
  if (attErr) {
    console.warn("[ensureActivityRollLeftTripPlaceholders] attendance read failed:", attErr.message);
    return;
  }
  const leftOnly = (leftTrip ?? []).filter(
    (row) => !String((row as { notes?: string | null }).notes ?? "").startsWith("Not collected"),
  );
  if (!leftOnly.length) return;

  const now = operationalNowIso();
  const rows = leftOnly.map((r) => ({
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
  const pids = leftOnly.map((r) => (r as { participant_id: string }).participant_id);
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
    const where = stop.venueName?.trim() || "This stop";
    throw new Error(
      `Not a connection problem. ${where} is already open or finished, so choosing how to travel there is no longer needed.`,
    );
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
 * Floor Open: the group is ready to head to this stop. Stamps opened_at and
 * leaves phase pending so travel (walk / bus / on site) is asked next.
 * Does not start the activity or meal roll — that happens on arrival.
 * Opening one stop clears a previous "ready" stamp on other pending stops.
 */
export async function declareProgrammeStopOpen(opts: {
  stopId: string;
  eventId: string;
  sessionDate: string;
  venueName: string | null;
  eventDaySessionId: string;
  /** Tap time when this Open was queued offline. */
  occurredAt?: string;
}): Promise<void> {
  await assertMorningRollCompleteBeforeProgramme({
    eventId: opts.eventId,
    sessionId: opts.eventDaySessionId,
    sessionDate: opts.sessionDate,
  });

  const { data: row, error: readErr } = await supabase
    .from("event_venue_stops")
    .select("id, phase, opened_at")
    .eq("id", opts.stopId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) throw new Error("Stop not found.");
  const phase = (row as { phase?: string | null }).phase ?? "pending";
  if (phase !== "pending") {
    throw new Error("This stop is already underway or finished.");
  }
  if ((row as { opened_at?: string | null }).opened_at) return;

  const { data: activeElsewhere, error: activeErr } = await supabase
    .from("event_venue_stops")
    .select("id, label_override")
    .eq("event_id", opts.eventId)
    .eq("session_date", opts.sessionDate)
    .eq("phase", "active")
    .neq("id", opts.stopId)
    .limit(1);
  if (activeErr) throw activeErr;
  const busy = (activeElsewhere ?? [])[0] as
    | { label_override?: string | null }
    | undefined;
  if (busy) {
    throw new Error(
      `Finish ${busy.label_override?.trim() || "the current activity"} before opening the next one.`,
    );
  }

  const { error: clearErr } = await supabase
    .from("event_venue_stops")
    .update({
      opened_at: null,
      opened_by_id: null,
      movement_method: null,
    })
    .eq("event_id", opts.eventId)
    .eq("session_date", opts.sessionDate)
    .eq("phase", "pending")
    .neq("id", opts.stopId)
    .not("opened_at", "is", null);
  if (clearErr) throw clearErr;

  const staffId = await resolveStaffIdWithFallback();
  const now = opts.occurredAt ?? operationalNowIso();
  const { error } = await supabase
    .from("event_venue_stops")
    .update({
      opened_at: now,
      opened_by_id: staffId || null,
    })
    .eq("id", opts.stopId)
    .eq("phase", "pending");
  if (error) throw error;

  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_OPEN",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      description: `Opened ${opts.venueName ?? "stop"} — ready to travel`,
      summary: `Opened ${opts.venueName ?? "stop"} — ready to travel`,
      venue_stop_id: opts.stopId,
      event_id: opts.eventId,
      session_date: opts.sessionDate,
      declare_ready: true,
      location: opts.venueName ?? "trip",
    }),
  });
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

  const { data: existingOpen } = await supabase
    .from("event_venue_stops")
    .select("opened_at, opened_by_id")
    .eq("id", stop.id)
    .maybeSingle();
  const already = existingOpen as {
    opened_at?: string | null;
    opened_by_id?: string | null;
  } | null;

  // 1. Mark stop active. Keep the earlier "ready to go" stamp if Open already ran.
  const { error: phaseErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "active",
      movement_method: stop.movementMethod,
      opened_at: already?.opened_at ?? now,
      opened_by_id: already?.opened_by_id ?? staffId ?? null,
    })
    .eq("id", stop.id);
  if (phaseErr) throw phaseErr;

  const { data: kindRow, error: kindErr } = await supabase
    .from("event_venue_stops")
    .select("activity_kind")
    .eq("id", stop.id)
    .maybeSingle();
  if (kindErr) throw kindErr;
  const activityKind =
    (kindRow as { activity_kind?: string | null } | null)?.activity_kind ??
    "venue";
  // Meals and medication rounds keep their own rolls. An activity check-in
  // list on those stops blocks the next hop after the meal is already done.
  if (activityKind === "meal" || activityKind === "medication_round") {
    void writeActivityOpenedLedger(stop, staffId);
    return;
  }

  // 2. Walk/on-site: seed checked-in as expected + left-trip Absent as placeholders
  const { data: floor, error: attErr } = await supabase
    .from("event_attendance_log")
    .select("participant_id, status, notes")
    .eq("event_day_session_id", eventDaySessionId)
    .in("status", ["checked_in", "absent"]);
  if (attErr) throw attErr;

  const onThisStop = (floor ?? []).filter((r) => {
    const row = r as { status: string; notes?: string | null };
    return !(row.status === "absent" && String(row.notes ?? "").startsWith("Not collected"));
  });
  const participants = onThisStop.map((r) => {
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
  void writeActivityOpenedLedger(stop, staffId);
}

async function writeActivityOpenedLedger(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
    movementMethod: MovementMethod;
  },
  staffId: string,
) {
  void writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "ACTIVITY_OPEN",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      description: `Activity started — ${stop.venueName ?? "stop"} (${stop.movementMethod})`,
      summary: `Started trip activity ${stop.venueName ?? "stop"} (${String(stop.movementMethod ?? "").replace(/_/g, " ")})`,
      venue_stop_id: stop.id,
      event_id: stop.eventId,
      session_date: stop.sessionDate,
      movement_method: stop.movementMethod,
      location: stop.venueName ?? "trip",
    }),
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

/**
 * Activity check-in blocks leave only while a venue activity is still open.
 * A finished stop, a meal, or a medication round uses its own completion check.
 */
export async function assertActivityRollClearToLeave(venueStopId: string): Promise<void> {
  const { data, error } = await supabase
    .from("event_venue_stops")
    .select("phase, activity_kind, label_override, venues(name)")
    .eq("id", venueStopId)
    .maybeSingle();
  if (error) throw error;
  const row = data as {
    phase?: string | null;
    activity_kind?: string | null;
    label_override?: string | null;
    venues?: { name?: string | null } | null;
  } | null;
  const kind = row?.activity_kind ?? "venue";
  const phase = row?.phase ?? "pending";
  if (kind === "meal" || kind === "medication_round" || phase !== "active") return;

  const outstanding = await countOutstandingActivityExpected(venueStopId);
  if (outstanding <= 0) return;
  const label =
    row?.label_override?.trim() ||
    row?.venues?.name?.trim() ||
    "this activity";
  const people =
    outstanding === 1 ? "1 person is" : `${outstanding} people are`;
  throw new Error(
    `Not a connection problem. Leaving ${label} is held because the server still has that activity open, and ${people} still expected on the ${label} check-in. The list on screen can show a later activity already confirmed. Open ${label} and confirm each person, or mark Not at activity.`,
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
 * A bus hop uses `confirmBusLeave` (headcount on this tablet, then the same open).
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

export type HopHeadcountMark = {
  key: string;
  name: string;
  participantId: string | null;
  staffId: string | null;
  carerId: string | null;
  mark: "on_bus" | "not_travelling";
};

/** Open the next place after the leader's bus headcount. No Manifest hop and no kilometres. */
async function openArrivedByBus(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
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

  const { data: existing, error } = await supabase
    .from("event_venue_stops")
    .select("id, phase, opened_at, opened_by_id")
    .eq("id", stop.id)
    .maybeSingle();
  if (error) throw error;
  if (!existing) throw new Error("Destination stop not found.");
  const phase = (existing as { phase?: string | null }).phase ?? "pending";
  if (phase !== "pending") {
    throw new Error("Destination is already open or completed.");
  }
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();
  const openedAt = (existing as { opened_at?: string | null }).opened_at ?? now;
  const openedBy = (existing as { opened_by_id?: string | null }).opened_by_id ?? staffId ?? null;
  const { error: updErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "active",
      movement_method: "bus",
      opened_at: openedAt,
      opened_by_id: openedBy,
    })
    .eq("id", stop.id);
  if (updErr) throw updErr;
}

/**
 * Leader bus hop: everyone still with the group is on the bus or not travelling.
 * Not travelling does not take them off the trip. Then the next place opens.
 */
export async function confirmBusLeave(opts: {
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
  marks: HopHeadcountMark[];
}): Promise<{ openedStopId: string }> {
  await assertActivityRollClearToLeave(opts.fromStop.id);

  const { data: attendance, error: attErr } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("status", "checked_in");
  if (attErr) throw attErr;

  const supportResult = await supabase
    .from("event_support_attendance_log")
    .select("staff_id, carer_id")
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("status", "checked_in");
  if (supportResult.error && !/schema|column|relation/i.test(supportResult.error.message)) {
    throw supportResult.error;
  }

  const needed = new Set<string>();
  for (const row of attendance ?? []) {
    const id = (row as { participant_id: string }).participant_id;
    if (id) needed.add(`p:${id}`);
  }
  for (const row of supportResult.data ?? []) {
    const staffId = (row as { staff_id?: string | null }).staff_id;
    const carerId = (row as { carer_id?: string | null }).carer_id;
    if (staffId) needed.add(`s:${staffId}`);
    else if (carerId) needed.add(`c:${carerId}`);
  }

  const marked = new Map(opts.marks.map((mark) => [mark.key, mark]));
  const missing = [...needed].filter((key) => {
    const mark = marked.get(key)?.mark;
    return mark !== "on_bus" && mark !== "not_travelling";
  });
  if (needed.size === 0) {
    throw new Error("No one is checked in yet.");
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} still to mark on the bus or not travelling.`,
    );
  }

  await openArrivedByBus(opts.toStop, opts.eventDaySessionId);
  await closeVenueStop({
    id: opts.fromStop.id,
    eventId: opts.fromStop.eventId,
    venueName: opts.fromStop.venueName,
    sessionDate: opts.fromStop.sessionDate,
  });

  const staffId = await resolveStaffIdWithFallback();
  const from = opts.fromStop.venueName?.trim() || "here";
  const to = opts.toStop.venueName?.trim() || "the next place";
  for (const key of needed) {
    const mark = marked.get(key)!;
    const onBus = mark.mark === "on_bus";
    try {
      await writeToLedger({
        staff_id: staffId,
        category: "TRIP",
        severity: "GREEN",
        action_type: onBus ? "EVENT_HOP_ON_BUS" : "EVENT_HOP_NOT_TRAVELLING",
        gps_lat: null,
        gps_lng: null,
        metadata: await withAuditActorMeta({
          person_name: mark.name,
          participant_id: mark.participantId,
          staff_id: mark.staffId,
          carer_id: mark.carerId,
          location: `${from} to ${to}`,
          summary: onBus
            ? `${mark.name} on the bus from ${from} to ${to}`
            : `${mark.name} not travelling from ${from} to ${to} — still on the trip`,
        }),
      });
    } catch (err) {
      console.warn("[confirmBusLeave] headcount receipt failed:", err);
    }
  }

  return { openedStopId: opts.toStop.id };
}

/** Leave this place unrun. It drops off the available list and does not block Evening Roll. */
export async function skipVenueStop(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
}): Promise<void> {
  const { data, error } = await supabase
    .from("event_venue_stops")
    .select("phase, activity_kind, notes")
    .eq("id", stop.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That activity is not on the programme.");
  const row = data as { phase?: string | null; activity_kind?: string | null; notes?: string | null };
  if (isMealStop(row) || isMedicationStop(row) || isPassengerStop(row)) {
    throw new Error("Skip a place. Meals, medication, and pickups stay on their day.");
  }
  if ((row.phase ?? "pending") === "active") {
    throw new Error("Close this activity before skipping it.");
  }
  if ((row.phase ?? "pending") === "completed" && !isSkippedStop(row)) {
    throw new Error("This activity is already done.");
  }
  const now = operationalNowIso();
  const { error: updErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "completed",
      closed_at: now,
      notes: withSkippedStopNotes(row.notes),
    })
    .eq("id", stop.id);
  if (updErr) throw updErr;
  const staffId = await resolveStaffIdWithFallback();
  const name = stop.venueName?.trim() || "activity";
  try {
    await writeToLedger({
      staff_id: staffId,
      category: "TRIP",
      severity: "INFO",
      action_type: "ACTIVITY_SKIPPED",
      gps_lat: null,
      gps_lng: null,
      metadata: await withAuditActorMeta({
        venue_stop_id: stop.id,
        event_id: stop.eventId,
        location: name,
        summary: `Skipped ${name} — not running`,
      }),
    });
  } catch (err) {
    console.warn("[skipVenueStop] receipt failed:", err);
  }
}

/**
 * Take an Active or Done activity back to waiting.
 * Check-in ticks for this visit are cleared so Open can run it again.
 * Meals already served and doses already given stay on the record.
 */
export async function undoOpenVenueStop(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
}): Promise<void> {
  const { data, error } = await supabase
    .from("event_venue_stops")
    .select("phase, notes")
    .eq("id", stop.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That activity is not on the programme.");
  const row = data as { phase?: string | null; notes?: string | null };
  if (isSkippedStop(row)) {
    throw new Error("This was skipped. Undo the skip.");
  }
  const phase = row.phase ?? "pending";
  if (phase !== "active" && phase !== "completed") return;

  const { error: updErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "pending",
      opened_at: null,
      opened_by_id: null,
      closed_at: null,
      movement_method: null,
    })
    .eq("id", stop.id);
  if (updErr) throw updErr;

  const { error: rollErr } = await supabase
    .from("event_activity_rolls")
    .delete()
    .eq("venue_stop_id", stop.id);
  if (rollErr) throw rollErr;

  const staffId = await resolveStaffIdWithFallback();
  const name = stop.venueName?.trim() || "activity";
  try {
    await writeToLedger({
      staff_id: staffId,
      category: "TRIP",
      severity: "INFO",
      action_type: "ACTIVITY_OPEN_UNDONE",
      gps_lat: null,
      gps_lng: null,
      metadata: await withAuditActorMeta({
        venue_stop_id: stop.id,
        event_id: stop.eventId,
        location: name,
        summary: `Undid opening ${name} — back to waiting`,
      }),
    });
  } catch (err) {
    console.warn("[undoOpenVenueStop] receipt failed:", err);
  }
}

/** Put a skipped place back on the programme. A place that was run stays done. */
export async function undoSkipVenueStop(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
}): Promise<void> {
  const { data, error } = await supabase
    .from("event_venue_stops")
    .select("notes")
    .eq("id", stop.id)
    .maybeSingle();
  if (error) throw error;
  const notes = (data as { notes?: string | null } | null)?.notes;
  if (!isSkippedStop({ notes })) {
    throw new Error("This activity was run. It is not a skip.");
  }
  const { error: updErr } = await supabase
    .from("event_venue_stops")
    .update({
      phase: "pending",
      closed_at: null,
      opened_at: null,
      movement_method: null,
      notes: withoutSkippedStopNotes(notes),
    })
    .eq("id", stop.id);
  if (updErr) throw updErr;
  const staffId = await resolveStaffIdWithFallback();
  const name = stop.venueName?.trim() || "activity";
  try {
    await writeToLedger({
      staff_id: staffId,
      category: "TRIP",
      severity: "INFO",
      action_type: "ACTIVITY_SKIP_UNDONE",
      gps_lat: null,
      gps_lng: null,
      metadata: await withAuditActorMeta({
        venue_stop_id: stop.id,
        event_id: stop.eventId,
        location: name,
        summary: `Put ${name} back on the programme`,
      }),
    });
  } catch (err) {
    console.warn("[undoSkipVenueStop] receipt failed:", err);
  }
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
    metadata: await withAuditActorMeta({
      description: `Activity completed — ${stop.venueName ?? "stop"} (group assumed done)`,
      summary: `Completed trip activity ${stop.venueName ?? "stop"} (group assumed done)`,
      venue_stop_id: stop.id,
      event_id: stop.eventId,
      location: stop.venueName ?? "trip",
    }),
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

export async function toggleActivityCheckIn(
  row: ActivityRollRow,
  occurredAt?: string,
): Promise<ActivityRollRow> {
  const staffId = await resolveStaffIdWithFallback();
  const now = occurredAt ?? operationalNowIso();
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
      event_day_session_id: row.eventDaySessionId,
      participant_id: row.participantId,
      reason: opts.reason,
      notes,
      why: opts.reason.replace(/_/g, " "),
      location: "trip",
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

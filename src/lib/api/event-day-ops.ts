/**
 * event-day-ops.ts — Phase 3 live accountability (GUARDRAILS §12.4–§12.5)
 *
 * Three interlinked engines:
 *   A) Bus check-on roll — event_bus_manifest, per hop/trip
 *   B) Curfew accountability sweep — event_curfew_log, YELLOW→RED+SMS
 *   C) Morning roll accountability sweep — event_morning_log, same pattern
 *
 * All three mirror the Day Centre single-rail escalator in client-attendance.ts.
 * GUARDRAILS §1.1: ledger write MUST precede any RED insert/promote; abort if
 * the ledger write fails so no un-vouched RED row appears in site_issues_register.
 */

import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger, writeToLedgerOrThrow } from "@/lib/api/ledger";
import { operationalNowIso, operationalNowMs } from "@/lib/operational-clock";
import { sydneyWallClockToUtcDate } from "@/lib/operational-time";
import { listEventVenueStops } from "@/lib/api/event-outing";
import { formatDate, formatTime } from "@/lib/utils";
import { syncFloorAttendanceLeftTrip } from "@/lib/api/event-attendance";
import { listReturnHomeBusEligibleParticipantIds } from "@/lib/api/event-transport";
import { matchesEventBusRun } from "@/lib/event-bus-runs";
import {
  encodeLeftTripNotes,
  leftTripHubDescription,
  type LeftTripDisposition,
} from "@/lib/trip-absent";
import { compareBySurname } from "@/lib/ui/sort-participants";

/** Hub attribution for automated roll sweeps (reported_by is text after migration). */
export const SYSTEM_ISSUE_REPORTER = "System";

interface RollHubContext {
  eventId: string;
  sessionDate: string;
  eventTitle: string;
  dayLabel: string;
  tripContext: string;
}

async function loadRollHubContext(sessionId: string): Promise<RollHubContext | null> {
  const { data: session, error } = await supabase
    .from("event_day_sessions")
    .select("event_id, session_date")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !session) return null;

  const eventId = String((session as { event_id: string }).event_id);
  const sessionDate = String((session as { session_date: string }).session_date);

  const [{ data: ev }, { data: days }] = await Promise.all([
    supabase.from("event_manifest").select("title").eq("id", eventId).maybeSingle(),
    supabase
      .from("event_day_sessions")
      .select("session_date")
      .eq("event_id", eventId)
      .order("session_date", { ascending: true }),
  ]);

  const eventTitle =
    String((ev as { title?: string } | null)?.title ?? "").trim() || "Trip";
  const dates = (days ?? []).map((d) => (d as { session_date: string }).session_date);
  const dayNum = dates.indexOf(sessionDate) + 1;
  const dayLabel =
    dates.length > 1 && dayNum > 0
      ? `Day ${dayNum} of ${dates.length}`
      : formatDate(sessionDate);
  const tripContext = `${eventTitle} · ${dayLabel} (${formatDate(sessionDate)})`;

  return { eventId, sessionDate, eventTitle, dayLabel, tripContext };
}

// ============================================================================
// Shared types
// ============================================================================

export type BusManifestStatus = "expected" | "on_bus" | "not_travelling";
export type AccountabilityStatus = "expected" | "accounted" | "absent";
export type EscalationSeverity = "yellow" | "red";

// ============================================================================
// A — Bus check-on roll (event_bus_manifest)
// ============================================================================

export interface EventBusManifestRow {
  id: string;
  event_day_session_id: string;
  transport_trip_id: string;
  participant_id: string | null;
  staff_id?: string | null;
  carer_id: string | null;
  expected_on_bus: boolean;
  status: BusManifestStatus;
  checked_on_at: string | null;
  checked_on_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined: participant name. */
  participant_name?: string | null;
}

/** Get (or create) a transport_trips row for a specific event hop. */
export async function getOrCreateEventHopTrip(opts: {
  eventId: string;
  eventDaySessionId: string;
  sessionDate: string;
  fromStopId: string | null;
  toStopId: string | null;
  hopIndex: number;
}): Promise<string> {
  // Look for an existing trip with this event_day_session_id + hop_index.
  const { data: existing } = await supabase
    .from("transport_trips")
    .select("id")
    .eq("event_day_session_id", opts.eventDaySessionId)
    .eq("hop_index", opts.hopIndex)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  // Create a minimal planning-phase trip row.
  // TEST bootstrap: trip_origin / trip_return NOT NULL without DEFAULT.
  const { data, error } = await supabase
    .from("transport_trips")
    .insert({
      event_id: opts.eventId,
      event_day_session_id: opts.eventDaySessionId,
      trip_kind: "event_venue_hop",
      venue_stop_from_id: opts.fromStopId,
      venue_stop_to_id: opts.toStopId,
      hop_index: opts.hopIndex,
      trip_date: opts.sessionDate,
      start_odometer: 0,
      start_odometer_km: 0,
      status: "planned",
      started_at: new Date(opts.sessionDate + "T00:00:00").toISOString(),
      trip_origin: "depot",
      trip_return: "none",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create hop trip: ${error.message}`);
  return (data as { id: string }).id;
}

function isDuplicateKeyError(error: { code?: string }): boolean {
  return error.code === "23505";
}

interface BusSeedBooking {
  participant_id: string;
  carer_id?: string | null;
  brings_carer?: boolean;
  carer_transport_required?: boolean;
  outbound_transport_mode?: string | null;
  return_transport_mode?: string | null;
  outbound_bus_run_code?: string | null;
  return_bus_run_code?: string | null;
}

function rosterBookingOnBus(b: BusSeedBooking, direction: "outbound" | "return"): boolean {
  if (direction === "outbound") return (b.outbound_transport_mode ?? "bus") === "bus";
  return (b.return_transport_mode ?? "bus") === "bus";
}

async function fetchBusSeedBookings(eventId: string): Promise<BusSeedBooking[]> {
  const withModes =
    "participant_id, carer_id, brings_carer, carer_transport_required, outbound_transport_mode, return_transport_mode, outbound_bus_run_code, return_bus_run_code";
  const withModesNoRun =
    "participant_id, carer_id, brings_carer, carer_transport_required, outbound_transport_mode, return_transport_mode";
  const basic = "participant_id, carer_id, brings_carer, carer_transport_required";

  let result = await supabase
    .from("event_roster_bookings")
    .select(withModes)
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");

  if (result.error) {
    result = await supabase
      .from("event_roster_bookings")
      .select(withModesNoRun)
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
  }
  if (result.error) {
    result = await supabase
      .from("event_roster_bookings")
      .select(basic)
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
    if (result.error) throw result.error;
    return (result.data ?? []).map((b) => ({
      ...(b as BusSeedBooking),
      outbound_transport_mode: null,
      return_transport_mode: null,
      outbound_bus_run_code: null,
      return_bus_run_code: null,
    }));
  }
  return (result.data ?? []) as BusSeedBooking[];
}

async function insertBusManifestRows(rows: Record<string, unknown>[]): Promise<void> {
  const participantRows = rows.filter((r) => r.participant_id != null);
  const carerRows = rows.filter((r) => r.carer_id != null && r.participant_id == null);
  const staffRows = rows.filter((r) => r.staff_id != null && r.participant_id == null && r.carer_id == null);

  if (participantRows.length) {
    const { error } = await supabase.from("event_bus_manifest").insert(participantRows);
    if (error && !isDuplicateKeyError(error)) throw error;
  }
  if (carerRows.length) {
    const { error } = await supabase.from("event_bus_manifest").insert(carerRows);
    if (error && !isDuplicateKeyError(error)) throw error;
  }
  if (staffRows.length) {
    const { error } = await supabase.from("event_bus_manifest").insert(staffRows);
    if (error && !isDuplicateKeyError(error)) throw error;
  }
}

export async function listBusManifest(tripId: string): Promise<EventBusManifestRow[]> {
  const { data, error } = await supabase
    .from("event_bus_manifest")
    .select("*")
    .eq("transport_trip_id", tripId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!data?.length) return [];

  const participantIds = [
    ...new Set(
      data
        .map((r) => (r as { participant_id?: string | null }).participant_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const carerIds = [
    ...new Set(
      data
        .map((r) => (r as { carer_id?: string | null }).carer_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const staffIds = [
    ...new Set(
      data
        .map((r) => (r as { staff_id?: string | null }).staff_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const nameById: Record<string, string> = {};
  const surnameById = new Map<
    string,
    { firstName?: string; lastName?: string; id: string }
  >();
  if (participantIds.length) {
    const { data: parts, error: pErr } = await supabase
      .from("participants")
      .select("id, first_name, last_name")
      .in("id", participantIds);
    if (pErr) throw pErr;
    for (const p of parts ?? []) {
      const row = p as { id: string; first_name?: string; last_name?: string };
      nameById[row.id] = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
      surnameById.set(row.id, {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
      });
    }
  }
  if (carerIds.length) {
    const { data: carers } = await supabase
      .from("carers_registry")
      .select("id, full_name")
      .in("id", carerIds);
    for (const c of carers ?? []) {
      const row = c as { id: string; full_name: string };
      nameById[`c:${row.id}`] = row.full_name;
    }
  }
  if (staffIds.length) {
    const { data: staff } = await supabase
      .from("staff_registry")
      .select("id, full_name")
      .in("id", staffIds);
    for (const s of staff ?? []) {
      const row = s as { id: string; full_name: string };
      nameById[`s:${row.id}`] = row.full_name;
    }
  }

  // Surname A–Z — on_bus / not_travelling must not reorder the boarding list.
  return data
    .map((r) => {
      const row = r as EventBusManifestRow;
      return {
        ...row,
        participant_name: row.participant_id
          ? nameById[row.participant_id] || null
          : row.carer_id
            ? nameById[`c:${row.carer_id}`] || null
            : row.staff_id
              ? nameById[`s:${row.staff_id}`] || null
              : null,
      };
    })
    .sort((a, b) =>
      compareBySurname(
        {
          ...(a.participant_id
            ? surnameById.get(a.participant_id)
            : undefined),
          id: a.participant_id ?? a.id,
        },
        {
          ...(b.participant_id
            ? surnameById.get(b.participant_id)
            : undefined),
          id: b.participant_id ?? b.id,
        },
      ),
    );
}

/** Seed bus manifest for a trip from the event roster (or arrival roll fallback). */
export async function seedBusManifest(opts: {
  eventId: string;
  eventDaySessionId: string;
  tripId: string;
  /** 'outbound' or 'return' determines which transport_mode column we filter on. */
  direction: "outbound" | "return";
}): Promise<number> {
  const bookingsRaw = await fetchBusSeedBookings(opts.eventId);

  let bookings = bookingsRaw.filter((b) => rosterBookingOnBus(b, opts.direction));

  // Return / outbound multi-bus: filter to this trip's bus_run_code (BL-069).
  const { data: tripRow } = await supabase
    .from("transport_trips")
    .select("bus_run_code")
    .eq("id", opts.tripId)
    .maybeSingle();
  const tripRunCode =
    ((tripRow as { bus_run_code?: string | null } | null)?.bus_run_code ?? "").trim() ||
    null;

  if (bookings.length > 0) {
    bookings = bookings.filter((b) => {
      const code =
        opts.direction === "return"
          ? b.return_bus_run_code
          : b.outbound_bus_run_code;
      return matchesEventBusRun(code, tripRunCode);
    });
  }

  // Return home: drop Left-trip / absent / self — floor attendance wins over roster.
  if (opts.direction === "return" && bookings.length > 0) {
    const eligible = await listReturnHomeBusEligibleParticipantIds(
      opts.eventDaySessionId,
    );
    if (eligible) {
      bookings = bookings.filter((b) => eligible.ids.has(b.participant_id));
    }
  }

  // Fallback: arrival roll for this trip day (leader may have opened location already).
  if (bookingsRaw.length === 0) {
    const { data: attendance, error: attErr } = await supabase
      .from("event_attendance_log")
      .select("participant_id, arrival_method, status")
      .eq("event_day_session_id", opts.eventDaySessionId)
      .in("status", ["expected", "checked_in"]);
    if (attErr) throw attErr;

    bookings = (attendance ?? [])
      .filter((row) => {
        const r = row as { arrival_method?: string };
        return r.arrival_method === "bus" || r.arrival_method === "other";
      })
      .map((row) => {
        const r = row as { participant_id: string };
        return {
          participant_id: r.participant_id,
          carer_id: null,
          brings_carer: false,
          carer_transport_required: false,
          outbound_transport_mode: "bus" as const,
          return_transport_mode: "bus" as const,
        };
      });
  }

  const rows: Record<string, unknown>[] = [];
  for (const bk of bookings) {
    rows.push({
      event_day_session_id: opts.eventDaySessionId,
      transport_trip_id: opts.tripId,
      participant_id: bk.participant_id,
      carer_id: null,
      expected_on_bus: true,
      status: "expected",
    });
    if (bk.brings_carer && bk.carer_transport_required && bk.carer_id) {
      rows.push({
        event_day_session_id: opts.eventDaySessionId,
        transport_trip_id: opts.tripId,
        participant_id: null,
        carer_id: bk.carer_id,
        expected_on_bus: true,
        status: "expected",
      });
    }
  }
  try {
    const { listEventSupportBookings } = await import("@/lib/api/event-support");
    const support = await listEventSupportBookings(opts.eventId);
    for (const s of support.filter((b) => b.bookingStatus !== "Cancelled")) {
      const onBus =
        opts.direction === "outbound"
          ? s.outboundTransportMode === "bus"
          : s.returnTransportMode === "bus";
      if (!onBus) continue;
      rows.push({
        event_day_session_id: opts.eventDaySessionId,
        transport_trip_id: opts.tripId,
        participant_id: null,
        staff_id: s.staffId,
        carer_id: s.carerId,
        expected_on_bus: true,
        status: "expected",
      });
    }
  } catch {
    /* BL-125 table not migrated yet */
  }
  if (!rows.length) return 0;

  await insertBusManifestRows(rows);

  const manifest = await listBusManifest(opts.tripId);
  return manifest.length;
}

export async function markOnBus(row: EventBusManifestRow): Promise<EventBusManifestRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  const next: BusManifestStatus = row.status === "on_bus" ? "expected" : "on_bus";

  const { data, error } = await supabase
    .from("event_bus_manifest")
    .update({
      status: next,
      checked_on_at: next === "on_bus" ? nowIso : null,
      checked_on_by: next === "on_bus" ? staffId : null,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: next === "on_bus" ? "BUS_CHECKON_CONFIRMED" : "BUS_CHECKON_UNDO",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      manifest_id: row.id,
      trip_id: row.transport_trip_id,
      participant_id: row.participant_id,
      carer_id: row.carer_id,
    },
  });
  return data as EventBusManifestRow;
}

export async function markNotTravelling(
  row: EventBusManifestRow,
  notes: string,
): Promise<EventBusManifestRow> {
  const staffId = await resolveStaffIdWithFallback();
  const { data, error } = await supabase
    .from("event_bus_manifest")
    .update({ status: "not_travelling", notes })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw error;

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "YELLOW",
    action_type: "BUS_CHECKON_NOT_TRAVELLING",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      manifest_id: row.id,
      trip_id: row.transport_trip_id,
      participant_id: row.participant_id,
      notes,
    },
  });
  return data as EventBusManifestRow;
}

// ============================================================================
// B + C — Shared curfew/morning accountability engine
// ============================================================================

type LogTable = "event_curfew_log" | "event_morning_log";

export interface EventAccountabilityRow {
  id: string;
  event_day_session_id: string;
  participant_id: string;
  staff_id?: string | null;
  carer_id?: string | null;
  expected_accounted_at: string;
  accounted_at: string | null;
  accounted_by: string | null;
  status: AccountabilityStatus;
  escalation_issue_id: string | null;
  escalation_severity: EscalationSeverity | null;
  escalation_raised_at: string | null;
  red_sms_dispatched_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joined: participant full name. */
  participant_name?: string | null;
  /**
   * True when the row was synthesised from event_attendance_log and does not
   * yet exist in the curfew/morning log table.  markAccounted/markAbsent will
   * upsert it on first write.
   */
  isVirtual?: boolean;
}

function accPersonKey(r: {
  participant_id?: string | null;
  staff_id?: string | null;
  carer_id?: string | null;
}): string {
  if (r.staff_id) return `s:${r.staff_id}`;
  if (r.carer_id) return `c:${r.carer_id}`;
  return r.participant_id ?? "";
}

function mapAccRow(r: Record<string, unknown>): EventAccountabilityRow {
  const p = r.participants as { first_name?: string; last_name?: string } | null | undefined;
  const staffId = (r.staff_id as string | null) ?? null;
  const carerId = (r.carer_id as string | null) ?? null;
  const participantId = (r.participant_id as string | null) ?? accPersonKey({
    participant_id: r.participant_id as string | null,
    staff_id: staffId,
    carer_id: carerId,
  });
  return {
    id: r.id as string,
    event_day_session_id: r.event_day_session_id as string,
    participant_id: participantId,
    staff_id: staffId,
    carer_id: carerId,
    expected_accounted_at: r.expected_accounted_at as string,
    accounted_at: (r.accounted_at as string | null) ?? null,
    accounted_by: (r.accounted_by as string | null) ?? null,
    status: (r.status as AccountabilityStatus) ?? "expected",
    escalation_issue_id: (r.escalation_issue_id as string | null) ?? null,
    escalation_severity: (r.escalation_severity as EscalationSeverity | null) ?? null,
    escalation_raised_at: (r.escalation_raised_at as string | null) ?? null,
    red_sms_dispatched_at: (r.red_sms_dispatched_at as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    participant_name: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || null : null,
  };
}

/**
 * Ensure floor left-trip (status=absent) people appear on morning/evening as
 * Absent placeholders — even when they were never seeded onto this roll.
 */
async function ensureLeftTripPlaceholdersOnAccountabilityRoll(
  table: LogTable,
  sessionId: string,
  expectedAccountedAt: string,
): Promise<void> {
  const { data: floorAbsent, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id, notes")
    .eq("event_day_session_id", sessionId)
    .eq("status", "absent");
  if (error || !floorAbsent?.length) return;

  const rows = floorAbsent.map((r) => ({
    event_day_session_id: sessionId,
    participant_id: (r as { participant_id: string }).participant_id,
    expected_accounted_at: expectedAccountedAt,
    status: "absent" as AccountabilityStatus,
    notes: (r as { notes: string | null }).notes,
  }));

  // Insert missing only — do not overwrite accounted/expected rows.
  const { error: upsErr } = await supabase.from(table).upsert(rows, {
    onConflict: "event_day_session_id,participant_id",
    ignoreDuplicates: true,
  });
  if (upsErr) {
    console.warn("[ensureLeftTripPlaceholdersOnAccountabilityRoll] upsert failed:", upsErr.message);
  }

  // If they already have expected rows, promote to absent with floor notes.
  const pids = floorAbsent.map((r) => (r as { participant_id: string }).participant_id);
  for (const r of floorAbsent) {
    const pid = (r as { participant_id: string }).participant_id;
    const notes = (r as { notes: string | null }).notes;
    await supabase
      .from(table)
      .update({ status: "absent", notes, accounted_at: null, accounted_by: null })
      .eq("event_day_session_id", sessionId)
      .eq("participant_id", pid)
      .eq("status", "expected");
  }
  void pids;
}

/**
 * Returns the live accountability roll, derived from today's checked-in
 * attendees merged with any existing curfew/morning log records.
 *
 * People who checked in but have no log record yet appear as virtual "expected"
 * rows — they are written to the DB on the first markAccounted/markAbsent tap.
 * People still "expected" on the check-in roll (not yet arrived/reconciled) are
 * NOT included here; query countUnreconciledCheckins() to show the gate warning.
 *
 * Two-tier absent:
 * - Activity skip → floor stays checked_in → still on hotel rolls (mark Safe).
 * - Left trip → floor absent → placeholder on hotel rolls (not awaiting Safe).
 * Union = checked_in ∪ existing log rows ∪ floor left-trip absents.
 */
export async function listAccountabilityRoll(
  table: LogTable,
  sessionId: string,
): Promise<EventAccountabilityRow[]> {
  // Session clock for virtual rows — never wall-clock `new Date()` (breaks SIM time).
  const { data: sessionRow } = await supabase
    .from("event_day_sessions")
    .select("session_date, curfew_time, morning_roll_time")
    .eq("id", sessionId)
    .maybeSingle();
  const sessionDate = (sessionRow as { session_date?: string } | null)?.session_date;
  const clockRaw =
    table === "event_curfew_log"
      ? (sessionRow as { curfew_time?: string | null } | null)?.curfew_time
      : (sessionRow as { morning_roll_time?: string | null } | null)?.morning_roll_time;
  const clock = clockRaw?.trim().slice(0, 5);
  let virtualExpectedAt = operationalNowIso();
  if (sessionDate && clock) {
    try {
      virtualExpectedAt = sydneyWallClockToUtcDate(sessionDate, clock).toISOString();
    } catch {
      /* keep operational now */
    }
  }

  await ensureLeftTripPlaceholdersOnAccountabilityRoll(table, sessionId, virtualExpectedAt);

  // 1. Who is still on the trip today (checked in)?
  const { data: attendees, error: attErr } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", sessionId)
    .eq("status", "checked_in");
  if (attErr) throw attErr;

  // 2. Existing curfew/morning records (includes Left-trip Absent placeholders).
  const { data: logRows, error: logErr } = await supabase
    .from(table)
    .select("*, participants(first_name, last_name)")
    .eq("event_day_session_id", sessionId);
  if (logErr) throw logErr;

  const logMap = new Map(
    (logRows ?? []).map((r) => [
      accPersonKey(r as Record<string, unknown>),
      r,
    ]),
  );

  const checkedInIds: string[] = (attendees ?? []).map(
    (a) => a.participant_id as string,
  );

  let supportCheckedIn: Array<{
    key: string;
    staffId: string | null;
    carerId: string | null;
    name: string;
  }> = [];
  try {
    const { listEventSupportAttendance } = await import("@/lib/api/event-support");
    const support = await listEventSupportAttendance(sessionId);
    supportCheckedIn = support
      .filter((s) => s.status === "checked_in")
      .map((s) => ({
        key: accPersonKey({ staff_id: s.staffId, carer_id: s.carerId }),
        staffId: s.staffId,
        carerId: s.carerId,
        name: s.displayName,
      }));
  } catch {
    /* BL-125 table not migrated yet */
  }

  const checkedInSet = new Set([...checkedInIds, ...supportCheckedIn.map((s) => s.key)]);
  const supportByKey = new Map(supportCheckedIn.map((s) => [s.key, s]));

  // Checked-in first (still with group — can mark Safe), then left-trip placeholders.
  const orderedIds: string[] = [...checkedInIds, ...supportCheckedIn.map((s) => s.key)];
  for (const pid of logMap.keys()) {
    if (!checkedInSet.has(pid)) orderedIds.push(pid);
  }
  if (orderedIds.length === 0) return [];

  const stamp = operationalNowIso();
  return orderedIds.map((pid) => {
    const existing = logMap.get(pid);
    if (existing) {
      const mapped = mapAccRow(existing as Record<string, unknown>);
      const support = supportByKey.get(pid);
      if (support && !mapped.participant_name) mapped.participant_name = support.name;
      return mapped;
    }
    const support = supportByKey.get(pid);
    // Virtual row — not yet in the log table. Name resolved in panel via nameMap.
    return {
      id: `virtual:${pid}`,
      event_day_session_id: sessionId,
      participant_id: pid,
      staff_id: support?.staffId ?? null,
      carer_id: support?.carerId ?? null,
      expected_accounted_at: virtualExpectedAt,
      accounted_at: null,
      accounted_by: null,
      status: "expected" as AccountabilityStatus,
      escalation_issue_id: null,
      escalation_severity: null,
      escalation_raised_at: null,
      red_sms_dispatched_at: null,
      notes: null,
      created_at: stamp,
      updated_at: stamp,
      participant_name: support?.name ?? null,
      isVirtual: true,
    };
  });
}

/** Returns count of check-in roll entries still "expected" (not yet arrived or reconciled). */
export async function countUnreconciledCheckins(sessionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("event_attendance_log")
    .select("id", { count: "exact", head: true })
    .eq("event_day_session_id", sessionId)
    .eq("status", "expected");
  if (error) throw error;
  let extra = 0;
  try {
    const { listEventSupportAttendance } = await import("@/lib/api/event-support");
    extra = (await listEventSupportAttendance(sessionId)).filter((s) => s.status === "expected").length;
  } catch {
    /* ignore */
  }
  return (count ?? 0) + extra;
}

/** Seed accountability rows from the event roster for this session. Idempotent. */
export async function seedAccountabilityRoll(
  table: LogTable,
  opts: {
    eventId: string;
    sessionId: string;
    /** ISO clock string for expected_accounted_at, e.g. "22:00" */
    rollTimeClock: string;
    sessionDate: string;
  },
): Promise<number> {
  // Seed only from participants who checked in today — curfew/morning rolls
  // must never include people who didn't physically arrive.
  const { data: attendees, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id")
    .eq("event_day_session_id", opts.sessionId)
    .eq("status", "checked_in");
  if (error) throw error;

  const [hh, mm] = opts.rollTimeClock.split(":").map(Number);
  const expectedIso = sydneyWallClockToUtcDate(
    opts.sessionDate,
    `${String(hh).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}`,
  ).toISOString();
  if (!Number.isFinite(Date.parse(expectedIso))) {
    throw new Error(`Invalid roll time "${opts.rollTimeClock}" for ${opts.sessionDate}`);
  }

  const rows = (attendees ?? []).map((b) => ({
    event_day_session_id: opts.sessionId,
    participant_id: (b as { participant_id: string }).participant_id,
    expected_accounted_at: expectedIso,
    status: "expected" as AccountabilityStatus,
  }));
  if (!rows.length) return 0;

  const { data: inserted, error: insErr } = await supabase
    .from(table)
    .upsert(rows, { onConflict: "event_day_session_id,participant_id", ignoreDuplicates: true })
    .select("id");
  if (insErr) throw insErr;

  let supportInserted = 0;
  try {
    const { listEventSupportAttendance } = await import("@/lib/api/event-support");
    const support = (await listEventSupportAttendance(opts.sessionId)).filter(
      (s) => s.status === "checked_in",
    );
    const supportRows = support.map((s) => ({
      event_day_session_id: opts.sessionId,
      participant_id: null,
      staff_id: s.staffId,
      carer_id: s.carerId,
      expected_accounted_at: expectedIso,
      status: "expected" as AccountabilityStatus,
    }));
    if (supportRows.length) {
      const { data: sIns, error: sErr } = await supabase.from(table).insert(supportRows).select("id");
      if (!sErr) supportInserted = sIns?.length ?? 0;
    }
  } catch {
    /* support columns / table not migrated yet */
  }

  return (inserted?.length ?? 0) + supportInserted;
}

/** Ensure a virtual row is persisted before updating it; returns the real DB id. */
async function materializeVirtualRow(
  table: LogTable,
  row: EventAccountabilityRow,
): Promise<string> {
  const payload: Record<string, unknown> = {
    event_day_session_id: row.event_day_session_id,
    expected_accounted_at: row.expected_accounted_at || operationalNowIso(),
    status: "expected" as AccountabilityStatus,
  };
  if (row.staff_id) {
    payload.staff_id = row.staff_id;
    payload.participant_id = null;
  } else if (row.carer_id) {
    payload.carer_id = row.carer_id;
    payload.participant_id = null;
  } else {
    payload.participant_id = row.participant_id;
  }
  const onConflict = row.staff_id
    ? "event_day_session_id,staff_id"
    : row.carer_id
      ? "event_day_session_id,carer_id"
      : "event_day_session_id,participant_id";
  const { data, error } = await supabase
    .from(table)
    .upsert(payload, { onConflict })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Evening roll may only be marked once the group is back at the overnight base
 * (all non-final destination stops completed; final stop active/completed, or
 * session phase at_base). Prevents morning-time accidental completion.
 */
export async function isEveningRollMarkingUnlocked(opts: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
}): Promise<{ unlocked: boolean; reason?: string }> {
  const { data: sessionRow, error: sessionErr } = await supabase
    .from("event_day_sessions")
    .select("phase, event_id")
    .eq("id", opts.sessionId)
    .maybeSingle();
  if (sessionErr) throw sessionErr;

  const phase = (sessionRow as { phase?: string } | null)?.phase ?? "";
  if (phase === "at_base") return { unlocked: true };

  const eventId =
    opts.eventId ||
    ((sessionRow as { event_id?: string } | null)?.event_id ?? "");
  if (!eventId) {
    return { unlocked: false, reason: "Missing event for evening roll gate." };
  }

  type StopWithPhase = Awaited<ReturnType<typeof listEventVenueStops>>[number] & {
    phase?: string | null;
  };
  const stops = ((await listEventVenueStops(eventId)) as StopWithPhase[])
    .filter((s) => s.session_date === opts.sessionDate)
    .sort((a, b) => a.stop_order - b.stop_order);

  // Hotel day with no outbound hops — evening roll can run after check-in.
  if (stops.length <= 1) return { unlocked: true };

  const destinations = stops.slice(1);
  const nonFinal = destinations.slice(0, -1);
  const finalStop = destinations[destinations.length - 1]!;
  const phaseOf = (s: StopWithPhase) => (s.phase ?? "pending") as string;

  if (nonFinal.some((s) => phaseOf(s) !== "completed")) {
    return {
      unlocked: false,
      reason:
        "Finish today's programme and return to base before marking Evening Roll.",
    };
  }

  const finalPhase = phaseOf(finalStop);
  if (finalPhase !== "active" && finalPhase !== "completed") {
    return {
      unlocked: false,
      reason:
        "Return to the overnight venue before marking Evening Roll.",
    };
  }

  return { unlocked: true };
}

async function assertEveningRollMarkingAllowed(
  table: LogTable,
  sessionId: string,
): Promise<void> {
  if (table !== "event_curfew_log") return;
  const { data: sessionRow, error } = await supabase
    .from("event_day_sessions")
    .select("event_id, session_date")
    .eq("id", sessionId)
    .single();
  if (error) throw error;
  const row = sessionRow as { event_id: string; session_date: string };
  const gate = await isEveningRollMarkingUnlocked({
    eventId: row.event_id,
    sessionId,
    sessionDate: row.session_date,
  });
  if (!gate.unlocked) {
    throw new Error(gate.reason ?? "Evening Roll is not available yet.");
  }
}

export const ROLL_DEFER_INCREMENTS_MIN = [15, 30, 45, 60, 90, 120] as const;
export const DEFAULT_ROLL_MAX_DEFER_MINUTES = 120;

export interface DeferAccountabilityRollResult {
  deferredCount: number;
  yellowsAutoCleared: number;
}

/** Banner-only copy for group defer (never written onto person rows). */
export function formatGroupDeferBannerNote(opts: {
  minutes: number;
  reason: string;
  band: "YELLOW" | "RED";
  managerName?: string | null;
  /** Wall-clock label e.g. "22:05" — Deferred until. */
  untilLabel?: string | null;
}): string {
  const reason = opts.reason.trim().replace(/\s+/g, " ");
  const until = opts.untilLabel?.trim() ? ` until ${opts.untilLabel.trim()}` : "";
  if (opts.band === "RED" && opts.managerName?.trim()) {
    return `Group Deferred +${opts.minutes}m${until} · ${opts.managerName.trim()} — ${reason}`;
  }
  return `Group Deferred +${opts.minutes}m${until} — ${reason}`;
}

/**
 * Push `expected_accounted_at` for outstanding roll rows (Yellow leader defer
 * or Red manager-authorised defer). Clears Yellow issues when the new window
 * is no longer overdue; leaves Red Hub issues open for manager review.
 * Does not clear `red_sms_dispatched_at` (SMS once).
 *
 * Group defer (no participantIds): reason lives on event_day_sessions banner note only.
 * Individual defer: reason appended to that person's roll notes.
 */
export async function deferAccountabilityRoll(
  table: LogTable,
  opts: {
    sessionId: string;
    minutes: number;
    reason: string;
    /** Omit / empty = all outstanding (`expected`) on the roll = group defer. */
    participantIds?: string[] | null;
    band: "YELLOW" | "RED";
    operatorStaffId?: string | null;
    managerStaffId?: string | null;
    managerName?: string | null;
  },
): Promise<DeferAccountabilityRollResult> {
  const reason = opts.reason.trim();
  if (reason.length < 10) {
    throw new Error("Deferral reason must be at least 10 characters.");
  }
  if (opts.band === "RED" && !opts.managerStaffId) {
    throw new Error("Red deferral requires manager consultation.");
  }
  if (!Number.isFinite(opts.minutes) || opts.minutes < 1) {
    throw new Error("Deferral minutes must be at least 1.");
  }

  let maxDefer = DEFAULT_ROLL_MAX_DEFER_MINUTES;
  try {
    const { listSystemParameters } = await import("@/lib/api/system-parameters");
    const rows = await listSystemParameters();
    const row = rows.find((r) => r.key === "event_roll_max_defer_minutes");
    if (row) {
      const n = typeof row.value === "number" ? row.value : Number(row.value);
      if (Number.isFinite(n) && n >= 15) maxDefer = Math.min(24 * 60, n);
    }
  } catch {
    /* keep default */
  }
  if (opts.minutes > maxDefer) {
    throw new Error(`Deferral cannot exceed ${maxDefer} minutes (Admin max).`);
  }

  const staffId = opts.operatorStaffId || (await resolveStaffIdWithFallback());
  const roll = await listAccountabilityRoll(table, opts.sessionId);
  const idFilter =
    opts.participantIds && opts.participantIds.length > 0
      ? new Set(opts.participantIds)
      : null;
  const isGroupDefer = idFilter == null;

  const targets = roll.filter((r) => {
    if (r.status !== "expected") return false;
    if (idFilter && !idFilter.has(r.participant_id)) return false;
    return true;
  });
  if (!targets.length) {
    throw new Error("No outstanding people to defer on this roll.");
  }

  let yellowsAutoCleared = 0;
  const now = operationalNowMs();
  const affectedIds: string[] = [];
  let latestDeferredUntilMs = 0;

  for (const row of targets) {
    const realId = row.isVirtual ? await materializeVirtualRow(table, row) : row.id;
    const baseMs = Date.parse(row.expected_accounted_at);
    const fromMs = Number.isFinite(baseMs) ? baseMs : now;
    // If already overdue, push from now so the grace is real wall time.
    const startMs = Math.max(fromMs, now);
    const nextMs = startMs + opts.minutes * 60_000;
    const nextIso = new Date(nextMs).toISOString();
    latestDeferredUntilMs = Math.max(latestDeferredUntilMs, nextMs);

    const patch: Record<string, unknown> = {
      expected_accounted_at: nextIso,
      updated_at: operationalNowIso(),
    };

    // Individual only — group reason stays on the banner / session note.
    if (!isGroupDefer) {
      const noteLine =
        opts.band === "RED"
          ? `[RED DEFER +${opts.minutes}m · ${opts.managerName ?? "manager"}] ${reason}`
          : `[YELLOW DEFER +${opts.minutes}m] ${reason}`;
      const prevNotes = (row.notes ?? "").trim();
      patch.notes = prevNotes ? `${prevNotes}\n${noteLine}` : noteLine;
    }

    const { error: updErr } = await supabase
      .from(table)
      .update(patch)
      .eq("id", realId);
    if (updErr) throw updErr;
    affectedIds.push(realId);

    // Auto-clear Yellow when new deadline is still in the future.
    const minsToNew = Math.floor((Date.parse(nextIso) - now) / 60_000);
    if (
      minsToNew > 0 &&
      row.escalation_issue_id &&
      row.escalation_severity === "yellow"
    ) {
      const { data: issue } = await supabase
        .from("site_issues_register")
        .select("id, status, severity")
        .eq("id", row.escalation_issue_id)
        .maybeSingle();
      if (
        issue &&
        (issue as { status: string }).status === "open" &&
        (issue as { severity: string }).severity === "yellow"
      ) {
        await supabase
          .from("site_issues_register")
          .update({
            status: "resolved",
            resolved_at: operationalNowIso(),
          })
          .eq("id", row.escalation_issue_id);
        await supabase
          .from(table)
          .update({
            escalation_issue_id: null,
            escalation_severity: null,
            escalation_raised_at: null,
          })
          .eq("id", realId);
        yellowsAutoCleared += 1;
      }
    }
  }

  const isCurfew = table === "event_curfew_log";
  const untilLabel =
    latestDeferredUntilMs > 0 ? formatTime(latestDeferredUntilMs) : null;
  const groupBannerNote = isGroupDefer
    ? formatGroupDeferBannerNote({
        minutes: opts.minutes,
        reason,
        band: opts.band,
        managerName: opts.managerName,
        untilLabel,
      })
    : null;

  if (groupBannerNote) {
    const col = isCurfew ? "evening_group_defer_note" : "morning_group_defer_note";
    const { error: sessErr } = await supabase
      .from("event_day_sessions")
      .update({ [col]: groupBannerNote, updated_at: operationalNowIso() })
      .eq("id", opts.sessionId);
    if (sessErr) {
      console.warn("[deferAccountabilityRoll] group banner note save failed:", sessErr.message);
    }
  }

  await writeToLedger({
    staff_id: staffId,
    category: "TRIP",
    severity: opts.band,
    action_type: isCurfew
      ? opts.band === "RED"
        ? "CURFEW_ROLL_RED_DEFERRED"
        : "CURFEW_ROLL_YELLOW_DEFERRED"
      : opts.band === "RED"
        ? "MORNING_ROLL_RED_DEFERRED"
        : "MORNING_ROLL_YELLOW_DEFERRED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      session_id: opts.sessionId,
      table,
      minutes: opts.minutes,
      reason,
      scope: isGroupDefer ? "group" : "individual",
      group_banner_note: groupBannerNote,
      affected_count: affectedIds.length,
      affected_ids: affectedIds,
      yellows_auto_cleared: yellowsAutoCleared,
      manager_staff_id: opts.managerStaffId ?? null,
      manager_name: opts.managerName ?? null,
      operator_staff_id: staffId,
    },
  });

  return { deferredCount: affectedIds.length, yellowsAutoCleared };
}

/** Latest group defer banner notes for Morning / Evening (session columns). */
export async function fetchRollGroupDeferNotes(sessionId: string): Promise<{
  morning: string | null;
  evening: string | null;
}> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("morning_group_defer_note, evening_group_defer_note")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    // Pre-migration / schema lag — never break Event Deliver for banner notes.
    const code = String((error as { code?: string }).code ?? "");
    const msg = error.message ?? "";
    if (
      code === "42703" ||
      code === "PGRST204" ||
      /morning_group_defer_note|evening_group_defer_note|column|schema cache/i.test(msg)
    ) {
      return { morning: null, evening: null };
    }
    console.warn("[fetchRollGroupDeferNotes]", msg);
    return { morning: null, evening: null };
  }
  const row = data as {
    morning_group_defer_note?: string | null;
    evening_group_defer_note?: string | null;
  } | null;
  return {
    morning: row?.morning_group_defer_note?.trim() || null,
    evening: row?.evening_group_defer_note?.trim() || null,
  };
}

/** Keep Yellow/Red defer notes when marking accounted/absent; append new text if provided. */
function mergeRollNotes(existing: string | null | undefined, next: string): string | null {
  const prev = (existing ?? "").trim();
  const add = next.trim();
  if (!add) return prev || null;
  if (!prev) return add;
  return `${prev}\n${add}`;
}

export async function markAccounted(
  table: LogTable,
  row: EventAccountabilityRow,
  notes: string,
): Promise<EventAccountabilityRow> {
  await assertEveningRollMarkingAllowed(table, row.event_day_session_id);

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();

  // If this is a virtual row (not yet in the DB), upsert it first.
  const realId = row.isVirtual ? await materializeVirtualRow(table, row) : row.id;
  const mergedNotes = mergeRollNotes(row.notes, notes);

  const { data, error } = await supabase
    .from(table)
    .update({
      status: "accounted",
      accounted_at: nowIso,
      accounted_by: staffId,
      notes: mergedNotes,
    })
    .eq("id", realId)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) throw error;

  // Auto-close YELLOW if one exists.
  if (row.escalation_issue_id && row.escalation_severity === "yellow") {
    const { data: issue } = await supabase
      .from("site_issues_register")
      .select("id, status, severity")
      .eq("id", row.escalation_issue_id)
      .maybeSingle();
    if (issue && (issue as { status: string }).status === "open" && (issue as { severity: string }).severity === "yellow") {
      await supabase
        .from("site_issues_register")
        .update({ status: "resolved", resolved_at: nowIso })
        .eq("id", row.escalation_issue_id);
      await supabase
        .from(table)
        .update({ escalation_issue_id: null, escalation_severity: null, escalation_raised_at: null })
        .eq("id", realId);
    }
  }

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: table === "event_curfew_log" ? "CURFEW_ACCOUNTED" : "MORNING_ROLL_ACCOUNTED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      log_id: realId,
      session_id: row.event_day_session_id,
      participant_id: row.participant_id,
      notes: mergedNotes,
    },
  });
  return mapAccRow(data as Record<string, unknown>);
}

/**
 * Fat-finger undo (§4.4): accounted → expected again so Defer / No show return.
 * Keeps prior notes; does not reopen resolved escalation issues.
 */
export async function unmarkAccounted(
  table: LogTable,
  row: EventAccountabilityRow,
): Promise<EventAccountabilityRow> {
  if (row.status !== "accounted") {
    throw new Error("Only accounted people can be returned to awaiting roll.");
  }
  if (row.isVirtual) {
    throw new Error("This row is not saved yet — nothing to undo.");
  }
  await assertEveningRollMarkingAllowed(table, row.event_day_session_id);

  const staffId = await resolveStaffIdWithFallback();
  const { data, error } = await supabase
    .from(table)
    .update({
      status: "expected",
      accounted_at: null,
      accounted_by: null,
    })
    .eq("id", row.id)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) throw error;

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type:
      table === "event_curfew_log" ? "CURFEW_UNACCOUNTED" : "MORNING_ROLL_UNACCOUNTED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      log_id: row.id,
      session_id: row.event_day_session_id,
      participant_id: row.participant_id,
    },
  });
  return mapAccRow(data as Record<string, unknown>);
}

/** Toggle Mark accounted ↔ awaiting (fat-finger reverse). */
export async function toggleAccounted(
  table: LogTable,
  row: EventAccountabilityRow,
  notes = "",
): Promise<EventAccountabilityRow> {
  if (row.status === "accounted") return unmarkAccounted(table, row);
  if (row.status === "absent") {
    throw new Error("Clear absent first — use No show options, or mark accounted from awaiting.");
  }
  return markAccounted(table, row, notes);
}

export interface MarkLeftTripAbsentParams {
  disposition: LeftTripDisposition;
  safetyPlan: string;
  severity: "yellow" | "red";
  /** Display name for Hub issue. */
  participantName: string;
}

/**
 * Left-trip Absent on morning/evening roll (BL-090).
 * Opens Hub [LEFT TRIP] Yellow/Red; supersedes automated overdue issue (does not
 * silently close without welfare evidence); syncs floor attendance to absent.
 */
export async function markAbsent(
  table: LogTable,
  row: EventAccountabilityRow,
  params: MarkLeftTripAbsentParams,
): Promise<EventAccountabilityRow> {
  await assertEveningRollMarkingAllowed(table, row.event_day_session_id);

  const plan = params.safetyPlan.trim();
  if (plan.length < 20) {
    throw new Error("Reason / safety plan must be at least 20 characters.");
  }

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  const leftNotes = encodeLeftTripNotes({
    disposition: params.disposition,
    safetyPlan: plan,
  });
  const mergedNotes = mergeRollNotes(row.notes, leftNotes);

  const realId = row.isVirtual ? await materializeVirtualRow(table, row) : row.id;

  // Supersede automated overdue issue — welfare record replaces it.
  if (row.escalation_issue_id) {
    await supabase
      .from("site_issues_register")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("id", row.escalation_issue_id)
      .eq("status", "open");
  }

  const hubCtx = await loadRollHubContext(row.event_day_session_id);
  const eventId = hubCtx?.eventId ?? null;
  const pName = params.participantName.trim() || "Participant";
  let newIssueId: string | null = null;

  if (eventId) {
    const { data: issue, error: issueErr } = await supabase
      .from("site_issues_register")
      .insert({
        session_id: null,
        event_id: eventId,
        event_day_session_id: row.event_day_session_id,
        reported_by: staffId,
        severity: params.severity,
        issue_description: leftTripHubDescription(pName, params.disposition, plan),
        workaround_plan: plan,
        owner: "internal",
        status: "open",
        update_log: "",
      })
      .select("id")
      .single();
    if (issueErr) {
      console.warn("[markAbsent] Hub LEFT TRIP issue failed (non-fatal):", issueErr.message);
    } else {
      newIssueId = (issue as { id: string }).id;
    }
  }

  const { data, error } = await supabase
    .from(table)
    .update({
      status: "absent",
      notes: mergedNotes,
      accounted_at: null,
      escalation_issue_id: newIssueId,
      escalation_severity: params.severity,
      escalation_raised_at: newIssueId ? nowIso : row.escalation_raised_at,
    })
    .eq("id", realId)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) throw error;

  if (row.staff_id || row.carer_id) {
    try {
      const { listEventSupportAttendance, markEventSupportAbsent } = await import(
        "@/lib/api/event-support"
      );
      const support = await listEventSupportAttendance(row.event_day_session_id);
      const match = support.find(
        (s) =>
          (row.staff_id && s.staffId === row.staff_id) ||
          (row.carer_id && s.carerId === row.carer_id),
      );
      if (match) await markEventSupportAbsent(match.id);
    } catch {
      /* ignore */
    }
  } else {
    await syncFloorAttendanceLeftTrip({
      eventDaySessionId: row.event_day_session_id,
      participantId: row.participant_id,
      notes: leftNotes,
    });
  }

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: params.severity === "red" ? "RED" : "YELLOW",
    action_type: table === "event_curfew_log" ? "CURFEW_ABSENT_CONFIRMED" : "MORNING_ROLL_ABSENT",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      log_id: realId,
      session_id: row.event_day_session_id,
      participant_id: row.participant_id,
      disposition: params.disposition,
      safety_plan: plan,
      severity: params.severity,
      hub_issue_id: newIssueId,
      notes: mergedNotes,
    },
  });
  return mapAccRow(data as Record<string, unknown>);
}

/**
 * Clear morning/evening Absent placeholder and restore floor to checked_in.
 */
export async function reinstateAccountabilityAbsent(
  table: LogTable,
  row: EventAccountabilityRow,
  reason: string,
): Promise<EventAccountabilityRow> {
  if (row.status !== "absent") {
    throw new Error("Only absent people can be reinstated.");
  }
  if (row.isVirtual) {
    throw new Error("This row is not saved yet — nothing to reinstate.");
  }
  await assertEveningRollMarkingAllowed(table, row.event_day_session_id);

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    throw new Error("Reinstate reason must be at least 10 characters.");
  }
  const reinstateNote = `[REINSTATED] ${trimmed}`;
  const mergedNotes = mergeRollNotes(row.notes, reinstateNote);

  if (row.escalation_issue_id) {
    await supabase
      .from("site_issues_register")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("id", row.escalation_issue_id)
      .eq("status", "open");
  }

  const { data, error } = await supabase
    .from(table)
    .update({
      status: "expected",
      notes: mergedNotes,
      accounted_at: null,
      accounted_by: null,
      escalation_issue_id: null,
      escalation_severity: null,
      escalation_raised_at: null,
    })
    .eq("id", row.id)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) throw error;

  // Floor: absent → checked_in so they rejoin transport / activity assignment.
  const { error: floorErr } = await supabase
    .from("event_attendance_log")
    .update({
      status: "checked_in",
      notes: reinstateNote,
      checked_out_at: null,
      checked_out_by: null,
      return_transport: null,
    })
    .eq("event_day_session_id", row.event_day_session_id)
    .eq("participant_id", row.participant_id)
    .eq("status", "absent");
  if (floorErr) {
    console.warn("[reinstateAccountabilityAbsent] floor sync failed (non-fatal):", floorErr.message);
  }

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type:
      table === "event_curfew_log" ? "CURFEW_REINSTATE" : "MORNING_ROLL_REINSTATE",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      log_id: row.id,
      session_id: row.event_day_session_id,
      participant_id: row.participant_id,
      reason: trimmed,
    },
  });
  return mapAccRow(data as Record<string, unknown>);
}

// ============================================================================
// YELLOW → RED sweep (mirrors sweepOverdueArrivals in client-attendance.ts)
// ============================================================================

export interface AccountabilitySweepResult {
  yellowRaised: number;
  redRaised: number;
}

export async function sweepAccountabilityRoll(
  table: LogTable,
  sessionId: string,
  yellowMins: number,
  redMins: number,
  participantNames: Record<string, string>,
): Promise<AccountabilitySweepResult> {
  const roll = await listAccountabilityRoll(table, sessionId);
  const now = operationalNowMs();
  let yellowRaised = 0;
  let redRaised = 0;
  const isCurfew = table === "event_curfew_log";

  const hubCtx = await loadRollHubContext(sessionId);
  if (!hubCtx) {
    console.error("[event-day-ops] sweep: missing session context", sessionId);
    return { yellowRaised: 0, redRaised: 0 };
  }
  const rollLabel = isCurfew ? "Evening roll" : "Morning roll";
  const rollTag = isCurfew ? "EVENING ROLL" : "MORNING ROLL";

  for (const r of roll) {
    // Virtual rows (not yet in DB) cannot receive escalation PATCHes — seed first.
    if (r.isVirtual) continue;
    if (r.status === "accounted" || r.status === "absent") continue;
    const expected = Date.parse(r.expected_accounted_at);
    if (!Number.isFinite(expected)) continue;

    // YELLOW = yellowMins BEFORE the deadline; RED = redMins AFTER.
    const minsRelative = Math.floor((now - expected) / 60_000);
    const isYellowZone = minsRelative >= -yellowMins;
    const isRedZone = minsRelative >= redMins;
    if (!isYellowZone) continue;

    const pName = participantNames[r.participant_id] ?? "Participant";

    // ── No issue yet → raise YELLOW (or RED if skipped past threshold) ──
    if (!r.escalation_issue_id) {
      const insertSeverity: EscalationSeverity = isRedZone ? "red" : "yellow";

      // §1.1 abort-on-failure for RED
      if (isRedZone) {
        try {
          await writeToLedgerOrThrow({
            staff_id: await resolveStaffIdWithFallback(),
            category: "TRIP",
            severity: "RED",
            action_type: isCurfew ? "CURFEW_RED_AUTO_RAISED" : "MORNING_ROLL_RED_AUTO_RAISED",
            gps_lat: null,
            gps_lng: null,
            metadata: {
              log_id: r.id,
              session_id: sessionId,
              event_id: hubCtx.eventId,
              participant_id: r.participant_id,
              mins_relative: minsRelative,
              automated: true,
            },
          });
        } catch {
          continue; // ledger failed — skip; retry next sweep
        }
      } else {
        await writeToLedger({
          staff_id: await resolveStaffIdWithFallback(),
          category: "TRIP",
          severity: "YELLOW",
          action_type: isCurfew ? "CURFEW_YELLOW_RAISED" : "MORNING_ROLL_YELLOW_RAISED",
          gps_lat: null,
          gps_lng: null,
          metadata: {
            log_id: r.id,
            session_id: sessionId,
            event_id: hubCtx.eventId,
            participant_id: r.participant_id,
            mins_relative: minsRelative,
            automated: true,
          },
        });
      }

      const desc =
        insertSeverity === "red"
          ? `[AUTOMATED_RED] ${rollTag} · ${hubCtx.tripContext}: ${pName} unaccounted ${minsRelative} min after deadline.`
          : `[${rollTag}] ${hubCtx.tripContext}: ${pName} unaccounted — approaching deadline.`;

      const { data: issue, error: issErr } = await supabase
        .from("site_issues_register")
        .insert({
          session_id: null,
          event_id: hubCtx.eventId,
          event_day_session_id: sessionId,
          reported_by: SYSTEM_ISSUE_REPORTER,
          severity: insertSeverity,
          issue_description: desc,
          owner: "internal",
          status: "open",
          update_log: "",
        })
        .select("id")
        .single();
      if (issErr) { console.error("[event-day-ops] issue insert failed", issErr); continue; }

      await supabase
        .from(table)
        .update({
          escalation_issue_id: (issue as { id: string }).id,
          escalation_severity: insertSeverity,
          escalation_raised_at: operationalNowIso(),
        })
        .eq("id", r.id);

      if (insertSeverity === "red") {
        await fireEventRedSms(table, r, pName, sessionId, rollLabel);
        redRaised += 1;
      } else {
        yellowRaised += 1;
      }
      continue;
    }

    // ── Yellow issue exists → promote to RED if threshold crossed ──
    if (isRedZone && r.escalation_severity !== "red") {
      const staffId = await resolveStaffIdWithFallback();
      try {
        await writeToLedgerOrThrow({
          staff_id: staffId,
          category: "TRIP",
          severity: "RED",
          action_type: isCurfew ? "CURFEW_RED_AUTO_RAISED" : "MORNING_ROLL_RED_AUTO_RAISED",
          gps_lat: null,
          gps_lng: null,
          metadata: {
            log_id: r.id,
            issue_id: r.escalation_issue_id,
            session_id: sessionId,
            event_id: hubCtx.eventId,
            participant_id: r.participant_id,
            mins_relative: minsRelative,
            automated: true,
          },
        });
      } catch {
        continue; // ledger failed — abort RED promotion; retry next sweep
      }

      await supabase
        .from("site_issues_register")
        .update({
          severity: "red",
          event_id: hubCtx.eventId,
          event_day_session_id: sessionId,
          reported_by: SYSTEM_ISSUE_REPORTER,
          issue_description: `[AUTOMATED_RED] ${rollTag} · ${hubCtx.tripContext}: ${pName} unaccounted ${minsRelative} min after deadline — escalated to RED.`,
        })
        .eq("id", r.escalation_issue_id);

      await supabase
        .from(table)
        .update({ escalation_severity: "red" })
        .eq("id", r.id);

      await fireEventRedSms(table, r, pName, sessionId, rollLabel);
      redRaised += 1;
    }
  }

  return { yellowRaised, redRaised };
}

/**
 * SMS fires **once** per participant per roll when they first hit RED.
 * Guarded by `red_sms_dispatched_at` — no repeat interval / no re-send on later sweeps.
 */
async function fireEventRedSms(
  table: LogTable,
  row: EventAccountabilityRow,
  participantName: string,
  sessionId: string,
  rollLabel: string,
): Promise<void> {
  if (row.red_sms_dispatched_at) return;

  const { emitMockSms } = await import("@/lib/notifications/mock-sms");
  try {
    const res = await fetch("/api/internal/attendance-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attendanceId: row.id,
        participantName,
        expectedAt: row.expected_accounted_at,
        sessionId,
        context: `event_${rollLabel.toLowerCase().replace(" ", "_")}`,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      recipients?: string[];
      message?: string;
      reason?: string;
      reference?: string;
    };
    if (!res.ok) {
      console.error("[event-day-ops] SMS pipeline non-OK", res.status, json);
      emitMockSms({
        recipient: "unknown",
        body: `[RED] ${participantName} — ${rollLabel} server route returned ${res.status}.`,
        source: "event_red",
        reason: "pipeline_non_ok",
        reference: `event-red-${row.id}`,
      });
      return;
    }
    const recipients = json.recipients ?? [];
    const message = json.message ?? `[RED] ${participantName} — ${rollLabel} breach, event session ${sessionId}.`;
    if (recipients.length === 0) {
      emitMockSms({
        recipient: "(no recipients resolved)",
        body: message,
        source: "event_red",
        reason: json.reason ?? "unknown",
        reference: json.reference,
      });
    } else {
      for (const to of recipients) {
        emitMockSms({
          recipient: to,
          body: message,
          source: "event_red",
          reason: json.reason ?? "threshold",
          reference: json.reference,
        });
      }
    }
    await supabase
      .from(table)
      .update({ red_sms_dispatched_at: operationalNowIso() })
      .eq("id", row.id);
  } catch (e) {
    console.error("[event-day-ops] SMS pipeline threw", e);
    emitMockSms({
      recipient: "unknown",
      body: `[RED] ${participantName} — event SMS pipeline failed.`,
      source: "event_red",
      reason: "pipeline_error",
    });
  }
}

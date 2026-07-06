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
}

function rosterBookingOnBus(_b: BusSeedBooking, _direction: "outbound" | "return"): boolean {
  // Venue hops: all active roster members may board the group bus between stops.
  // Self-transport is handled via "Not travelling" on the roll if needed.
  return true;
}

async function fetchBusSeedBookings(eventId: string): Promise<BusSeedBooking[]> {
  const withModes =
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
      .select(basic)
      .eq("event_id", eventId)
      .neq("booking_status", "Cancelled");
    if (result.error) throw result.error;
    return (result.data ?? []).map((b) => ({
      ...(b as BusSeedBooking),
      outbound_transport_mode: null,
      return_transport_mode: null,
    }));
  }
  return (result.data ?? []) as BusSeedBooking[];
}

async function insertBusManifestRows(rows: Record<string, unknown>[]): Promise<void> {
  const participantRows = rows.filter((r) => r.participant_id != null);
  const carerRows = rows.filter((r) => r.carer_id != null && r.participant_id == null);

  if (participantRows.length) {
    const { error } = await supabase.from("event_bus_manifest").insert(participantRows);
    if (error && !isDuplicateKeyError(error)) throw error;
  }
  if (carerRows.length) {
    const { error } = await supabase.from("event_bus_manifest").insert(carerRows);
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

  const nameById: Record<string, string> = {};
  if (participantIds.length) {
    const { data: parts, error: pErr } = await supabase
      .from("participants")
      .select("id, first_name, last_name")
      .in("id", participantIds);
    if (pErr) throw pErr;
    for (const p of parts ?? []) {
      const row = p as { id: string; first_name?: string; last_name?: string };
      nameById[row.id] = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
    }
  }

  return data.map((r) => {
    const row = r as EventBusManifestRow;
    return {
      ...row,
      participant_name: row.participant_id
        ? nameById[row.participant_id] || null
        : null,
    };
  });
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
  if (!rows.length) return 0;

  await insertBusManifestRows(rows);

  const manifest = await listBusManifest(opts.tripId);
  return manifest.length;
}

export async function markOnBus(row: EventBusManifestRow): Promise<EventBusManifestRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();
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
}

function mapAccRow(r: Record<string, unknown>): EventAccountabilityRow {
  const p = r.participants as { first_name?: string; last_name?: string } | null | undefined;
  return {
    id: r.id as string,
    event_day_session_id: r.event_day_session_id as string,
    participant_id: r.participant_id as string,
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

export async function listAccountabilityRoll(
  table: LogTable,
  sessionId: string,
): Promise<EventAccountabilityRow[]> {
  const { data, error } = await supabase
    .from(table)
    .select("*, participants(first_name, last_name)")
    .eq("event_day_session_id", sessionId)
    .order("expected_accounted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapAccRow(r as Record<string, unknown>));
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
  const { data: bookings, error } = await supabase
    .from("event_roster_bookings")
    .select("participant_id")
    .eq("event_id", opts.eventId)
    .neq("booking_status", "Cancelled");
  if (error) throw error;

  const [hh, mm] = opts.rollTimeClock.split(":").map(Number);
  const base = new Date(`${opts.sessionDate}T${String(hh).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}:00`);
  const expectedIso = base.toISOString();

  const rows = (bookings ?? []).map((b) => ({
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
  return inserted?.length ?? 0;
}

export async function markAccounted(
  table: LogTable,
  row: EventAccountabilityRow,
  notes: string,
): Promise<EventAccountabilityRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from(table)
    .update({ status: "accounted", accounted_at: nowIso, accounted_by: staffId, notes: notes || null })
    .eq("id", row.id)
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
        .eq("id", row.id);
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
      log_id: row.id,
      session_id: row.event_day_session_id,
      participant_id: row.participant_id,
      notes: notes || null,
    },
  });
  return mapAccRow(data as Record<string, unknown>);
}

export async function markAbsent(
  table: LogTable,
  row: EventAccountabilityRow,
  notes: string,
): Promise<EventAccountabilityRow> {
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from(table)
    .update({ status: "absent", notes: notes || null, accounted_at: null })
    .eq("id", row.id)
    .select("*, participants(first_name, last_name)")
    .single();
  if (error) throw error;

  // Force-close any open issue (absent = confirmed not returning tonight).
  if (row.escalation_issue_id) {
    await supabase
      .from("site_issues_register")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("id", row.escalation_issue_id)
      .eq("status", "open");
  }

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "YELLOW",
    action_type: table === "event_curfew_log" ? "CURFEW_ABSENT_CONFIRMED" : "MORNING_ROLL_ABSENT",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      log_id: row.id,
      session_id: row.event_day_session_id,
      participant_id: row.participant_id,
      notes: notes || null,
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
  const now = Date.now();
  let yellowRaised = 0;
  let redRaised = 0;
  const isCurfew = table === "event_curfew_log";

  for (const r of roll) {
    if (r.status === "accounted" || r.status === "absent") continue;
    const expected = Date.parse(r.expected_accounted_at);
    if (!Number.isFinite(expected)) continue;

    // YELLOW = yellowMins BEFORE the deadline; RED = redMins AFTER.
    const minsRelative = Math.floor((now - expected) / 60_000);
    const isYellowZone = minsRelative >= -yellowMins;
    const isRedZone = minsRelative >= redMins;
    if (!isYellowZone) continue;

    const pName = participantNames[r.participant_id] ?? "Participant";
    const rollLabel = isCurfew ? "Curfew" : "Morning Roll";

    // ── No issue yet → raise YELLOW (or RED if skipped past threshold) ──
    if (!r.escalation_issue_id) {
      const insertSeverity: EscalationSeverity = isRedZone ? "red" : "yellow";

      // §1.1 abort-on-failure for RED
      if (isRedZone) {
        try {
          await writeToLedgerOrThrow({
            staff_id: await resolveStaffIdWithFallback(),
            category: "CENTRE",
            severity: "RED",
            action_type: isCurfew ? "CURFEW_RED_AUTO_RAISED" : "MORNING_ROLL_RED_AUTO_RAISED",
            gps_lat: null,
            gps_lng: null,
            metadata: {
              log_id: r.id,
              session_id: sessionId,
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
          category: "CENTRE",
          severity: "YELLOW",
          action_type: isCurfew ? "CURFEW_YELLOW_RAISED" : "MORNING_ROLL_YELLOW_RAISED",
          gps_lat: null,
          gps_lng: null,
          metadata: {
            log_id: r.id,
            session_id: sessionId,
            participant_id: r.participant_id,
            mins_relative: minsRelative,
            automated: true,
          },
        });
      }

      const desc =
        insertSeverity === "red"
          ? `[AUTOMATED_RED] ${rollLabel}: ${pName} unaccounted ${minsRelative} min after deadline.`
          : `[${rollLabel.toUpperCase()}] ${pName} unaccounted — approaching deadline.`;

      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data: issue, error: issErr } = await supabase
        .from("site_issues_register")
        .insert({
          reported_by: userId,
          severity: insertSeverity,
          issue_description: desc,
          owner: "internal",
          status: "open",
        })
        .select("id")
        .single();
      if (issErr) { console.error("[event-day-ops] issue insert failed", issErr); continue; }

      await supabase
        .from(table)
        .update({
          escalation_issue_id: (issue as { id: string }).id,
          escalation_severity: insertSeverity,
          escalation_raised_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      if (insertSeverity === "red") {
        await fireEventRedSms(r, pName, sessionId, rollLabel);
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
          category: "CENTRE",
          severity: "RED",
          action_type: isCurfew ? "CURFEW_RED_AUTO_RAISED" : "MORNING_ROLL_RED_AUTO_RAISED",
          gps_lat: null,
          gps_lng: null,
          metadata: {
            log_id: r.id,
            issue_id: r.escalation_issue_id,
            session_id: sessionId,
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
          issue_description: `[AUTOMATED_RED] ${rollLabel}: ${pName} unaccounted ${minsRelative} min after deadline — escalated to RED.`,
        })
        .eq("id", r.escalation_issue_id);

      await supabase
        .from(table)
        .update({ escalation_severity: "red" })
        .eq("id", r.id);

      await fireEventRedSms(r, pName, sessionId, rollLabel);
      redRaised += 1;
    }
  }

  return { yellowRaised, redRaised };
}

async function fireEventRedSms(
  row: EventAccountabilityRow,
  participantName: string,
  sessionId: string,
  rollLabel: string,
): Promise<void> {
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
        emitMockSms({ recipient: to, body: message, source: "event_red", reason: json.reason ?? "threshold", reference: json.reference });
      }
    }
    await supabase.from("event_curfew_log").update({ red_sms_dispatched_at: new Date().toISOString() }).eq("id", row.id);
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

/**
 * event-lifecycle.ts — Phase 4: event status lifecycle + Trip Report read model
 *
 * Status ladder: Planning → Confirmed → Open → Closed
 *
 * Guard rules (§12, GUARDRAILS §1.1):
 *   • Planning   → Confirmed: all day sessions must have a manager assigned.
 *   • Confirmed  → Open:      event start_date ≤ today; all itinerary stops exist.
 *   • Open       → Closed:    all day sessions must be closed (phase closed_orderly
 *                             or closed_incident); then billingLocked = true.
 *   • Closed is terminal — no further status changes permitted.
 *
 * Trip Report = read-only aggregate of:
 *   • Event metadata + venue itinerary
 *   • Roster summary (confirmed / cancelled)
 *   • Accountability summary per day (bus check-on, curfew, morning)
 *   • Finance summary (revenue / expenses / P&L)
 *   • Open issues at close time
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { resolveStaffIdWithFallback, getEventFinanceTotals } from "@/lib/data-store";
import { writeToLedger, writeToLedgerOrThrow } from "@/lib/api/ledger";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import {
  inferEventKind,
  isOutingEventKind,
  seedEventDaySessions,
  ensureEventItineraryStops,
  listEventDaySessions,
} from "@/lib/api/event-outing";
import { fetchActualTransportForSessions } from "@/lib/api/event-transport";
import { todayLocalIso } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type EventStatus = "Planning" | "Confirmed" | "Open" | "Closed";

export interface StatusGuardResult {
  ok: boolean;
  /** Human-readable list of unmet conditions. Empty when ok=true. */
  blockers: string[];
}

// ============================================================================
// Guard checks
// ============================================================================

/** Planning → Confirmed: outing events need trip leaders on every calendar day in range. */
async function guardPlanningToConfirmed(eventId: string): Promise<StatusGuardResult> {
  const { data: event, error: evErr } = await supabase
    .from("event_manifest")
    .select("event_kind, start_date, end_date, event_type, primary_venue_id")
    .eq("id", eventId)
    .single();
  if (evErr) return { ok: false, blockers: [`DB error: ${evErr.message}`] };

  const row = event as {
    event_kind: string | null;
    start_date: string;
    end_date: string;
    event_type: string;
    primary_venue_id: string | null;
  };

  const { data: typeRow } = await supabase
    .from("system_lookup_parameters")
    .select("display_name")
    .eq("category", "event_types")
    .eq("code", row.event_type)
    .maybeSingle();

  const inferred = inferEventKind({
    startDate: row.start_date,
    endDate: row.end_date,
    eventTypeCode: row.event_type,
    eventTypeDisplayName: (typeRow as { display_name?: string } | null)?.display_name ?? null,
    primaryVenueId: row.primary_venue_id,
    storedEventKind: row.event_kind,
  });

  // Centre-linked legacy events — no trip-day requirement.
  if (inferred === "legacy" && !isOutingEventKind(row.event_kind)) {
    return { ok: true, blockers: [] };
  }

  const kind = inferred !== "legacy" ? inferred : row.event_kind ?? "legacy";
  if (kind !== row.event_kind && isOutingEventKind(kind)) {
    await supabase.from("event_manifest").update({ event_kind: kind }).eq("id", eventId);
  }

  await seedEventDaySessions(eventId, row.start_date, row.end_date ?? row.start_date);

  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("id, session_date, manager_staff_id")
    .eq("event_id", eventId);
  if (error) return { ok: false, blockers: [`DB error: ${error.message}`] };

  const sessions = data ?? [];
  if (sessions.length === 0) {
    return {
      ok: false,
      blockers: [
        "No trip days for this date range — check start and end dates on Details & Config, then save.",
      ],
    };
  }

  const unmanaged = sessions.filter(
    (s) => !(s as { manager_staff_id: string | null }).manager_staff_id,
  );
  if (unmanaged.length > 0) {
    const dates = unmanaged.map((s) => (s as { session_date: string }).session_date).join(", ");
    return {
      ok: false,
      blockers: [
        `Assign a trip leader for: ${dates} — Trip days tab → expand the date → pick leader → Save.`,
      ],
    };
  }

  const { data: rosterRows, error: rosterErr } = await supabase
    .from("event_roster_bookings")
    .select("id, outbound_transport_mode, transport_med_bag_required, booking_status")
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");
  if (rosterErr && !isSchemaMismatchError(rosterErr)) {
    return { ok: false, blockers: [`DB error: ${rosterErr.message}`] };
  }

  if (!rosterErr) {
    const busOutboundUnset = (rosterRows ?? []).filter((r) => {
      const row = r as {
        outbound_transport_mode: string | null;
        transport_med_bag_required: string | null;
      };
      const mode = row.outbound_transport_mode ?? "bus";
      if (mode !== "bus") return false;
      return (row.transport_med_bag_required ?? "not_set") === "not_set";
    });
    if (busOutboundUnset.length > 0) {
      return {
        ok: false,
        blockers: [
          `${busOutboundUnset.length} bus passenger${busOutboundUnset.length === 1 ? "" : "s"} still need a transport med bag decision — Roster → Edit booking → Transport med bag.`,
        ],
      };
    }
  }

  return { ok: true, blockers: [] };
}

/** Confirmed → Open: start_date ≤ today (local timezone); at least one venue stop per day. */
async function guardConfirmedToOpen(eventId: string, startDate: string): Promise<StatusGuardResult> {
  const today = todayLocalIso();
  if (startDate > today) {
    return {
      ok: false,
      blockers: [`Event starts ${startDate} — cannot open before start date (today is ${today}).`],
    };
  }

  await ensureEventItineraryStops(eventId);

  const { data: stops } = await supabase
    .from("event_venue_stops")
    .select("session_date")
    .eq("event_id", eventId);
  if (!stops || stops.length === 0) {
    return {
      ok: false,
      blockers: [
        "No venue stops in the itinerary — set Primary venue on Details & Config, or add stops on the Itinerary tab.",
      ],
    };
  }

  const { data: sessions, error: sessErr } = await supabase
    .from("event_day_sessions")
    .select("id, session_date, manager_staff_id")
    .eq("event_id", eventId);
  if (sessErr) return { ok: false, blockers: [`DB error: ${sessErr.message}`] };

  const unmanaged = (sessions ?? []).filter(
    (s) => !(s as { manager_staff_id: string | null }).manager_staff_id,
  );
  if (unmanaged.length > 0) {
    const dates = unmanaged
      .map((s) => (s as { session_date: string }).session_date)
      .join(", ");
    return {
      ok: false,
      blockers: [
        `Assign a trip leader for: ${dates} — Trip days tab → expand the date → pick leader → Save.`,
      ],
    };
  }

  return { ok: true, blockers: [] };
}

/** Open → Closed: all day sessions must be closed (orderly or incident). */
async function guardOpenToClosed(eventId: string): Promise<StatusGuardResult> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("id, session_date, phase")
    .eq("event_id", eventId);
  if (error) return { ok: false, blockers: [`DB error: ${error.message}`] };

  const sessions = data ?? [];
  const open = sessions.filter((s) => {
    const phase = (s as { phase: string }).phase;
    return phase !== "closed_orderly" && phase !== "closed_incident";
  });

  if (open.length > 0) {
    const dates = open.map((s) => (s as { session_date: string }).session_date).join(", ");
    return {
      ok: false,
      blockers: [`Day sessions not yet closed: ${dates}. Close each day session before closing the event.`],
    };
  }

  // Check for open RED issues linked to this event's sessions.
  const sessionIds = sessions.map((s) => (s as { id: string }).id);
  if (sessionIds.length > 0) {
    const { data: openIssues } = await supabase
      .from("site_issues_register")
      .select("id")
      .in("session_id", sessionIds)
      .eq("status", "open")
      .eq("severity", "red");
    if (openIssues && openIssues.length > 0) {
      return {
        ok: false,
        blockers: [
          `${openIssues.length} open RED issue${openIssues.length > 1 ? "s" : ""} must be resolved before closing the event.`,
        ],
      };
    }
  }

  return { ok: true, blockers: [] };
}

// ============================================================================
// Lifecycle transitions
// ============================================================================

export async function checkPromoteGuards(
  eventId: string,
  startDate: string,
  from: EventStatus,
): Promise<StatusGuardResult> {
  switch (from) {
    case "Planning": return guardPlanningToConfirmed(eventId);
    case "Confirmed": return guardConfirmedToOpen(eventId, startDate);
    case "Open": return guardOpenToClosed(eventId);
    default: return { ok: false, blockers: ["Event is already Closed."] };
  }
}

const STATUS_SEQUENCE: EventStatus[] = ["Planning", "Confirmed", "Open", "Closed"];

function nextStatus(from: EventStatus): EventStatus | null {
  const idx = STATUS_SEQUENCE.indexOf(from);
  return idx >= 0 && idx < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[idx + 1] : null;
}

export async function promoteEventStatus(
  eventId: string,
  startDate: string,
  currentStatus: EventStatus,
): Promise<{ newStatus: EventStatus }> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can change event status.");

  const next = nextStatus(currentStatus);
  if (!next) throw new Error("Event is already Closed — no further transitions.");

  const guards = await checkPromoteGuards(eventId, startDate, currentStatus);
  if (!guards.ok) {
    throw new Error(`Cannot promote: ${guards.blockers.join(" · ")}`);
  }

  const staffId = await resolveStaffIdWithFallback();
  const patch: Record<string, unknown> = { status: next };

  // Closing: lock billing + record closed_at, closed_by.
  if (next === "Closed") {
    // §1.1 — ledger write FIRST for billing lock.
    try {
      await writeToLedgerOrThrow({
        staff_id: staffId,
        category: "CENTRE",
        severity: "RED",
        action_type: "EVENT_BILLING_LOCKED",
        gps_lat: null,
        gps_lng: null,
        metadata: { event_id: eventId, reason: "Event closed — billing locked by manager." },
      });
    } catch (e) {
      throw new Error(`Billing lock ledger write failed — event NOT closed. Retry. (${(e as Error).message})`);
    }
    patch.billing_locked = true;
    patch.closed_at = new Date().toISOString();
    patch.closed_by_id = staffId;
  }

  const { error } = await supabase
    .from("event_manifest")
    .update(patch)
    .eq("id", eventId);
  if (error) throw new Error(`Status update failed: ${error.message}`);

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: next === "Closed" ? "RED" : "INFO",
    action_type: `EVENT_STATUS_${next.toUpperCase()}`,
    gps_lat: null,
    gps_lng: null,
    metadata: { event_id: eventId, from: currentStatus, to: next },
  });

  return { newStatus: next };
}

/** Close a specific event_day_session (orderly or incident). Manager-only. */
export async function closeEventDaySession(
  sessionId: string,
  outcome: "closed_orderly" | "closed_incident",
  notes: string,
): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can close day sessions.");

  const staffId = await resolveStaffIdWithFallback();
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("event_day_sessions")
    .update({
      phase: outcome,
      closed_by_id: staffId,
      close_declared_at: nowIso,
      close_leader_notes: notes || null,
    })
    .eq("id", sessionId);
  if (error) throw new Error(`Close failed: ${error.message}`);

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: outcome === "closed_incident" ? "RED" : "GREEN",
    action_type: outcome === "closed_incident" ? "EVENT_DAY_CLOSED_INCIDENT" : "EVENT_DAY_CLOSED_ORDERLY",
    gps_lat: null,
    gps_lng: null,
    metadata: { session_id: sessionId, notes: notes || null },
  });
}

// ============================================================================
// Trip Report read model (§12.8)
// ============================================================================

export interface TripReportVenueStop {
  sessionDate: string;
  stopOrder: number;
  venueName: string | null;
  venueType: string | null;
  labelOverride: string | null;
}

export interface TripReportDaySession {
  sessionDate: string;
  phase: string;
  managerName: string | null;
  curfewTime: string | null;
  morningRollTime: string | null;
  busManifestTotal: number;
  busManifestOnBus: number;
  busManifestNotTravelling: number;
  curfewTotal: number;
  curfewAccounted: number;
  curfewAbsent: number;
  curfewYellow: number;
  curfewRed: number;
  morningTotal: number;
  morningAccounted: number;
  morningAbsent: number;
  morningYellow: number;
  morningRed: number;
}

export interface TripReportRosterEntry {
  participantName: string;
  bookingStatus: string;
  /** Actual outbound from event-floor roll (arrival method), when recorded. */
  outboundTransportMode: string;
  /** Actual return from departure handover, when recorded. */
  returnTransportMode: string;
  /** Roster booking plan — for contrast when floor ops differed. */
  plannedOutboundTransportMode: string;
  plannedReturnTransportMode: string;
  amountPaid: number;
  customPrice: number | null;
}

export interface TripReportFinance {
  ticketRevenue: number;
  vendorExpenses: number;
  netPnl: number;
}

export interface TripReport {
  eventId: string;
  title: string;
  eventKind: string;
  status: string;
  startDate: string;
  endDate: string | null;
  primaryVenueName: string | null;
  generatedAt: string;

  venueStops: TripReportVenueStop[];
  daySessions: TripReportDaySession[];
  roster: TripReportRosterEntry[];
  finance: TripReportFinance;

  rosterSummary: {
    confirmed: number;
    cancelled: number;
    total: number;
  };
  accountabilitySummary: {
    totalRedIssues: number;
    totalYellowIssues: number;
    allSessionsClosed: boolean;
  };
}

export async function buildTripReport(eventId: string): Promise<TripReport> {
  // Fetch core data in parallel; day sessions use listEventDaySessions (no broken join).
  const [
    eventResult,
    stopsResult,
    rosterResult,
    daySessionRows,
    finance,
  ] = await Promise.all([
    supabase
      .from("event_manifest")
      .select("*, venues!event_manifest_primary_venue_id_fkey(name)")
      .eq("id", eventId)
      .single(),
    supabase
      .from("event_venue_stops")
      .select("*, venues(name, venue_type)")
      .eq("event_id", eventId)
      .order("session_date")
      .order("stop_order"),
    supabase
      .from("event_roster_bookings")
      .select("*, participants!inner(first_name, last_name)")
      .eq("event_id", eventId)
      .order("created_at"),
    listEventDaySessions(eventId),
    getEventFinanceTotals(eventId),
  ]);

  const actualTransportByParticipant = await fetchActualTransportForSessions(daySessionRows);

  if (eventResult.error) throw new Error(`Event not found: ${eventResult.error.message}`);
  const ev = eventResult.data as Record<string, unknown>;
  const vName = (ev.venues as { name?: string } | null)?.name ?? null;

  const stops: TripReportVenueStop[] = (stopsResult.data ?? []).map((s) => {
    const v = (s as { venues?: { name?: string; venue_type?: string } | null }).venues;
    return {
      sessionDate: (s as { session_date: string }).session_date,
      stopOrder: (s as { stop_order: number }).stop_order,
      venueName: v?.name ?? null,
      venueType: v?.venue_type ?? null,
      labelOverride: (s as { label_override: string | null }).label_override,
    };
  });

  // Accountability counts per day session.
  const sessionIds = daySessionRows.map((s) => s.id);
  const [curfewResult, morningResult, busResult] = await Promise.all([
    sessionIds.length
      ? supabase
          .from("event_curfew_log")
          .select("event_day_session_id, status, escalation_severity")
          .in("event_day_session_id", sessionIds)
      : { data: [], error: null },
    sessionIds.length
      ? supabase
          .from("event_morning_log")
          .select("event_day_session_id, status, escalation_severity")
          .in("event_day_session_id", sessionIds)
      : { data: [], error: null },
    sessionIds.length
      ? supabase
          .from("event_bus_manifest")
          .select("event_day_session_id, status")
          .in("event_day_session_id", sessionIds)
      : { data: [], error: null },
  ]);

  function countBy<T extends Record<string, unknown>>(
    rows: T[],
    sessionId: string,
    field: keyof T,
    value: unknown,
  ) {
    return rows.filter((r) => r.event_day_session_id === sessionId && r[field] === value).length;
  }
  function sessionRows<T extends Record<string, unknown>>(rows: T[], sid: string) {
    return rows.filter((r) => r.event_day_session_id === sid);
  }

  const curfewRows = (curfewResult.data ?? []) as Array<Record<string, unknown>>;
  const morningRows = (morningResult.data ?? []) as Array<Record<string, unknown>>;
  const busRows = (busResult.data ?? []) as Array<Record<string, unknown>>;

  const daySessions: TripReportDaySession[] = daySessionRows.map((s) => {
    const sid = s.id;
    const cr = sessionRows(curfewRows, sid);
    const mr = sessionRows(morningRows, sid);
    const br = sessionRows(busRows, sid);
    return {
      sessionDate: s.session_date,
      phase: s.phase,
      managerName: s.manager_name ?? null,
      curfewTime: s.curfew_time ?? null,
      morningRollTime: s.morning_roll_time ?? null,
      busManifestTotal: br.length,
      busManifestOnBus: br.filter((r) => r.status === "on_bus").length,
      busManifestNotTravelling: br.filter((r) => r.status === "not_travelling").length,
      curfewTotal: cr.length,
      curfewAccounted: cr.filter((r) => r.status === "accounted").length,
      curfewAbsent: cr.filter((r) => r.status === "absent").length,
      curfewYellow: cr.filter((r) => r.escalation_severity === "yellow").length,
      curfewRed: cr.filter((r) => r.escalation_severity === "red").length,
      morningTotal: mr.length,
      morningAccounted: mr.filter((r) => r.status === "accounted").length,
      morningAbsent: mr.filter((r) => r.status === "absent").length,
      morningYellow: mr.filter((r) => r.escalation_severity === "yellow").length,
      morningRed: mr.filter((r) => r.escalation_severity === "red").length,
    };
  });

  const rosterRaw = (rosterResult.data ?? []) as Array<Record<string, unknown>>;
  const roster: TripReportRosterEntry[] = rosterRaw.map((b) => {
    const p = b.participants as { first_name?: string; last_name?: string } | null;
    const participantId = b.participant_id as string;
    const plannedOutbound = (b.outbound_transport_mode as string) ?? "bus";
    const plannedReturn = (b.return_transport_mode as string) ?? "bus";
    const actual = actualTransportByParticipant.get(participantId);
    return {
      participantName: p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "(unknown)" : "(unknown)",
      bookingStatus: (b.booking_status as string) ?? "Unknown",
      outboundTransportMode: actual?.outbound ?? plannedOutbound,
      returnTransportMode: actual?.return ?? plannedReturn,
      plannedOutboundTransportMode: plannedOutbound,
      plannedReturnTransportMode: plannedReturn,
      amountPaid: Number(b.amount_paid ?? 0),
      customPrice: b.custom_price != null ? Number(b.custom_price) : null,
    };
  });

  const confirmed = roster.filter((r) => r.bookingStatus !== "Cancelled").length;
  const cancelled = roster.filter((r) => r.bookingStatus === "Cancelled").length;
  const totalRedIssues = daySessions.reduce((s, d) => s + d.curfewRed + d.morningRed, 0);
  const totalYellowIssues = daySessions.reduce((s, d) => s + d.curfewYellow + d.morningYellow, 0);
  const allSessionsClosed = daySessions.every(
    (d) => d.phase === "closed_orderly" || d.phase === "closed_incident",
  );

  return {
    eventId,
    title: ev.title as string,
    eventKind: (ev.event_kind as string) ?? "legacy",
    status: (ev.status as string) ?? "Planning",
    startDate: ev.start_date as string,
    endDate: (ev.end_date as string | null) ?? null,
    primaryVenueName: vName,
    generatedAt: new Date().toISOString(),
    venueStops: stops,
    daySessions,
    roster,
    finance: {
      ticketRevenue: finance.ticketRevenue,
      vendorExpenses: finance.vendorExpenses,
      netPnl: finance.netPnl,
    },
    rosterSummary: { confirmed, cancelled, total: roster.length },
    accountabilitySummary: { totalRedIssues, totalYellowIssues, allSessionsClosed },
  };
}

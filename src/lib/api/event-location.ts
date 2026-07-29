/**
 * event-location.ts — hard open/close location (§12.4.1 / Phase 8)
 *
 * Trip leader opens the temporary centre (phase → active) or closes after
 * departure handover (phase → closed_orderly | closed_incident).
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback, verifyCoordinatorPin } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { hasOpenRedIssueForSession } from "@/lib/api/site-issues";
import { seedAttendanceWithOvernightContinuity } from "@/lib/api/event-day-continuity";
import {
  assertDaySessionCloseable,
  assertPriorDayClosedBeforeOpen,
} from "@/lib/api/event-lifecycle-gates";
import {
  assertOvernightDaysEndAtHotel,
  type EventDaySession,
} from "@/lib/api/event-outing";
import { operationalNowIso } from "@/lib/operational-clock";

const OPEN_FROM_PHASES = new Set(["planning", "pre_departure"]);
const LOCATION_LIVE_PHASES = new Set(["active", "pre_departure", "in_transit", "at_base"]);
const CLOSABLE_PHASES = new Set(["active", "pre_departure", "in_transit", "at_base"]);

export function isEventLocationOpen(phase: string): boolean {
  return LOCATION_LIVE_PHASES.has(phase);
}

export function isEventLocationClosed(phase: string): boolean {
  return phase === "closed_orderly" || phase === "closed_incident";
}

async function getSession(sessionId: string): Promise<EventDaySession & { event_id: string }> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error) throw new Error(`Trip day not found: ${error.message}`);
  return data as EventDaySession & { event_id: string };
}

async function assertTripLeaderPin(tripLeaderStaffId: string, pin: string): Promise<void> {
  if (!tripLeaderStaffId) throw new Error("Assign a trip leader before opening the location.");
  const ok = await verifyCoordinatorPin(tripLeaderStaffId, pin);
  if (!ok) throw new Error("Invalid manager PIN.");
}

/** Hard open — event floor starts (§12.4.1 / BL-070). */
export async function openEventLocation(input: {
  sessionId: string;
  managerPin: string;
  notes?: string;
  /** Labels ticked on Open location walkthrough (empty = high-trust / none configured). */
  venueOpenChecksCompleted?: string[];
}): Promise<EventDaySession> {
  const session = await getSession(input.sessionId);

  if (!OPEN_FROM_PHASES.has(session.phase)) {
    throw new Error(`Location cannot open from phase "${session.phase}".`);
  }
  const tripLeaderId = session.manager_staff_id;
  if (!tripLeaderId) {
    throw new Error("Assign a trip leader before opening the location.");
  }

  await assertTripLeaderPin(tripLeaderId, input.managerPin);

  if (await hasOpenRedIssueForSession(input.sessionId)) {
    throw new Error("Open RED issue on this trip day — resolve before opening the location.");
  }

  await assertPriorDayClosedBeforeOpen({
    eventId: session.event_id,
    sessionId: input.sessionId,
  });

  // BL-T3 / BL-072 — overnight itinerary must end at hotel (final day exempt).
  await assertOvernightDaysEndAtHotel(session.event_id);

  // BL-098 — guest bookings must be complete before floor open.
  const { listIncompleteGuestBookings, formatGuestIncompleteMessage } =
    await import("@/lib/api/event-guest");
  const incompleteGuests = await listIncompleteGuestBookings(session.event_id);
  if (incompleteGuests.length > 0) {
    throw new Error(formatGuestIncompleteMessage(incompleteGuests));
  }

  const actorStaffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  const { data, error } = await supabase
    .from("event_day_sessions")
    .update({
      phase: "active",
      opened_by_id: tripLeaderId,
      open_declared_at: nowIso,
      open_leader_notes: input.notes?.trim() || null,
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error) throw error;

  await seedAttendanceWithOvernightContinuity({
    sessionId: input.sessionId,
    eventId: session.event_id,
    sessionDate: session.session_date,
    actorStaffId: tripLeaderId,
    source: "location_open",
  });

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: actorStaffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "EVENT_LOCATION_OPENED",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: input.sessionId,
      event_id: session.event_id,
      session_date: session.session_date,
      notes: input.notes ?? null,
      venue_open_checks: input.venueOpenChecksCompleted ?? [],
    },
  });

  return data as EventDaySession;
}

/** Hard close — after departure handover (§12.4.1). */
export async function closeEventLocation(input: {
  sessionId: string;
  managerPin: string;
  outcome: "closed_orderly" | "closed_incident";
  notes?: string;
}): Promise<EventDaySession> {
  const session = await getSession(input.sessionId);

  if (!CLOSABLE_PHASES.has(session.phase)) {
    if (isEventLocationClosed(session.phase)) {
      throw new Error("Location is already closed.");
    }
    throw new Error("Location is not open yet.");
  }

  await assertDaySessionCloseable({
    eventId: session.event_id,
    sessionId: input.sessionId,
    sessionDate: session.session_date,
  });

  const tripLeaderId = session.manager_staff_id;
  if (!tripLeaderId) {
    throw new Error("Assign a trip leader before closing the location.");
  }

  await assertTripLeaderPin(tripLeaderId, input.managerPin);

  const actorStaffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();
  const { data, error } = await supabase
    .from("event_day_sessions")
    .update({
      phase: input.outcome,
      closed_by_id: tripLeaderId,
      close_declared_at: nowIso,
      close_leader_notes: input.notes?.trim() || null,
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: actorStaffId,
    category: "CENTRE",
    severity: input.outcome === "closed_incident" ? "RED" : "GREEN",
    action_type:
      input.outcome === "closed_incident"
        ? "EVENT_LOCATION_CLOSED_INCIDENT"
        : "EVENT_LOCATION_CLOSED_ORDERLY",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      event_day_session_id: input.sessionId,
      event_id: session.event_id,
      notes: input.notes ?? null,
    },
  });

  return data as EventDaySession;
}

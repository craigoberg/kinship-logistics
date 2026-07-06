/**
 * event-location.ts — hard open/close location (§12.4.1 / Phase 8)
 *
 * Trip leader opens the temporary centre (phase → active) or closes after
 * departure handover (phase → closed_orderly | closed_incident).
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback, verifyStaffPin } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { hasOpenRedIssueForSession } from "@/lib/api/site-issues";
import {
  listStillCheckedIn,
  seedEventAttendanceRoll,
} from "@/lib/api/event-attendance";
import type { EventDaySession } from "@/lib/api/event-outing";

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

async function assertManagerPin(staffId: string, pin: string): Promise<void> {
  const profile = await verifyStaffPin(staffId, pin);
  if (!profile) throw new Error("Invalid manager PIN.");
  const allowed = await canManageSystemParameters(staffId);
  if (!allowed) throw new Error("Only Managers can open or close the event location.");
}

/** Hard open — event floor starts (§12.4.1). */
export async function openEventLocation(input: {
  sessionId: string;
  managerPin: string;
  notes?: string;
}): Promise<EventDaySession> {
  const session = await getSession(input.sessionId);

  if (!OPEN_FROM_PHASES.has(session.phase)) {
    throw new Error(`Location cannot open from phase "${session.phase}".`);
  }
  if (!session.manager_staff_id) {
    throw new Error("Assign a trip leader before opening the location.");
  }

  const staffId = await resolveStaffIdWithFallback();
  await assertManagerPin(staffId, input.managerPin);

  if (await hasOpenRedIssueForSession(input.sessionId)) {
    throw new Error("Open RED issue on this trip day — resolve before opening the location.");
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("event_day_sessions")
    .update({
      phase: "active",
      opened_by_id: staffId,
      open_declared_at: nowIso,
      open_leader_notes: input.notes?.trim() || null,
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error) throw error;

  await seedEventAttendanceRoll(
    input.sessionId,
    session.event_id,
    session.session_date,
  );

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
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

  const stillIn = await listStillCheckedIn(input.sessionId);
  if (stillIn.length > 0) {
    throw new Error(
      `Departure handover incomplete — still checked in: ${stillIn.join(", ")}. Check out each participant first.`,
    );
  }

  const staffId = await resolveStaffIdWithFallback();
  await assertManagerPin(staffId, input.managerPin);

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("event_day_sessions")
    .update({
      phase: input.outcome,
      closed_by_id: staffId,
      close_declared_at: nowIso,
      close_leader_notes: input.notes?.trim() || null,
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error) throw error;

  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
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

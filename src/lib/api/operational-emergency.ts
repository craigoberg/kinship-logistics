/**
 * BL-084 Phase B + C MVP — site lockdown / programme suspend + Drill|Live emergency.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { createIssue, markResolved } from "@/lib/api/site-issues";
import { writeToLedger, tryGetGps, writeToLedgerOrThrow } from "@/lib/api/ledger";
import { listAttendanceRoll } from "@/lib/api/client-attendance";
import { emitMockSms } from "@/lib/notifications/mock-sms";
import { setPhase } from "@/lib/api/site-day-sessions";

export type EmergencyMode = "drill" | "live";
export type EmergencySeverity = "yellow" | "red";
export type EmergencyStatus = "active" | "stood_down";
export type EmergencySurface = "centre" | "trip" | "manifest";
export type MusterState = "expected" | "accounted" | "missing";

export interface OperationalEmergency {
  id: string;
  mode: EmergencyMode;
  severity: EmergencySeverity;
  situationText: string;
  status: EmergencyStatus;
  siteDaySessionId: string | null;
  eventId: string | null;
  eventDaySessionId: string | null;
  surface: EmergencySurface;
  activatedByStaffId: string;
  activatedAt: string;
  stoodDownByStaffId: string | null;
  stoodDownAt: string | null;
  debriefText: string | null;
  hubIssueId: string | null;
}

export interface MusterLine {
  id: string;
  emergencyId: string;
  participantId: string;
  participantName: string | null;
  state: MusterState;
  updatedAt: string;
}

interface EmergencyRow {
  id: string;
  mode: string;
  severity: string;
  situation_text: string;
  status: string;
  site_day_session_id: string | null;
  event_id: string | null;
  event_day_session_id: string | null;
  surface: string;
  activated_by_staff_id: string;
  activated_at: string;
  stood_down_by_staff_id: string | null;
  stood_down_at: string | null;
  debrief_text: string | null;
  hub_issue_id: string | null;
}

interface MusterRow {
  id: string;
  emergency_id: string;
  participant_id: string;
  participant_name: string | null;
  state: string;
  updated_at: string;
}

function rowToEmergency(r: EmergencyRow): OperationalEmergency {
  return {
    id: r.id,
    mode: r.mode as EmergencyMode,
    severity: r.severity as EmergencySeverity,
    situationText: r.situation_text,
    status: r.status as EmergencyStatus,
    siteDaySessionId: r.site_day_session_id,
    eventId: r.event_id,
    eventDaySessionId: r.event_day_session_id,
    surface: r.surface as EmergencySurface,
    activatedByStaffId: r.activated_by_staff_id,
    activatedAt: r.activated_at,
    stoodDownByStaffId: r.stood_down_by_staff_id,
    stoodDownAt: r.stood_down_at,
    debriefText: r.debrief_text,
    hubIssueId: r.hub_issue_id,
  };
}

function rowToMuster(r: MusterRow): MusterLine {
  return {
    id: r.id,
    emergencyId: r.emergency_id,
    participantId: r.participant_id,
    participantName: r.participant_name,
    state: r.state as MusterState,
    updatedAt: r.updated_at,
  };
}

function schemaHint(err: { message?: string } | null): string {
  const m = err?.message ?? "";
  if (
    m.includes("operational_emergencies") ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  ) {
    return " Run docs/sql/2026-07-29_operational_emergencies_mvp.sql on this database.";
  }
  return "";
}

/** Hub timeline stamp so Governance Active / Resolved can review Drill|Live. */
async function stampEmergencyHubNote(args: {
  issueId: string;
  eventDaySessionId?: string | null;
  staffId: string;
  note: string;
  kind: "append" | "resolve";
}): Promise<void> {
  const source = args.eventDaySessionId ? "event" : "day_centre";
  const { error } = await supabase.from("hub_issue_notes").insert({
    source,
    source_row_id: args.issueId,
    note: args.note.trim(),
    kind: args.kind,
    staff_id: args.staffId || null,
  });
  if (error) {
    console.warn("[operational-emergency] hub note failed", error);
  }
}

export async function listActiveEmergencies(): Promise<OperationalEmergency[]> {
  const { data, error } = await supabase
    .from("operational_emergencies")
    .select("*")
    .eq("status", "active")
    .order("activated_at", { ascending: false });
  if (error) {
    if (error.message?.includes("does not exist") || error.code === "42P01") {
      return [];
    }
    throw error;
  }
  return (data ?? []).map((r) => rowToEmergency(r as EmergencyRow));
}

/** Open Hub tickets for Drill/Live that still need office review (incl. after stand-down). */
export async function listOpenEmergencyHubIssues(): Promise<
  Array<{
    id: string;
    title: string;
    severity: EmergencySeverity;
    modeHint: "drill" | "live" | "other";
  }>
> {
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("id, issue_description, severity, status")
    .eq("status", "open")
    .eq("issue_area", "health_safety")
    .or(
      "issue_description.ilike.%[DRILL EMERGENCY]%,issue_description.ilike.%[LIVE EMERGENCY]%",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (error.message?.includes("issue_area")) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const desc = String(
      (r as { issue_description?: string }).issue_description ?? "",
    );
    const modeHint: "drill" | "live" | "other" = desc.includes("[LIVE EMERGENCY]")
      ? "live"
      : desc.includes("[DRILL EMERGENCY]")
        ? "drill"
        : "other";
    return {
      id: String((r as { id: string }).id),
      title: desc || "Emergency Hub issue",
      severity: ((r as { severity?: string }).severity === "yellow"
        ? "yellow"
        : "red") as EmergencySeverity,
      modeHint,
    };
  });
}

export async function getActiveEmergencyForContext(args: {
  siteDaySessionId?: string | null;
  eventDaySessionId?: string | null;
}): Promise<OperationalEmergency | null> {
  let q = supabase
    .from("operational_emergencies")
    .select("*")
    .eq("status", "active")
    .limit(1);

  if (args.siteDaySessionId) {
    q = q.eq("site_day_session_id", args.siteDaySessionId);
  } else if (args.eventDaySessionId) {
    q = q.eq("event_day_session_id", args.eventDaySessionId);
  } else {
    const all = await listActiveEmergencies();
    return all[0] ?? null;
  }

  const { data, error } = await q.maybeSingle();
  if (error) {
    if (error.message?.includes("does not exist") || error.code === "42P01") {
      return null;
    }
    throw error;
  }
  return data ? rowToEmergency(data as EmergencyRow) : null;
}

export async function listMusterLines(emergencyId: string): Promise<MusterLine[]> {
  const { data, error } = await supabase
    .from("operational_emergency_muster")
    .select("*")
    .eq("emergency_id", emergencyId)
    .order("participant_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToMuster(r as MusterRow));
}

async function seedMusterFromCentreRoll(
  emergencyId: string,
  siteDaySessionId: string,
): Promise<void> {
  const roll = await listAttendanceRoll(siteDaySessionId);
  const inCare = roll.filter(
    (r) => r.status === "checked_in" || r.status === "expected",
  );
  if (!inCare.length) return;

  const names = new Map<string, string>();
  const ids = inCare.map((r) => r.participantId);
  const { data: parts } = await supabase
    .from("participants")
    .select("id, first_name, last_name")
    .in("id", ids);
  for (const p of parts ?? []) {
    const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Participant";
    names.set(p.id as string, name);
  }

  const rows = inCare.map((r) => ({
    emergency_id: emergencyId,
    participant_id: r.participantId,
    participant_name: names.get(r.participantId) ?? null,
    state: "expected" as const,
  }));

  const { error } = await supabase
    .from("operational_emergency_muster")
    .upsert(rows, { onConflict: "emergency_id,participant_id", ignoreDuplicates: true });
  if (error) console.warn("[operational-emergency] muster seed centre", error);
}

async function seedMusterFromEventRoll(
  emergencyId: string,
  eventDaySessionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("event_attendance_log")
    .select("participant_id, status, participants(first_name, last_name)")
    .eq("event_day_session_id", eventDaySessionId);
  if (error) {
    console.warn("[operational-emergency] muster seed trip", error);
    return;
  }
  const inCare = (data ?? []).filter((r) => {
    const s = String(r.status ?? "");
    return s === "checked_in" || s === "expected" || s === "arrived";
  });
  if (!inCare.length) return;

  const rows = inCare.map((r) => {
    const p = r.participants as
      | { first_name?: string; last_name?: string }
      | null
      | undefined;
    const name = p
      ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()
      : null;
    return {
      emergency_id: emergencyId,
      participant_id: r.participant_id as string,
      participant_name: name || null,
      state: "expected" as const,
    };
  });

  const { error: insErr } = await supabase
    .from("operational_emergency_muster")
    .upsert(rows, { onConflict: "emergency_id,participant_id", ignoreDuplicates: true });
  if (insErr) console.warn("[operational-emergency] muster upsert trip", insErr);
}

export async function activateEmergency(input: {
  mode: EmergencyMode;
  severity: EmergencySeverity;
  situationText: string;
  surface: EmergencySurface;
  siteDaySessionId?: string | null;
  eventId?: string | null;
  eventDaySessionId?: string | null;
  managerStaffId: string;
}): Promise<OperationalEmergency> {
  const situation = input.situationText.trim();
  if (situation.length < 10) {
    throw new Error("Describe the situation (at least 10 characters).");
  }
  if (!input.managerStaffId) {
    throw new Error("Manager staff id required.");
  }

  const existing = await getActiveEmergencyForContext({
    siteDaySessionId: input.siteDaySessionId,
    eventDaySessionId: input.eventDaySessionId,
  });
  if (existing) {
    throw new Error("An emergency is already active for this context. Stand it down first.");
  }

  const modeLabel = input.mode === "drill" ? "DRILL" : "LIVE";
  // Keep Hub status clearly OPEN (do not pass a workaround — createIssue
  // auto-stamps workaround_accepted_at when a plan is present, which hides
  // the urgency of an active emergency in the Governance list).
  const issue = await createIssue({
    sessionId: input.siteDaySessionId ?? null,
    eventId: input.eventId ?? undefined,
    eventDaySessionId: input.eventDaySessionId ?? undefined,
    severity: input.severity,
    issueDescription: `[${modeLabel} EMERGENCY] ${situation}`,
    workaroundPlan: null,
    owner: "internal",
    issueArea: "health_safety",
  });

  const { data, error } = await supabase
    .from("operational_emergencies")
    .insert({
      mode: input.mode,
      severity: input.severity,
      situation_text: situation,
      status: "active",
      site_day_session_id: input.siteDaySessionId ?? null,
      event_id: input.eventId ?? null,
      event_day_session_id: input.eventDaySessionId ?? null,
      surface: input.surface,
      activated_by_staff_id: input.managerStaffId,
      hub_issue_id: issue.id,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`${error.message}.${schemaHint(error)}`);
  }

  const emergency = rowToEmergency(data as EmergencyRow);

  await stampEmergencyHubNote({
    issueId: issue.id,
    eventDaySessionId: input.eventDaySessionId,
    staffId: input.managerStaffId,
    note: `[${modeLabel} EMERGENCY] Activated — muster in progress. Stand-down when accounted.`,
    kind: "append",
  });

  if (input.siteDaySessionId) {
    await seedMusterFromCentreRoll(emergency.id, input.siteDaySessionId);
  } else if (input.eventDaySessionId) {
    await seedMusterFromEventRoll(emergency.id, input.eventDaySessionId);
  }

  const gps = await tryGetGps();
  await writeToLedgerOrThrow({
    staff_id: input.managerStaffId,
    category: input.surface === "trip" ? "TRIP" : "CENTRE",
    severity: input.severity === "red" ? "RED" : "YELLOW",
    action_type: "EMERGENCY_ACTIVATED",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      emergency_id: emergency.id,
      mode: input.mode,
      severity: input.severity,
      surface: input.surface,
      situation,
      hub_issue_id: issue.id,
    },
  });

  try {
    emitMockSms({
      recipient: "ops-broadcast",
      body: `[Yada ${modeLabel}] ${input.severity.toUpperCase()}: ${situation.slice(0, 140)}`,
      source: "operational-emergency-activate",
    });
  } catch {
    /* mock only */
  }

  return emergency;
}

export async function updateMusterState(args: {
  musterId: string;
  state: MusterState;
  staffId: string;
}): Promise<MusterLine> {
  const { data, error } = await supabase
    .from("operational_emergency_muster")
    .update({
      state: args.state,
      updated_by_staff_id: args.staffId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.musterId)
    .select("*")
    .single();
  if (error) throw error;
  return rowToMuster(data as MusterRow);
}

export async function standDownEmergency(input: {
  emergencyId: string;
  debriefText: string;
  managerStaffId: string;
}): Promise<OperationalEmergency> {
  const debrief = input.debriefText.trim();
  if (debrief.length < 10) {
    throw new Error("Debrief note required (at least 10 characters).");
  }

  const { data: prior, error: loadErr } = await supabase
    .from("operational_emergencies")
    .select("*")
    .eq("id", input.emergencyId)
    .single();
  if (loadErr || !prior) throw loadErr ?? new Error("Emergency not found.");
  const current = rowToEmergency(prior as EmergencyRow);
  if (current.status !== "active") {
    throw new Error("Emergency is already stood down.");
  }

  const { data, error } = await supabase
    .from("operational_emergencies")
    .update({
      status: "stood_down",
      stood_down_by_staff_id: input.managerStaffId,
      stood_down_at: new Date().toISOString(),
      debrief_text: debrief,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.emergencyId)
    .select("*")
    .single();
  if (error) throw error;

  const modeLabel = current.mode === "drill" ? "DRILL" : "LIVE";
  if (current.hubIssueId) {
    try {
      // Stand-down restores floor ops but Hub issue stays OPEN for office review
      // (manager Resolve / Defer). Do not markResolved here.
      await stampEmergencyHubNote({
        issueId: current.hubIssueId,
        eventDaySessionId: current.eventDaySessionId,
        staffId: input.managerStaffId,
        note: `[${modeLabel} STOOD DOWN] Floor cleared. Awaiting Hub review. Debrief: ${debrief}`,
        kind: "append",
      });
      await supabase
        .from("site_issues_register")
        .update({
          workaround_plan: `Stood down — awaiting Hub review. Debrief: ${debrief}`,
          workaround_accepted_at: null,
          status: "open",
        })
        .eq("id", current.hubIssueId);
    } catch (err) {
      console.warn("[operational-emergency] Hub stand-down note failed", err);
    }
  }

  const gps = await tryGetGps();
  await writeToLedgerOrThrow({
    staff_id: input.managerStaffId,
    category: current.surface === "trip" ? "TRIP" : "CENTRE",
    severity: "INFO",
    action_type: "EMERGENCY_STOOD_DOWN",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      emergency_id: current.id,
      mode: current.mode,
      debrief,
      hub_issue_id: current.hubIssueId,
      hub_issue_left_open: true,
    },
  });

  try {
    emitMockSms({
      recipient: "ops-broadcast",
      body: `[Yada] ${current.mode.toUpperCase()} emergency stood down.`,
      source: "operational-emergency-standdown",
    });
  } catch {
    /* mock only */
  }

  return rowToEmergency(data as EmergencyRow);
}

// ─── Phase B: do-not-open / lockdown / programme suspend ────────────────────

export async function declareDoNotOpenCentre(input: {
  siteDaySessionId: string;
  reason: string;
  severity: EmergencySeverity;
  managerStaffId: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new Error("Reason required (at least 10 characters).");

  const issue = await createIssue({
    sessionId: input.siteDaySessionId,
    severity: input.severity,
    issueDescription: `[SITE DO-NOT-OPEN] ${reason}`,
    workaroundPlan: "Centre not opened. Reopen only after Hub clear / manager reopen.",
    owner: "internal",
    issueArea: "health_safety",
  });

  await setPhase(input.siteDaySessionId, "closed_no_go");

  const { error } = await supabase
    .from("site_day_sessions")
    .update({
      close_leader_notes: reason,
      closed_by_id: null,
      close_declared_at: new Date().toISOString(),
      lockdown_hub_issue_id: issue.id,
    })
    .eq("id", input.siteDaySessionId);
  if (error) console.warn("[do-not-open] session update", error);

  await writeToLedgerOrThrow({
    staff_id: input.managerStaffId,
    category: "CENTRE",
    severity: input.severity === "red" ? "RED" : "YELLOW",
    action_type: "SITE_DO_NOT_OPEN",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      session_id: input.siteDaySessionId,
      reason,
      severity: input.severity,
      hub_issue_id: issue.id,
    },
  });
}

export async function declareCentreLockdown(input: {
  siteDaySessionId: string;
  reason: string;
  severity: EmergencySeverity;
  managerStaffId: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new Error("Reason required (at least 10 characters).");

  const issue = await createIssue({
    sessionId: input.siteDaySessionId,
    severity: input.severity,
    issueDescription: `[SITE LOCKDOWN / EARLY CLOSE] ${reason}`,
    workaroundPlan:
      "New arrivals blocked. Complete orderly Day Centre close when everyone is accounted for.",
    owner: "internal",
    issueArea: "health_safety",
  });

  const { error } = await supabase
    .from("site_day_sessions")
    .update({
      lockdown_active: true,
      lockdown_reason: reason,
      lockdown_severity: input.severity,
      lockdown_hub_issue_id: issue.id,
      lockdown_at: new Date().toISOString(),
      lockdown_by_staff_id: input.managerStaffId,
    })
    .eq("id", input.siteDaySessionId);

  if (error) {
    throw new Error(`${error.message}.${schemaHint(error)}`);
  }

  await writeToLedgerOrThrow({
    staff_id: input.managerStaffId,
    category: "CENTRE",
    severity: input.severity === "red" ? "RED" : "YELLOW",
    action_type: "SITE_LOCKDOWN_DECLARED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      session_id: input.siteDaySessionId,
      reason,
      severity: input.severity,
      hub_issue_id: issue.id,
    },
  });
}

export async function clearCentreLockdown(input: {
  siteDaySessionId: string;
  managerStaffId: string;
}): Promise<void> {
  const { data: cur } = await supabase
    .from("site_day_sessions")
    .select("lockdown_hub_issue_id")
    .eq("id", input.siteDaySessionId)
    .maybeSingle();

  const { error } = await supabase
    .from("site_day_sessions")
    .update({
      lockdown_active: false,
      lockdown_reason: null,
      lockdown_severity: null,
      lockdown_at: null,
      lockdown_by_staff_id: null,
    })
    .eq("id", input.siteDaySessionId);
  if (error) throw error;

  const hubId = (cur as { lockdown_hub_issue_id?: string } | null)
    ?.lockdown_hub_issue_id;
  if (hubId) {
    try {
      await markResolved(hubId);
    } catch {
      /* best effort */
    }
  }

  await writeToLedger({
    staff_id: input.managerStaffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SITE_LOCKDOWN_CLEARED",
    gps_lat: null,
    gps_lng: null,
    metadata: { session_id: input.siteDaySessionId },
  });
}

export async function getCentreLockdown(siteDaySessionId: string): Promise<{
  active: boolean;
  reason: string | null;
  severity: EmergencySeverity | null;
} | null> {
  const { data, error } = await supabase
    .from("site_day_sessions")
    .select("lockdown_active, lockdown_reason, lockdown_severity")
    .eq("id", siteDaySessionId)
    .maybeSingle();
  if (error) {
    if (error.message?.includes("lockdown_active")) return null;
    throw error;
  }
  if (!data) return null;
  return {
    active: !!(data as { lockdown_active?: boolean }).lockdown_active,
    reason: (data as { lockdown_reason?: string | null }).lockdown_reason ?? null,
    severity:
      ((data as { lockdown_severity?: string | null }).lockdown_severity as
        | EmergencySeverity
        | null) ?? null,
  };
}

export async function declareProgrammeSuspend(input: {
  eventId: string;
  eventDaySessionId: string;
  reason: string;
  severity: EmergencySeverity;
  managerStaffId: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new Error("Reason required (at least 10 characters).");

  const issue = await createIssue({
    eventId: input.eventId,
    eventDaySessionId: input.eventDaySessionId,
    severity: input.severity,
    issueDescription: `[PROGRAMME SUSPENDED] ${reason}`,
    workaroundPlan: "Hop / programme start gated until manager clears suspend.",
    owner: "internal",
    issueArea: "health_safety",
  });

  const { error } = await supabase
    .from("event_day_sessions")
    .update({
      programme_suspended: true,
      programme_suspend_reason: reason,
      programme_suspend_severity: input.severity,
      programme_suspend_hub_issue_id: issue.id,
      programme_suspended_at: new Date().toISOString(),
      programme_suspended_by_staff_id: input.managerStaffId,
    })
    .eq("id", input.eventDaySessionId);

  if (error) {
    throw new Error(`${error.message}.${schemaHint(error)}`);
  }

  await writeToLedgerOrThrow({
    staff_id: input.managerStaffId,
    category: "TRIP",
    severity: input.severity === "red" ? "RED" : "YELLOW",
    action_type: "PROGRAMME_SUSPENDED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      event_id: input.eventId,
      event_day_session_id: input.eventDaySessionId,
      reason,
      severity: input.severity,
      hub_issue_id: issue.id,
    },
  });
}

export async function clearProgrammeSuspend(input: {
  eventDaySessionId: string;
  managerStaffId: string;
}): Promise<void> {
  const { data: cur } = await supabase
    .from("event_day_sessions")
    .select("programme_suspend_hub_issue_id")
    .eq("id", input.eventDaySessionId)
    .maybeSingle();

  const { error } = await supabase
    .from("event_day_sessions")
    .update({
      programme_suspended: false,
      programme_suspend_reason: null,
      programme_suspend_severity: null,
      programme_suspended_at: null,
      programme_suspended_by_staff_id: null,
    })
    .eq("id", input.eventDaySessionId);
  if (error) throw error;

  const hubId = (cur as { programme_suspend_hub_issue_id?: string } | null)
    ?.programme_suspend_hub_issue_id;
  if (hubId) {
    try {
      await markResolved(hubId);
    } catch {
      /* best effort */
    }
  }

  await writeToLedger({
    staff_id: input.managerStaffId,
    category: "TRIP",
    severity: "INFO",
    action_type: "PROGRAMME_SUSPEND_CLEARED",
    gps_lat: null,
    gps_lng: null,
    metadata: { event_day_session_id: input.eventDaySessionId },
  });
}

export async function getProgrammeSuspend(eventDaySessionId: string): Promise<{
  active: boolean;
  reason: string | null;
  severity: EmergencySeverity | null;
} | null> {
  const { data, error } = await supabase
    .from("event_day_sessions")
    .select(
      "programme_suspended, programme_suspend_reason, programme_suspend_severity",
    )
    .eq("id", eventDaySessionId)
    .maybeSingle();
  if (error) {
    if (error.message?.includes("programme_suspended")) return null;
    throw error;
  }
  if (!data) return null;
  const row = data as {
    programme_suspended?: boolean;
    programme_suspend_reason?: string | null;
    programme_suspend_severity?: string | null;
  };
  return {
    active: !!row.programme_suspended,
    reason: row.programme_suspend_reason ?? null,
    severity: (row.programme_suspend_severity as EmergencySeverity | null) ?? null,
  };
}

/** Block centre check-in when lockdown active. */
export async function assertCentreNotLockedDown(siteDaySessionId: string): Promise<void> {
  const lock = await getCentreLockdown(siteDaySessionId);
  if (lock?.active) {
    throw new Error(
      `Centre lockdown active${lock.reason ? `: ${lock.reason}` : ""}. No new arrivals until lockdown clears and close completes.`,
    );
  }
}

export { resolveStaffIdWithFallback };

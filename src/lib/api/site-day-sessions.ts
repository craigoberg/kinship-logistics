import { supabase } from "@/integrations/supabase/client";
import {
  resolveStaffIdWithFallback,
  verifyStaffPin,
} from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { getSydneyIsoDate, todaysSydneyDayCode } from "@/lib/operational-time";

// ---------------------------------------------------------------------------
// Empty-Day Opening Shield
// ---------------------------------------------------------------------------
// On weekends, public holidays, or any day with zero active rostered
// participants we MUST NOT raise a "Centre Not Opened" anomaly. Any
// centre-opening sweep should call this first and short-circuit when the
// count is 0 — no site_issues_register insert, no ledger receipt.
export async function countActiveSchedulesForToday(): Promise<number> {
  const code = todaysSydneyDayCode();
  const { count, error } = await supabase
    .from("participant_attendance_schedules")
    .select("id", { count: "exact", head: true })
    .eq("day_of_week", code)
    .eq("active", true);
  if (error) {
    console.error("[countActiveSchedulesForToday] query failed", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Centre-opening sweep gate. Returns true when an overdue-opening anomaly
 * MAY be raised; false when today has zero rostered participants and the
 * sweep must silently abort.
 */
export async function shouldRaiseOverdueOpening(): Promise<boolean> {
  const count = await countActiveSchedulesForToday();
  return count > 0;
}

// ============================================================================
// site_day_sessions — Day Centre open/close + dual-PIN site escalation.
// Schema is assumed to exist per architecture spec. UI surfaces any column
// errors cleanly; we never auto-create.
// ============================================================================

export type SiteSessionPhase =
  | "open_pending"
  | "active_day"
  | "escalated_lock"
  | "closed_orderly"
  | "closed_no_go";

export type HandshakeDecision = "go" | "no_go";

export interface SiteDaySession {
  id: string;
  sessionDate: string; // YYYY-MM-DD
  phase: SiteSessionPhase;
  openedById: string | null;
  openDeclaredAt: string | null;
  openLeaderNotes: string | null;
  closedById: string | null;
  closeDeclaredAt: string | null;
  closeLeaderNotes: string | null;
  managerPlanText: string | null;
  managerDecision: HandshakeDecision | null;
  managerAuthStaffId: string | null;
  managerAuthAt: string | null;
  leaderDecision: HandshakeDecision | null;
  leaderAuthStaffId: string | null;
  leaderAuthAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SiteDaySessionRow {
  id: string;
  session_date: string;
  phase: SiteSessionPhase;
  opened_by_id: string | null;
  open_declared_at: string | null;
  open_leader_notes: string | null;
  closed_by_id: string | null;
  close_declared_at: string | null;
  close_leader_notes: string | null;
  manager_plan_text: string | null;
  manager_decision: HandshakeDecision | null;
  manager_auth_staff_id: string | null;
  manager_auth_at: string | null;
  leader_decision: HandshakeDecision | null;
  leader_auth_staff_id: string | null;
  leader_auth_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSession(r: SiteDaySessionRow): SiteDaySession {
  return {
    id: r.id,
    sessionDate: r.session_date,
    phase: r.phase,
    openedById: r.opened_by_id,
    openDeclaredAt: r.open_declared_at,
    openLeaderNotes: r.open_leader_notes,
    closedById: r.closed_by_id,
    closeDeclaredAt: r.close_declared_at,
    closeLeaderNotes: r.close_leader_notes,
    managerPlanText: r.manager_plan_text,
    managerDecision: r.manager_decision,
    managerAuthStaffId: r.manager_auth_staff_id,
    managerAuthAt: r.manager_auth_at,
    leaderDecision: r.leader_decision,
    leaderAuthStaffId: r.leader_auth_staff_id,
    leaderAuthAt: r.leader_auth_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function todayIso(): string {
  return getSydneyIsoDate();
}

/**
 * Resolve a uuid that satisfies the `opened_by_id`/`closed_by_id` FK
 * (references `auth.users`). Uses the current authenticated session user
 * (auth.uid()). Returns null if there is no signed-in user — the caller
 * will then send null rather than violate the FK with a placeholder uuid.
 *
 * Note: `staff_registry` has no `auth_user_id` column; its `id` is the
 * canonical identifier. We therefore never read a mapping column here.
 */
async function resolveOpenedByUserId(): Promise<string | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user?.id) return auth.user.id;
  } catch {
    /* ignore */
  }
  return null;
}

/** site_day.* ledger event prefix. Best-effort — never blocks the caller. */
async function siteLedger(
  action: string,
  metadata: Record<string, unknown>,
  severity: "RED" | "YELLOW" | "GREEN" | "INFO" = "INFO",
): Promise<void> {
  try {
    const staffId = await resolveStaffIdWithFallback();
    const gps = await tryGetGps();
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity,
      action_type: `site_day.${action}`,
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata,
    });
  } catch (err) {
    console.error("[site_day.ledger] write failed", err);
  }
}

/**
 * Fetch today's site day session if one exists. Returns null when no row
 * exists for today (the StartOfDayPanel will create it on Declare). Only
 * throws on real Postgres/schema errors.
 */
export async function getTodaySession(): Promise<SiteDaySession | null> {
  const date = todayIso();
  console.log("[site_day_sessions] session_date query parameter:", date);
  const { data, error, status } = await supabase
    .from("site_day_sessions")
    .select("*")
    .eq("session_date", date)
    .maybeSingle();
  console.log("[site_day_sessions] query result:", { data, error, status });
  if (error) throw error;
  return data ? rowToSession(data as SiteDaySessionRow) : null;
}

/**
 * Return today's session row if it exists, otherwise insert a fresh row in
 * `open_pending` phase. Written from the browser client under RLS — same
 * path the dual-PIN handshake updates use.
 */
export async function ensureTodaySession(): Promise<SiteDaySession> {
  const existing = await getTodaySession();
  if (existing) return existing;
  const date = todayIso();
  const { data, error } = await supabase
    .from("site_day_sessions")
    .insert({ session_date: date, phase: "open_pending" })
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);
  await siteLedger(
    "initialize",
    { session_id: next.id, session_date: next.sessionDate },
    "INFO",
  );
  return next;
}

/** Declare site safe & open the day. Find-or-create today's row, then flip to active_day. */
export async function openSession(notes: string): Promise<SiteDaySession> {
  const openedByUserId = await resolveOpenedByUserId();
  const date = todayIso();
  const nowIso = new Date().toISOString();


  const existing = await supabase
    .from("site_day_sessions")
    .select("id")
    .eq("session_date", date)
    .maybeSingle();
  if (existing.error) throw existing.error;

  let rowId = existing.data?.id as string | undefined;
  if (!rowId) {
    const created = await supabase
      .from("site_day_sessions")
      .insert({ session_date: date, phase: "open_pending" })
      .select("id")
      .single();
    if (created.error) throw created.error;
    rowId = created.data.id as string;
  }

  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      phase: "active_day",
      opened_by_id: openedByUserId,
      open_declared_at: nowIso,
      open_leader_notes: notes || null,
    })
    .eq("id", rowId!)
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);
  await siteLedger(
    "open",
    { session_id: next.id, session_date: next.sessionDate, notes: notes || null },
    "GREEN",
  );
  return next;
}

export async function closeSession(notes: string): Promise<SiteDaySession> {
  const closedByUserId = await resolveOpenedByUserId();
  const date = todayIso();
  const existing = await supabase
    .from("site_day_sessions")
    .select("id")
    .eq("session_date", date)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error("No session row to close.");

  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      phase: "closed_orderly",
      closed_by_id: closedByUserId,
      close_declared_at: new Date().toISOString(),
      close_leader_notes: notes || null,
    })
    .eq("id", existing.data.id)
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);
  await siteLedger(
    "close",
    { session_id: next.id, session_date: next.sessionDate, notes: notes || null },
    "GREEN",
  );
  return next;
}

/**
 * Reopen a previously closed Day Centre. Manager-authorised only.
 *  - Allowed only when phase === 'closed_orderly' (a 'closed_no_go' hard lock
 *    is NOT unwound by this path).
 *  - Same row, flipped back to active_day; close_* fields cleared so the next
 *    Close cycle can rewrite them cleanly and the DayClosedPanel disappears.
 *  - Audit fact recorded as a single 'site_day.centre_reopened' ledger entry
 *    (severity YELLOW) that carries the prior close stamp + manager reason.
 *  - No attendance / issue / billing rows are mutated.
 */
export async function reopenSession(args: {
  managerStaffId: string;
  pin: string;
  reason: string;
}): Promise<SiteDaySession> {
  const ok = await verifyStaffPin(args.managerStaffId, args.pin);
  if (!ok) throw new Error("Manager PIN does not match.");

  const date = todayIso();
  const existing = await supabase
    .from("site_day_sessions")
    .select("*")
    .eq("session_date", date)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error("No session row to reopen.");
  const cur = rowToSession(existing.data as SiteDaySessionRow);
  if (cur.phase !== "closed_orderly") {
    throw new Error(
      cur.phase === "closed_no_go"
        ? "NO-GO sessions cannot be reopened from here — start a new session tomorrow."
        : `Centre is not in a closed_orderly state (current: ${cur.phase}).`,
    );
  }

  const priorCloseAt = cur.closeDeclaredAt;
  const priorClosedBy = cur.closedById;

  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      phase: "active_day",
      closed_by_id: null,
      close_declared_at: null,
      close_leader_notes: null,
    })
    .eq("id", cur.id)
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);

  await siteLedger(
    "centre_reopened",
    {
      session_id: next.id,
      session_date: next.sessionDate,
      manager_staff_id: args.managerStaffId,
      reason: args.reason,
      prior_close_at: priorCloseAt,
      prior_closed_by: priorClosedBy,
    },
    "YELLOW",
  );
  return next;
}

/**
 * TEST-ONLY rewind. Flip today's session row back to `open_pending` and
 * clear all open/close/handshake stamps so the Start of Day flow renders
 * fresh. Does NOT touch issues, escalations, attendance, billing or other
 * tables — only this row plus a single YELLOW ledger audit entry.
 *
 * UI for this action is gated by `IS_TEST_BUILD` so it never appears on
 * published deployments.
 */
export async function resetStartOfDay(reason?: string): Promise<SiteDaySession> {
  const date = todayIso();
  const existing = await supabase
    .from("site_day_sessions")
    .select("*")
    .eq("session_date", date)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error("No session row to reset.");
  const prior = rowToSession(existing.data as SiteDaySessionRow);

  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      phase: "open_pending",
      opened_by_id: null,
      open_declared_at: null,
      open_leader_notes: null,
      closed_by_id: null,
      close_declared_at: null,
      close_leader_notes: null,
      manager_plan_text: null,
      manager_decision: null,
      manager_auth_staff_id: null,
      manager_auth_at: null,
      leader_decision: null,
      leader_auth_staff_id: null,
      leader_auth_at: null,
    })
    .eq("id", prior.id)
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);

  await siteLedger(
    "reset_start_of_day",
    {
      session_id: next.id,
      session_date: next.sessionDate,
      prior_phase: prior.phase,
      prior_open_at: prior.openDeclaredAt,
      prior_close_at: prior.closeDeclaredAt,
      reason: reason ?? null,
      test_only: true,
    },
    "YELLOW",
  );
  return next;
}

export async function setPhase(
  id: string,
  phase: SiteSessionPhase,
): Promise<SiteDaySession> {
  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({ phase })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);
  await siteLedger(
    "phase_change",
    { session_id: id, new_phase: phase },
    phase === "closed_no_go" ? "RED" : phase === "escalated_lock" ? "RED" : "INFO",
  );
  return next;
}



export interface ManagerHandshakeArgs {
  sessionId: string;
  plan: string;
  decision: HandshakeDecision;
  managerStaffId: string;
  pin: string;
}

export async function submitManagerHandshake(
  args: ManagerHandshakeArgs,
): Promise<SiteDaySession> {
  console.debug("[submitManagerHandshake] called", {
    sessionId: args.sessionId,
    managerStaffId: args.managerStaffId,
    decision: args.decision,
    planLen: args.plan?.length ?? 0,
    pinLen: args.pin?.length ?? 0,
  });
  const ok = await verifyStaffPin(args.managerStaffId, args.pin);
  console.debug("[submitManagerHandshake] pin verify result", { ok });
  if (!ok) throw new Error("Invalid manager PIN.");
  const payload = {
    manager_plan_text: args.plan,
    manager_decision: args.decision,
    manager_auth_staff_id: args.managerStaffId,
    manager_auth_at: new Date().toISOString(),
  };
  console.debug("[submitManagerHandshake] update payload", payload);
  const { data, error } = await supabase
    .from("site_day_sessions")
    .update(payload)
    .eq("id", args.sessionId)
    .select("*")
    .single();
  if (error) {
    console.error("[submitManagerHandshake] update error", {
      code: (error as { code?: string }).code,
      message: error.message,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
    });
    throw error;
  }
  if (!data) {
    console.error("[submitManagerHandshake] update returned no row", {
      sessionId: args.sessionId,
    });
    throw new Error(
      "Manager handshake did not update any row — session may not exist or RLS blocked the write.",
    );
  }
  console.debug("[submitManagerHandshake] update returned row", data);
  const next = rowToSession(data as SiteDaySessionRow);
  await siteLedger(
    "handshake_manager",
    {
      session_id: args.sessionId,
      decision: args.decision,
      plan: args.plan,
      manager_staff_id: args.managerStaffId,
    },
    args.decision === "no_go" ? "RED" : "YELLOW",
  );
  return next;
}


export interface LeaderHandshakeArgs {
  sessionId: string;
  decision: HandshakeDecision;
  leaderStaffId: string;
  pin: string;
}

export async function submitLeaderHandshake(
  args: LeaderHandshakeArgs,
): Promise<SiteDaySession> {
  const ok = await verifyStaffPin(args.leaderStaffId, args.pin);
  if (!ok) throw new Error("Invalid leader PIN.");

  // Read current row to resolve final phase atomically client-side.
  const { data: current, error: readErr } = await supabase
    .from("site_day_sessions")
    .select("*")
    .eq("id", args.sessionId)
    .single();
  if (readErr) throw readErr;
  const cur = rowToSession(current as SiteDaySessionRow);
  if (!cur.managerDecision) {
    throw new Error("Manager must complete the handshake first.");
  }

  const bothGo = args.decision === "go" && cur.managerDecision === "go";
  const nextPhase: SiteSessionPhase = bothGo ? "active_day" : "closed_no_go";

  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      leader_decision: args.decision,
      leader_auth_staff_id: args.leaderStaffId,
      leader_auth_at: new Date().toISOString(),
      phase: nextPhase,
      ...(bothGo
        ? { open_declared_at: new Date().toISOString() }
        : {
            closed_by_id: args.leaderStaffId,
            close_declared_at: new Date().toISOString(),
          }),
    })
    .eq("id", args.sessionId)
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToSession(data as SiteDaySessionRow);
  await siteLedger(
    "handshake_leader",
    {
      session_id: args.sessionId,
      decision: args.decision,
      manager_decision: cur.managerDecision,
      manager_plan: cur.managerPlanText,
      manager_staff_id: cur.managerAuthStaffId,
      leader_staff_id: args.leaderStaffId,
      final_phase: nextPhase,
    },
    bothGo ? "GREEN" : "RED",
  );
  if (!bothGo) {
    await siteLedger(
      "no_go",
      { session_id: args.sessionId, reason: "dual_pin_no_go" },
      "RED",
    );
  }
  return next;
}

/** Realtime subscription for a single site_day_sessions row. */
export function subscribeToSiteSession(
  sessionId: string,
  cb: (next: SiteDaySession) => void,
): () => void {
  const channel = supabase
    .channel(`site-day-session-${sessionId}-${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "site_day_sessions",
        filter: `id=eq.${sessionId}`,
      },
      (payload) => {
        cb(rowToSession(payload.new as SiteDaySessionRow));
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

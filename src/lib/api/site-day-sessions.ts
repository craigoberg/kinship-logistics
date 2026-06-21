import { supabase } from "@/integrations/supabase/client";
import {
  resolveStaffIdWithFallback,
  verifyStaffPin,
} from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";

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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  const { data, error } = await supabase
    .from("site_day_sessions")
    .select("*")
    .eq("session_date", date)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSession(data as SiteDaySessionRow) : null;
}

/**
 * Declare site safe & open the day. If no row exists for today yet,
 * inserts a fresh row directly into `active_day`. Otherwise updates the
 * existing pending row.
 */
export async function openSession(notes: string): Promise<SiteDaySession> {
  const date = todayIso();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const nowIso = new Date().toISOString();
  const today = await getTodaySession();

  let row: SiteDaySessionRow;
  if (!today) {
    const { data, error } = await supabase
      .from("site_day_sessions")
      .insert({
        session_date: date,
        phase: "active_day",
        opened_by_id: userId,
        open_declared_at: nowIso,
        open_leader_notes: notes || null,
      })
      .select("*")
      .single();
    if (error) throw error;
    row = data as SiteDaySessionRow;
  } else {
    const { data, error } = await supabase
      .from("site_day_sessions")
      .update({
        phase: "active_day",
        opened_by_id: userId,
        open_declared_at: nowIso,
        open_leader_notes: notes || null,
      })
      .eq("id", today.id)
      .select("*")
      .single();
    if (error) throw error;
    row = data as SiteDaySessionRow;
  }

  const next = rowToSession(row);
  await siteLedger(
    "open",
    { session_id: next.id, session_date: next.sessionDate, notes: notes || null },
    "GREEN",
  );
  return next;
}

export async function closeSession(notes: string): Promise<SiteDaySession> {
  const today = await getTodaySession();
  if (!today) throw new Error("No session row to close.");
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      phase: "closed_orderly",
      closed_by_id: userId,
      close_declared_at: new Date().toISOString(),
      close_leader_notes: notes || null,
    })
    .eq("id", today.id)
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
  const ok = await verifyStaffPin(args.managerStaffId, args.pin);
  if (!ok) throw new Error("Invalid manager PIN.");
  const { data, error } = await supabase
    .from("site_day_sessions")
    .update({
      manager_plan_text: args.plan,
      manager_decision: args.decision,
      manager_auth_staff_id: args.managerStaffId,
      manager_auth_at: new Date().toISOString(),
    })
    .eq("id", args.sessionId)
    .select("*")
    .single();
  if (error) throw error;
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
    .channel(`site-day-session-${sessionId}`)
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

import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { redHasAcceptedWorkaround } from "@/lib/site-day/red-workaround";

// ============================================================================
// site_issues_register — RYGE anomaly log tied to a site_day_session.
// ============================================================================

export type RygeSeverity = "green" | "yellow" | "red";
export type ResponsibilityOwner = "internal" | "council";
export type CouncilSlaCategory = "Sev 1" | "Sev 2" | "Sev 3";

export interface SiteIssue {
  id: string;
  sessionId: string | null;
  /** Set for event-day issues (§12.6); null for day-centre issues. */
  eventId: string | null;
  /** Set for event-day issues (§12.6); null for day-centre issues. */
  eventDaySessionId: string | null;
  reportedBy: string | null;
  severity: RygeSeverity;
  issueDescription: string;
  workaroundPlan: string | null;
  owner: ResponsibilityOwner;
  councilSlaCategory: CouncilSlaCategory | null;
  councilSlaDeadline: string | null;
  emailDispatchedToCouncil: boolean;
  emailDispatchedAt: string | null;
  status: string;
  resolvedAt: string | null;
  workaroundAcceptedAt: string | null;
  createdAt: string;
}

interface SiteIssueRow {
  id: string;
  session_id: string | null;
  event_id: string | null;
  event_day_session_id: string | null;
  reported_by: string | null;
  severity: RygeSeverity;
  issue_description: string;
  workaround_plan: string | null;
  owner: ResponsibilityOwner | null;
  council_sla_category: string | null;
  council_sla_deadline: string | null;
  email_dispatched_to_council: boolean | null;
  email_dispatched_at: string | null;
  status: string | null;
  resolved_at: string | null;
  workaround_accepted_at: string | null;
  created_at: string;
}

function rowToIssue(r: SiteIssueRow): SiteIssue {
  return {
    id: r.id,
    sessionId: r.session_id ?? null,
    eventId: r.event_id ?? null,
    eventDaySessionId: r.event_day_session_id ?? null,
    reportedBy: r.reported_by,
    severity: r.severity,
    issueDescription: r.issue_description,
    workaroundPlan: r.workaround_plan,
    owner: (r.owner ?? "internal") as ResponsibilityOwner,
    councilSlaCategory: (r.council_sla_category ?? null) as CouncilSlaCategory | null,
    councilSlaDeadline: r.council_sla_deadline,
    emailDispatchedToCouncil: r.email_dispatched_to_council ?? false,
    emailDispatchedAt: r.email_dispatched_at,
    status: r.status ?? "open",
    resolvedAt: r.resolved_at,
    workaroundAcceptedAt: r.workaround_accepted_at ?? null,
    createdAt: r.created_at,
  };
}

export async function listIssues(sessionId: string): Promise<SiteIssue[]> {
  console.info("[SiteIssues] listIssues → querying session_id", sessionId);
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).map((r) => rowToIssue(r as SiteIssueRow));
  console.info(
    "[SiteIssues] listIssues ← returned",
    rows.length,
    "rows for session_id",
    sessionId,
    rows.map((r) => ({ id: r.id, severity: r.severity, sessionId: r.sessionId })),
  );
  return rows;
}

/**
 * Unified active-issue feed for the post-declaration ActiveDayPanel.
 * Returns, in one round trip:
 *   - every row for today's session (any status), plus
 *   - every still-`open` row from prior sessions.
 * Resolved rows from prior days are excluded.
 */
export async function listActiveIssues(sessionId: string): Promise<SiteIssue[]> {
  console.info("[SiteIssues] listActiveIssues → session_id", sessionId);
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("*")
    .or(`session_id.eq.${sessionId},status.eq.open`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).map((r) => rowToIssue(r as SiteIssueRow));
  console.info(
    "[SiteIssues] listActiveIssues ← returned",
    rows.length,
    "rows (today + carried-over open)",
  );
  return rows;
}

export interface NewSiteIssue {
  /** site_day_sessions.id — required for Day Centre issues; null for event-day issues. */
  sessionId: string | null;
  severity: RygeSeverity;
  issueDescription: string;
  workaroundPlan: string | null;
  owner: ResponsibilityOwner;
  /** event_manifest.id — set for outing event issues (§12.6). */
  eventId?: string | null;
  /** event_day_sessions.id — set for outing event issues (§12.6). */
  eventDaySessionId?: string | null;
}

export async function createIssue(payload: NewSiteIssue): Promise<SiteIssue> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  console.info("[SiteIssues] createIssue → inserting", {
    session_id: payload.sessionId,
    event_id: payload.eventId,
    event_day_session_id: payload.eventDaySessionId,
    severity: payload.severity,
    owner: payload.owner,
  });
  const hasWorkaround = !!(payload.workaroundPlan && payload.workaroundPlan.trim());
  const { data, error } = await supabase
    .from("site_issues_register")
    .insert({
      session_id: payload.sessionId ?? null,
      reported_by: userId,
      severity: payload.severity,
      issue_description: payload.issueDescription,
      workaround_plan: payload.workaroundPlan,
      owner: payload.owner,
      status: "open",
      workaround_accepted_at: hasWorkaround ? new Date().toISOString() : null,
      event_id: payload.eventId ?? null,
      event_day_session_id: payload.eventDaySessionId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToIssue(data as SiteIssueRow);
  console.info("[SiteIssues] createIssue ← inserted row", {
    id: next.id,
    session_id: next.sessionId,
    severity: next.severity,
  });

  // Ledger receipt — site_day.issue_logged
  try {
    const staffId = await resolveStaffIdWithFallback();
    const gps = await tryGetGps();
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity:
        payload.severity === "red"
          ? "RED"
          : payload.severity === "yellow"
            ? "YELLOW"
            : "GREEN",
      action_type: "site_day.issue_logged",
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata: {
        session_id: payload.sessionId,
        event_id: payload.eventId ?? null,
        event_day_session_id: payload.eventDaySessionId ?? null,
        issue_id: next.id,
        severity: payload.severity,
        owner: payload.owner,
        description: payload.issueDescription,
        workaround: payload.workaroundPlan,
      },
    });
  } catch (err) {
    console.error("[site_issues.createIssue] ledger failed", err);
  }
  return next;
}

/**
 * List all issues for a specific event day session (§12.6).
 * Uses `.in()` — the same PostgREST operator used by buildTripReport (Trip Report).
 * `.eq()` on this column was silently failing; `.in()` is confirmed to work.
 */
export async function listEventDayIssues(eventDaySessionId: string): Promise<SiteIssue[]> {
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("*")
    .in("event_day_session_id", [eventDaySessionId])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToIssue(r as SiteIssueRow));
}

/**
 * List ALL issues for an event across all day sessions, using the same
 * `.in()` pattern as buildTripReport. Callers filter by eventDaySessionId
 * client-side to show per-day issues in EventIssuesCard.
 */
export async function listEventIssues(eventId: string, sessionIds: string[]): Promise<SiteIssue[]> {
  if (sessionIds.length === 0) return [];
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("*")
    .in("event_day_session_id", sessionIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToIssue(r as SiteIssueRow));
}

/**
 * Returns true if there is a blocking open RED issue for the given event day session.
 *
 * Non-blocking rows (GUARDRAILS §3, §13.7):
 *   • Verbal-workaround RED rows — `[VERBAL WORKAROUND]` prefix in issue_description
 *   • INCIDENT/FAULT RED rows   — `[INCIDENT]` prefix in issue_description
 *     These are filed via the global big-red button and must never gate location open.
 *     Only venue-walkaround RED rows (no special prefix) activate the hard block.
 */
export async function hasOpenRedIssueForSession(eventDaySessionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("site_issues_register")
    .select("id, status, issue_description, workaround_plan, workaround_accepted_at")
    .in("event_day_session_id", [eventDaySessionId])
    .eq("status", "open")
    .eq("severity", "red");
  if (error) return false;
  return (data ?? []).some((row) => {
    const desc: string = row.issue_description ?? "";
    // [INCIDENT] rows from the global INCIDENT/FAULT button never block (§13.7)
    if (desc.startsWith("[INCIDENT]")) return false;
    return !redHasAcceptedWorkaround({
      id: row.id,
      status: row.status,
      issue_description: desc,
      workaround_plan: row.workaround_plan,
      workaround_accepted_at: row.workaround_accepted_at,
    });
  });
}

/**
 * Canonical RYGE sort helpers (GUARDRAILS §13.9).
 *
 * Both variants group by severity: RED → YELLOW → GREEN.
 * Within each group the timestamp direction differs by context:
 *
 *   sortByRygeOldestFirst  — Trip Report, HUB, Day Centre registers
 *                            Oldest first: read the history in chronological order.
 *
 *   sortByRygeNewestFirst  — Trip Days Active Issues Register only.
 *                            Newest first: the most recently logged issue surfaces immediately.
 */
const SEV_RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 };

export function sortByRygeOldestFirst<T extends { severity: string; createdAt: string }>(
  issues: T[],
): T[] {
  return [...issues].sort((a, b) => {
    const rankDiff = (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function sortByRygeNewestFirst<T extends { severity: string; createdAt: string }>(
  issues: T[],
): T[] {
  return [...issues].sort((a, b) => {
    const rankDiff = (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function markResolved(id: string): Promise<SiteIssue> {
  const { data, error } = await supabase
    .from("site_issues_register")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToIssue(data as SiteIssueRow);
}

// ---------- Council SLA computation (pure, client-side) ----------

export interface SlaHoursMap {
  Sev_1?: number;
  Sev_2?: number;
  Sev_3?: number;
}

/**
 * Suggest a Council SLA tier from severity + owner, and compute the
 * deadline from `system_parameters.site_management.council_sla_hours`.
 * Pure / synchronous — caller supplies the hours map.
 */
export function routeToCouncilLocal(issue: {
  severity: RygeSeverity;
  owner: ResponsibilityOwner;
}, hours: SlaHoursMap): {
  category: CouncilSlaCategory;
  hours: number;
  deadlineIso: string;
} {
  let category: CouncilSlaCategory;
  if (issue.severity === "red") category = "Sev 1";
  else if (issue.severity === "yellow") category = "Sev 2";
  else category = "Sev 3";

  const key =
    category === "Sev 1" ? "Sev_1" : category === "Sev 2" ? "Sev_2" : "Sev_3";
  const h = Number(hours?.[key]);
  const slaHours = Number.isFinite(h) && h > 0 ? h : 24;
  const deadline = new Date(Date.now() + slaHours * 3600 * 1000);
  return {
    category,
    hours: slaHours,
    deadlineIso: deadline.toISOString(),
  };
}

export interface DispatchCouncilEmailArgs {
  issueId: string;
  to: string;
  subject: string;
  body: string;
  category: CouncilSlaCategory;
  deadlineIso: string;
}

/**
 * Send the council maintenance email via the Lovable Emails route if
 * available; on 404 / missing route, fall back to a `mailto:` handoff so
 * the user can dispatch from their mail client. Either path flips the
 * `email_dispatched_to_council` flag on success.
 */
export async function dispatchCouncilEmail(
  args: DispatchCouncilEmailArgs,
): Promise<{ ok: true; mode: "sent" | "mailto"; mailto?: string }> {
  let mode: "sent" | "mailto" = "sent";
  let mailto: string | undefined;

  try {
    const session = (await supabase.auth.getSession()).data.session;
    const token = session?.access_token;
    const resp = await fetch("/lovable/email/transactional/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        templateName: "council-maintenance-request",
        recipientEmail: args.to,
        idempotencyKey: `council-maint-${args.issueId}`,
        templateData: {
          subject: args.subject,
          body: args.body,
          severity: args.category,
          deadline: args.deadlineIso,
        },
      }),
    });
    if (!resp.ok) {
      throw new Error(`Email route returned ${resp.status}`);
    }
  } catch {
    // Graceful fallback: mailto handoff. UI surfaces this as a "manual send" toast.
    mode = "mailto";
    const params = new URLSearchParams({
      subject: args.subject,
      body: args.body,
    });
    mailto = `mailto:${encodeURIComponent(args.to)}?${params.toString()}`;
  }

  // Flip the issue flag + record SLA fields. If column is missing this throws
  // and the UI surfaces it.
  const { error } = await supabase
    .from("site_issues_register")
    .update({
      email_dispatched_to_council: true,
      email_dispatched_at: new Date().toISOString(),
      council_sla_category: args.category,
      council_sla_deadline: args.deadlineIso,
    })
    .eq("id", args.issueId);
  if (error) throw error;

  try {
    const staffId = await resolveStaffIdWithFallback();
    await writeToLedger({
      staff_id: staffId,
      category: "CENTRE",
      severity: "INFO",
      action_type: "site_day.council_dispatch",
      gps_lat: null,
      gps_lng: null,
      metadata: {
        issue_id: args.issueId,
        sla_category: args.category,
        deadline: args.deadlineIso,
        mode,
        to: args.to,
      },
    });
  } catch (err) {
    console.error("[dispatchCouncilEmail] ledger failed", err);
  }

  return { ok: true, mode, mailto };
}

/** Realtime subscription for issues attached to a single session. */
export function subscribeToSiteIssues(
  sessionId: string,
  cb: () => void,
): () => void {
  const channel = supabase
    .channel(`site-issues-${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "site_issues_register",
        filter: `session_id=eq.${sessionId}`,
      },
      () => cb(),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

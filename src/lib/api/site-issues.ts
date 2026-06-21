import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";

// ============================================================================
// site_issues_register — RYGE anomaly log tied to a site_day_session.
// ============================================================================

export type RygeSeverity = "green" | "yellow" | "red";
export type ResponsibilityOwner = "internal" | "council";
export type CouncilSlaCategory = "Sev 1" | "Sev 2" | "Sev 3";

export interface SiteIssue {
  id: string;
  sessionId: string;
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
  createdAt: string;
}

interface SiteIssueRow {
  id: string;
  session_id: string;
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
  created_at: string;
}

function rowToIssue(r: SiteIssueRow): SiteIssue {
  return {
    id: r.id,
    sessionId: r.session_id,
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

export interface NewSiteIssue {
  sessionId: string;
  severity: RygeSeverity;
  issueDescription: string;
  workaroundPlan: string | null;
  owner: ResponsibilityOwner;
}

export async function createIssue(payload: NewSiteIssue): Promise<SiteIssue> {
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { data, error } = await supabase
    .from("site_issues_register")
    .insert({
      session_id: payload.sessionId,
      reported_by: userId,
      severity: payload.severity,
      issue_description: payload.issueDescription,
      workaround_plan: payload.workaroundPlan,
      owner: payload.owner,
      status: "open",
    })
    .select("*")
    .single();
  if (error) throw error;
  const next = rowToIssue(data as SiteIssueRow);

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

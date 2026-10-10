import { supabase } from "@/integrations/supabase/client";

/**
 * Map of issueId → resolution_notes for RED site_day escalations that have
 * been resolved_approved (manager-agreed workaround). Used as a fallback
 * source-of-truth for "RED has accepted workaround?" when the issue row
 * itself wasn't updated by the acceptance flow.
 */
export type EscalationWorkaroundMap = Map<string, string>;

export async function fetchApprovedRedWorkarounds(
  issueIds: string[],
): Promise<EscalationWorkaroundMap> {
  const out: EscalationWorkaroundMap = new Map();
  if (!issueIds.length) return out;
  const { data, error } = await supabase
    .from("operational_escalations")
    .select("source_issue_id, status, resolution_notes, created_at")
    .in("source_issue_id", issueIds)
    .eq("source_kind", "site_day_red")
    .eq("status", "resolved_approved")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[fetchApprovedRedWorkarounds] read failed", error);
    return out;
  }
  for (const row of (data ?? []) as Array<{
    source_issue_id: string | null;
    resolution_notes: string | null;
  }>) {
    const id = row.source_issue_id;
    const notes = row.resolution_notes?.trim() ?? "";
    if (id && notes && !out.has(id)) out.set(id, notes);
  }
  return out;
}

export function isVerbalWorkaroundDescription(description: string | null | undefined): boolean {
  return (description ?? "").includes("[VERBAL WORKAROUND]");
}

export function redHasAcceptedWorkaround(
  issue: {
    id: string;
    status: string | null;
    workaround_plan?: string | null;
    workaroundPlan?: string | null;
    issue_description?: string | null;
    issueDescription?: string | null;
    workaround_accepted_at?: string | null;
    workaroundAcceptedAt?: string | null;
  },
  escalationMap?: EscalationWorkaroundMap | null,
): boolean {
  if (issue.status === "workaround_accepted") return true;
  const acceptedAt = issue.workaround_accepted_at ?? issue.workaroundAcceptedAt ?? null;
  if (acceptedAt) return true;
  const plan = issue.workaround_plan ?? issue.workaroundPlan ?? null;
  if (plan && plan.trim()) return true;
  const desc = issue.issue_description ?? issue.issueDescription ?? "";
  if (isVerbalWorkaroundDescription(desc)) return true;
  if (escalationMap && escalationMap.get(issue.id)?.trim()) return true;
  return false;
}

export function effectiveWorkaroundText(
  issue: {
    id: string;
    workaround_plan?: string | null;
    workaroundPlan?: string | null;
  },
  escalationMap?: EscalationWorkaroundMap | null,
): string | null {
  const plan = (issue.workaround_plan ?? issue.workaroundPlan ?? "").trim();
  if (plan) return plan;
  const fromEsc = escalationMap?.get(issue.id)?.trim();
  return fromEsc || null;
}

/** Day Centre open gate — trip/event REDs must never block centre open. */
export function isDayCentreScopedIssue(issue: {
  event_id?: string | null;
  eventId?: string | null;
  event_day_session_id?: string | null;
  eventDaySessionId?: string | null;
}): boolean {
  const eventId = issue.event_id ?? issue.eventId ?? null;
  const eventDaySessionId =
    issue.event_day_session_id ?? issue.eventDaySessionId ?? null;
  return eventId == null && eventDaySessionId == null;
}

/**
 * Lost Soul Rule — person late / missing / not-yet-arrived (client or support).
 * These REDs stay open in the Hub for review; they must not hold Open Centre.
 * Checkout / unexpected-med REDs are not lost souls.
 */
export function isLostSoulAttendanceIssue(
  description: string | null | undefined,
): boolean {
  const d = (description ?? "").trim();
  if (!d) return false;
  if (d.includes("[DEPARTURE]")) return false;
  if (/overdue checkout/i.test(d)) return false;
  if (/unexpected medication/i.test(d)) return false;
  if (d.includes("[ATTENDANCE]")) return true;
  if (d.includes("[AUTOMATED_RED]") && /overdue by \d+\s*min/i.test(d)) {
    return true;
  }
  return false;
}

function issueDescriptionOf(issue: {
  issue_description?: string | null;
  issueDescription?: string | null;
}): string {
  return issue.issue_description ?? issue.issueDescription ?? "";
}

/** True when this Day Centre issue must hold Open Centre. */
export function doesIssueBlockDayCentreOpen(
  issue: {
    severity: string;
    status: string | null;
    issue_description?: string | null;
    issueDescription?: string | null;
    workaround_plan?: string | null;
    workaroundPlan?: string | null;
    workaround_accepted_at?: string | null;
    workaroundAcceptedAt?: string | null;
  },
  escMap?: EscalationWorkaroundMap | null,
): boolean {
  if (issue.status === "resolved" || issue.status === "deferred") return false;
  if (isLostSoulAttendanceIssue(issueDescriptionOf(issue))) return false;
  if (issue.severity === "red") return !redHasAcceptedWorkaround(issue, escMap);
  if (issue.severity === "yellow") {
    const plan = issue.workaround_plan ?? issue.workaroundPlan ?? "";
    return !plan.trim();
  }
  return false;
}

export type DayCentreRedIssueRow = {
  id: string;
  session_id: string | null;
  severity: string;
  status: string | null;
  issue_description: string | null;
  workaround_plan: string | null;
  workaround_accepted_at: string | null;
  created_at: string;
  occurred_at: string | null;
  event_id: string | null;
  event_day_session_id: string | null;
};

export const DAY_CENTRE_BLOCKING_REDS_QUERY_KEY = [
  "site-issues",
  "open-reds-day-centre",
] as const;

/**
 * RED issues that can block Day Centre Open Centre.
 * Scoped to Day Centre only: `event_id` and `event_day_session_id` both null.
 * Trip morning/evening / event-floor REDs are excluded.
 * Non-blocking: `resolved`, Hub `deferred`, accepted workaround, or Lost Soul
 * attendance overdue (person late/missing — Hub still shows the open RED).
 */
export async function fetchDayCentreBlockingReds(): Promise<{
  /** Day-scoped RED rows (any status except we still return resolved for diagnostics). */
  rows: DayCentreRedIssueRow[];
  /** Unresolved Day-scoped REDs with no accepted workaround. */
  blocking: DayCentreRedIssueRow[];
  escMap: EscalationWorkaroundMap;
}> {
  const { data, error } = await supabase
    .from("site_issues_register")
    .select(
      "id, session_id, severity, status, issue_description, workaround_plan, workaround_accepted_at, created_at, occurred_at, event_id, event_day_session_id",
    )
    .eq("severity", "red")
    .is("event_id", null)
    .is("event_day_session_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as DayCentreRedIssueRow[];
  const unresolved = rows.filter(
    (r) => r.status !== "resolved" && r.status !== "deferred",
  );
  const escMap = await fetchApprovedRedWorkarounds(unresolved.map((r) => r.id));
  const blocking = unresolved.filter((r) => doesIssueBlockDayCentreOpen(r, escMap));
  return { rows, blocking, escMap };
}

// Return-trip unsafe drop-off — RED hub ticket (Governance Hub / operational_incidents).
//
// Mirrors pre-trip verbal RED in issue-accumulator-panel: lands as Source
// "Incident" with a [Return trip] prefix. site_issues_register is written
// when a day-centre session exists for linkage.

import { supabase } from "@/integrations/supabase/client";
import { createIssue } from "@/lib/api/site-issues";
import { getTodaySession } from "@/lib/api/site-day-sessions";
import { resolveStaffIdWithFallback } from "@/lib/data-store";

export const RETURN_TRIP_TAG = "[Return trip]";

export interface RaiseUnsafeDropHubIssueArgs {
  tripId: string;
  legId: string;
  eventId?: string | null;
  /** Full description including [VERBAL WORKAROUND] prefix. */
  description: string;
  workaroundPlan: string;
}

export interface RaiseUnsafeDropHubIssueResult {
  incidentId: string | null;
  siteIssueId: string | null;
}

/**
 * Land an unsafe drop-off verbal consultation in the Governance Hub.
 * Always writes operational_incidents (human_operational / sev1) so the
 * row appears under Source "Incident" — same surface as pre-trip RED.
 */
export async function raiseUnsafeDropHubIssue(
  args: RaiseUnsafeDropHubIssueArgs,
): Promise<RaiseUnsafeDropHubIssueResult> {
  const staffId = await resolveStaffIdWithFallback();
  const hubDescription = args.description.startsWith(RETURN_TRIP_TAG)
    ? args.description
    : `${RETURN_TRIP_TAG} ${args.description}`;

  const { data: incidentRow, error: incidentErr } = await supabase
    .from("operational_incidents")
    .insert({
      incident_type: "human_operational",
      severity: "sev1",
      description: hubDescription,
      event_id: args.eventId ?? null,
      reported_by: staffId,
      status: "pending",
    })
    .select("id")
    .single();

  if (incidentErr) throw incidentErr;

  let siteIssueId: string | null = null;
  try {
    const sess = await getTodaySession();
    if (sess?.id) {
      const issue = await createIssue({
        sessionId: sess.id,
        eventId: args.eventId ?? null,
        severity: "red",
        issueDescription: hubDescription,
        workaroundPlan: args.workaroundPlan,
        owner: "internal",
      });
      siteIssueId = issue.id;
    }
  } catch (err) {
    // operational_incidents is the primary Hub surface for transport RED;
    // site_issues_register linkage is best-effort when a session exists.
    console.error("[raiseUnsafeDropHubIssue] site_issues_register insert failed", err);
  }

  return {
    incidentId: String((incidentRow as { id: string }).id),
    siteIssueId,
  };
}

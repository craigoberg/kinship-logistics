// ============================================================================
// Unexpected Medical Bag — symmetrical RED escalation helper.
//
// Called from both surfaces in the chain of custody:
//   • Transport (bus boarding / passenger pickup) — context: "transport"
//   • Day Centre handover at the door — context: "centre"
//
// Inserts ONE site_issues_register row (severity='red',
// category='medication_handover') so the Governance Hub picks it up via
// the single-rail escalation feed, and pairs it with an immutable
// operational_ledger receipt per the 20-Character Compliance Shield.
// The originating action (boarding / check-in) is NEVER blocked by this
// helper — it runs in parallel and surfaces failures to the console only.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { getTodaySession } from "@/lib/api/site-day-sessions";

export type UnexpectedMedContext = "transport" | "centre";

export interface RaiseUnexpectedMedBagArgs {
  participantId: string;
  participantName?: string | null;
  context: UnexpectedMedContext;
  /** trip_leg id (transport) or site_day_sessions id (centre). */
  referenceId: string;
  /** Optional free-text driver/operator note. */
  notes?: string | null;
}

export interface RaiseUnexpectedMedBagResult {
  issueId: string | null;
  ledgerWritten: boolean;
}

function justificationText(
  context: UnexpectedMedContext,
  participantLabel: string,
  referenceId: string,
): string {
  // ≥20 chars (20-Character Compliance Shield).
  if (context === "transport") {
    return (
      `Driver flagged an unexpected medication bag at bus boarding for ` +
      `${participantLabel} (trip leg ${referenceId}). Medication is NOT on ` +
      `the participant's scheduled regimen — office must investigate the ` +
      `chain of custody and confirm the prescribing authority before the ` +
      `dose can be administered.`
    );
  }
  return (
    `Day Centre operator received an unexpected medication bag at the door ` +
    `for ${participantLabel} (session ${referenceId}). The participant has ` +
    `no scheduled medication recorded — Governance Hub must trace the ` +
    `handover source (bus / carer / family) and confirm authorisation ` +
    `before any administration.`
  );
}

export async function raiseUnexpectedMedBagIssue(
  args: RaiseUnexpectedMedBagArgs,
): Promise<RaiseUnexpectedMedBagResult> {
  const participantLabel = args.participantName?.trim() || args.participantId;

  // Every site_issues_register row needs a site_day_sessions session_id FK.
  // Resolve today's session — both contexts attach to the same daily anchor.
  let sessionId: string | null = null;
  try {
    const sess = await getTodaySession();
    sessionId = sess?.id ?? null;
  } catch (err) {
    console.error("[unexpected-med-bag] getTodaySession failed", err);
  }
  if (!sessionId) {
    console.warn(
      "[unexpected-med-bag] No active site_day_session — RED issue cannot be persisted; ledger receipt only.",
    );
  }

  const description =
    `Unexpected medication bag — investigate. ` +
    `Context: ${args.context} · Participant: ${participantLabel} · ` +
    `Reference: ${args.referenceId}` +
    (args.notes?.trim() ? ` · Notes: ${args.notes.trim()}` : "");

  const reportedBy = (await supabase.auth.getUser()).data.user?.id ?? null;

  let issueId: string | null = null;
  if (sessionId) {
    try {
      const { data, error } = await supabase
        .from("site_issues_register")
        .insert({
          session_id: sessionId,
          reported_by: reportedBy,
          severity: "red",
          issue_description: description,
          workaround_plan: null,
          owner: "internal",
          status: "open",
        })
        .select("id")
        .single();
      if (error) throw error;
      issueId = (data as { id: string }).id;
    } catch (err) {
      console.error("[unexpected-med-bag] site_issues_register insert failed", err);
    }
  }

  let ledgerWritten = false;
  try {
    const staffId = await resolveStaffIdWithFallback();
    const gps = await tryGetGps();
    await writeToLedger({
      staff_id: staffId,
      category: args.context === "transport" ? "TRIP" : "CLIENT",
      severity: "RED",
      action_type: "UNEXPECTED_MED_BAG_FLAGGED",
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata: {
        subject_type: "medication_handover",
        subject_id: args.referenceId,
        context: args.context,
        participant_id: args.participantId,
        participant_name: participantLabel,
        reference_id: args.referenceId,
        session_id: sessionId,
        issue_id: issueId,
        notes: args.notes?.trim() || null,
        justification: justificationText(
          args.context,
          participantLabel,
          args.referenceId,
        ),
        source: "raise_unexpected_med_bag",
      },
    });
    ledgerWritten = true;
  } catch (err) {
    console.error("[unexpected-med-bag] ledger write failed", err);
  }

  return { issueId, ledgerWritten };
}

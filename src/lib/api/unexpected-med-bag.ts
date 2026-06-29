// ============================================================================
// Unexpected Medical Bag — RED escalation helper.
//
// Called from both surfaces in the chain of custody:
//   • Transport (bus boarding / passenger pickup) — context: "transport"
//   • Day Centre handover at the door — context: "centre"
//
// GUARDRAILS §1.1 — ledger write FIRST (writeToLedgerOrThrow). If the ledger
// write fails, the function throws and the caller must surface the error to the
// operator. The originating boarding action is NOT blocked, but the failure
// MUST be shown to the user rather than swallowed silently.
//
// GUARDRAILS §1.1 atomicity — ledger succeeds before site_issues_register
// insert is attempted. A failed register write is surfaced to the caller via
// the return value; the ledger row is already on record either way.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { writeToLedgerOrThrow, tryGetGps } from "@/lib/api/ledger";
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

/**
 * Raises a RED unexpected-med-bag escalation.
 *
 * Throws if the ledger write fails (GUARDRAILS §1.1 — callers must catch and
 * surface the error to the operator, NOT swallow it).
 *
 * Returns `{ issueId, ledgerWritten }`. `issueId` is null when no active
 * session exists or the register insert fails (ledger row is always written
 * first, so the event is never un-vouched).
 */
export async function raiseUnexpectedMedBagIssue(
  args: RaiseUnexpectedMedBagArgs,
): Promise<RaiseUnexpectedMedBagResult> {
  const participantLabel = args.participantName?.trim() || args.participantId;

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
      "[unexpected-med-bag] No active site_day_session — ledger receipt written; register row skipped.",
    );
  }

  const description =
    `[AUTOMATED_RED] Unexpected medication bag — investigate. ` +
    `Context: ${args.context} · Participant: ${participantLabel} · ` +
    `Reference: ${args.referenceId}` +
    (args.notes?.trim() ? ` · Notes: ${args.notes.trim()}` : "");

  const reportedBy = (await supabase.auth.getUser()).data.user?.id ?? null;
  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();

  // GUARDRAILS §1.1 — ledger write FIRST. Throws on failure so caller must
  // surface the error — no silent swallow of a failed RED event.
  await writeToLedgerOrThrow({
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
      notes: args.notes?.trim() || null,
      justification: justificationText(
        args.context,
        participantLabel,
        args.referenceId,
      ),
      source: "raise_unexpected_med_bag",
      automated: true,
    },
  });

  // Ledger succeeded — now insert the register row (best-effort; ledger is
  // the authoritative audit record per §1.1).
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
      // Ledger row is already written — the event is on record. Register
      // failure is returned to the caller for operator notification.
    }
  }

  return { issueId, ledgerWritten: true };
}

import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import { resolveAuthorisingManager } from "@/lib/api/service-exit";
import { operationalNowIso } from "@/lib/operational-clock";
import { exitNotesRequired, type CarerExitReason } from "@/lib/service-exit";

const SQL_HINT = "Run docs/sql/2026-10-04_carer_offboard.sql on this database, then hard-refresh.";

export interface CarerClientTerm {
  id: string;
  carerId: string;
  carerName: string;
  relationship: string | null;
  participantId: string;
  startedAt: string;
  endedAt: string | null;
  wasPrimary: boolean;
  endReason: string | null;
}

export async function listCarerClientTerms(participantId: string): Promise<CarerClientTerm[]> {
  const { data, error } = await supabase
    .from("carer_client_terms")
    .select("id, carer_id, participant_id, started_at, ended_at, was_primary, end_reason")
    .eq("participant_id", participantId)
    .order("started_at", { ascending: false });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const carerIds = [...new Set(rows.map((row) => String(row.carer_id)))];
  const names = new Map<string, { name: string; relationship: string | null }>();
  if (carerIds.length > 0) {
    const { data: carers, error: carerErr } = await supabase
      .from("carers_registry")
      .select("id, full_name, relationship")
      .in("id", carerIds);
    if (carerErr) throw new Error(carerErr.message);
    for (const carer of (carers ?? []) as Array<{ id: string; full_name: string; relationship: string | null }>) {
      names.set(carer.id, { name: carer.full_name, relationship: carer.relationship });
    }
  }
  return rows.map((row) => {
    const carerId = String(row.carer_id);
    const who = names.get(carerId);
    return {
      id: String(row.id),
      carerId,
      carerName: who?.name ?? "Carer",
      relationship: who?.relationship ?? null,
      participantId: String(row.participant_id),
      startedAt: String(row.started_at),
      endedAt: (row.ended_at as string | null) ?? null,
      wasPrimary: row.was_primary === true,
      endReason: (row.end_reason as string | null) ?? null,
    };
  });
}

async function ensureOpenTerm(carerId: string, participantId: string, wasPrimary: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("carer_client_terms")
    .select("id")
    .eq("carer_id", carerId)
    .eq("participant_id", participantId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) {
    if (isSchemaMismatchError(error)) return;
    throw new Error(error.message);
  }
  if (data) {
    if (wasPrimary) {
      await supabase.from("carer_client_terms").update({ was_primary: true }).eq("id", (data as { id: string }).id);
    }
    return;
  }
  const { error: insertErr } = await supabase.from("carer_client_terms").insert({
    carer_id: carerId,
    participant_id: participantId,
    started_at: operationalNowIso(),
    was_primary: wasPrimary,
  });
  if (insertErr && !isSchemaMismatchError(insertErr)) throw new Error(insertErr.message);
}

export async function rememberCarerLink(carerId: string, participantId: string, wasPrimary: boolean): Promise<void> {
  await ensureOpenTerm(carerId, participantId, wasPrimary);
}

export async function offboardCarer(input: {
  carerId: string;
  displayName: string;
  reason: CarerExitReason | string;
  notes: string;
  managerPin: string;
  replacementCarerId?: string | null;
}): Promise<{ exitedAt: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Choose why this carer is leaving.");
  const notes = input.notes.trim();
  if (exitNotesRequired(reason, "offboard") && notes.length < 20) {
    throw new Error("Notes need at least 20 characters.");
  }
  const manager = await resolveAuthorisingManager(input.managerPin);

  const { data: carer, error: readErr } = await supabase
    .from("carers_registry")
    .select("id, full_name, participant_id, is_primary_contact, exited_at, created_at")
    .eq("id", input.carerId)
    .maybeSingle();
  if (readErr) {
    if (isSchemaMismatchError(readErr)) throw new Error(SQL_HINT);
    throw new Error(readErr.message);
  }
  const row = carer as {
    id: string;
    full_name: string;
    participant_id: string | null;
    is_primary_contact: boolean | null;
    exited_at: string | null;
    created_at: string | null;
  } | null;
  if (!row) throw new Error("Carer not found.");
  if (row.exited_at) throw new Error(`${row.full_name} is already off-boarded.`);

  const participantId = row.participant_id;
  let replacementId = (input.replacementCarerId ?? "").trim() || null;
  if (participantId) {
    const { data: others, error: othersErr } = await supabase
      .from("carers_registry")
      .select("id, is_primary_contact, exited_at")
      .eq("participant_id", participantId)
      .neq("id", row.id);
    if (othersErr) throw new Error(othersErr.message);
    const activeOthers = ((others ?? []) as Array<{ id: string; is_primary_contact: boolean | null; exited_at: string | null }>)
      .filter((c) => !c.exited_at);
    const someoneElseIsPrimary = activeOthers.some((c) => c.is_primary_contact);
    const mustReplace = row.is_primary_contact === true || !someoneElseIsPrimary;
    if (mustReplace) {
      if (activeOthers.length === 0) {
        throw new Error("Add another contact for this client before off-boarding this one.");
      }
      if (!replacementId || !activeOthers.some((c) => c.id === replacementId)) {
        throw new Error("Choose the new primary contact before this carer can be off-boarded.");
      }
    } else {
      replacementId = null;
    }
  }

  const now = operationalNowIso();
  if (participantId) {
    await ensureOpenTerm(row.id, participantId, row.is_primary_contact === true);
    const { error: endErr } = await supabase
      .from("carer_client_terms")
      .update({ ended_at: now, was_primary: row.is_primary_contact === true, end_reason: reason })
      .eq("carer_id", row.id)
      .eq("participant_id", participantId)
      .is("ended_at", null);
    if (endErr && !isSchemaMismatchError(endErr)) throw new Error(endErr.message);
  }

  if (replacementId && participantId) {
    const { error: demoteErr } = await supabase
      .from("carers_registry")
      .update({ is_primary_contact: false })
      .eq("participant_id", participantId)
      .neq("id", replacementId);
    if (demoteErr) throw new Error(demoteErr.message);
    const { error: promoteErr } = await supabase
      .from("carers_registry")
      .update({ is_primary_contact: true, participant_id: participantId })
      .eq("id", replacementId);
    if (promoteErr) throw new Error(promoteErr.message);
    await ensureOpenTerm(replacementId, participantId, true);
  }

  const { error: scheduleErr } = await supabase
    .from("support_attendance_schedules")
    .update({ active: false })
    .eq("carer_id", row.id)
    .eq("active", true);
  if (scheduleErr && !isSchemaMismatchError(scheduleErr)) throw new Error(scheduleErr.message);

  const { error: exitErr } = await supabase
    .from("carers_registry")
    .update({
      exited_at: now,
      exited_by_id: manager.id,
      exit_reason: reason,
      exit_notes: notes || null,
      is_primary_contact: false,
      participant_id: null,
    })
    .eq("id", row.id);
  if (exitErr) {
    if (isSchemaMismatchError(exitErr)) throw new Error(SQL_HINT);
    throw new Error(exitErr.message);
  }

  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "carer",
    recordId: row.id,
    recordName: input.displayName,
    summary: `${input.displayName} off-boarded. ${manager.fullName} authorised.`,
    after: { reason, replacementCarerId: replacementId },
  });

  if (participantId) {
    const { resolvePrimaryContactGap } = await import("@/lib/api/primary-contact-gap");
    void resolvePrimaryContactGap(participantId);
  }

  return { exitedAt: now };
}

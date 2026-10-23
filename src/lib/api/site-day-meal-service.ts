/**
 * BL-073 — Day Centre meal service roll (checked-in clients).
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { operationalNowIso } from "@/lib/operational-clock";
import { writeToLedger } from "@/lib/api/ledger";
import {
  lookupParticipantName,
  withAuditActorMeta,
} from "@/lib/api/office-change-log";

export type MealServiceStatus =
  | "expected"
  | "served"
  | "modified"
  | "own_order"
  | "declined"
  | "na";

export type SiteDayMealServiceRow = {
  id: string;
  activityId: string;
  participantId: string;
  status: MealServiceStatus;
  notes: string | null;
};

export function siteDayMealRollKey(activityId: string) {
  return ["site-day-meal-service-roll", activityId] as const;
}

function isMissingOnConflictTarget(err: {
  code?: string;
  message?: string;
}): boolean {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return (
    code === "42P10" ||
    /no unique|exclusion constraint matching the ON CONFLICT/i.test(msg)
  );
}

export async function seedSiteDayMealServiceRoll(
  activityId: string,
  sessionId: string,
): Promise<number> {
  const { data: attendance, error } = await supabase
    .from("client_attendance_log")
    .select("participant_id, status")
    .eq("session_id", sessionId)
    .eq("status", "checked_in");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw error;
  }
  const ids = [
    ...new Set(
      (attendance ?? [])
        .map((r) => (r as { participant_id: string | null }).participant_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (ids.length === 0) return 0;

  // Skip people already on the roll (idempotent without UNIQUE on TEST bootstrap)
  const existing = await listSiteDayMealServiceRoll(activityId);
  const have = new Set(existing.map((r) => r.participantId));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length === 0) return existing.length;

  const payload = missing.map((participant_id) => ({
    activity_id: activityId,
    participant_id,
    status: "expected",
  }));
  const { data, error: insErr } = await supabase
    .from("site_day_meal_service_rolls")
    .upsert(payload, {
      onConflict: "activity_id,participant_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insErr) {
    if (isSchemaMismatchError(insErr)) return existing.length;
    // Bootstrap tables may lack UNIQUE — plain insert for missing ids only
    if (isMissingOnConflictTarget(insErr)) {
      const { data: inserted, error: plainErr } = await supabase
        .from("site_day_meal_service_rolls")
        .insert(payload)
        .select("id");
      if (plainErr) {
        if (isSchemaMismatchError(plainErr)) return existing.length;
        throw plainErr;
      }
      return existing.length + (inserted?.length ?? 0);
    }
    throw insErr;
  }
  return existing.length + (data?.length ?? 0);
}

export async function listSiteDayMealServiceRoll(
  activityId: string,
): Promise<SiteDayMealServiceRow[]> {
  const { data, error } = await supabase
    .from("site_day_meal_service_rolls")
    .select("*")
    .eq("activity_id", activityId);
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      activity_id: string;
      participant_id: string;
      status: string;
      notes: string | null;
    };
    return {
      id: row.id,
      activityId: row.activity_id,
      participantId: row.participant_id,
      status: row.status as MealServiceStatus,
      notes: row.notes,
    };
  });
}

export async function setSiteDayMealServiceStatus(
  rowId: string,
  status: MealServiceStatus,
  notes?: string | null,
): Promise<void> {
  const staffId = await resolveStaffIdWithFallback();
  const patch: Record<string, unknown> = {
    status,
    updated_at: operationalNowIso(),
    updated_by_id: staffId || null,
  };
  if (notes !== undefined) patch.notes = notes?.trim() || null;
  const { data, error } = await supabase
    .from("site_day_meal_service_rolls")
    .update(patch)
    .eq("id", rowId)
    .select("id, activity_id, participant_id, status, notes")
    .single();
  if (error) throw error;
  if (status === "expected" || !data) return;
  const row = data as {
    id: string;
    activity_id: string;
    participant_id: string;
    status: string;
    notes: string | null;
  };
  const personName = await lookupParticipantName(row.participant_id);
  const { data: act } = await supabase
    .from("site_day_activities")
    .select("title, meal_slot")
    .eq("id", row.activity_id)
    .maybeSingle();
  const meal =
    (act as { title?: string } | null)?.title?.trim() ||
    ((act as { meal_slot?: string } | null)?.meal_slot ?? "meal").replace(/_/g, " ");
  const who = personName ?? "client";
  const note = (row.notes ?? "").trim();
  const verb =
    status === "served"
      ? "Served"
      : status === "modified"
        ? "Served modified"
        : status === "own_order"
          ? "Own-order"
          : status === "declined"
            ? "Declined"
            : "N/A";
  const summary =
    status === "declined" || status === "na"
      ? `${verb} ${meal} for ${who} at Day Centre`
      : `${verb} ${meal} to ${who} at Day Centre`;
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "MEAL_SERVED",
    gps_lat: null,
    gps_lng: null,
    metadata: await withAuditActorMeta({
      meal_row_id: row.id,
      activity_id: row.activity_id,
      participant_id: row.participant_id,
      person_name: who,
      location: "Day Centre",
      meal_title: meal,
      meal_status: status,
      notes: note || null,
      summary: note ? `${summary} — ${note}` : summary,
    }),
  });
}

export async function countOutstandingSiteDayMealServes(
  activityId: string,
): Promise<number> {
  const rows = await listSiteDayMealServiceRoll(activityId);
  return rows.filter((r) => r.status === "expected").length;
}

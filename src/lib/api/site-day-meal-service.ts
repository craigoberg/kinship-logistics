/**
 * BL-073 — Day Centre meal service roll (checked-in clients).
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { operationalNowIso } from "@/lib/operational-clock";

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
  const { error } = await supabase
    .from("site_day_meal_service_rolls")
    .update(patch)
    .eq("id", rowId);
  if (error) throw error;
}

export async function countOutstandingSiteDayMealServes(
  activityId: string,
): Promise<number> {
  const rows = await listSiteDayMealServiceRoll(activityId);
  return rows.filter((r) => r.status === "expected").length;
}

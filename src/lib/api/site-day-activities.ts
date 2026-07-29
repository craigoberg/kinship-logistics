/**
 * BL-100 / BL-073 — Day Centre Activities (meals, medication rounds).
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";
import { operationalNowIso } from "@/lib/operational-clock";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  MEAL_SOURCE_LABELS,
  mealSourceNeedsPrepChecks,
  validateMealOpenPayload,
  type MealOpenPayload,
  type MealSource,
  type PreparerCertStatus,
} from "@/lib/meal-open";
import {
  asStringLabelArray,
  fetchMealPrepCheckLabels,
} from "@/lib/api/meal-prep-checks";
import {
  assertMealPrepAttestationPin,
  mealPrepAttestationPatch,
} from "@/lib/api/meal-prep-attestation";
import type { PrepAttestationMode } from "@/lib/meal-open";

export type SiteDayActivityKind = "meal" | "medication_round" | "other";
export type MealSlot = "breakfast" | "morning_tea" | "lunch" | "dinner";
export type { MealSource, PreparerCertStatus };
export { MEAL_SOURCE_LABELS };
export type ActivityPhase = "pending" | "active" | "completed";

export type SiteDayActivity = {
  id: string;
  sessionId: string;
  activityKind: SiteDayActivityKind;
  mealSlot: MealSlot | null;
  title: string;
  mealSource: MealSource | null;
  menuNotes: string | null;
  preparedByStaffId: string | null;
  preparerCertStatus: PreparerCertStatus | null;
  preparerAckNote: string | null;
  prepChecksCompleted: string[];
  prepAttestationMode: PrepAttestationMode | null;
  prepAttestedByStaffId: string | null;
  guestPreparerName: string | null;
  prepAttestationNote: string | null;
  phase: ActivityPhase;
  sortOrder: number;
  openedAt: string | null;
  closedAt: string | null;
};

type DbRow = {
  id: string;
  session_id: string;
  activity_kind: string;
  meal_slot: string | null;
  title: string;
  meal_source: string | null;
  menu_notes: string | null;
  prepared_by_staff_id?: string | null;
  preparer_cert_status?: string | null;
  preparer_ack_note?: string | null;
  prep_checks_completed?: unknown;
  prep_attestation_mode?: string | null;
  prep_attested_by_staff_id?: string | null;
  guest_preparer_name?: string | null;
  prep_attestation_note?: string | null;
  phase: string;
  sort_order: number;
  opened_at: string | null;
  closed_at: string | null;
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  morning_tea: "Morning tea",
  lunch: "Lunch",
  dinner: "Dinner",
};

function toActivity(r: DbRow): SiteDayActivity {
  return {
    id: r.id,
    sessionId: r.session_id,
    activityKind: r.activity_kind as SiteDayActivityKind,
    mealSlot: (r.meal_slot as MealSlot | null) ?? null,
    title: r.title,
    mealSource: (r.meal_source as MealSource | null) ?? null,
    menuNotes: r.menu_notes,
    preparedByStaffId: r.prepared_by_staff_id ?? null,
    preparerCertStatus: (r.preparer_cert_status as PreparerCertStatus | null) ?? null,
    preparerAckNote: r.preparer_ack_note ?? null,
    prepChecksCompleted: asStringLabelArray(r.prep_checks_completed),
    prepAttestationMode:
      (r.prep_attestation_mode as PrepAttestationMode | null) ?? null,
    prepAttestedByStaffId: r.prep_attested_by_staff_id ?? null,
    guestPreparerName: r.guest_preparer_name ?? null,
    prepAttestationNote: r.prep_attestation_note ?? null,
    phase: r.phase as ActivityPhase,
    sortOrder: r.sort_order,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
  };
}

export function siteDayActivitiesKey(sessionId: string) {
  return ["site-day-activities", sessionId] as const;
}

export async function listSiteDayActivities(
  sessionId: string,
): Promise<SiteDayActivity[]> {
  const { data, error } = await supabase
    .from("site_day_activities")
    .select("*")
    .eq("session_id", sessionId)
    .order("sort_order", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => toActivity(r as DbRow));
}

type TemplateItem = {
  meal_slot?: string;
  title?: string;
  meal_source?: string;
  activity_kind?: string;
};

async function loadActivityTemplate(): Promise<TemplateItem[]> {
  const { data, error } = await supabase
    .from("system_parameters")
    .select("value")
    .eq("key", "site_day.activity_template")
    .maybeSingle();
  if (error || !data?.value) {
    return [
      {
        meal_slot: "morning_tea",
        title: "Morning tea",
        meal_source: "delivered_by_us",
      },
      { meal_slot: "lunch", title: "Lunch", meal_source: "delivered_by_us" },
    ];
  }
  const v = data.value;
  if (Array.isArray(v)) return v as TemplateItem[];
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as TemplateItem[];
    } catch {
      return [];
    }
  }
  return [];
}

/** Seed template meals (+ medication round) once per session if empty. */
export async function ensureSiteDayActivitiesSeeded(
  sessionId: string,
): Promise<number> {
  const existing = await listSiteDayActivities(sessionId);
  if (existing.length > 0) return 0;

  const template = await loadActivityTemplate();
  const rows: Record<string, unknown>[] = template.map((t, i) => ({
    session_id: sessionId,
    activity_kind: t.activity_kind ?? "meal",
    meal_slot: t.meal_slot ?? null,
    title:
      t.title ??
      (t.meal_slot
        ? MEAL_SLOT_LABELS[t.meal_slot as MealSlot] ?? "Meal"
        : "Activity"),
    meal_source: t.meal_source ?? "delivered_by_us",
    phase: "pending",
    sort_order: i,
  }));
  rows.push({
    session_id: sessionId,
    activity_kind: "medication_round",
    meal_slot: null,
    title: "Medication round",
    meal_source: null,
    phase: "pending",
    sort_order: rows.length,
  });

  const { data, error } = await supabase
    .from("site_day_activities")
    .insert(rows)
    .select("id");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw error;
  }
  return data?.length ?? 0;
}

export async function openSiteDayActivity(
  activityId: string,
  mealOpen?: MealOpenPayload | null,
): Promise<SiteDayActivity> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();

  const prior = await supabase
    .from("site_day_activities")
    .select("id, activity_kind, title")
    .eq("id", activityId)
    .maybeSingle();
  if (prior.error) throw prior.error;
  if (!prior.data) throw new Error("Activity not found.");

  const patch: Record<string, unknown> = {
    phase: "active",
    opened_at: now,
    opened_by_id: staffId || null,
    updated_at: now,
  };

  if (prior.data.activity_kind === "meal") {
    if (!mealOpen) {
      throw new Error("Open meal requires source / menu details.");
    }
    const requiredPrep = mealSourceNeedsPrepChecks(mealOpen.mealSource)
      ? await fetchMealPrepCheckLabels()
      : [];
    const err = validateMealOpenPayload(mealOpen, requiredPrep);
    if (err) throw new Error(err);
    await assertMealPrepAttestationPin(mealOpen);
    const attPatch = mealPrepAttestationPatch(mealOpen);
    patch.meal_source = mealOpen.mealSource;
    patch.menu_notes =
      mealOpen.mealSource === "own_food"
        ? mealOpen.menuNotes?.trim() || null
        : mealOpen.menuNotes?.trim() || null;
    patch.prepared_by_staff_id = mealOpen.preparedByStaffId;
    patch.preparer_cert_status = mealOpen.preparerCertStatus;
    patch.preparer_ack_note = mealOpen.preparerAckNote?.trim() || null;
    patch.prep_checks_completed = mealSourceNeedsPrepChecks(mealOpen.mealSource)
      ? mealOpen.prepChecksCompleted ?? []
      : [];
    Object.assign(patch, attPatch);
  }

  const { data, error } = await supabase
    .from("site_day_activities")
    .update(patch)
    .eq("id", activityId)
    .select("*")
    .single();
  if (error) throw error;
  const act = toActivity(data as DbRow);

  if (act.activityKind === "meal") {
    const { seedSiteDayMealServiceRoll } = await import(
      "@/lib/api/site-day-meal-service"
    );
    await seedSiteDayMealServiceRoll(act.id, act.sessionId);
  }

  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SITE_DAY_ACTIVITY_OPENED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      activity_id: act.id,
      title: act.title,
      meal_source: act.mealSource,
      prepared_by_staff_id: act.preparedByStaffId,
      preparer_cert_status: act.preparerCertStatus,
      prep_checks_completed: act.prepChecksCompleted,
      prep_attestation_mode: act.prepAttestationMode,
      prep_attested_by_staff_id: act.prepAttestedByStaffId,
      guest_preparer_name: act.guestPreparerName,
      prep_attestation_note: act.prepAttestationNote,
      sfh_approved_by_staff_id:
        mealOpen?.sfhManagerApproval?.managerStaffId ?? null,
    },
  });
  return act;
}

export async function completeSiteDayActivity(
  activityId: string,
): Promise<SiteDayActivity> {
  const staffId = await resolveStaffIdWithFallback();
  const now = operationalNowIso();

  const prior = await supabase
    .from("site_day_activities")
    .select("id, activity_kind, session_id, title")
    .eq("id", activityId)
    .maybeSingle();
  if (prior.error) throw prior.error;
  if (!prior.data) throw new Error("Activity not found.");

  if (prior.data.activity_kind === "meal") {
    const { countOutstandingSiteDayMealServes } = await import(
      "@/lib/api/site-day-meal-service"
    );
    const outstanding = await countOutstandingSiteDayMealServes(activityId);
    if (outstanding > 0) {
      throw new Error(
        `${outstanding} person${outstanding === 1 ? "" : "s"} still expected on the meal roll. Mark Served / Modified / Own order / Declined / N/A before completing.`,
      );
    }
  }

  if (prior.data.activity_kind === "medication_round") {
    const {
      listAllActiveSchedules,
      listTodaysComplianceLogs,
    } = await import("@/lib/data-store");
    const { getSydneyIsoDate } = await import("@/lib/operational-time");
    const { assertMedicationRoundManaged } = await import(
      "@/lib/medication/todays-medication-round"
    );

    const date = getSydneyIsoDate();
    const sessionRes = await supabase
      .from("site_day_sessions")
      .select("id")
      .eq("session_date", date)
      .maybeSingle();
    if (sessionRes.error) throw sessionRes.error;
    const sessionId = (sessionRes.data?.id as string | undefined) ?? null;
    const checkedInIds = new Set<string>();
    if (sessionId) {
      const logRes = await supabase
        .from("client_attendance_log")
        .select("participant_id, status")
        .eq("session_id", sessionId);
      if (logRes.error) throw logRes.error;
      for (const r of logRes.data ?? []) {
        const row = r as { participant_id: string | null; status: string | null };
        if (row.status === "checked_in" && row.participant_id) {
          checkedInIds.add(row.participant_id);
        }
      }
    }
    const [schedules, logs] = await Promise.all([
      listAllActiveSchedules(),
      listTodaysComplianceLogs(),
    ]);
    assertMedicationRoundManaged({ schedules, logs, checkedInIds });
  }

  const { data, error } = await supabase
    .from("site_day_activities")
    .update({
      phase: "completed",
      closed_at: now,
      closed_by_id: staffId || null,
      updated_at: now,
    })
    .eq("id", activityId)
    .select("*")
    .single();
  if (error) throw error;
  const act = toActivity(data as DbRow);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SITE_DAY_ACTIVITY_COMPLETED",
    gps_lat: null,
    gps_lng: null,
    metadata: { activity_id: act.id, title: act.title },
  });
  return act;
}

export async function countOpenSiteDayActivities(
  sessionId: string,
): Promise<number> {
  const rows = await listSiteDayActivities(sessionId);
  return rows.filter((r) => r.phase === "active").length;
}

/**
 * TEST rewind helper — put all session activities back to undelivered
 * (`pending`, clear open/close stamps). Keeps the seeded rows so Open Centre
 * does not need to re-insert the template.
 */
export async function resetSiteDayActivitiesDelivery(
  sessionId: string,
): Promise<number> {
  const now = operationalNowIso();
  const { data, error } = await supabase
    .from("site_day_activities")
    .update({
      phase: "pending",
      opened_at: null,
      opened_by_id: null,
      closed_at: null,
      closed_by_id: null,
      updated_at: now,
    })
    .eq("session_id", sessionId)
    .select("id");
  if (error) {
    if (isSchemaMismatchError(error)) return 0;
    throw error;
  }
  return data?.length ?? 0;
}

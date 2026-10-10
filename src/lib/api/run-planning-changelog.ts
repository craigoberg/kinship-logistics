/**
 * BL-128 — who changed Run Planning IN/OUT, what they changed, when.
 */
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger } from "@/lib/api/ledger";
import { resolveAuditActor } from "@/lib/api/office-change-log";
import { normalizeDayCode } from "@/lib/api/run-planning";
import {
  DEFAULT_STAFF_UUID,
  primeStaffDisplayNames,
  resolveStaffDisplayName,
} from "@/lib/data-store";
import type { RoutePersonKind } from "@/lib/support-person";

export const RUN_PLANNING_CHANGE_LOG_KEY = ["run-planning-change-log"] as const;

export type RunPlanningChangeAction = "created" | "updated" | "cleared" | "reordered";

export type RunPlanningChangeSource =
  | "staff_sheet"
  | "carer_sheet"
  | "add_to_run"
  | "participant_schedule"
  | "run_order"
  | "centre_run";

export interface RunPlanningChangeRow {
  id: string;
  createdAt: string;
  actorStaffId: string | null;
  actorAuthUserId: string | null;
  actorName: string;
  personKind: RoutePersonKind | "run";
  personId: string | null;
  personName: string;
  dayOfWeek: string | null;
  action: RunPlanningChangeAction;
  source: string;
  summary: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  scheduleId: string | null;
}

export interface RecordRunPlanningChangeInput {
  action: RunPlanningChangeAction;
  source?: RunPlanningChangeSource | string;
  personKind: RoutePersonKind | "run";
  personId?: string | null;
  personName: string;
  dayOfWeek?: string | null;
  summary: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  scheduleId?: string | null;
}

export { resolveAuditActor as resolvePlanningActor } from "@/lib/api/office-change-log";

export function transportLabel(code: string | null | undefined): string {
  const v = (code ?? "").trim();
  if (!v) return "(none)";
  const lower = v.toLowerCase();
  if (
    v === "TRN-SELF" ||
    lower.includes("self") ||
    lower.includes("private") ||
    lower.includes("family")
  ) {
    return "Self";
  }
  return v;
}

export function dayShortLabel(day: string | null | undefined): string {
  if (!day) return "";
  const n = normalizeDayCode(day);
  if (n) return n.replace(/^DAY-/, "");
  return day.replace(/^DAY-/i, "");
}

export function buildScheduleChangeSummary(input: {
  action: "created" | "updated" | "cleared";
  personName: string;
  dayOfWeek: string;
  beforeIn?: string | null;
  beforeOut?: string | null;
  afterIn?: string | null;
  afterOut?: string | null;
}): string {
  const day = dayShortLabel(input.dayOfWeek);
  const name = input.personName;
  if (input.action === "cleared") {
    return `Cleared ${name} ${day} (was IN ${transportLabel(input.beforeIn)} / OUT ${transportLabel(input.beforeOut)})`;
  }
  if (input.action === "created") {
    return `Added ${name} ${day} IN ${transportLabel(input.afterIn)} / OUT ${transportLabel(input.afterOut)}`;
  }
  const bits: string[] = [];
  if ((input.beforeIn ?? "") !== (input.afterIn ?? "")) {
    bits.push(`IN ${transportLabel(input.beforeIn)} → ${transportLabel(input.afterIn)}`);
  }
  if ((input.beforeOut ?? "") !== (input.afterOut ?? "")) {
    bits.push(`OUT ${transportLabel(input.beforeOut)} → ${transportLabel(input.afterOut)}`);
  }
  if (bits.length === 0) {
    return `Updated ${name} ${day}`;
  }
  return `Changed ${name} ${day} ${bits.join("; ")}`;
}

export async function recordRunPlanningChange(
  input: RecordRunPlanningChangeInput,
): Promise<void> {
  const actor = await resolveAuditActor();
  await writeToLedger({
    staff_id: actor.staffId ?? DEFAULT_STAFF_UUID,
    category: "CENTRE",
    severity: "INFO",
    action_type: "RUN_PLANNING_CHANGED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      summary: input.summary,
      actor_name: actor.name,
      actor_auth_user_id: actor.authUserId,
      person_kind: input.personKind,
      person_id: input.personId ?? null,
      person_name: input.personName,
      day_of_week: input.dayOfWeek ?? null,
      action: input.action,
      source: input.source ?? "centre_run",
      before: input.beforeState ?? null,
      after: input.afterState ?? null,
      schedule_id: input.scheduleId ?? null,
    },
  });
}

export async function recordRunPlanningChangeBestEffort(
  input: RecordRunPlanningChangeInput,
): Promise<void> {
  try {
    await recordRunPlanningChange(input);
  } catch (err) {
    console.error("[run-planning] change log failed", err);
  }
}

interface LedgerChangeDb {
  id: string;
  created_at: string;
  staff_id: string;
  metadata: Record<string, unknown> | null;
}

function metaText(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function listRunPlanningChangeLog(limit = 80): Promise<RunPlanningChangeRow[]> {
  const { data, error } = await supabase
    .from("operational_ledger")
    .select("id, created_at, staff_id, metadata")
    .eq("action_type", "RUN_PLANNING_CHANGED")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  await primeStaffDisplayNames();
  return (data ?? []).map((raw) => {
    const r = raw as LedgerChangeDb;
    const meta = r.metadata ?? {};
    const action = (metaText(meta, "action") ?? "updated") as RunPlanningChangeAction;
    return {
      id: r.id,
      createdAt: r.created_at,
      actorStaffId: r.staff_id === DEFAULT_STAFF_UUID ? null : r.staff_id,
      actorAuthUserId: metaText(meta, "actor_auth_user_id"),
      actorName:
        metaText(meta, "actor_name") || resolveStaffDisplayName(r.staff_id) || "Unknown operator",
      personKind: (metaText(meta, "person_kind") as RunPlanningChangeRow["personKind"]) || "staff",
      personId: metaText(meta, "person_id"),
      personName: metaText(meta, "person_name") || "—",
      dayOfWeek: metaText(meta, "day_of_week"),
      action,
      source: metaText(meta, "source") || "centre_run",
      summary: metaText(meta, "summary") || "Run planning change",
      beforeState: (meta.before as Record<string, unknown> | null) ?? null,
      afterState: (meta.after as Record<string, unknown> | null) ?? null,
      scheduleId: metaText(meta, "schedule_id"),
    };
  });
}

export async function fetchParticipantDisplayName(participantId: string): Promise<string> {
  const { data } = await supabase
    .from("participants")
    .select("first_name, last_name")
    .eq("id", participantId)
    .maybeSingle();
  const row = data as { first_name?: string | null; last_name?: string | null } | null;
  const name = `${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim();
  return name || "(participant)";
}

export const PLANNING_SOURCE_LABEL: Record<string, string> = {
  staff_sheet: "Staff record",
  carer_sheet: "Carer record",
  add_to_run: "Add support person",
  participant_schedule: "Participant schedule",
  run_order: "Run order",
  centre_run: "Centre run",
};

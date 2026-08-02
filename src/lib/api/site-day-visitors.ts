/**
 * BL-097 — Day Centre floor visitors (non-registered).
 * Separate from client_attendance_log / Add Attendee walk-ins.
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";
import { operationalNowIso } from "@/lib/operational-clock";

export type SiteDayVisitorKind =
  | "trial"
  | "friend_family"
  | "site"
  | "other";

export type SiteDayVisitor = {
  id: string;
  sessionId: string;
  displayName: string;
  kind: SiteDayVisitorKind;
  linkedParticipantId: string | null;
  note: string | null;
  arrivedAt: string;
  arrivedBy: string | null;
  leftAt: string | null;
  leftBy: string | null;
};

type DbRow = {
  id: string;
  session_id: string;
  display_name: string;
  kind: string;
  linked_participant_id: string | null;
  note: string | null;
  arrived_at: string;
  arrived_by: string | null;
  left_at: string | null;
  left_by: string | null;
};

export const VISITOR_KIND_LABELS: Record<SiteDayVisitorKind, string> = {
  trial: "Trial",
  friend_family: "Friend / Family",
  site: "Site visitor",
  other: "Other",
};

/** Display label; maps legacy friend/family rows until SQL migrate runs. */
export function visitorKindLabel(kind: string): string {
  if (kind === "friend" || kind === "family") return "Friend / Family";
  return VISITOR_KIND_LABELS[kind as SiteDayVisitorKind] ?? kind;
}

function toVisitor(r: DbRow): SiteDayVisitor {
  return {
    id: r.id,
    sessionId: r.session_id,
    displayName: r.display_name,
    kind: r.kind as SiteDayVisitorKind,
    linkedParticipantId: r.linked_participant_id,
    note: r.note,
    arrivedAt: r.arrived_at,
    arrivedBy: r.arrived_by,
    leftAt: r.left_at,
    leftBy: r.left_by,
  };
}

export function siteDayVisitorsKey(sessionId: string) {
  return ["site-day-visitors", sessionId] as const;
}

export async function listSiteDayVisitors(
  sessionId: string,
): Promise<SiteDayVisitor[]> {
  const { data, error } = await supabase
    .from("site_day_visitors")
    .select("*")
    .eq("session_id", sessionId)
    .order("arrived_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => toVisitor(r as DbRow));
}

export async function countPresentSiteDayVisitors(
  sessionId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("site_day_visitors")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .is("left_at", null);
  if (error) throw error;
  return count ?? 0;
}

export async function addSiteDayVisitor(input: {
  sessionId: string;
  displayName: string;
  kind: SiteDayVisitorKind;
  linkedParticipantId?: string | null;
  note?: string | null;
}): Promise<SiteDayVisitor> {
  const name = input.displayName.trim();
  if (!name) throw new Error("Visitor name is required.");
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();

  const { data, error } = await supabase
    .from("site_day_visitors")
    .insert({
      session_id: input.sessionId,
      display_name: name,
      kind: input.kind,
      linked_participant_id: input.linkedParticipantId?.trim() || null,
      note: input.note?.trim() || null,
      arrived_at: nowIso,
      arrived_by: staffId,
    })
    .select("*")
    .single();
  if (error) throw error;

  const row = toVisitor(data as DbRow);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SITE_DAY_VISITOR_ARRIVED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      visitor_id: row.id,
      session_id: input.sessionId,
      display_name: row.displayName,
      kind: row.kind,
      linked_participant_id: row.linkedParticipantId,
    },
  });

  return row;
}

export async function markSiteDayVisitorLeft(
  visitor: SiteDayVisitor,
): Promise<SiteDayVisitor> {
  if (visitor.leftAt) return visitor;
  const staffId = await resolveStaffIdWithFallback();
  const nowIso = operationalNowIso();

  const { data, error } = await supabase
    .from("site_day_visitors")
    .update({
      left_at: nowIso,
      left_by: staffId,
    })
    .eq("id", visitor.id)
    .is("left_at", null)
    .select("*")
    .single();
  if (error) throw error;

  const row = toVisitor(data as DbRow);
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SITE_DAY_VISITOR_LEFT",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      visitor_id: row.id,
      session_id: row.sessionId,
      display_name: row.displayName,
      kind: row.kind,
    },
  });

  return row;
}

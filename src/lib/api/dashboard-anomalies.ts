import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { appendUpdateNote, type UnifiedIssue } from "@/lib/api/unified-issues";

const TAG_PREFIX = "[DASH_ANOMALY:";

function anomalyTag(anomalyKey: string): string {
  return `${TAG_PREFIX}${anomalyKey}]`;
}

/**
 * Find or create a pending operational_incidents row for a dashboard
 * start/end-day clearance anomaly so coordinators can manage it in the Hub shell.
 */
export async function ensureDashboardAnomalyIncident(args: {
  anomalyKey: string;
  title: string;
  detail: string;
}): Promise<UnifiedIssue> {
  const tag = anomalyTag(args.anomalyKey);
  const staffId = await resolveStaffIdWithFallback();

  const { data: existing, error: findErr } = await supabase
    .from("operational_incidents")
    .select("*")
    .eq("status", "pending")
    .ilike("description", `%${tag}%`)
    .maybeSingle();

  if (findErr) throw findErr;

  let row: Record<string, unknown>;
  if (existing) {
    row = existing as Record<string, unknown>;
  } else {
    const description = `${tag} ${args.title}\n\n${args.detail}`;
    const { data, error } = await supabase
      .from("operational_incidents")
      .insert({
        incident_type: "mechanical",
        severity: "sev2",
        description,
        reported_by: staffId,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    row = data as Record<string, unknown>;

    await appendUpdateNote(
      {
        key: `incident:${row.id as string}`,
        source: "incident",
        sourceLabel: "Incident",
        category: "mechanical",
        subCategory: "Dashboard anomaly",
        severity: "yellow",
        title: args.title.slice(0, 120),
        description,
        status: "pending",
        createdAt: String(row.created_at ?? new Date().toISOString()),
        sourceRowId: String(row.id),
        raw: row,
      },
      "Auto-created from Dashboard start/end-day anomaly feed.",
    ).catch(() => {
      /* timeline note is best-effort on create */
    });
  }

  const id = String(row.id);
  const description = String(row.description ?? "");
  return {
    key: `incident:${id}`,
    source: "incident",
    sourceLabel: "Incident · Dashboard",
    category: String(row.incident_type ?? "mechanical").replace("_", " "),
    subCategory: "Clearance anomaly",
    severity: "yellow",
    title: args.title.slice(0, 120),
    description,
    status: String(row.status ?? "pending"),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    sourceRowId: id,
    eventId: (row.event_id as string | null) ?? null,
    raw: row,
  };
}

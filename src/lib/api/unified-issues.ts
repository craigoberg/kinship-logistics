import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps, type LedgerSeverity } from "@/lib/api/ledger";
import {
  computeRyge,
  listComplianceAssets,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import { resolveStaffIdWithFallback } from "@/lib/data-store";

export type UnifiedIssueSource =
  | "day_centre"
  | "incident"
  | "escalation"
  | "renewal";

export type UnifiedSeverity = "red" | "yellow" | "green" | null;

export interface UnifiedIssue {
  key: string;
  source: UnifiedIssueSource;
  sourceLabel: string;
  category: string;
  subCategory: string | null;
  severity: UnifiedSeverity;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  sourceRowId: string;
  eventId?: string | null;
  raw: unknown;
}

const SOURCE_LABELS: Record<UnifiedIssueSource, string> = {
  day_centre: "Day Centre",
  incident: "Incident",
  escalation: "Escalation",
  renewal: "Renewal",
};

function severityToLedger(sev: UnifiedSeverity): LedgerSeverity {
  if (sev === "red") return "RED";
  if (sev === "yellow") return "YELLOW";
  if (sev === "green") return "GREEN";
  return "INFO";
}

function incidentSevToUnified(sev: string | null | undefined): UnifiedSeverity {
  if (sev === "sev1") return "red";
  if (sev === "sev2") return "yellow";
  if (sev === "sev3") return "green";
  return null;
}

/**
 * Fetch every open operational issue across the four source tables in
 * parallel and normalise them to a single shape for the Governance Hub.
 */
export async function listOpenUnifiedIssues(): Promise<UnifiedIssue[]> {
  const [siteIssuesRes, incidentsRes, escalationsRes, assets] =
    await Promise.all([
      supabase
        .from("site_issues_register")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      supabase
        .from("operational_incidents")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      // Escalations: keep visible across the three live phases so an
      // approved-but-awaiting-operator-acknowledgment row does not silently
      // vanish from the Hub before the on-site operator signs off.
      supabase
        .from("operational_escalations")
        .select("*")
        .or(
          "status.in.(pending,claimed),and(status.eq.resolved_approved,operator_acknowledged_at.is.null)",
        )
        .order("created_at", { ascending: false }),
      listComplianceAssets({ status: "active" }).catch(() => [] as ComplianceAsset[]),
    ]);


  const out: UnifiedIssue[] = [];

  if (!siteIssuesRes.error) {
    for (const r of (siteIssuesRes.data ?? []) as Array<Record<string, unknown>>) {
      const sev = (r.severity as UnifiedSeverity) ?? null;
      out.push({
        key: `day_centre:${r.id as string}`,
        source: "day_centre",
        sourceLabel: SOURCE_LABELS.day_centre,
        category: sev ? sev.toUpperCase() : "NOTE",
        subCategory: (r.owner as string | null) ?? null,
        severity: sev,
        title: String(r.issue_description ?? "Day Centre anomaly").slice(0, 120),
        description: String(r.issue_description ?? ""),
        status: String(r.status ?? "open"),
        createdAt: String(r.created_at ?? new Date().toISOString()),
        sourceRowId: String(r.id),
        raw: r,
      });
    }
  } else {
    console.warn("[unified-issues] site_issues_register failed", siteIssuesRes.error);
  }

  if (!incidentsRes.error) {
    for (const r of (incidentsRes.data ?? []) as Array<Record<string, unknown>>) {
      const sev = incidentSevToUnified(r.severity as string | null);
      out.push({
        key: `incident:${r.id as string}`,
        source: "incident",
        sourceLabel: SOURCE_LABELS.incident,
        category: String(r.incident_type ?? "incident").replace("_", " "),
        subCategory: (r.event_id as string | null) ?? null,
        severity: sev,
        title: String(r.description ?? "Operational incident").slice(0, 120),
        description: String(r.description ?? ""),
        status: String(r.status ?? "pending"),
        createdAt: String(r.created_at ?? new Date().toISOString()),
        sourceRowId: String(r.id),
        eventId: (r.event_id as string | null) ?? null,
        raw: r,
      });
    }
  } else {
    console.warn("[unified-issues] operational_incidents failed", incidentsRes.error);
  }

  if (!escalationsRes.error) {
    for (const r of (escalationsRes.data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        key: `escalation:${r.id as string}`,
        source: "escalation",
        sourceLabel: SOURCE_LABELS.escalation,
        category: String(r.gate_id ?? "gate"),
        subCategory: (r.vehicle_info as string | null) ?? null,
        severity: "red",
        title: `${r.driver_name ?? "Driver"} · ${r.vehicle_info ?? ""}`.trim(),
        description: `Gate ${r.gate_id ?? "?"} — ${r.driver_name ?? "driver"} (${r.vehicle_info ?? "vehicle"}). Status: ${r.status}.`,
        status: String(r.status ?? "pending"),
        createdAt: String(r.created_at ?? new Date().toISOString()),
        sourceRowId: String(r.id),
        raw: r,
      });
    }
  } else {
    console.warn("[unified-issues] operational_escalations failed", escalationsRes.error);
  }

  for (const a of assets) {
    const ryge = computeRyge(a);
    if (ryge === "green") continue;
    out.push({
      key: `renewal:${a.id}`,
      source: "renewal",
      sourceLabel: SOURCE_LABELS.renewal,
      category: a.category,
      subCategory: a.type,
      severity: ryge,
      title: a.name,
      description:
        (a.description ?? "") +
        (a.expiry_date ? ` (expires ${a.expiry_date})` : ""),
      status: a.status,
      createdAt: a.updated_at,
      sourceRowId: a.id,
      raw: a,
    });
  }

  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

/**
 * Mark a unified issue as resolved at its source AND write an
 * `operational_ledger` receipt with the mandatory resolution note —
 * the receipt is the NDIS-reportable artefact.
 *
 * Renewals are not resolvable from the Hub (use the Compliance Asset
 * editor instead); calling this for a renewal throws.
 */
export async function resolveUnifiedIssue(
  issue: UnifiedIssue,
  resolutionNote: string,
): Promise<void> {
  const note = resolutionNote.trim();
  if (note.length < 10) {
    throw new Error("Resolution note must be at least 10 characters.");
  }
  if (issue.source === "renewal") {
    throw new Error(
      "Renewals are resolved via the Compliance Asset editor, not the unified panel.",
    );
  }

  const nowIso = new Date().toISOString();
  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();

  // 1) Ledger receipt FIRST so the NDIS audit trail exists even if the
  //    source flip races or fails.
  await writeToLedger({
    staff_id: staffId,
    category: issue.source === "day_centre" ? "CENTRE" : "VEHICLE",
    severity: severityToLedger(issue.severity),
    action_type: "governance.issue_resolved",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      source: issue.source,
      source_row_id: issue.sourceRowId,
      category: issue.category,
      sub_category: issue.subCategory,
      severity: issue.severity,
      resolution_note: note,
      resolved_by_staff_id: staffId,
      title: issue.title,
    },
  });

  // 2) Flip the source row.
  if (issue.source === "day_centre") {
    const { error } = await supabase
      .from("site_issues_register")
      .update({ status: "resolved", resolved_at: nowIso })
      .eq("id", issue.sourceRowId);
    if (error) throw error;
  } else if (issue.source === "incident") {
    const { error } = await supabase
      .from("operational_incidents")
      .update({ status: "resolved" })
      .eq("id", issue.sourceRowId);
    if (error) throw error;
  } else if (issue.source === "escalation") {
    const { error } = await supabase
      .from("operational_escalations")
      .update({
        status: "resolved_approved",
        resolved_at: nowIso,
        resolved_by: staffId,
        resolution_notes: note,
      })
      .eq("id", issue.sourceRowId);
    if (error) throw error;
  }
}

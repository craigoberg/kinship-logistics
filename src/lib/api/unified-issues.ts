import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps, type LedgerSeverity } from "@/lib/api/ledger";
import {
  computeRyge,
  listComplianceAssets,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import { getActiveUserProfile, resolveStaffIdWithFallback } from "@/lib/data-store";

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

export type UnifiedIssueTab = "active" | "awaiting";

/**
 * Fetch every open operational issue across the four source tables in
 * parallel and normalise them to a single shape for the Governance Hub.
 *
 * tab = "active"   → open / pending rows (current default behaviour).
 * tab = "awaiting" → site_issues_register rows whose status is
 *                    `deferred` or `awaiting_external` (escalated to
 *                    Council). Renewals + escalations are omitted from
 *                    this tab — they have their own resolution surfaces.
 */
export async function listOpenUnifiedIssues(
  options: { tab?: UnifiedIssueTab } = {},
): Promise<UnifiedIssue[]> {
  const tab: UnifiedIssueTab = options.tab ?? "active";

  if (tab === "awaiting") {
    const { data, error } = await supabase
      .from("site_issues_register")
      .select("*")
      .in("status", ["deferred", "awaiting_external"])
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[unified-issues] awaiting tab fetch failed", error);
      return [];
    }
    const out: UnifiedIssue[] = [];
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const sev = (r.severity as UnifiedSeverity) ?? null;
      const status = String(r.status ?? "open");
      const label =
        status === "deferred" ? "Day Centre · Deferred" : "Day Centre · Council";
      out.push({
        key: `day_centre:${r.id as string}`,
        source: "day_centre",
        sourceLabel: label,
        category: sev ? sev.toUpperCase() : "NOTE",
        subCategory:
          status === "awaiting_external"
            ? (r.council_severity as string | null) ?? "Council"
            : (r.deferred_until as string | null) ?? "Deferred",
        severity: sev,
        title: String(r.issue_description ?? "Day Centre anomaly").slice(0, 120),
        description: String(r.issue_description ?? ""),
        status,
        createdAt: String(r.created_at ?? new Date().toISOString()),
        sourceRowId: String(r.id),
        raw: r,
      });
    }
    return out;
  }

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
          "and(status.eq.pending),and(status.eq.claimed),and(status.eq.resolved_approved,operator_acknowledged_at.is.null)",
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
      const status = String(r.status ?? "pending");
      const awaitingAck =
        status === "resolved_approved" && r.operator_acknowledged_at == null;
      out.push({
        key: `escalation:${r.id as string}`,
        source: "escalation",
        sourceLabel: awaitingAck
          ? `${SOURCE_LABELS.escalation} · Workaround — awaiting operator ack`
          : SOURCE_LABELS.escalation,
        category: String(r.gate_id ?? "gate"),
        subCategory: (r.vehicle_info as string | null) ?? null,
        severity: "red",
        title: `${r.driver_name ?? "Driver"} · ${r.vehicle_info ?? ""}`.trim(),
        description: awaitingAck
          ? `Gate ${r.gate_id ?? "?"} — manager approved a workaround. Awaiting on-site operator (${r.driver_name ?? "driver"}) acknowledgment.`
          : `Gate ${r.gate_id ?? "?"} — ${r.driver_name ?? "driver"} (${r.vehicle_info ?? "vehicle"}). Status: ${status}.`,
        status,
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
    // Context-aware closure:
    //   - Pre-trip (sourceKind = "bus_walkaround", no source_issue_id):
    //     leave operator_acknowledged_at NULL so the driver's screen stays
    //     locked on Phase 2 (Manager Authorized) and requires the driver's
    //     PIN to finalize.
    //   - Day Centre (sourceKind = "site_day_red" / source_issue_id set):
    //     the on-site opener has already participated in the joint review,
    //     so write operator_acknowledged_at NOW to drop the shield
    //     immediately and avoid a permanent lockout.
    const raw = (issue.raw ?? {}) as Record<string, unknown>;
    const isDayCentreEscalation =
      raw.source_kind === "site_day_red" ||
      (raw.source_issue_id != null && String(raw.source_issue_id).length > 0);

    const update: Record<string, unknown> = {
      status: "resolved_approved",
      resolved_at: nowIso,
      resolved_by: staffId,
      resolution_notes: note,
    };
    if (isDayCentreEscalation) {
      update.operator_acknowledged_at = nowIso;
      update.operator_acknowledged_by = staffId;
    }

    const { error } = await supabase
      .from("operational_escalations")
      .update(update)
      .eq("id", issue.sourceRowId);
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Append-only timeline + Hub triage state transitions
// ---------------------------------------------------------------------------

export type CouncilSeverity = "Sev 1" | "Sev 2" | "Sev 3" | "Sev 4";

export const COUNCIL_SEVERITY_OPTIONS: Array<{
  value: CouncilSeverity;
  label: string;
}> = [
  { value: "Sev 1", label: "Sev 1 — Critical" },
  { value: "Sev 2", label: "Sev 2 — High" },
  { value: "Sev 3", label: "Sev 3 — Medium" },
  { value: "Sev 4", label: "Sev 4 — Routine" },
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Browser-local stamp in dd-mm-yy/hh:mm. */
function formatStamp(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${yy}/${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export interface HubIssueNote {
  id: string;
  source: UnifiedIssueSource;
  sourceRowId: string;
  note: string;
  kind: "append" | "defer" | "escalate" | "resolve";
  stampedAt: string;
  staffId: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Read every timeline note for a Hub issue (any source), oldest → newest.
 */
export async function listIssueNotes(
  source: UnifiedIssueSource,
  sourceRowId: string,
): Promise<HubIssueNote[]> {
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("*")
    .eq("source", source)
    .eq("source_row_id", sourceRowId)
    .order("stamped_at", { ascending: true });
  if (error) {
    console.warn("[unified-issues] listIssueNotes failed", error);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    source: r.source as UnifiedIssueSource,
    sourceRowId: String(r.source_row_id),
    note: String(r.note ?? ""),
    kind: (r.kind as HubIssueNote["kind"]) ?? "append",
    stampedAt: String(r.stamped_at),
    staffId: (r.staff_id as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}

/** Render a single note as `[dd-mm-yy/hh:mm]: text`. */
export function renderNoteLine(n: HubIssueNote): string {
  return `[${formatStamp(new Date(n.stampedAt))}]: ${n.note}`;
}

async function insertHubNote(args: {
  source: UnifiedIssueSource;
  sourceRowId: string;
  note: string;
  kind: HubIssueNote["kind"];
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const staffId = await resolveStaffIdWithFallback().catch(() => null);
  const { error } = await supabase.from("hub_issue_notes").insert({
    source: args.source,
    source_row_id: args.sourceRowId,
    note: args.note.trim(),
    kind: args.kind,
    staff_id: staffId,
    metadata: args.metadata ?? null,
  });
  if (error) throw error;
}

/**
 * Append a timeline note for ANY Hub source. Inserts into the central
 * `hub_issue_notes` table (append-only, no row contention).
 *
 * For `day_centre` rows we ALSO mirror the entry into the legacy
 * `site_issues_register.update_log` column so existing day-centre views
 * that read that column keep working during the transition.
 */
export async function appendUpdateNote(
  issue: UnifiedIssue,
  note: string,
): Promise<void> {
  const trimmed = note.trim();
  if (trimmed.length < 10) {
    throw new Error("Update note must be at least 10 characters.");
  }

  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: trimmed,
    kind: "append",
  });

  // Backward-compat mirror for day_centre's existing column.
  if (issue.source === "day_centre") {
    try {
      const { data: current } = await supabase
        .from("site_issues_register")
        .select("update_log")
        .eq("id", issue.sourceRowId)
        .single();
      const prior = String(
        (current as { update_log: string | null } | null)?.update_log ?? "",
      );
      const stamp = formatStamp(new Date());
      const next = `${prior}\n[${stamp}]: ${trimmed}`.trim();
      await supabase
        .from("site_issues_register")
        .update({ update_log: next })
        .eq("id", issue.sourceRowId);
    } catch (err) {
      console.warn("[unified-issues] legacy update_log mirror failed", err);
    }
  }
}


/**
 * Defer an issue with a "next action" date. The row drops off the
 * primary active Hub list and stays reachable via the Awaiting tab.
 * Performs the timeline append and the status flip in one optimistic
 * UPDATE so the two stay in sync.
 */
export async function deferUnifiedIssue(
  issue: UnifiedIssue,
  args: { untilIso: string; note: string },
): Promise<void> {
  const note = args.note.trim();
  if (note.length < 10) {
    throw new Error("Defer note must be at least 10 characters.");
  }
  if (!args.untilIso || Number.isNaN(Date.parse(args.untilIso))) {
    throw new Error("A valid next-action date is required.");
  }

  // 1) Always log a defer note to the central timeline (every source).
  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: `[DEFERRED until ${args.untilIso.slice(0, 16)}] ${note}`,
    kind: "defer",
    metadata: { deferred_until: args.untilIso },
  });

  // 2) For day_centre rows, also flip the row off the active list.
  //    Other source tables don't carry a 'deferred' status today — the
  //    timeline note is the audit trail.
  if (issue.source === "day_centre") {
    const { error: writeErr } = await supabase
      .from("site_issues_register")
      .update({
        status: "deferred",
        deferred_until: args.untilIso,
      })
      .eq("id", issue.sourceRowId);
    if (writeErr) throw writeErr;
  }

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: issue.source === "day_centre" ? "CENTRE" : "VEHICLE",
    severity: severityToLedger(issue.severity),
    action_type: "governance.issue_deferred",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      source: issue.source,
      source_row_id: issue.sourceRowId,
      deferred_until: args.untilIso,
      note,
    },
  });
}

/**
 * Escalate an issue to Council with a chosen Council Severity. For
 * day_centre rows, also flips status to `awaiting_external` so the row
 * drops off the active Hub list and surfaces in the Awaiting tab. For
 * other sources, logs the council escalation note + ledger receipt only.
 */
export async function escalateUnifiedIssueToCouncil(
  issue: UnifiedIssue,
  args: { councilSeverity: CouncilSeverity; note: string },
): Promise<void> {
  const note = args.note.trim();
  if (note.length < 10) {
    throw new Error("Council escalation note must be at least 10 characters.");
  }

  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: `[ESCALATED TO COUNCIL · ${args.councilSeverity}] ${note}`,
    kind: "escalate",
    metadata: { council_severity: args.councilSeverity },
  });

  if (issue.source === "day_centre") {
    const { error: writeErr } = await supabase
      .from("site_issues_register")
      .update({
        status: "awaiting_external",
        council_severity: args.councilSeverity,
        council_sla_category: args.councilSeverity,
        owner: "council",
      })
      .eq("id", issue.sourceRowId);
    if (writeErr) throw writeErr;
  }

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: issue.source === "day_centre" ? "CENTRE" : "VEHICLE",
    severity: severityToLedger(issue.severity),
    action_type: "governance.council_escalated",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      source: issue.source,
      source_row_id: issue.sourceRowId,
      council_severity: args.councilSeverity,
      note,
    },
  });
}


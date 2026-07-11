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
  | "event"
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
  event: "Trip Day",
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
 *
 * deferRewarnDays (default 7) — how many days before a deferral deadline
 *   expires that the issue resurfaces on the Active tab. Issues with a
 *   live deferral more than `deferRewarnDays` in the future are excluded
 *   from Active ("No News Is Good News"). Once within the window they
 *   reappear so managers are notified before the deadline lapses.
 */
export async function listOpenUnifiedIssues(
  options: { tab?: UnifiedIssueTab; deferRewarnDays?: number } = {},
): Promise<UnifiedIssue[]> {
  const tab: UnifiedIssueTab = options.tab ?? "active";
  const deferRewarnMs = (options.deferRewarnDays ?? 7) * 86_400_000;

  // Latest note per (source, source_row_id), used to detect "currently
  // deferred" issues for any source (incident / escalation / renewal /
  // day_centre). A defer is "live" when the latest note is kind='defer'
  // and metadata.deferred_until is in the future.
  const deferState = await fetchLatestDeferStateMap();

  if (tab === "awaiting") {
    const { data, error } = await supabase
      .from("site_issues_register")
      .select("*")
      .in("status", ["deferred", "awaiting_external"])
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[unified-issues] awaiting tab fetch failed", error);
    }
    const out: UnifiedIssue[] = [];
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const sev = (r.severity as UnifiedSeverity) ?? null;
      const status = String(r.status ?? "open");
      const isEventRow = !!(r.event_id as string | null);
      const source: UnifiedIssueSource = isEventRow ? "event" : "day_centre";
      const baseLabel = isEventRow ? "Trip Day" : "Day Centre";
      const label =
        status === "deferred" ? `${baseLabel} · Deferred` : `${baseLabel} · Council`;
      out.push({
        key: `${source}:${r.id as string}`,
        source,
        sourceLabel: label,
        category: sev ? sev.toUpperCase() : "NOTE",
        subCategory:
          status === "awaiting_external"
            ? (r.council_severity as string | null) ?? "Council"
            : (r.deferred_until as string | null) ?? "Deferred",
        severity: sev,
        title: String(r.issue_description ?? (isEventRow ? "Trip Day venue issue" : "Day Centre anomaly")).slice(0, 120),
        description: String(r.issue_description ?? ""),
        status,
        createdAt: String(r.created_at ?? new Date().toISOString()),
        sourceRowId: String(r.id),
        eventId: (r.event_id as string | null) ?? null,
        raw: r,
      });
    }

    // Cross-source deferrals: surface any non-day_centre issue whose
    // latest timeline note is a still-live defer.
    const extras = await fetchDeferredNonDayCentreIssues(deferState);
    out.push(...extras);
    return out;
  }

  const [siteIssuesRes, incidentsRes, escalationsRes] = await Promise.all([
    supabase
      .from("site_issues_register")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    // §14 routing: only human_operational incidents belong in Human Incidents tab.
    // mechanical / asset incidents are tracked in Maintenance & Repairs via maintenance_items.
    supabase
      .from("operational_incidents")
      .select("*")
      .eq("status", "pending")
      .eq("incident_type", "human_operational")
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
  ]);


  const out: UnifiedIssue[] = [];

  // Throw so React Query surfaces the error in the UI (isError=true).
  if (siteIssuesRes.error) {
    throw new Error(
      `site_issues_register: ${siteIssuesRes.error.message ?? siteIssuesRes.error.code ?? "query failed"}`,
    );
  }
  for (const r of (siteIssuesRes.data ?? []) as Array<Record<string, unknown>>) {
    const sev = (r.severity as UnifiedSeverity) ?? null;
    const isEventRow = !!(r.event_id as string | null);
    const source: UnifiedIssueSource = isEventRow ? "event" : "day_centre";
    const fallbackTitle = isEventRow ? "Trip Day venue issue" : "Day Centre anomaly";
    out.push({
      key: `${source}:${r.id as string}`,
      source,
      sourceLabel: SOURCE_LABELS[source],
      category: sev ? sev.toUpperCase() : "NOTE",
      subCategory: (r.owner as string | null) ?? null,
      severity: sev,
      title: String(r.issue_description ?? fallbackTitle).slice(0, 120),
      description: String(r.issue_description ?? ""),
      status: String(r.status ?? "open"),
      createdAt: String(r.created_at ?? new Date().toISOString()),
      sourceRowId: String(r.id),
      eventId: (r.event_id as string | null) ?? null,
      raw: r,
    });
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


  // Compliance renewals intentionally excluded from the active feed —
  // they live exclusively in the Governance Hub's "Compliance Assets" tab.



  // Filter out deferred issues — but only when the deferral deadline is
  // further away than the rewarn window. Once inside the window the issue
  // resurfaces on the Active tab so managers see it before the defer lapses.
  const now = Date.now();
  const filtered = out.filter((i) => {
    const k = `${i.source}:${i.sourceRowId}`;
    const d = deferState.get(k);
    if (!d) return true; // not deferred — always show
    const msUntilDefer = d.deferredUntil.getTime() - now;
    if (msUntilDefer <= 0) return true; // defer has already lapsed — show
    // Hidden only while the deadline is comfortably in the future.
    return msUntilDefer <= deferRewarnMs;
  });

  return filtered;
}

// ---------------------------------------------------------------------------
// Cross-source deferral helpers (read latest hub_issue_notes per issue)
// ---------------------------------------------------------------------------

interface LiveDefer {
  deferredUntil: Date;
  note: string;
  stampedAt: string;
}

/**
 * Build a map of `${source}:${sourceRowId}` → live defer state by reading
 * the latest note per issue from `hub_issue_notes`. An issue is "live
 * deferred" only when its LATEST note is kind='defer' (any later
 * append/resolve note cancels the defer).
 */
async function fetchLatestDeferStateMap(): Promise<Map<string, LiveDefer>> {
  const map = new Map<string, LiveDefer>();
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("source, source_row_id, note, kind, stamped_at, metadata")
    .order("stamped_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.warn("[unified-issues] fetchLatestDeferStateMap failed", error);
    return map;
  }
  const seen = new Set<string>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const key = `${String(r.source)}:${String(r.source_row_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.kind !== "defer") continue;
    const meta = (r.metadata as Record<string, unknown> | null) ?? null;
    const untilStr = meta && typeof meta.deferred_until === "string"
      ? (meta.deferred_until as string)
      : null;
    if (!untilStr) continue;
    const until = new Date(untilStr);
    if (Number.isNaN(until.getTime())) continue;
    map.set(key, {
      deferredUntil: until,
      note: String(r.note ?? ""),
      stampedAt: String(r.stamped_at),
    });
  }
  return map;
}

/**
 * Fetch incident / escalation / renewal rows that are currently
 * live-deferred (latest note is a defer with future deferred_until) and
 * surface them in the Awaiting / Deferred tab.
 */
async function fetchDeferredNonDayCentreIssues(
  deferState: Map<string, LiveDefer>,
): Promise<UnifiedIssue[]> {
  const now = Date.now();
  const targets: Array<{ source: UnifiedIssueSource; id: string; until: Date }> = [];
  for (const [key, d] of deferState.entries()) {
    if (d.deferredUntil.getTime() <= now) continue;
    const [src, id] = key.split(":", 2);
    // site_issues_register-backed sources are handled via the status column — skip
    if (src === "day_centre" || src === "event") continue;
    targets.push({ source: src as UnifiedIssueSource, id, until: d.deferredUntil });
  }
  if (targets.length === 0) return [];

  const incidentIds = targets.filter((t) => t.source === "incident").map((t) => t.id);
  const escalationIds = targets.filter((t) => t.source === "escalation").map((t) => t.id);
  const renewalIds = targets.filter((t) => t.source === "renewal").map((t) => t.id);

  const [incRes, escRes, renRes] = await Promise.all([
    incidentIds.length
      ? supabase.from("operational_incidents").select("*").in("id", incidentIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    escalationIds.length
      ? supabase.from("operational_escalations").select("*").in("id", escalationIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    renewalIds.length
      ? listComplianceAssets({ status: "active" })
          .then((assets) => ({ data: assets.filter((a) => renewalIds.includes(a.id)), error: null }))
          .catch(() => ({ data: [] as ComplianceAsset[], error: null }))
      : Promise.resolve({ data: [] as ComplianceAsset[], error: null }),
  ]);

  const fmt = (d: Date) => formatStamp(d);
  const out: UnifiedIssue[] = [];

  for (const r of (incRes.data ?? []) as Array<Record<string, unknown>>) {
    const sev = incidentSevToUnified(r.severity as string | null);
    const meta = deferState.get(`incident:${r.id}`)!;
    out.push({
      key: `incident:${r.id as string}`,
      source: "incident",
      sourceLabel: `${SOURCE_LABELS.incident} · Deferred`,
      category: String(r.incident_type ?? "incident").replace("_", " "),
      subCategory: `Deferred until ${fmt(meta.deferredUntil)}`,
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

  for (const r of (escRes.data ?? []) as Array<Record<string, unknown>>) {
    const meta = deferState.get(`escalation:${r.id}`)!;
    out.push({
      key: `escalation:${r.id as string}`,
      source: "escalation",
      sourceLabel: `${SOURCE_LABELS.escalation} · Deferred`,
      category: String(r.gate_id ?? "gate"),
      subCategory: `Deferred until ${fmt(meta.deferredUntil)}`,
      severity: "red",
      title: `${r.driver_name ?? "Driver"} · ${r.vehicle_info ?? ""}`.trim(),
      description: `Gate ${r.gate_id ?? "?"} — ${r.driver_name ?? "driver"}. Status: ${r.status ?? "pending"}.`,
      status: String(r.status ?? "pending"),
      createdAt: String(r.created_at ?? new Date().toISOString()),
      sourceRowId: String(r.id),
      raw: r,
    });
  }

  for (const a of renRes.data as ComplianceAsset[]) {
    const meta = deferState.get(`renewal:${a.id}`)!;
    out.push({
      key: `renewal:${a.id}`,
      source: "renewal",
      sourceLabel: `${SOURCE_LABELS.renewal} · Deferred`,
      category: a.category,
      subCategory: `Deferred until ${fmt(meta.deferredUntil)}`,
      severity: computeRyge(a),
      title: a.name,
      description: (a.description ?? "") + (a.expiry_date ? ` (expires ${a.expiry_date})` : ""),
      status: a.status,
      createdAt: a.updated_at,
      sourceRowId: a.id,
      raw: a,
    });
  }

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

  // Central timeline: always log the resolution note (every source incl. renewals).
  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: `[RESOLVED] ${note}`,
    kind: "resolve",
  });

  if (issue.source === "renewal") {
    // Renewals don't have a destructive flip here — the Compliance Asset
    // editor owns the lifecycle. The timeline note + ledger receipt below
    // are the audit artefacts.
  }


  const nowIso = new Date().toISOString();
  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();

  // 1) Ledger receipt FIRST so the NDIS audit trail exists even if the
  //    source flip races or fails.
  await writeToLedger({
    staff_id: staffId,
    category: (issue.source === "day_centre" || issue.source === "event") ? "CENTRE" : "VEHICLE",
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
  if (issue.source === "day_centre" || issue.source === "event") {
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
 * Manager-only force-acknowledge for stranded "awaiting operator ack"
 * escalations. Writes operator_acknowledged_at/by directly and appends
 * a FORCE-ACK note to the central Hub timeline so the Compliance Shield
 * ledger records who dismissed it and why. Does NOT touch the normal
 * driver-PIN handshake on live pre-trip escalations.
 */
export async function forceAckEscalation(
  issue: UnifiedIssue,
  args: { reason: string },
): Promise<void> {
  if (issue.source !== "escalation") {
    throw new Error("Force-ack only applies to escalation rows.");
  }
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new Error("Force-ack reason must be at least 10 characters.");
  }
  const nowIso = new Date().toISOString();
  const staffId = await resolveStaffIdWithFallback();

  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: `[FORCE-ACK]: ${reason}`,
    kind: "append",
  });

  const { error } = await supabase
    .from("operational_escalations")
    .update({
      operator_acknowledged_at: nowIso,
      operator_acknowledged_by: staffId,
    })
    .eq("id", issue.sourceRowId);
  if (error) throw error;
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
  //    Display the defer target in LOCAL dd-mm-yy/hh:mm so it matches the
  //    timeline stamp format and avoids surprising the operator with UTC.
  const deferStampLocal = formatStamp(new Date(args.untilIso));
  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: `[DEFERRED until ${deferStampLocal}] ${note}`,
    kind: "defer",
    metadata: { deferred_until: args.untilIso },
  });

  // 2) For site_issues_register rows (day_centre + event), also flip the row.
  //    Other source tables don't carry a 'deferred' status — timeline note is
  //    the audit trail.
  if (issue.source === "day_centre" || issue.source === "event") {
    const { error: writeErr } = await supabase
      .from("site_issues_register")
      .update({
        status: "deferred",
        deferred_until: args.untilIso,
      })
      .eq("id", issue.sourceRowId);
    if (writeErr) throw writeErr;
  } else if (issue.source === "renewal") {
    const { error: renErr } = await supabase
      .from("compliance_assets")
      .update({ next_action_at: args.untilIso })
      .eq("id", issue.sourceRowId);
    if (renErr) throw renErr;
  }

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: (issue.source === "day_centre" || issue.source === "event") ? "CENTRE" : "VEHICLE",
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

  if (issue.source === "day_centre" || issue.source === "event") {
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
    category: (issue.source === "day_centre" || issue.source === "event") ? "CENTRE" : "VEHICLE",
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


import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, tryGetGps, type LedgerSeverity } from "@/lib/api/ledger";
import {
  computeRyge,
  listComplianceAssets,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import {
  resolveStaffIdWithFallback,
  resolveStaffDisplayName,
  primeStaffDisplayNames,
} from "@/lib/data-store";
import { formatDate } from "@/lib/utils";
import { publicFormHubDisplay } from "@/lib/governance/public-form-hub";

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
  /** When it happened (operator). Same as createdAt when not captured. */
  occurredAt: string;
  sourceRowId: string;
  eventId?: string | null;
  raw: unknown;
  /** ISO timestamp of the most recent hub_issue_note for this issue; null if none. */
  lastActivityAt: string | null;
  /** ISO timestamp of the current active defer deadline; null = not deferred. */
  deferredUntil: string | null;
}

const SOURCE_LABELS: Record<UnifiedIssueSource, string> = {
  day_centre: "Day Centre",
  event: "Trip Day",
  incident: "Incident",
  escalation: "Escalation",
  renewal: "Renewal",
};

/**
 * Trip Day when event FKs set, or legacy trip-roll description (§12.6).
 *
 * Do NOT treat bare `[AUTOMATED_RED]` as a trip issue — Day Centre attendance /
 * departure sweeps use that prefix with `session_id` only (no event FKs).
 */
function isTripDaySiteIssue(r: Record<string, unknown>): boolean {
  if (r.event_id || r.event_day_session_id) return true;
  // Explicit Day Centre session row → never trip.
  if (r.session_id && !r.event_id && !r.event_day_session_id) return false;
  const desc = String(r.issue_description ?? "");
  return /\[(?:CURFEW|EVENING ROLL|MORNING ROLL|TRIP ABSENT)\]/i.test(desc)
    || /\[AUTOMATED_RED\].*(?:MORNING ROLL|EVENING ROLL|CURFEW)/i.test(desc);
}

async function fetchEventTitlesById(
  eventIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(eventIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase
    .from("event_manifest")
    .select("id, title")
    .in("id", unique);
  if (error) {
    console.warn("[unified-issues] event title lookup failed", error);
    return map;
  }
  for (const row of data ?? []) {
    const id = String((row as { id: string }).id);
    const title = String((row as { title?: string }).title ?? "").trim();
    if (id && title) map.set(id, title);
  }
  return map;
}

function tripDaySourceLabel(eventTitle: string | null | undefined): string {
  const t = (eventTitle ?? "").trim();
  return t ? `Trip Day · ${t}` : SOURCE_LABELS.event;
}

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

function occurredAtFromRow(
  row: Record<string, unknown>,
  createdAt: string,
): string {
  const v = row.occurred_at;
  if (typeof v === "string" && v.trim()) return v;
  return createdAt;
}

function incidentListDisplay(
  description: string,
  opts?: { deferred?: boolean },
): { title: string; sourceLabel: string } {
  return (
    publicFormHubDisplay(description, opts) ?? {
      title: (description || "Operational incident").slice(0, 120),
      sourceLabel: opts?.deferred
        ? `${SOURCE_LABELS.incident} · Deferred`
        : SOURCE_LABELS.incident,
    }
  );
}

export type UnifiedIssueTab = "active" | "deferred" | "resolved";

/**
 * Fetch operational issues for the Governance Hub Human Incidents tab.
 *
 * tab = "active"   → open / pending rows (deferrals hidden until rewarn window).
 * tab = "deferred" → site_issues_register deferred + council awaiting, plus
 *                    cross-source hub_note deferrals.
 * tab = "resolved" → resolved site issues, incidents, and fully acked escalations.
 *
 * deferRewarnMs (default 3_600_000 = 1 hour) — how many milliseconds before a
 *   deferral deadline that the issue resurfaces on the Active tab. Human issues
 *   default to 1 hour; pass the value from useIssueDeferRewarnMs().
 */
export async function listOpenUnifiedIssues(
  options: { tab?: UnifiedIssueTab; deferRewarnMs?: number; /** @deprecated use deferRewarnMs */ deferRewarnDays?: number } = {},
): Promise<UnifiedIssue[]> {
  const tab: UnifiedIssueTab = options.tab ?? "active";
  // Prefer ms; fall back to legacy days param if caller hasn't migrated yet.
  const deferRewarnMs =
    (options.deferRewarnMs ?? ((options.deferRewarnDays ?? 0) * 86_400_000)) || 3_600_000;

  // Resolve reported_by UUIDs (staff id or auth user id) before cards render.
  await primeStaffDisplayNames();

  // Combined note-state: latest defer + latest activity per issue.
  const { deferState, activityAt } = await fetchNoteStateMaps();

  if (tab === "deferred") {
    const { data, error } = await supabase
      .from("site_issues_register")
      .select("*")
      .in("status", ["deferred", "awaiting_external"])
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[unified-issues] deferred tab fetch failed", error);
    }
    const out: UnifiedIssue[] = [];
    const deferredRows = (data ?? []) as Array<Record<string, unknown>>;
    const deferredTitles = await fetchEventTitlesById(
      deferredRows
        .map((r) => r.event_id as string | null)
        .filter((id): id is string => !!id),
    );
    for (const r of deferredRows) {
      const sev = (r.severity as UnifiedSeverity) ?? null;
      const status = String(r.status ?? "open");
      const isEventRow = isTripDaySiteIssue(r);
      const source: UnifiedIssueSource = isEventRow ? "event" : "day_centre";
      const eventId = (r.event_id as string | null) ?? null;
      const desc = String(r.issue_description ?? "");
      const isHealthSafety =
        String(r.issue_area ?? "") === "health_safety" ||
        desc.includes("[HEALTH & SAFETY]");
      const baseLabel = isEventRow
        ? tripDaySourceLabel(eventId ? deferredTitles.get(eventId) : null)
        : isHealthSafety
          ? "Health & Safety"
          : "Day Centre";
      const label =
        status === "deferred" ? `${baseLabel} · Deferred` : `${baseLabel} · Council`;
      const key = `${source}:${String(r.id)}`;
      out.push({
        key,
        source,
        sourceLabel: label,
        category: sev ? sev.toUpperCase() : "NOTE",
        subCategory:
          status === "awaiting_external"
            ? (r.council_severity as string | null) ?? "Council"
            : isHealthSafety
              ? "Health & Safety"
              : (r.deferred_until as string | null) ?? "Deferred",
        severity: sev,
        title: (desc || (isEventRow ? "Trip Day venue issue" : "Day Centre anomaly")).slice(0, 120),
        description: desc,
        status,
        createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
        sourceRowId: String(r.id),
        eventId: (r.event_id as string | null) ?? null,
        raw: r,
        lastActivityAt: activityAt.get(key) ?? null,
        deferredUntil: (r.deferred_until as string | null) ?? deferState.get(key)?.deferredUntil.toISOString() ?? null,
      });
    }

    // Cross-source deferrals: surface any non-day_centre issue whose
    // latest timeline note is a still-live defer.
    const extras = await fetchDeferredNonDayCentreIssues(deferState, activityAt);
    out.push(...extras);
    return out;
  }

  if (tab === "resolved") {
    const [siteRes, incRes, escRes] = await Promise.all([
      supabase
        .from("site_issues_register")
        .select("*")
        .eq("status", "resolved")
        .order("resolved_at", { ascending: false })
        .limit(300),
      supabase
        .from("operational_incidents")
        .select("*")
        .eq("status", "resolved")
        .eq("incident_type", "human_operational")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("operational_escalations")
        .select("*")
        .not("operator_acknowledged_at", "is", null)
        .order("resolved_at", { ascending: false })
        .limit(300),
    ]);

    const out: UnifiedIssue[] = [];

    for (const r of (siteRes.data ?? []) as Array<Record<string, unknown>>) {
      const sev = (r.severity as UnifiedSeverity) ?? null;
      const isEventRow = isTripDaySiteIssue(r);
      const source: UnifiedIssueSource = isEventRow ? "event" : "day_centre";
      const key = `${source}:${String(r.id)}`;
      const issueArea = String(r.issue_area ?? "");
      const desc = String(r.issue_description ?? "");
      const plan = String(r.workaround_plan ?? "");
      const isHealthSafety =
        issueArea === "health_safety" ||
        desc.includes("[HEALTH & SAFETY]") ||
        desc.includes("[INFECTIOUS EXCLUSION]") ||
        desc.includes("[DRILL EMERGENCY]") ||
        desc.includes("[LIVE EMERGENCY]") ||
        desc.includes("[SITE DO-NOT-OPEN]") ||
        desc.includes("[SITE LOCKDOWN") ||
        desc.includes("[PROGRAMME SUSPENDED]");
      out.push({
        key,
        source,
        sourceLabel: isEventRow
          ? SOURCE_LABELS[source]
          : isHealthSafety
            ? "Health & Safety"
            : SOURCE_LABELS[source],
        category: sev ? sev.toUpperCase() : "NOTE",
        subCategory: isHealthSafety
          ? "Health & Safety"
          : (r.owner as string | null) ?? null,
        severity: sev,
        title: desc ? desc.slice(0, 120) : "Resolved issue",
        description: plan ? `${desc}\n${plan}` : desc,
        status: "resolved",
        createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
        sourceRowId: String(r.id),
        eventId: (r.event_id as string | null) ?? null,
        raw: r,
        lastActivityAt: activityAt.get(key) ?? null,
        deferredUntil: null,
      });
    }

    if (!incRes.error) {
      for (const r of (incRes.data ?? []) as Array<Record<string, unknown>>) {
        const sev = incidentSevToUnified(r.severity as string | null);
        const key = `incident:${String(r.id)}`;
        const description = String(r.description ?? "");
        const display = incidentListDisplay(description);
        out.push({
          key,
          source: "incident",
          sourceLabel: display.sourceLabel,
          category: String(r.incident_type ?? "incident").replace("_", " "),
          subCategory: (r.event_id as string | null) ?? null,
          severity: sev,
          title: display.title,
          description,
          status: "resolved",
          createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
          sourceRowId: String(r.id),
          eventId: (r.event_id as string | null) ?? null,
          raw: r,
          lastActivityAt: activityAt.get(key) ?? null,
          deferredUntil: null,
        });
      }
    }

    if (!escRes.error) {
      for (const r of (escRes.data ?? []) as Array<Record<string, unknown>>) {
        const key = `escalation:${String(r.id)}`;
        out.push({
          key,
          source: "escalation",
          sourceLabel: SOURCE_LABELS.escalation,
          category: String(r.gate_id ?? "escalation"),
          subCategory: (r.vehicle_info as string | null) ?? null,
          severity: "red",
          title: `Escalation ${String(r.id ?? "").slice(0, 8)}`,
          description: `Gate ${r.gate_id ?? "?"} — ${r.driver_name ?? "driver"} (${r.vehicle_info ?? "vehicle"}).`,
          status: "resolved",
          createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
          sourceRowId: String(r.id),
          raw: r,
          lastActivityAt: activityAt.get(key) ?? null,
          deferredUntil: null,
        });
      }
    }

    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }

  const [siteIssuesRes, incidentsRes, escalationsRes] = await Promise.all([
    // Include deferred rows so rewarn-window items resurface on the Active tab.
    supabase
      .from("site_issues_register")
      .select("*")
      // open + deferred + accepted workarounds (still operating — not Hub-resolved yet)
      .in("status", ["open", "deferred", "workaround_accepted", "awaiting_external"])
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
  const siteRows = (siteIssuesRes.data ?? []) as Array<Record<string, unknown>>;
  const eventTitles = await fetchEventTitlesById(
    siteRows
      .map((r) => r.event_id as string | null)
      .filter((id): id is string => !!id),
  );

  for (const r of siteRows) {
    const sev = (r.severity as UnifiedSeverity) ?? null;
    const isEventRow = isTripDaySiteIssue(r);
    const source: UnifiedIssueSource = isEventRow ? "event" : "day_centre";
    const fallbackTitle = isEventRow ? "Trip Day venue issue" : "Day Centre anomaly";
    const key = `${source}:${String(r.id)}`;
    const eventId = (r.event_id as string | null) ?? null;
    const issueArea = String(r.issue_area ?? "");
    const desc = String(r.issue_description ?? "");
    const isHealthSafety =
      issueArea === "health_safety" ||
      desc.includes("[HEALTH & SAFETY]") ||
      desc.includes("[INFECTIOUS EXCLUSION]") ||
      desc.includes("[DRILL EMERGENCY]") ||
      desc.includes("[LIVE EMERGENCY]") ||
      desc.includes("[SITE DO-NOT-OPEN]") ||
      desc.includes("[SITE LOCKDOWN") ||
      desc.includes("[PROGRAMME SUSPENDED]");
    out.push({
      key,
      source,
      sourceLabel: isEventRow
        ? tripDaySourceLabel(eventId ? eventTitles.get(eventId) : null)
        : isHealthSafety
          ? "Health & Safety"
          : SOURCE_LABELS[source],
      category: sev ? sev.toUpperCase() : "NOTE",
      subCategory: isHealthSafety
        ? "Health & Safety"
        : (r.owner as string | null) ?? null,
      severity: sev,
      title: desc
        ? desc.slice(0, 120)
        : fallbackTitle,
      description: desc,
      status: String(r.status ?? "open"),
      createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
      sourceRowId: String(r.id),
      eventId,
      raw: r,
      lastActivityAt: activityAt.get(key) ?? null,
      deferredUntil: (r.deferred_until as string | null) ?? null,
    });
  }

  if (!incidentsRes.error) {
    for (const r of (incidentsRes.data ?? []) as Array<Record<string, unknown>>) {
      const sev = incidentSevToUnified(r.severity as string | null);
      const key = `incident:${String(r.id)}`;
      const deferEntry = deferState.get(key);
      const description = String(r.description ?? "");
      const display = incidentListDisplay(description);
      out.push({
        key,
        source: "incident",
        sourceLabel: display.sourceLabel,
        category: String(r.incident_type ?? "incident").replace("_", " "),
        subCategory: (r.event_id as string | null) ?? null,
        severity: sev,
        title: display.title,
        description,
        status: String(r.status ?? "pending"),
        createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
        sourceRowId: String(r.id),
        eventId: (r.event_id as string | null) ?? null,
        raw: r,
        lastActivityAt: activityAt.get(key) ?? null,
        deferredUntil: deferEntry?.deferredUntil.toISOString() ?? null,
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
      const key = `escalation:${String(r.id)}`;
      const deferEntry = deferState.get(key);
      out.push({
        key,
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
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
        sourceRowId: String(r.id),
        raw: r,
        lastActivityAt: activityAt.get(key) ?? null,
        deferredUntil: deferEntry?.deferredUntil.toISOString() ?? null,
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
    // day_centre / event: defer is tracked on the row's deferred_until column.
    if (i.source === "day_centre" || i.source === "event") {
      if (i.status !== "deferred") return true; // open — always show
      const deferUntilStr = i.deferredUntil;
      if (!deferUntilStr) return true; // deferred but no date — show
      const deferMs = new Date(deferUntilStr).getTime();
      if (deferMs <= now) return true; // already lapsed — show
      return (deferMs - now) <= deferRewarnMs; // show only if within rewarn
    }

    // All other sources: defer tracked via hub_issue_notes.
    const d = deferState.get(`${i.source}:${i.sourceRowId}`);
    if (!d) return true; // not deferred — always show
    const msUntilDefer = d.deferredUntil.getTime() - now;
    if (msUntilDefer <= 0) return true; // already lapsed — show
    return msUntilDefer <= deferRewarnMs; // show only if within rewarn
  });

  return filtered;
}

// ---------------------------------------------------------------------------
// Cross-source note-state helpers (read latest hub_issue_notes per issue)
// ---------------------------------------------------------------------------

interface LiveDefer {
  deferredUntil: Date;
  note: string;
  stampedAt: string;
}

interface NoteStateMaps {
  /** Latest defer note per `${source}:${sourceRowId}` (kind='defer' as most recent note). */
  deferState: Map<string, LiveDefer>;
  /** Latest stamped_at (any kind) per `${source}:${sourceRowId}`. */
  activityAt: Map<string, string>;
}

/**
 * Single-pass read of hub_issue_notes returning both the defer state AND the
 * latest activity timestamp per issue. One query serves both needs.
 */
async function fetchNoteStateMaps(): Promise<NoteStateMaps> {
  const deferState = new Map<string, LiveDefer>();
  const activityAt = new Map<string, string>();

  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("source, source_row_id, note, kind, stamped_at, metadata")
    .order("stamped_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.warn("[unified-issues] fetchNoteStateMaps failed", error);
    return { deferState, activityAt };
  }

  const seenForDefer = new Set<string>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const key = `${String(r.source)}:${String(r.source_row_id)}`;

    // Latest activity: first occurrence (desc order) wins.
    if (!activityAt.has(key)) {
      activityAt.set(key, String(r.stamped_at));
    }

    // Defer state: only the LATEST note per issue matters. If it is kind='defer'
    // with a valid deferred_until, the issue is "live deferred".
    if (!seenForDefer.has(key)) {
      seenForDefer.add(key);
      if (r.kind !== "defer") continue;
      const meta = (r.metadata as Record<string, unknown> | null) ?? null;
      const untilStr = meta && typeof meta.deferred_until === "string"
        ? (meta.deferred_until as string)
        : null;
      if (!untilStr) continue;
      const until = new Date(untilStr);
      if (Number.isNaN(until.getTime())) continue;
      deferState.set(key, {
        deferredUntil: until,
        note: String(r.note ?? ""),
        stampedAt: String(r.stamped_at),
      });
    }
  }

  return { deferState, activityAt };
}

/**
 * Returns a Map<sourceRowId → latestStampedAt> for a single source.
 * Used by panels (e.g. Compliance Assets) that need last-activity data
 * for urgency badging without running a full note-state scan.
 */
export async function fetchLatestHubActivityMap(
  source: UnifiedIssueSource,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("source_row_id, stamped_at")
    .eq("source", source)
    .order("stamped_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.warn("[unified-issues] fetchLatestHubActivityMap failed", error);
    return map;
  }
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const rowId = String(r.source_row_id);
    if (!map.has(rowId)) {
      map.set(rowId, String(r.stamped_at));
    }
  }
  return map;
}

/**
 * Fetch incident / escalation / renewal rows that are currently
 * live-deferred (latest note is a defer with future deferred_until) and
 * surface them in the Deferred tab.
 */
async function fetchDeferredNonDayCentreIssues(
  deferState: Map<string, LiveDefer>,
  activityAt: Map<string, string>,
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
    const key = `incident:${String(r.id)}`;
    const meta = deferState.get(key)!;
    const description = String(r.description ?? "");
    const display = incidentListDisplay(description, { deferred: true });
    out.push({
      key,
      source: "incident",
      sourceLabel: display.sourceLabel,
      category: String(r.incident_type ?? "incident").replace("_", " "),
      subCategory: `Deferred until ${fmt(meta.deferredUntil)}`,
      severity: sev,
      title: display.title,
      description,
      status: String(r.status ?? "pending"),
      createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
      sourceRowId: String(r.id),
      eventId: (r.event_id as string | null) ?? null,
      raw: r,
      lastActivityAt: activityAt.get(key) ?? null,
      deferredUntil: meta.deferredUntil.toISOString(),
    });
  }

  for (const r of (escRes.data ?? []) as Array<Record<string, unknown>>) {
    const key = `escalation:${String(r.id)}`;
    const meta = deferState.get(key)!;
    out.push({
      key,
      source: "escalation",
      sourceLabel: `${SOURCE_LABELS.escalation} · Deferred`,
      category: String(r.gate_id ?? "gate"),
      subCategory: `Deferred until ${fmt(meta.deferredUntil)}`,
      severity: "red",
      title: `${r.driver_name ?? "Driver"} · ${r.vehicle_info ?? ""}`.trim(),
      description: `Gate ${r.gate_id ?? "?"} — ${r.driver_name ?? "driver"}. Status: ${r.status ?? "pending"}.`,
      status: String(r.status ?? "pending"),
      createdAt: String(r.created_at ?? new Date().toISOString()),
          occurredAt: occurredAtFromRow(r, String(r.created_at ?? new Date().toISOString())),
      sourceRowId: String(r.id),
      raw: r,
      lastActivityAt: activityAt.get(key) ?? null,
      deferredUntil: meta.deferredUntil.toISOString(),
    });
  }

  for (const a of renRes.data as ComplianceAsset[]) {
    const key = `renewal:${a.id}`;
    const meta = deferState.get(key)!;
    out.push({
      key,
      source: "renewal",
      sourceLabel: `${SOURCE_LABELS.renewal} · Deferred`,
      category: a.category,
      subCategory: `Deferred until ${fmt(meta.deferredUntil)}`,
      severity: computeRyge(a),
      title: a.name,
      description: (a.description ?? "") + (a.expiry_date ? ` (expires ${formatDate(a.expiry_date)})` : ""),
      status: a.status,
      createdAt: a.updated_at,
      occurredAt: a.updated_at,
      sourceRowId: a.id,
      raw: a,
      lastActivityAt: activityAt.get(key) ?? null,
      deferredUntil: meta.deferredUntil.toISOString(),
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

    // Clear attendance-roll RED/YELLOW badges so floor UI does not keep
    // saying "Manager notified" after Hub resolve.
    if (issue.source === "day_centre") {
      await supabase
        .from("client_attendance_log")
        .update({
          escalation_severity: null,
          escalation_raised_at: null,
        })
        .eq("escalation_issue_id", issue.sourceRowId);
      await supabase
        .from("client_attendance_log")
        .update({
          departure_severity: null,
          departure_raised_at: null,
        })
        .eq("departure_issue_id", issue.sourceRowId);
    }
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

const STAMP_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;

/** Browser-local stamp in dd-Mmm-yy / HH:mm (GUARDRAILS §5.3). */
function formatStamp(d: Date): string {
  const dd = pad2(d.getDate());
  const mmm = STAMP_MONTHS[d.getMonth()];
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${dd}-${mmm}-${yy} / ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
 * Office acknowledges review has begun — stamps the Hub timeline so wait
 * time from logged → review started is auditable (BL-060).
 */
export async function startUnifiedIssueReview(issue: UnifiedIssue): Promise<void> {
  const staffId = await resolveStaffIdWithFallback().catch(() => null);
  const author = resolveStaffDisplayName(staffId);
  await insertHubNote({
    source: issue.source,
    sourceRowId: issue.sourceRowId,
    note: `Review started by ${author}.`,
    kind: "append",
    metadata: { review_started: true, started_by: staffId },
  });
}

/** Keys `${source}:${sourceRowId}` with an office review-started stamp. */
export async function fetchHubReviewStartedKeySet(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("source, source_row_id, note, metadata")
    .order("stamped_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.warn("[unified-issues] fetchHubReviewStartedKeySet failed", error);
    return new Set();
  }
  const keys = new Set<string>();
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    const meta = row.metadata as Record<string, unknown> | null;
    const note = String(row.note ?? "");
    if (
      meta?.review_started === true ||
      /^Review started/i.test(note) ||
      note === "Work started."
    ) {
      keys.add(`${row.source}:${row.source_row_id}`);
    }
  }
  return keys;
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


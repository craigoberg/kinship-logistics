import { MIN_EVIDENCE } from "@/lib/governance/constants";
import { supabase } from "@/integrations/supabase/client";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { resolveStaffIdWithFallback, verifyStaffPin } from "@/lib/data-store";
import { tryGetGps, writeToLedger } from "@/lib/api/ledger";

// ---------------------------------------------------------------------------
// Compliance Governance Engine — registry of every "thing that expires".
// SQL: docs/sql/2026-07-06_compliance_governance.sql
// ---------------------------------------------------------------------------

export type ComplianceActionModule =
  | "vehicle_rego"
  | "vehicle_service"
  | "staff_cert"
  | "formal_audit"
  | "insurance_renewal"
  | "generic_resolve";

export type ComplianceStatus = "active" | "archived";

export interface ComplianceAssetConfig {
  /** Days before expiry that the asset turns YELLOW on the dashboard. */
  yellow_days?: number;
  /** Days before expiry that the asset turns RED on the dashboard. */
  red_days?: number;
  /** Optional checklist category key for formal-audit resolutions. */
  checklist_category?: string | null;
  /** PIN handshake required to resolve: single manager vs dual (manager + witness). */
  handshake?: "single" | "dual";
  [k: string]: unknown;
}

export interface ComplianceAsset {
  id: string;
  category: string;
  type: string;
  name: string;
  description: string | null;
  subject_table: string | null;
  subject_id: string | null;
  expiry_date: string | null;
  next_action_at: string | null;
  action_module: ComplianceActionModule;
  config: ComplianceAssetConfig;
  status: ComplianceStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListComplianceAssetsArgs {
  category?: string;
  status?: ComplianceStatus;
  subjectTable?: string;
  subjectId?: string;
}

export async function listComplianceAssets(
  args: ListComplianceAssetsArgs = {},
): Promise<ComplianceAsset[]> {
  let q = supabase
    .from("compliance_assets")
    .select(
      "id, category, type, name, description, subject_table, subject_id, expiry_date, next_action_at, action_module, config, status, created_by, created_at, updated_at",
    )
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("next_action_at", { ascending: true, nullsFirst: false });
  if (args.category) q = q.eq("category", args.category);
  if (args.status) q = q.eq("status", args.status);
  if (args.subjectTable) q = q.eq("subject_table", args.subjectTable);
  if (args.subjectId) q = q.eq("subject_id", args.subjectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ComplianceAsset[];
}

/**
 * Convenience wrapper: list all compliance assets linked to a specific venue.
 * Returns both active and archived rows ordered by expiry (soonest first).
 */
export async function listVenueComplianceAssets(venueId: string): Promise<ComplianceAsset[]> {
  return listComplianceAssets({ subjectTable: "venues", subjectId: venueId });
}

export interface UpsertComplianceAssetInput {
  id?: string | null;
  category: string;
  type: string;
  name: string;
  description?: string | null;
  subject_table?: string | null;
  subject_id?: string | null;
  expiry_date?: string | null;
  next_action_at?: string | null;
  action_module: ComplianceActionModule;
  config: ComplianceAssetConfig;
  status?: ComplianceStatus;
}

export async function upsertComplianceAsset(
  input: UpsertComplianceAssetInput,
  justification: string,
): Promise<ComplianceAsset> {
  const trimmed = justification.trim();
  if (trimmed.length < 20) {
    throw new Error("Justification must be at least 20 characters.");
  }
  const allowed = await canManageSystemParameters();
  if (!allowed) {
    throw new Error("Only Managers can edit compliance assets.");
  }

  const actor = await resolveStaffIdWithFallback();
  const payload = {
    category: input.category.trim(),
    type: input.type.trim(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    subject_table: input.subject_table || null,
    subject_id: input.subject_id || null,
    expiry_date: input.expiry_date || null,
    next_action_at: input.next_action_at || null,
    action_module: input.action_module,
    config: { ...input.config, last_justification: trimmed },
    status: input.status ?? "active",
    created_by: actor,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("compliance_assets")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as ComplianceAsset;
  }

  const { data, error } = await supabase
    .from("compliance_assets")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as ComplianceAsset;
}

export async function archiveComplianceAsset(
  id: string,
  justification: string,
): Promise<void> {
  const trimmed = justification.trim();
  if (trimmed.length < 10) {
    throw new Error("Justification must be at least 10 characters.");
  }
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can archive compliance assets.");

  const { error } = await supabase
    .from("compliance_assets")
    .update({
      status: "archived",
      next_action_at: null,
      config: { archive_justification: trimmed },
    })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Hub timeline (source = renewal) — defer, notes, close — mirrors Open Issues.
// ---------------------------------------------------------------------------

export const COMPLIANCE_HUB_SOURCE = "renewal" as const;

export type ComplianceHubNoteKind = "append" | "defer" | "resolve";

export interface ComplianceHubNote {
  id: string;
  note: string;
  kind: ComplianceHubNoteKind;
  stampedAt: string;
  staffId: string | null;
  metadata: Record<string, unknown> | null;
}

function formatHubStamp(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)}/${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderComplianceNoteLine(n: ComplianceHubNote): string {
  return `[${formatHubStamp(new Date(n.stampedAt))}]: ${n.note}`;
}

async function insertComplianceHubNote(args: {
  assetId: string;
  note: string;
  kind: ComplianceHubNoteKind;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const staffId = await resolveStaffIdWithFallback().catch(() => null);
  const { error } = await supabase.from("hub_issue_notes").insert({
    source: COMPLIANCE_HUB_SOURCE,
    source_row_id: args.assetId,
    note: args.note.trim(),
    kind: args.kind,
    staff_id: staffId,
    metadata: args.metadata ?? null,
  });
  if (error) throw error;
}

export async function listComplianceAssetNotes(
  assetId: string,
): Promise<ComplianceHubNote[]> {
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("*")
    .eq("source", COMPLIANCE_HUB_SOURCE)
    .eq("source_row_id", assetId)
    .order("stamped_at", { ascending: true });
  if (error) {
    console.warn("[listComplianceAssetNotes] failed", error);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    note: String(r.note ?? ""),
    kind: (r.kind as ComplianceHubNoteKind) ?? "append",
    stampedAt: String(r.stamped_at),
    staffId: (r.staff_id as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}

export interface LiveComplianceDefer {
  deferredUntil: Date;
  note: string;
}

/**
 * Latest defer per asset id (renewal hub notes). Live when kind=defer and
 * deferred_until is still in the future.
 */
export async function fetchComplianceDeferMap(): Promise<
  Map<string, LiveComplianceDefer>
> {
  const map = new Map<string, LiveComplianceDefer>();
  const { data, error } = await supabase
    .from("hub_issue_notes")
    .select("source_row_id, note, kind, stamped_at, metadata")
    .eq("source", COMPLIANCE_HUB_SOURCE)
    .order("stamped_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.warn("[fetchComplianceDeferMap] failed", error);
    return map;
  }
  const seen = new Set<string>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(r.source_row_id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (r.kind !== "defer") continue;
    const meta = (r.metadata as Record<string, unknown> | null) ?? null;
    const untilStr =
      meta && typeof meta.deferred_until === "string" ? meta.deferred_until : null;
    if (!untilStr) continue;
    const until = new Date(untilStr);
    if (Number.isNaN(until.getTime())) continue;
    map.set(id, {
      deferredUntil: until,
      note: String(r.note ?? ""),
    });
  }
  return map;
}

export function isComplianceAssetLiveDeferred(
  assetId: string,
  deferMap: Map<string, LiveComplianceDefer>,
): boolean {
  const d = deferMap.get(assetId);
  return !!(d && d.deferredUntil.getTime() > Date.now());
}

/** Append a `[RESOLVED]` line after domain completion from the Manage shell. */
export async function appendComplianceAssetResolveNote(
  assetId: string,
  args: {
    note: string;
    resolutionSummary: string;
    evidenceRef?: string;
    metadata?: Record<string, unknown>;
    /** When the domain API already wrote a ledger row (e.g. resolveComplianceAsset). */
    skipLedger?: boolean;
  },
): Promise<void> {
  const trimmed = args.note.trim();
  if (trimmed.length < 10) {
    throw new Error("Resolution note must be at least 10 characters.");
  }
  const evidenceSuffix = args.evidenceRef
    ? ` · evidence: ${args.evidenceRef.trim()}`
    : "";
  await insertComplianceHubNote({
    assetId,
    note: `[RESOLVED · ${args.resolutionSummary}] ${trimmed}${evidenceSuffix}`,
    kind: "resolve",
    metadata: {
      resolution_summary: args.resolutionSummary,
      evidence_ref: args.evidenceRef ?? null,
      ...args.metadata,
    },
  });

  if (args.skipLedger) return;

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "GREEN",
    action_type: "governance.issue_resolved",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      source: COMPLIANCE_HUB_SOURCE,
      source_row_id: assetId,
      resolution_note: trimmed,
      resolution_summary: args.resolutionSummary,
      evidence_ref: args.evidenceRef ?? null,
    },
  });
}

export async function saveComplianceAssetRenewal(
  assetId: string,
  args: { note: string; newExpiry: string; evidenceRef: string },
): Promise<void> {
  const trimmed = args.note.trim();
  if (trimmed.length < 10) {
    throw new Error("Update note must be at least 10 characters.");
  }
  if (!args.newExpiry || Number.isNaN(Date.parse(args.newExpiry))) {
    throw new Error("A valid next expiry date is required.");
  }
  const evidence = args.evidenceRef.trim();
  if (evidence.length < MIN_EVIDENCE) {
    throw new Error(`Evidence reference must be at least ${MIN_EVIDENCE} characters.`);
  }

  const { data: current, error: readErr } = await supabase
    .from("compliance_assets")
    .select("expiry_date")
    .eq("id", assetId)
    .maybeSingle();
  if (readErr) throw readErr;

  const previousExpiry = (current as { expiry_date: string | null } | null)?.expiry_date;

  const { error: updErr } = await supabase
    .from("compliance_assets")
    .update({ expiry_date: args.newExpiry, next_action_at: null })
    .eq("id", assetId);
  if (updErr) throw updErr;

  await appendComplianceAssetResolveNote(assetId, {
    note: trimmed,
    resolutionSummary: `renewed · expiry ${args.newExpiry}`,
    evidenceRef: evidence,
    metadata: {
      previous_expiry: previousExpiry,
      new_expiry: args.newExpiry,
      payload_kind: "manage_renewal",
      archived: true,
    },
    skipLedger: false,
  });

  await archiveComplianceAsset(assetId, trimmed);
}

export async function appendComplianceAssetNote(
  assetId: string,
  note: string,
  args?: { evidenceRef?: string },
): Promise<void> {
  const trimmed = note.trim();
  if (trimmed.length < 10) {
    throw new Error("Update note must be at least 10 characters.");
  }
  const evidence = args?.evidenceRef?.trim();
  const evidenceSuffix = evidence ? ` · evidence: ${evidence}` : "";
  await insertComplianceHubNote({
    assetId,
    note: `${trimmed}${evidenceSuffix}`,
    kind: "append",
    metadata: evidence ? { evidence_ref: evidence } : undefined,
  });
}

export async function deferComplianceAsset(
  assetId: string,
  args: { untilIso: string; note: string },
): Promise<void> {
  const note = args.note.trim();
  if (note.length < 10) {
    throw new Error("Defer note must be at least 10 characters.");
  }
  if (!args.untilIso || Number.isNaN(Date.parse(args.untilIso))) {
    throw new Error("A valid next-action date is required.");
  }

  const deferStampLocal = formatHubStamp(new Date(args.untilIso));
  await insertComplianceHubNote({
    assetId,
    note: `[DEFERRED until ${deferStampLocal}] ${note}`,
    kind: "defer",
    metadata: { deferred_until: args.untilIso },
  });

  const { error } = await supabase
    .from("compliance_assets")
    .update({ next_action_at: args.untilIso })
    .eq("id", assetId);
  if (error) throw error;

  const staffId = await resolveStaffIdWithFallback();
  const gps = await tryGetGps();
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "YELLOW",
    action_type: "governance.issue_deferred",
    gps_lat: gps?.lat ?? null,
    gps_lng: gps?.lng ?? null,
    metadata: {
      source: COMPLIANCE_HUB_SOURCE,
      source_row_id: assetId,
      deferred_until: args.untilIso,
      note,
    },
  });
}

export type ComplianceAssetTab = "active" | "awaiting";

// ---------------------------------------------------------------------------
// RYGE — Red/Yellow/Green derivation from expiry_date + config thresholds.
// ---------------------------------------------------------------------------

export type Ryge = "green" | "yellow" | "red";

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export const SHORT_CYCLE_TYPES = new Set([
  "facility_drill",
  "operational_check",
  "monthly_review",
  "two_man_bus_walkaround",
]);

export interface ComplianceThresholds {
  yellowDays: number;
  redDays: number;
}

export function thresholdsForAsset(
  assetType: string | undefined | null,
  params: { default: number; shortCycle: number },
): ComplianceThresholds {
  const isShort = !!assetType && SHORT_CYCLE_TYPES.has(assetType.toLowerCase());
  const yellow = isShort ? params.shortCycle : params.default;
  // Red defaults to ~1/4 of yellow (min 1) so RED is always less than YELLOW.
  const red = Math.max(1, Math.floor(yellow / 4));
  return { yellowDays: yellow, redDays: red };
}

export function computeRyge(
  asset: ComplianceAsset,
  paramsOrToday?: { default: number; shortCycle: number } | Date,
  maybeToday?: Date,
): Ryge {
  // Backwards-compat: old signature was computeRyge(asset, today?).
  const params =
    paramsOrToday && !(paramsOrToday instanceof Date)
      ? paramsOrToday
      : { default: 30, shortCycle: 7 };
  const today =
    paramsOrToday instanceof Date ? paramsOrToday : (maybeToday ?? new Date());

  if (!asset.expiry_date) return "green";
  const expiry = parseISODate(asset.expiry_date);
  if (!expiry) return "green";
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((expiry.getTime() - startOfToday.getTime()) / 86_400_000);

  const t = thresholdsForAsset(asset.type, params);
  // Per-asset config overrides still win when explicitly set.
  const red = asset.config.red_days ?? t.redDays;
  const yellow = asset.config.yellow_days ?? t.yellowDays;
  if (days <= red) return "red";
  if (days <= yellow) return "yellow";
  return "green";
}

export const ACTION_MODULES: { value: ComplianceActionModule; label: string }[] = [
  { value: "vehicle_rego", label: "Vehicle — Registration" },
  { value: "vehicle_service", label: "Vehicle — Service" },
  { value: "staff_cert", label: "Staff Certification" },
  { value: "formal_audit", label: "Formal Audit (dual-PIN + checklist)" },
  { value: "insurance_renewal", label: "Insurance Renewal" },
  { value: "generic_resolve", label: "Generic Resolve (date + justification)" },
];

// ---------------------------------------------------------------------------
// Generic resolve — updates expiry_date on a compliance asset and appends a
// COMPLIANCE_ASSET_RESOLVED row to operational_ledger. Used by
// ResolveComplianceAssetModal for insurance_renewal / generic_resolve.
// ---------------------------------------------------------------------------

export interface ResolveComplianceAssetInput {
  assetId: string;
  newExpiry: string;
  actionDate: string;
  evidenceRef: string;
  justification: string;
  managerStaffId: string;
  managerPin: string;
  witnessStaffId?: string | null;
  witnessPin?: string | null;
}

export async function resolveComplianceAsset(
  input: ResolveComplianceAssetInput,
): Promise<{ assetId: string; ledgerId: string | null }> {
  if (input.justification.trim().length < 20) {
    throw new Error("Justification must be at least 20 characters.");
  }
  if (input.evidenceRef.trim().length < 6) {
    throw new Error("Evidence reference must be at least 6 characters.");
  }

  const { data: current, error: readErr } = await supabase
    .from("compliance_assets")
    .select("*")
    .eq("id", input.assetId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw new Error("Compliance asset not found.");
  const asset = current as ComplianceAsset;

  if (!input.managerStaffId || !input.managerPin) {
    throw new Error("Manager PIN is required.");
  }
  const handshake = asset.config?.handshake === "dual" ? "dual" : "single";
  if (handshake === "dual") {
    if (!input.witnessStaffId || !input.witnessPin) {
      throw new Error("Witness PIN is required for dual handshake.");
    }
    if (input.witnessStaffId === input.managerStaffId) {
      throw new Error("Manager and Witness must be different staff members.");
    }
  }
  const checks: Promise<boolean>[] = [verifyStaffPin(input.managerStaffId, input.managerPin)];
  if (handshake === "dual") {
    checks.push(verifyStaffPin(input.witnessStaffId!, input.witnessPin!));
  }
  const results = await Promise.all(checks);
  if (!results[0]) throw new Error("Invalid Manager PIN.");
  if (handshake === "dual" && !results[1]) throw new Error("Invalid Witness PIN.");

  const { error: updErr } = await supabase
    .from("compliance_assets")
    .update({ expiry_date: input.newExpiry, next_action_at: null })
    .eq("id", input.assetId);
  if (updErr) throw updErr;

  const gps = await tryGetGps();
  const actor = await resolveStaffIdWithFallback();
  const { data: ledger, error: ledgerErr } = await supabase
    .from("operational_ledger")
    .insert({
      staff_id: actor,
      category: "CENTRE",
      severity: "GREEN",
      action_type: "COMPLIANCE_ASSET_RESOLVED",
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata: {
        compliance_asset_id: asset.id,
        asset_name: asset.name,
        category: asset.category,
        type: asset.type,
        action_module: asset.action_module,
        previous_expiry: asset.expiry_date,
        new_expiry: input.newExpiry,
        action_date: input.actionDate,
        evidence_ref: input.evidenceRef,
        justification: input.justification,
        handshake,
        manager_staff_id: input.managerStaffId,
        witness_staff_id: handshake === "dual" ? input.witnessStaffId : null,
        gps_captured: !!gps,
        source: "resolve_compliance_asset_modal",
      },
    })
    .select("id")
    .single();
  if (ledgerErr) throw ledgerErr;

  return { assetId: asset.id, ledgerId: (ledger?.id as string) ?? null };
}

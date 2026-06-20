import { supabase } from "@/integrations/supabase/client";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { resolveStaffIdWithFallback, verifyStaffPin } from "@/lib/data-store";
import { tryGetGps } from "@/lib/api/ledger";

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
}

export async function listComplianceAssets(
  args: ListComplianceAssetsArgs = {},
): Promise<ComplianceAsset[]> {
  let q = supabase
    .from("compliance_assets")
    .select(
      "id, category, type, name, description, subject_table, subject_id, expiry_date, next_action_at, action_module, config, status, created_by, created_at, updated_at",
    )
    .order("next_action_at", { ascending: true, nullsFirst: false });
  if (args.category) q = q.eq("category", args.category);
  if (args.status) q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ComplianceAsset[];
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
  if (trimmed.length < 10) {
    throw new Error("Justification must be at least 10 characters.");
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
    .update({ status: "archived", config: { archive_justification: trimmed } })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// RYGE — Red/Yellow/Green derivation from expiry_date + config thresholds.
// ---------------------------------------------------------------------------

export type Ryge = "green" | "yellow" | "red";

function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function computeRyge(asset: ComplianceAsset, today: Date = new Date()): Ryge {
  if (!asset.expiry_date) return "green";
  const expiry = parseISODate(asset.expiry_date);
  if (!expiry) return "green";
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((expiry.getTime() - startOfToday.getTime()) / 86_400_000);
  const red = asset.config.red_days ?? 7;
  const yellow = asset.config.yellow_days ?? 30;
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

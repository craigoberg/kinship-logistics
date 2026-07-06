/**
 * Venue registry API — GUARDRAILS §12.2
 *
 * Surfaces:
 *   - venues CRUD (manager-only writes)
 *   - venue_template_fields management (add / reorder / remove)
 *   - baseline sign-off (PIN + evidence + ledger receipt §1.1)
 *   - clone (field structure only — never copies answers §12.2.2)
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback, verifyStaffPin } from "@/lib/data-store";
import { writeToLedgerOrThrow, writeToLedger } from "@/lib/api/ledger";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { MIN_EVIDENCE } from "@/lib/governance/constants";

// ============================================================================
// Types
// ============================================================================

export type VenueStatus = "active" | "archived";
export type RiskTier = "low" | "medium" | "high";
export type AnswerType = "yes_no" | "text" | "number" | "select";

export interface Venue {
  id: string;
  name: string;
  venue_type: string;
  status: VenueStatus;
  street_address: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  access_notes: string | null;
  site_contact_name: string | null;
  site_contact_phone: string | null;
  max_safe_group_size: number | null;
  risk_tier: RiskTier;
  cloned_from_venue_id: string | null;
  created_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VenueTemplateField {
  id: string;
  venue_id: string;
  prompt: string;
  answer_type: AnswerType;
  options_json: string[] | null;
  is_mandatory: boolean;
  is_system_core: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VenueSafetyBaselineSignoff {
  id: string;
  venue_id: string;
  signed_off_by_staff_id: string | null;
  signed_off_at: string;
  evidence_ref: string;
  notes: string | null;
  created_at: string;
  answers?: VenueSafetyAnswer[];
}

export interface VenueSafetyAnswer {
  id: string;
  signoff_id: string;
  field_id: string;
  answer_text: string | null;
  answer_json: unknown | null;
  created_at: string;
}

// ============================================================================
// Venue CRUD
// ============================================================================

export async function listVenues(status?: VenueStatus): Promise<Venue[]> {
  let q = supabase
    .from("venues")
    .select("*")
    .order("name", { ascending: true });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Venue[];
}

export async function getVenue(id: string): Promise<Venue> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Venue;
}

export interface UpsertVenueInput {
  id?: string | null;
  name: string;
  venue_type: string;
  street_address?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  access_notes?: string | null;
  site_contact_name?: string | null;
  site_contact_phone?: string | null;
  max_safe_group_size?: number | null;
  risk_tier?: RiskTier;
  status?: VenueStatus;
}

export async function upsertVenue(input: UpsertVenueInput): Promise<Venue> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can create or edit venues.");

  const actor = await resolveStaffIdWithFallback();
  const payload = {
    name: input.name.trim(),
    venue_type: input.venue_type.trim() || "general",
    street_address: input.street_address?.trim() || null,
    gps_lat: input.gps_lat ?? null,
    gps_lng: input.gps_lng ?? null,
    access_notes: input.access_notes?.trim() || null,
    site_contact_name: input.site_contact_name?.trim() || null,
    site_contact_phone: input.site_contact_phone?.trim() || null,
    max_safe_group_size: input.max_safe_group_size ?? null,
    risk_tier: input.risk_tier ?? "medium",
    status: input.status ?? "active",
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("venues")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    await writeToLedger({
      staff_id: actor,
      category: "CENTRE",
      severity: "INFO",
      action_type: "VENUE_UPDATED",
      gps_lat: null,
      gps_lng: null,
      metadata: { venue_id: (data as Venue).id, name: (data as Venue).name },
    });
    return data as Venue;
  }

  const { data, error } = await supabase
    .from("venues")
    .insert({ ...payload, created_by_staff_id: actor })
    .select("*")
    .single();
  if (error) throw error;

  // Seed mandatory core safety template fields (§12.2.2).
  await supabase.rpc("seed_venue_mandatory_safety_fields", {
    p_venue_id: (data as Venue).id,
  });

  await writeToLedger({
    staff_id: actor,
    category: "CENTRE",
    severity: "INFO",
    action_type: "VENUE_CREATED",
    gps_lat: null,
    gps_lng: null,
    metadata: { venue_id: (data as Venue).id, name: (data as Venue).name },
  });
  return data as Venue;
}

export async function archiveVenue(id: string): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can archive venues.");

  const actor = await resolveStaffIdWithFallback();
  const { error } = await supabase
    .from("venues")
    .update({ status: "archived" })
    .eq("id", id);
  if (error) throw error;

  await writeToLedger({
    staff_id: actor,
    category: "CENTRE",
    severity: "INFO",
    action_type: "VENUE_ARCHIVED",
    gps_lat: null,
    gps_lng: null,
    metadata: { venue_id: id },
  });
}

// ============================================================================
// Template fields
// ============================================================================

export async function listVenueTemplateFields(venueId: string): Promise<VenueTemplateField[]> {
  const { data, error } = await supabase
    .from("venue_template_fields")
    .select("*")
    .eq("venue_id", venueId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VenueTemplateField[];
}

export interface AddVenueTemplateFieldInput {
  venue_id: string;
  prompt: string;
  answer_type: AnswerType;
  options_json?: string[] | null;
  is_mandatory?: boolean;
  sort_order?: number;
}

export async function addVenueTemplateField(
  input: AddVenueTemplateFieldInput,
): Promise<VenueTemplateField> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can edit venue template fields.");

  const { data, error } = await supabase
    .from("venue_template_fields")
    .insert({
      venue_id: input.venue_id,
      prompt: input.prompt.trim(),
      answer_type: input.answer_type,
      options_json: input.options_json ?? null,
      is_mandatory: input.is_mandatory ?? true,
      is_system_core: false,
      sort_order: input.sort_order ?? 999,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as VenueTemplateField;
}

export async function updateVenueTemplateField(
  id: string,
  patch: Partial<Pick<VenueTemplateField, "prompt" | "answer_type" | "options_json" | "is_mandatory" | "sort_order">>,
): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can edit venue template fields.");

  const { error } = await supabase
    .from("venue_template_fields")
    .update(patch)
    .eq("id", id)
    .eq("is_system_core", false); // never mutate system core via this path
  if (error) throw error;
}

export async function deleteVenueTemplateField(id: string): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can remove venue template fields.");

  const { error } = await supabase
    .from("venue_template_fields")
    .delete()
    .eq("id", id)
    .eq("is_system_core", false); // system core fields are permanent
  if (error) throw error;
}

// ============================================================================
// Clone venue (§12.2.2 — structure only, never answers)
// ============================================================================

export async function cloneVenue(sourceVenueId: string, newName: string): Promise<Venue> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can clone venues.");

  const actor = await resolveStaffIdWithFallback();
  const source = await getVenue(sourceVenueId);
  const sourceFields = await listVenueTemplateFields(sourceVenueId);

  // Create the new venue (answers NOT copied — §12.2.2).
  const { data: newVenue, error: vErr } = await supabase
    .from("venues")
    .insert({
      name: newName.trim(),
      venue_type: source.venue_type,
      street_address: source.street_address,
      gps_lat: source.gps_lat,
      gps_lng: source.gps_lng,
      access_notes: source.access_notes,
      site_contact_name: null,
      site_contact_phone: null,
      max_safe_group_size: source.max_safe_group_size,
      risk_tier: source.risk_tier,
      cloned_from_venue_id: sourceVenueId,
      created_by_staff_id: actor,
      status: "active",
    })
    .select("*")
    .single();
  if (vErr) throw vErr;

  // Copy field definitions only.
  if (sourceFields.length > 0) {
    const fieldRows = sourceFields.map((f) => ({
      venue_id: (newVenue as Venue).id,
      prompt: f.prompt,
      answer_type: f.answer_type,
      options_json: f.options_json,
      is_mandatory: f.is_mandatory,
      is_system_core: f.is_system_core,
      sort_order: f.sort_order,
    }));
    const { error: fErr } = await supabase
      .from("venue_template_fields")
      .insert(fieldRows);
    if (fErr) throw fErr;
  }

  await writeToLedger({
    staff_id: actor,
    category: "CENTRE",
    severity: "INFO",
    action_type: "VENUE_CLONED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      new_venue_id: (newVenue as Venue).id,
      source_venue_id: sourceVenueId,
      name: (newVenue as Venue).name,
    },
  });

  return newVenue as Venue;
}

// ============================================================================
// Baseline sign-off (§12.2.2) — manager PIN + evidence + ledger (§1.1)
// ============================================================================

export interface BaselineSignoffAnswer {
  field_id: string;
  answer_text?: string | null;
  answer_json?: unknown | null;
}

export interface BaselineSignoffInput {
  venue_id: string;
  /** Manager 4-digit PIN — verified before write. */
  managerPin: string;
  evidence_ref: string;
  notes?: string | null;
  answers: BaselineSignoffAnswer[];
}

export async function submitBaselineSignoff(
  input: BaselineSignoffInput,
): Promise<VenueSafetyBaselineSignoff> {
  if (input.evidence_ref.trim().length < MIN_EVIDENCE) {
    throw new Error(`Evidence reference must be at least ${MIN_EVIDENCE} characters.`);
  }

  // Verify manager PIN.
  const staffId = await resolveStaffIdWithFallback();
  const pinOk = await verifyStaffPin(staffId, input.managerPin);
  if (!pinOk) {
    throw new Error("Invalid Manager PIN.");
  }
  const allowed = await canManageSystemParameters(staffId);
  if (!allowed) {
    throw new Error("Manager PIN required to sign off venue safety baseline.");
  }

  // Insert signoff row.
  const { data: signoff, error: sErr } = await supabase
    .from("venue_safety_baseline_signoffs")
    .insert({
      venue_id: input.venue_id,
      signed_off_by_staff_id: staffId,
      evidence_ref: input.evidence_ref.trim(),
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();
  if (sErr) throw sErr;

  // Insert answers.
  if (input.answers.length > 0) {
    const rows = input.answers.map((a) => ({
      signoff_id: (signoff as VenueSafetyBaselineSignoff).id,
      field_id: a.field_id,
      answer_text: a.answer_text ?? null,
      answer_json: a.answer_json ?? null,
    }));
    const { error: aErr } = await supabase
      .from("venue_safety_answers")
      .insert(rows);
    if (aErr) throw aErr;
  }

  // Ledger receipt — §1.1 abort on failure.
  await writeToLedgerOrThrow({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "VENUE_BASELINE_SIGNOFF",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      venue_id: input.venue_id,
      signoff_id: (signoff as VenueSafetyBaselineSignoff).id,
      evidence_ref: input.evidence_ref.trim(),
      field_count: input.answers.length,
    },
  });

  return signoff as VenueSafetyBaselineSignoff;
}

export async function listBaselineSignoffs(
  venueId: string,
): Promise<VenueSafetyBaselineSignoff[]> {
  const { data, error } = await supabase
    .from("venue_safety_baseline_signoffs")
    .select("*")
    .eq("venue_id", venueId)
    .order("signed_off_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as VenueSafetyBaselineSignoff[];
}

export async function getLatestBaselineSignoff(
  venueId: string,
): Promise<VenueSafetyBaselineSignoff | null> {
  const { data, error } = await supabase
    .from("venue_safety_baseline_signoffs")
    .select("*")
    .eq("venue_id", venueId)
    .order("signed_off_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as VenueSafetyBaselineSignoff | null;
}

export async function getBaselineSignoffAnswers(
  signoffId: string,
): Promise<VenueSafetyAnswer[]> {
  const { data, error } = await supabase
    .from("venue_safety_answers")
    .select("*")
    .eq("signoff_id", signoffId);
  if (error) throw error;
  return (data ?? []) as VenueSafetyAnswer[];
}

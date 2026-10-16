/**
 * Expected checks for a venue type, copied onto each venue of that type.
 * Changing the list is a manager PIN plus a reason, kept for NDIS review.
 */
import { supabase } from "@/integrations/supabase/client";
import { operationalNowIso } from "@/lib/operational-clock";
import { verifyCoordinatorPin } from "@/lib/data-store";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import { createIssue } from "@/lib/api/site-issues";
import { venueTypeCodeFromLabel } from "@/lib/api/venue-types";
import { isoDateOnly, todayLocalIso, toIsoDateString } from "@/lib/utils";

export interface VenueRequirement {
  code: string;
  prompt: string;
  sort_order: number;
}

const SQL_HINT = "Run docs/sql/2026-10-14_venue_type_requirements.sql, then try again.";

export async function listRequirementCatalogue(): Promise<VenueRequirement[] | null> {
  const { data, error } = await supabase
    .from("venue_requirements")
    .select("code, prompt, sort_order, status")
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("prompt", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({
    code: (r as VenueRequirement).code,
    prompt: (r as VenueRequirement).prompt,
    sort_order: (r as VenueRequirement).sort_order,
  }));
}

/** Tick an existing requirement on or off for one venue type. One reason covers the whole change. */
export async function setTypeRequirementLinks(input: {
  typeCode: string;
  codes: string[];
  staffId: string;
  pin: string;
  reason: string;
}): Promise<void> {
  await assertChange(input.staffId, input.pin, input.reason);
  const current = await listRequirementsForType(input.typeCode);
  if (!current) throw new Error(SQL_HINT);
  const have = new Set(current.map((r) => r.code));
  const want = new Set(input.codes);
  const added = [...want].filter((c) => !have.has(c));
  const removed = [...have].filter((c) => !want.has(c));
  if (added.length === 0 && removed.length === 0) return;

  const catalogue = await listRequirementCatalogue();
  const nameOf = (code: string) => catalogue?.find((r) => r.code === code)?.prompt ?? code;

  for (const code of added) {
    const { error } = await supabase.from("venue_type_requirements").insert({
      venue_type_code: input.typeCode,
      requirement_code: code,
    });
    if (error && !String(error.message).toLowerCase().includes("duplicate")) {
      throw new Error(error.message);
    }
  }
  for (const code of removed) {
    const { error } = await supabase
      .from("venue_type_requirements")
      .delete()
      .eq("venue_type_code", input.typeCode)
      .eq("requirement_code", code);
    if (error) throw new Error(error.message);
  }

  await logChange({
    staffId: input.staffId,
    reason: input.reason,
    action: "linked",
    requirementCode: null,
    typeCode: input.typeCode,
    beforeText: removed.map(nameOf).join("; ") || null,
    afterText: added.map(nameOf).join("; ") || null,
  });
  await pushType(input.typeCode);
}

export async function listRequirementsForType(
  typeCode: string,
): Promise<VenueRequirement[] | null> {
  const { data, error } = await supabase
    .from("venue_type_requirements")
    .select("requirement_code, venue_requirements(code, prompt, sort_order, status)")
    .eq("venue_type_code", typeCode);
  if (error) {
    if (isSchemaMismatchError(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{
    venue_requirements: {
      code: string;
      prompt: string;
      sort_order: number;
      status: string;
    } | null;
  }>;
  return rows
    .map((r) => r.venue_requirements)
    .filter((r): r is NonNullable<typeof r> => !!r && r.status !== "archived")
    .map((r) => ({ code: r.code, prompt: r.prompt, sort_order: r.sort_order }))
    .sort((a, b) => a.sort_order - b.sort_order || a.prompt.localeCompare(b.prompt));
}

async function assertChange(staffId: string, pin: string, reason: string): Promise<void> {
  if (reason.trim().length < 20) {
    throw new Error("Say why this is changing (at least 20 characters).");
  }
  const pinOk = await verifyCoordinatorPin(staffId, pin);
  if (!pinOk) throw new Error("Invalid Manager PIN.");
  const allowed = await canManageSystemParameters(staffId);
  if (!allowed) throw new Error("Only a Manager can change venue requirements.");
}

async function logChange(input: {
  staffId: string;
  reason: string;
  action: string;
  requirementCode: string | null;
  typeCode: string | null;
  beforeText: string | null;
  afterText: string | null;
}): Promise<void> {
  const { error } = await supabase.from("venue_requirement_changes").insert({
    requirement_code: input.requirementCode,
    venue_type_code: input.typeCode,
    action: input.action,
    before_text: input.beforeText,
    after_text: input.afterText,
    reason: input.reason.trim(),
    changed_by_staff_id: input.staffId,
    created_at: operationalNowIso(),
  });
  if (error && !isSchemaMismatchError(error)) throw new Error(error.message);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "venue_requirement",
    recordName: input.afterText || input.beforeText || input.requirementCode || "Venue requirement",
    summary: `${input.action}: ${input.beforeText ?? "—"} → ${input.afterText ?? "—"}. Because: ${input.reason.trim()}`,
    before: { text: input.beforeText },
    after: { text: input.afterText, reason: input.reason.trim() },
  });
}

/** Copy the type's current list onto the venue. Returns false if the SQL is not loaded. */
export async function syncVenueTypeRequirements(
  venueId: string,
  typeCode: string,
  opts?: { voidBaseline?: boolean },
): Promise<boolean> {
  const expected = await listRequirementsForType(typeCode);
  if (!expected) return false;

  const { data, error } = await supabase
    .from("venue_template_fields")
    .select("id, requirement_code, prompt, is_current")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) return false;
    throw new Error(error.message);
  }
  const fields = (data ?? []) as Array<{
    id: string;
    requirement_code: string | null;
    prompt: string;
    is_current: boolean | null;
  }>;
  const expectedCodes = new Set(expected.map((r) => r.code));
  let changed = false;
  const seenCodes = new Set<string>();
  const kept: typeof fields = [];
  for (const field of fields) {
    if (!field.requirement_code) {
      kept.push(field);
      continue;
    }
    if (seenCodes.has(field.requirement_code)) {
      await supabase.from("venue_template_fields").delete().eq("id", field.id);
      changed = true;
      continue;
    }
    seenCodes.add(field.requirement_code);
    kept.push(field);
  }
  fields.splice(0, fields.length, ...kept);

  for (const req of expected) {
    const existing = fields.find((f) => f.requirement_code === req.code);
    if (!existing) {
      const { error: insErr } = await supabase.from("venue_template_fields").insert({
        venue_id: venueId,
        prompt: req.prompt,
        answer_type: "yes_no",
        is_mandatory: true,
        is_system_core: false,
        requirement_code: req.code,
        is_current: true,
        sort_order: req.sort_order,
      });
      if (insErr) {
        if (isSchemaMismatchError(insErr)) return false;
        if (String(insErr.code) === "23505" || String(insErr.message).toLowerCase().includes("duplicate")) {
          continue;
        }
        throw new Error(insErr.message);
      }
      changed = true;
    } else if (existing.prompt !== req.prompt || existing.is_current === false) {
      const { error: upErr } = await supabase
        .from("venue_template_fields")
        .update({ prompt: req.prompt, is_current: true, is_mandatory: true })
        .eq("id", existing.id);
      if (upErr) throw new Error(upErr.message);
      changed = true;
    }
  }

  for (const field of fields) {
    if (
      field.requirement_code &&
      !expectedCodes.has(field.requirement_code) &&
      field.is_current !== false
    ) {
      const { error: upErr } = await supabase
        .from("venue_template_fields")
        .update({ is_current: false, is_mandatory: false })
        .eq("id", field.id);
      if (upErr && !isSchemaMismatchError(upErr)) throw new Error(upErr.message);
      changed = true;
    }
  }

  if (changed && opts?.voidBaseline) {
    await supabase
      .from("venues")
      .update({ baseline_voided_at: operationalNowIso() })
      .eq("id", venueId);
  }
  return true;
}

async function venuesOfType(typeCode: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("venues")
    .select("id")
    .eq("venue_type", typeCode)
    .eq("status", "active");
  if (error) return [];
  return (data ?? []).map((r) => (r as { id: string }).id);
}

async function pushType(typeCode: string): Promise<void> {
  const ids = await venuesOfType(typeCode);
  for (const id of ids) {
    await syncVenueTypeRequirements(id, typeCode, { voidBaseline: true });
  }
}

export async function addRequirementToType(input: {
  typeCode: string;
  prompt: string;
  staffId: string;
  pin: string;
  reason: string;
}): Promise<void> {
  await assertChange(input.staffId, input.pin, input.reason);
  const prompt = input.prompt.trim();
  if (prompt.length < 8) throw new Error("The requirement needs at least 8 characters.");
  const code = venueTypeCodeFromLabel(prompt).slice(0, 40) || "requirement";

  const { data: existing } = await supabase
    .from("venue_requirements")
    .select("code, prompt")
    .eq("code", code)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from("venue_requirements").insert({
      code,
      prompt,
      sort_order: 200,
      status: "active",
      created_at: operationalNowIso(),
      updated_at: operationalNowIso(),
    });
    if (error) {
      if (isSchemaMismatchError(error)) throw new Error(SQL_HINT);
      throw new Error(error.message);
    }
  }

  const { error: linkErr } = await supabase.from("venue_type_requirements").insert({
    venue_type_code: input.typeCode,
    requirement_code: (existing as { code: string } | null)?.code ?? code,
  });
  if (linkErr && !String(linkErr.message).toLowerCase().includes("duplicate")) {
    if (isSchemaMismatchError(linkErr)) throw new Error(SQL_HINT);
    throw new Error(linkErr.message);
  }

  await logChange({
    staffId: input.staffId,
    reason: input.reason,
    action: "added",
    requirementCode: code,
    typeCode: input.typeCode,
    beforeText: null,
    afterText: prompt,
  });
  await pushType(input.typeCode);
}

export async function renameRequirement(input: {
  code: string;
  prompt: string;
  typeCode: string;
  staffId: string;
  pin: string;
  reason: string;
}): Promise<void> {
  await assertChange(input.staffId, input.pin, input.reason);
  const prompt = input.prompt.trim();
  if (prompt.length < 8) throw new Error("The requirement needs at least 8 characters.");
  const { data: before, error: readErr } = await supabase
    .from("venue_requirements")
    .select("prompt")
    .eq("code", input.code)
    .single();
  if (readErr) throw new Error(readErr.message);
  const previous = (before as { prompt: string }).prompt;
  const { error } = await supabase
    .from("venue_requirements")
    .update({ prompt, updated_at: operationalNowIso() })
    .eq("code", input.code);
  if (error) throw new Error(error.message);

  const { data: links } = await supabase
    .from("venue_type_requirements")
    .select("venue_type_code")
    .eq("requirement_code", input.code);
  const types = (links ?? []).map((r) => (r as { venue_type_code: string }).venue_type_code);

  await logChange({
    staffId: input.staffId,
    reason: input.reason,
    action: "renamed",
    requirementCode: input.code,
    typeCode: input.typeCode,
    beforeText: previous,
    afterText: prompt,
  });
  for (const typeCode of types) await pushType(typeCode);
}

/** Retire a check from the catalogue and from every venue type that used it. */
export async function archiveRequirement(input: {
  code: string;
  prompt: string;
  staffId: string;
  pin: string;
  reason: string;
}): Promise<void> {
  await assertChange(input.staffId, input.pin, input.reason);
  const { data: links, error: linkRead } = await supabase
    .from("venue_type_requirements")
    .select("venue_type_code")
    .eq("requirement_code", input.code);
  if (linkRead) throw new Error(linkRead.message);
  const types = [
    ...new Set((links ?? []).map((r) => (r as { venue_type_code: string }).venue_type_code)),
  ];

  const { error } = await supabase
    .from("venue_requirements")
    .update({ status: "archived", updated_at: operationalNowIso() })
    .eq("code", input.code);
  if (error) throw new Error(error.message);

  const { error: delErr } = await supabase
    .from("venue_type_requirements")
    .delete()
    .eq("requirement_code", input.code);
  if (delErr) throw new Error(delErr.message);

  await logChange({
    staffId: input.staffId,
    reason: input.reason,
    action: "archived",
    requirementCode: input.code,
    typeCode: null,
    beforeText: input.prompt,
    afterText: null,
  });
  for (const typeCode of types) await pushType(typeCode);
}

export async function removeRequirementFromType(input: {
  typeCode: string;
  code: string;
  prompt: string;
  staffId: string;
  pin: string;
  reason: string;
}): Promise<void> {
  await assertChange(input.staffId, input.pin, input.reason);
  const { error } = await supabase
    .from("venue_type_requirements")
    .delete()
    .eq("venue_type_code", input.typeCode)
    .eq("requirement_code", input.code);
  if (error) throw new Error(error.message);
  await logChange({
    staffId: input.staffId,
    reason: input.reason,
    action: "removed",
    requirementCode: input.code,
    typeCode: input.typeCode,
    beforeText: input.prompt,
    afterText: null,
  });
  await pushType(input.typeCode);
}

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return toIsoDateString(dt);
}

/** One open Hub issue when an active venue's annual baseline is due. Archived venues are skipped. */
export async function ensureDueVenueBaselineIssues(
  venues: Array<{ id: string; name: string; status: string }>,
): Promise<void> {
  const today = todayLocalIso();
  const soon = plusDays(today, 60);
  for (const venue of venues) {
    if (venue.status !== "active") continue;
    const { data: asset, error } = await supabase
      .from("compliance_assets")
      .select("expiry_date, status")
      .eq("subject_table", "venues")
      .eq("subject_id", venue.id)
      .eq("type", "venue_annual_review")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error || !asset) continue;
    const expiry = isoDateOnly((asset as { expiry_date: string | null }).expiry_date);
    if (!expiry || expiry > soon) continue;
    const marker = `venue-baseline:${venue.id}`;
    const { data: openRows } = await supabase
      .from("site_issues_register")
      .select("id")
      .eq("status", "open")
      .ilike("issue_description", `%${marker}%`)
      .limit(1);
    if ((openRows ?? []).length > 0) continue;
    await createIssue({
      sessionId: null,
      severity: "yellow",
      owner: "internal",
      issueArea: "health_safety",
      workaroundPlan: null,
      issueDescription: `Re-baseline ${venue.name}. The annual venue safety review is due ${expiry}. ${marker}`,
    }).catch(() => null);
  }
}

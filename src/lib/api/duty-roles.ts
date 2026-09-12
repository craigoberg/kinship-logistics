/**
 * BL-126 — Duty roles, requirement catalogue, bindings, staff assignment.
 */
import { supabase } from "@/integrations/supabase/client";
import { writeToLedger, type LedgerCategory } from "@/lib/api/ledger";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import {
  evaluateRequirementHolds,
  type DutyBinding,
  type DutyFunctionKey,
  type DutyRole,
  type DutySubjectKind,
  type RequirementKind,
  type RequirementType,
} from "@/lib/duty-roles";
import type { StaffMember } from "@/lib/data-store";

type RequirementRow = {
  id: string;
  name: string;
  kind: RequirementKind;
  aliases: string[] | null;
  active: boolean;
  sort_order: number;
};

type DutyRoleRow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
};

type BindingRow = {
  id: string;
  function_key: DutyFunctionKey;
  subject_kind: DutySubjectKind;
  subject_id: string | null;
  duty_role_id: string;
};

function rowToRequirement(r: RequirementRow): RequirementType {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    aliases: Array.isArray(r.aliases) ? r.aliases : [],
    active: r.active,
    sortOrder: r.sort_order,
  };
}

function rowToDutyRole(r: DutyRoleRow, requirementIds: string[]): DutyRole {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    active: r.active,
    sortOrder: r.sort_order,
    requirementIds,
  };
}

function rowToBinding(r: BindingRow): DutyBinding {
  return {
    id: r.id,
    functionKey: r.function_key,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    dutyRoleId: r.duty_role_id,
  };
}

function isMissingRelation(error: { message?: string; code?: string } | null): boolean {
  const msg = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

export async function listRequirementTypes(
  includeInactive = false,
): Promise<RequirementType[]> {
  let q = supabase
    .from("requirement_types")
    .select("id, name, kind, aliases, active, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data as RequirementRow[]).map(rowToRequirement);
}

export async function upsertRequirementType(input: {
  id?: string;
  name: string;
  kind: RequirementKind;
  aliases: string[];
  active?: boolean;
}): Promise<RequirementType> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Requirement name must be at least 2 characters.");
  const aliases = input.aliases
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  const payload = {
    name,
    kind: input.kind,
    aliases,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? supabase.from("requirement_types").update(payload).eq("id", input.id)
    : supabase.from("requirement_types").insert(payload);
  const { data, error } = await query
    .select("id, name, kind, aliases, active, sort_order")
    .single();
  if (error) throw error;
  return rowToRequirement(data as RequirementRow);
}

export async function setRequirementTypeActive(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("requirement_types")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listDutyRoles(includeInactive = false): Promise<DutyRole[]> {
  let q = supabase
    .from("duty_roles")
    .select("id, name, description, active, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  const roles = (data as DutyRoleRow[]) ?? [];
  if (roles.length === 0) return [];
  const { data: links, error: linkErr } = await supabase
    .from("duty_role_requirements")
    .select("duty_role_id, requirement_type_id, sort_order")
    .in(
      "duty_role_id",
      roles.map((r) => r.id),
    )
    .order("sort_order", { ascending: true });
  if (linkErr && !isMissingRelation(linkErr)) throw linkErr;
  const byRole = new Map<string, string[]>();
  for (const row of (links ?? []) as Array<{
    duty_role_id: string;
    requirement_type_id: string;
  }>) {
    const list = byRole.get(row.duty_role_id) ?? [];
    list.push(row.requirement_type_id);
    byRole.set(row.duty_role_id, list);
  }
  return roles.map((r) => rowToDutyRole(r, byRole.get(r.id) ?? []));
}

export async function upsertDutyRole(input: {
  id?: string;
  name: string;
  description: string | null;
  requirementIds: string[];
  active?: boolean;
}): Promise<DutyRole> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Duty role name must be at least 2 characters.");
  const payload = {
    name,
    description: input.description?.trim() || null,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? supabase.from("duty_roles").update(payload).eq("id", input.id)
    : supabase.from("duty_roles").insert(payload);
  const { data, error } = await query
    .select("id, name, description, active, sort_order")
    .single();
  if (error) throw error;
  const role = data as DutyRoleRow;
  const { error: delErr } = await supabase
    .from("duty_role_requirements")
    .delete()
    .eq("duty_role_id", role.id);
  if (delErr) throw delErr;
  const ids = [...new Set(input.requirementIds.filter(Boolean))];
  if (ids.length > 0) {
    const { error: insErr } = await supabase.from("duty_role_requirements").insert(
      ids.map((requirement_type_id, i) => ({
        duty_role_id: role.id,
        requirement_type_id,
        sort_order: (i + 1) * 10,
      })),
    );
    if (insErr) throw insErr;
  }
  return rowToDutyRole(role, ids);
}

export async function setDutyRoleActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from("duty_roles")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listStaffDutyRoleIds(staffId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("staff_duty_roles")
    .select("duty_role_id")
    .eq("staff_id", staffId);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return ((data ?? []) as Array<{ duty_role_id: string }>).map((r) => r.duty_role_id);
}

export async function replaceStaffDutyRoles(
  staffId: string,
  dutyRoleIds: string[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from("staff_duty_roles")
    .delete()
    .eq("staff_id", staffId);
  if (delErr) {
    if (isMissingRelation(delErr)) return;
    throw delErr;
  }
  const ids = [...new Set(dutyRoleIds.filter(Boolean))];
  if (ids.length === 0) return;
  const { error } = await supabase.from("staff_duty_roles").insert(
    ids.map((duty_role_id) => ({ staff_id: staffId, duty_role_id })),
  );
  if (error) throw error;
}

export async function listDutyBindings(): Promise<DutyBinding[]> {
  const { data, error } = await supabase
    .from("duty_bindings")
    .select("id, function_key, subject_kind, subject_id, duty_role_id")
    .order("function_key", { ascending: true });
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data as BindingRow[]).map(rowToBinding);
}

export async function createDutyBinding(input: {
  functionKey: DutyFunctionKey;
  subjectKind: DutySubjectKind;
  subjectId: string | null;
  dutyRoleId: string;
}): Promise<DutyBinding> {
  const subjectId =
    input.subjectKind === "function" ? null : (input.subjectId ?? "").trim() || null;
  if (input.subjectKind !== "function" && !subjectId) {
    throw new Error("Pick a vehicle category or fleet asset for this binding.");
  }
  const { data, error } = await supabase
    .from("duty_bindings")
    .insert({
      function_key: input.functionKey,
      subject_kind: input.subjectKind,
      subject_id: subjectId,
      duty_role_id: input.dutyRoleId,
    })
    .select("id, function_key, subject_kind, subject_id, duty_role_id")
    .single();
  if (error) throw error;
  return rowToBinding(data as BindingRow);
}

export async function deleteDutyBinding(id: string): Promise<void> {
  const { error } = await supabase.from("duty_bindings").delete().eq("id", id);
  if (error) throw error;
}

function bindingsForFunction(
  all: DutyBinding[],
  functionKey: DutyFunctionKey,
  subject?: { kind: DutySubjectKind; id: string } | null,
): DutyBinding[] {
  return all.filter((b) => {
    if (b.functionKey !== functionKey) return false;
    if (b.subjectKind === "function" && !b.subjectId) return true;
    if (!subject) return false;
    return b.subjectKind === subject.kind && b.subjectId === subject.id;
  });
}

export function selectFleetDriveBindings(
  all: DutyBinding[],
  asset: { id: string; vehicleCategory: string | null },
): DutyBinding[] {
  const category = (asset.vehicleCategory ?? "").trim();
  return all.filter((b) => {
    if (b.functionKey !== "fleet_drive") return false;
    if (b.subjectKind === "fleet_asset" && b.subjectId === asset.id) return true;
    if (b.subjectKind === "vehicle_category" && category && b.subjectId === category) {
      return true;
    }
    return false;
  });
}

export async function listRequirementsForBindings(
  bindings: DutyBinding[],
  roles?: DutyRole[],
  types?: RequirementType[],
): Promise<RequirementType[]> {
  const dutyRoles = roles ?? (await listDutyRoles(true));
  const catalogue = types ?? (await listRequirementTypes(true));
  const byId = new Map(catalogue.map((t) => [t.id, t]));
  const roleById = new Map(dutyRoles.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: RequirementType[] = [];
  for (const b of bindings) {
    const role = roleById.get(b.dutyRoleId);
    if (!role) continue;
    for (const reqId of role.requirementIds) {
      if (seen.has(reqId)) continue;
      const type = byId.get(reqId);
      if (!type || !type.active) continue;
      seen.add(reqId);
      out.push(type);
    }
  }
  return out;
}

export async function listRequirementsForFunction(
  functionKey: DutyFunctionKey,
  subject?: { kind: DutySubjectKind; id: string } | null,
): Promise<RequirementType[]> {
  const [bindings, roles, types] = await Promise.all([
    listDutyBindings(),
    listDutyRoles(true),
    listRequirementTypes(true),
  ]);
  const matched = bindingsForFunction(bindings, functionKey, subject);
  return listRequirementsForBindings(matched, roles, types);
}

export async function listRequirementsForFleetAsset(asset: {
  id: string;
  vehicleCategory: string | null;
}): Promise<RequirementType[]> {
  const [bindings, roles, types] = await Promise.all([
    listDutyBindings(),
    listDutyRoles(true),
    listRequirementTypes(true),
  ]);
  return listRequirementsForBindings(
    selectFleetDriveBindings(bindings, asset),
    roles,
    types,
  );
}

export function evaluateStaffForRequirements(
  staff: StaffMember | null | undefined,
  requirements: RequirementType[],
) {
  return evaluateRequirementHolds(staff, requirements);
}

export async function recordDutyGapApproval(input: {
  functionKey: DutyFunctionKey;
  staffId: string;
  staffName: string;
  managerStaffId: string;
  note: string;
  subjectLabel: string;
  missingSummary: string;
  ledgerCategory?: LedgerCategory;
}): Promise<void> {
  const reporterId = await resolveStaffIdWithFallback();
  await writeToLedger({
    staff_id: reporterId || input.managerStaffId,
    category: input.ledgerCategory ?? "CENTRE",
    severity: "YELLOW",
    action_type: "DUTY_REQUIREMENT_GAP_APPROVED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      function_key: input.functionKey,
      subject: input.subjectLabel,
      acting_staff_id: input.staffId,
      acting_staff_name: input.staffName,
      approved_by_staff_id: input.managerStaffId,
      note: input.note.trim(),
      gap: input.missingSummary,
    },
  });
}

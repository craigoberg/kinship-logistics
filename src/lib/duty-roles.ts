/**
 * BL-126 — Duty roles vs ACCESS_ROLES, requirement matching, floor evaluation.
 */
import type { StaffCertification, StaffMember } from "@/lib/data-store";
import { getOperationalTodayIso } from "@/lib/operational-clock";
import type { PreparerCertStatus } from "@/lib/meal-open";

export const REQUIREMENT_KINDS = ["certificate", "orientation"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const DUTY_FUNCTION_KEYS = [
  { key: "meal_prep", label: "Meal preparation" },
  { key: "fleet_drive", label: "Drive fleet asset" },
  { key: "centre_open", label: "Centre open" },
  { key: "centre_close", label: "Centre close" },
  { key: "med_admin", label: "Medical admin" },
  { key: "floor_on_duty", label: "On the floor (helper check-in)" },
  { key: "event_venue_open", label: "Open event location" },
  { key: "event_day_close", label: "Close event day / location" },
  { key: "med_witness", label: "Medication witness" },
] as const;

export type DutyFunctionKey = (typeof DUTY_FUNCTION_KEYS)[number]["key"];

export const DUTY_SUBJECT_KINDS = [
  { key: "function", label: "All uses of this function" },
  { key: "vehicle_category", label: "Vehicle category" },
  { key: "fleet_asset", label: "One fleet asset" },
] as const;

export type DutySubjectKind = (typeof DUTY_SUBJECT_KINDS)[number]["key"];

export type RequirementEvalStatus = "ok" | "missing" | "expired";

export type RequirementHoldEval = {
  requirement: RequirementType;
  status: RequirementEvalStatus;
};

export type DutyRequirementEval = {
  overall: PreparerCertStatus;
  holds: RequirementHoldEval[];
  missingNames: string[];
  expiredNames: string[];
};

export interface RequirementType {
  id: string;
  name: string;
  kind: RequirementKind;
  aliases: string[];
  active: boolean;
  sortOrder: number;
}

export interface DutyRole {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  requirementIds: string[];
}

export interface DutyBinding {
  id: string;
  functionKey: DutyFunctionKey;
  subjectKind: DutySubjectKind;
  subjectId: string | null;
  dutyRoleId: string;
}

export function dutyFunctionLabel(key: string): string {
  return DUTY_FUNCTION_KEYS.find((k) => k.key === key)?.label ?? key;
}

export function normalizeRequirementName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function requirementTypeMatchesName(
  type: Pick<RequirementType, "name" | "aliases">,
  holdName: string,
): boolean {
  const n = normalizeRequirementName(holdName);
  if (!n) return false;
  if (n === normalizeRequirementName(type.name)) return true;
  for (const alias of type.aliases) {
    const a = normalizeRequirementName(alias);
    if (a && n === a) return true;
  }
  if (n.length >= 6) {
    const typeName = normalizeRequirementName(type.name);
    if (typeName.length >= 6 && (n.includes(typeName) || typeName.includes(n))) {
      return true;
    }
    for (const alias of type.aliases) {
      const a = normalizeRequirementName(alias);
      if (a.length >= 6 && (n.includes(a) || a.includes(n))) return true;
    }
  }
  return false;
}

export function findHoldForRequirement(
  certs: StaffCertification[] | undefined,
  type: RequirementType,
): StaffCertification | null {
  const list = certs ?? [];
  const byId = list.find((c) => (c.requirementTypeId ?? "").trim() === type.id);
  if (byId) return byId;
  return list.find((c) => requirementTypeMatchesName(type, c.name ?? "")) ?? null;
}

function holdIsCurrent(cert: StaffCertification, todayIso: string): boolean {
  const expiry = (cert.expiry ?? "").trim();
  if (!expiry) return true;
  return expiry.slice(0, 10) >= todayIso;
}

export function evaluateRequirementHolds(
  staff: StaffMember | null | undefined,
  requirements: RequirementType[],
  todayIso: string = getOperationalTodayIso(),
): DutyRequirementEval {
  if (requirements.length === 0) {
    return { overall: "ok", holds: [], missingNames: [], expiredNames: [] };
  }
  if (!staff) {
    return {
      overall: "warn_missing",
      holds: requirements.map((requirement) => ({
        requirement,
        status: "missing" as const,
      })),
      missingNames: requirements.map((r) => r.name),
      expiredNames: [],
    };
  }
  const holds: RequirementHoldEval[] = requirements.map((requirement) => {
    const hold = findHoldForRequirement(staff.certifications, requirement);
    if (!hold) return { requirement, status: "missing" };
    if (!holdIsCurrent(hold, todayIso)) return { requirement, status: "expired" };
    return { requirement, status: "ok" };
  });
  const missingNames = holds
    .filter((h) => h.status === "missing")
    .map((h) => h.requirement.name);
  const expiredNames = holds
    .filter((h) => h.status === "expired")
    .map((h) => h.requirement.name);
  let overall: PreparerCertStatus = "ok";
  if (missingNames.length > 0) overall = "warn_missing";
  else if (expiredNames.length > 0) overall = "warn_expired";
  return { overall, holds, missingNames, expiredNames };
}

export function dutyGapSummary(evalResult: DutyRequirementEval): string {
  if (evalResult.overall === "ok") return "";
  const bits: string[] = [];
  if (evalResult.missingNames.length) {
    bits.push(`missing ${evalResult.missingNames.join(", ")}`);
  }
  if (evalResult.expiredNames.length) {
    bits.push(`expired ${evalResult.expiredNames.join(", ")}`);
  }
  return bits.join("; ");
}

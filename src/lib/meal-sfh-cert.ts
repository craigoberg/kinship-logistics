/**
 * BL-073 / BL-126 — Meal preparer requirement check.
 * Prefers Duty-role bindings for meal_prep; falls back to name match
 * when the catalogue is empty (SQL not loaded yet).
 */
import type { StaffMember } from "@/lib/data-store";
import { getOperationalTodayIso } from "@/lib/operational-clock";
import type { PreparerCertStatus } from "@/lib/meal-open";
import {
  evaluateRequirementHolds,
  requirementTypeMatchesName,
  type DutyRequirementEval,
  type RequirementType,
} from "@/lib/duty-roles";

export function isSafeFoodHandlingCertName(name: string): boolean {
  return requirementTypeMatchesName(
    {
      name: "Safe Food Handler",
      aliases: [
        "food handler basic",
        "safe food handling",
        "food handling",
        "safe food handler",
        "sfh",
        "food handler",
      ],
    },
    name,
  );
}

function legacySafeFoodEval(staff: StaffMember | null | undefined): PreparerCertStatus {
  if (!staff) return "warn_missing";
  const matches = (staff.certifications ?? []).filter((c) =>
    isSafeFoodHandlingCertName(c.name ?? ""),
  );
  if (matches.length === 0) return "warn_missing";
  const todayIso = getOperationalTodayIso();
  const anyCurrent = matches.some((c) => {
    const expiry = (c.expiry ?? "").trim();
    if (!expiry) return true;
    return expiry.slice(0, 10) >= todayIso;
  });
  return anyCurrent ? "ok" : "warn_expired";
}

export function evaluateMealPrepRequirements(
  staff: StaffMember | null | undefined,
  requirements: RequirementType[] | undefined,
): DutyRequirementEval {
  const list = requirements ?? [];
  if (list.length === 0) {
    const overall = legacySafeFoodEval(staff);
    return {
      overall,
      holds: [],
      missingNames: overall === "warn_missing" ? ["Safe Food Handler"] : [],
      expiredNames: overall === "warn_expired" ? ["Safe Food Handler"] : [],
    };
  }
  return evaluateRequirementHolds(staff, list);
}

export function evaluateSafeFoodHandlingCert(
  staff: StaffMember | null | undefined,
): PreparerCertStatus {
  return evaluateMealPrepRequirements(staff, []).overall;
}

export function preparerCertStatusForSource(
  needsPreparer: boolean,
  staff: StaffMember | null | undefined,
  requirements?: RequirementType[],
): PreparerCertStatus {
  if (!needsPreparer) return "na";
  return evaluateMealPrepRequirements(staff, requirements).overall;
}

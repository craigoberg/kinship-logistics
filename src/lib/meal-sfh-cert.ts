/**
 * BL-073 — Safe Food Handling cert check for meal preparers.
 */
import type { StaffCertification, StaffMember } from "@/lib/data-store";
import { getOperationalTodayIso } from "@/lib/operational-clock";
import type { PreparerCertStatus } from "@/lib/meal-open";

export function isSafeFoodHandlingCertName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.includes("safe food") || n.includes("food handling");
}

function certIsCurrent(cert: StaffCertification, todayIso: string): boolean {
  const deferred = (cert.deferredUntil ?? "").trim();
  if (deferred && deferred.slice(0, 10) > todayIso) {
    // Deferred past today — still treat expired dates as not current for kitchen.
  }
  const expiry = (cert.expiry ?? "").trim();
  if (!expiry) return true; // no expiry recorded → treat as current
  return expiry.slice(0, 10) >= todayIso;
}

export function evaluateSafeFoodHandlingCert(
  staff: StaffMember | null | undefined,
  todayIso: string = getOperationalTodayIso(),
): PreparerCertStatus {
  if (!staff) return "warn_missing";
  const matches = (staff.certifications ?? []).filter((c) =>
    isSafeFoodHandlingCertName(c.name ?? ""),
  );
  if (matches.length === 0) return "warn_missing";
  const anyCurrent = matches.some((c) => certIsCurrent(c, todayIso));
  return anyCurrent ? "ok" : "warn_expired";
}

export function preparerCertStatusForSource(
  needsPreparer: boolean,
  staff: StaffMember | null | undefined,
): PreparerCertStatus {
  if (!needsPreparer) return "na";
  return evaluateSafeFoodHandlingCert(staff);
}

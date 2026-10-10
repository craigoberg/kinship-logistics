/**
 * Annual onboarding review windows for Hub + Dashboard Band 3.
 * Yellow/red days come from Admin system_parameters (defaults 30 / 0).
 *
 * Convention matches Hub compliance RYGE: red when days remaining ≤ redDays,
 * yellow when days remaining ≤ yellowDays. redDays 0 = red on/after due date.
 */

export const ONBOARDING_REVIEW_YELLOW_DAYS_KEY = "onboarding_review_yellow_days";
export const ONBOARDING_REVIEW_RED_DAYS_KEY = "onboarding_review_red_days";
export const DEFAULT_ONBOARDING_REVIEW_YELLOW_DAYS = 30;
export const DEFAULT_ONBOARDING_REVIEW_RED_DAYS = 0;

export type OnboardingReviewUrgency = "ok" | "yellow" | "red";

/** Calendar-day difference (due − today). Negative = overdue. */
export function daysUntilIsoDate(dueIso: string, todayIso: string): number | null {
  const due = dueIso.slice(0, 10);
  const today = todayIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return null;
  }
  const [dy, dm, dd] = due.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const dueMs = Date.UTC(dy, dm - 1, dd);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return Math.round((dueMs - todayMs) / 86_400_000);
}

export function onboardingReviewUrgency(
  daysUntil: number,
  yellowDays: number,
  redDays: number,
): OnboardingReviewUrgency {
  if (daysUntil <= redDays) return "red";
  if (daysUntil <= yellowDays) return "yellow";
  return "ok";
}

export function isUnnamedOnboardingDraft(displayName: string | null | undefined): boolean {
  const n = (displayName ?? "").trim().toLowerCase();
  return (
    n === "" ||
    n === "client draft" ||
    n === "staff draft" ||
    n === "volunteer draft" ||
    n === "accompanying draft"
  );
}

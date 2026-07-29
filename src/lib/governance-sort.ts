import type { UnifiedIssue } from "@/lib/api/unified-issues";
import type { SiteIssue } from "@/lib/api/site-issues";

/** Red → Yellow → Green → unknown (null). */
export function rygeSortRank(sev: string | null | undefined): number {
  if (sev === "red") return 0;
  if (sev === "yellow") return 1;
  if (sev === "green") return 2;
  return 3;
}

/**
 * Day Centre Issues Register sort: group Red → Yellow → Green,
 * newest → oldest within each band.
 */
export function sortSiteIssuesByRygeNewestFirst(issues: SiteIssue[]): SiteIssue[] {
  return [...issues].sort((a, b) => {
    const byRyge = rygeSortRank(a.severity) - rygeSortRank(b.severity);
    if (byRyge !== 0) return byRyge;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Oldest → newest (ascending). Missing/invalid dates sort last within a RYGE band.
 * Uses ISO date string compare (yyyy-mm-dd) so ordering matches the Expiry column.
 */
export function compareOldestToNewest(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const dateA = a.slice(0, 10);
  const dateB = b.slice(0, 10);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateA) && /^\d{4}-\d{2}-\d{2}$/.test(dateB);
  if (dateOnly) {
    return dateA.localeCompare(dateB);
  }

  const tA = Date.parse(a);
  const tB = Date.parse(b);
  if (Number.isNaN(tA) && Number.isNaN(tB)) return 0;
  if (Number.isNaN(tA)) return 1;
  if (Number.isNaN(tB)) return -1;
  return tA - tB;
}

export function compareRygeThenExpiry(
  rygeA: string | null | undefined,
  expiryA: string | null | undefined,
  rygeB: string | null | undefined,
  expiryB: string | null | undefined,
): number {
  const byRyge = rygeSortRank(rygeA) - rygeSortRank(rygeB);
  if (byRyge !== 0) return byRyge;
  return compareOldestToNewest(expiryA, expiryB);
}

/** Best-effort expiry / follow-up date on a unified issue row. */
export function unifiedIssueSortDate(issue: UnifiedIssue): string {
  const raw = issue.raw as Record<string, unknown> | null | undefined;
  if (raw) {
    if (typeof raw.expiry_date === "string" && raw.expiry_date) return raw.expiry_date;
    if (typeof raw.deferred_until === "string" && raw.deferred_until) {
      return raw.deferred_until;
    }
  }
  return issue.createdAt;
}

export function sortUnifiedIssuesByRygeThenExpiry(issues: UnifiedIssue[]): UnifiedIssue[] {
  return [...issues].sort((a, b) => {
    const byEmergency =
      emergencyHubPriorityRank(a) - emergencyHubPriorityRank(b);
    if (byEmergency !== 0) return byEmergency;
    return compareRygeThenExpiry(
      a.severity,
      unifiedIssueSortDate(a),
      b.severity,
      unifiedIssueSortDate(b),
    );
  });
}

/** Pin active Drill/Live / site-hold Health & Safety tickets above other Hub rows. */
export function emergencyHubPriorityRank(issue: UnifiedIssue): number {
  const desc = `${issue.title} ${issue.description}`.toUpperCase();
  if (desc.includes("[LIVE EMERGENCY]")) return 0;
  if (desc.includes("[DRILL EMERGENCY]")) return 1;
  if (
    desc.includes("[SITE LOCKDOWN") ||
    desc.includes("[SITE DO-NOT-OPEN]") ||
    desc.includes("[PROGRAMME SUSPENDED]")
  ) {
    return 2;
  }
  if (issue.subCategory === "Health & Safety" || issue.sourceLabel === "Health & Safety") {
    return 3;
  }
  return 9;
}

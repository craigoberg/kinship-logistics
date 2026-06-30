import type { UnifiedIssue } from "@/lib/api/unified-issues";

/** Red → Yellow → Green → unknown (null). */
export function rygeSortRank(sev: string | null | undefined): number {
  if (sev === "red") return 0;
  if (sev === "yellow") return 1;
  if (sev === "green") return 2;
  return 3;
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
  return [...issues].sort((a, b) =>
    compareRygeThenExpiry(
      a.severity,
      unifiedIssueSortDate(a),
      b.severity,
      unifiedIssueSortDate(b),
    ),
  );
}

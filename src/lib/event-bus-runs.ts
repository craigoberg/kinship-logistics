/**
 * Event multi-bus runs (BL-069) — R1/R2/Rx short labels from Admin bus_runs lookup.
 * Day Centre UI keeps "Run 1" display names; events use Rx for compact field taps.
 */
import type { LookupParameter } from "@/lib/data-store";

/** Sentinel for the legacy single shared bus cohort (null run codes). */
export const LEGACY_SHARED_BUS_RUN = "__legacy_shared__" as const;

export type EventBusRunOption = {
  code: string;
  /** Event short label: R1, R2, … */
  shortLabel: string;
  /** Admin display name (e.g. Run 1). */
  displayName: string;
};

/** Map Admin bus_runs (sorted) → R1, R2, Rx for event UI. */
export function eventBusRunOptions(
  lookups: LookupParameter[],
): EventBusRunOption[] {
  const sorted = [...lookups].sort((a, b) => {
    const ao = a.sortOrder ?? 9999;
    const bo = b.sortOrder ?? 9999;
    if (ao !== bo) return ao - bo;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted.map((r, i) => ({
    code: r.code,
    shortLabel: `R${i + 1}`,
    displayName: r.displayName,
  }));
}

export function eventBusRunShortLabel(
  code: string | null | undefined,
  options: EventBusRunOption[],
): string {
  if (!code) return "Bus";
  const hit = options.find((o) => o.code === code);
  return hit?.shortLabel ?? code;
}

/**
 * True when this booking/attendance belongs on a Manifest trip for `tripRunCode`.
 * - tripRunCode null/legacy → only people with null planned/actual run (legacy shared).
 * - tripRunCode = BUSRUN-x → matching code (or floor override).
 */
export function matchesEventBusRun(
  personRunCode: string | null | undefined,
  tripRunCode: string | null | undefined,
): boolean {
  const person = (personRunCode ?? "").trim() || null;
  const trip = (tripRunCode ?? "").trim() || null;
  if (!trip || trip === LEGACY_SHARED_BUS_RUN) {
    return person == null;
  }
  return person === trip;
}

/**
 * Floor run when checked out; fall back to roster when floor says bus but
 * the run code was never written (seed ignoreDuplicates / generic Bus tap).
 * `floorRun === undefined` means not yet handed over — use roster.
 */
export function effectiveReturnBusRun(
  floorRun: string | null | undefined,
  rosterRun: string | null | undefined,
): string | null {
  const floor = (floorRun ?? "").trim() || null;
  const roster = (rosterRun ?? "").trim() || null;
  if (floorRun === undefined) return roster;
  return floor ?? roster;
}

/** Distinct non-null run codes from a list (preserves first-seen order). */
export function distinctBusRunCodes(
  codes: Array<string | null | undefined>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const v = (c ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Which Manifest run keys to show for a direction.
 * If any booking has a non-null run code → one card per code used.
 * Else → single legacy shared card.
 */
export function transportRunKeysForDirection(
  runCodesOnRoster: Array<string | null | undefined>,
): Array<string | null> {
  const distinct = distinctBusRunCodes(runCodesOnRoster);
  if (distinct.length === 0) return [null];
  return distinct;
}

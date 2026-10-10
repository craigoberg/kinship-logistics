/**
 * Default badge colours for Day Centre bus runs that have no stored badge_color.
 *
 * Index is creation order (created_at, then id) — never the current code/name
 * sort. Renaming R1 → Nth must not swap colours with another run.
 */

export const BUS_RUN_PALETTE = [
  "#7c3aed", // violet  — first created
  "#d97706", // amber
  "#0891b2", // cyan
  "#e11d48", // rose
  "#059669", // emerald
  "#7c2d12", // brown-orange
];

export interface BusRunPaletteRow {
  id: string;
  createdAt?: string | null;
  badgeColor?: string | null;
}

export function compareBusRunsForPalette(
  a: BusRunPaletteRow,
  b: BusRunPaletteRow,
): number {
  const ac = a.createdAt ?? "";
  const bc = b.createdAt ?? "";
  if (ac !== bc) return ac.localeCompare(bc);
  return a.id.localeCompare(b.id);
}

/** Palette slot for a run: stored colour, else colour from creation order. */
export function busRunEffectiveColor(
  runs: BusRunPaletteRow[],
  row: BusRunPaletteRow,
): string {
  const stored = row.badgeColor?.trim();
  if (stored) return stored;
  const sorted = [...runs].sort(compareBusRunsForPalette);
  const idx = sorted.findIndex((r) => r.id === row.id);
  return BUS_RUN_PALETTE[(idx < 0 ? 0 : idx) % BUS_RUN_PALETTE.length];
}

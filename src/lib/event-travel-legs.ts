/** Bus stop for one leg. Empty override uses the person's home / pickup on file. */
export function legAddress(
  override: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const chosen = (override ?? "").trim();
  if (chosen) return chosen;
  return (fallback ?? "").trim();
}

/**
 * What to store when the office edits a leg.
 * Matching the fallback clears the override so the file address stays current.
 */
export function legOverrideToStore(typed: string, fallback: string | null | undefined): string | null {
  const next = typed.trim();
  const base = (fallback ?? "").trim();
  if (!next || next === base) return null;
  return next;
}

/** Carer legs follow the saved Bus / Self. Older rows only have the bus-seat flag. */
export function carerLegMode(
  explicit: string | null | undefined,
  busSeat: boolean,
): "bus" | "self" {
  if (explicit === "bus" || explicit === "self") return explicit;
  return busSeat ? "bus" : "self";
}

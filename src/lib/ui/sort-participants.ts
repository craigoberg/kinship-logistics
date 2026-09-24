/**
 * Stable client-roll ordering (UI Style Guide — Check-off list order).
 *
 * Surname A–Z, then given name, then id. Never sort by check-off status —
 * status changes style only so rows do not bounce when tapped.
 */

export type SurnameSortable = {
  lastName?: string | null;
  firstName?: string | null;
  id?: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLocaleLowerCase();
}

/** Compare two name parts for surname-primary A–Z. */
export function compareBySurname(a: SurnameSortable, b: SurnameSortable): number {
  const byLast = norm(a.lastName).localeCompare(norm(b.lastName), undefined, {
    sensitivity: "base",
  });
  if (byLast !== 0) return byLast;
  const byFirst = norm(a.firstName).localeCompare(norm(b.firstName), undefined, {
    sensitivity: "base",
  });
  if (byFirst !== 0) return byFirst;
  return norm(a.id).localeCompare(norm(b.id));
}

/**
 * Sort a copy of `items` by participant surname via a lookup map.
 * Unknown participants sort last (empty surname), then by id.
 */
export function sortByParticipantSurname<T>(
  items: readonly T[],
  participantIdOf: (item: T) => string | null | undefined,
  nameById: ReadonlyMap<string, SurnameSortable> | Record<string, SurnameSortable>,
): T[] {
  const lookup = (id: string): SurnameSortable => {
    if (nameById instanceof Map) return nameById.get(id) ?? { id };
    return nameById[id] ?? { id };
  };
  return [...items].sort((a, b) => {
    const idA = participantIdOf(a) ?? "";
    const idB = participantIdOf(b) ?? "";
    return compareBySurname(
      { ...lookup(idA), id: idA },
      { ...lookup(idB), id: idB },
    );
  });
}

/** Build a surname lookup from listParticipants() / Participant-like rows. */
export function surnameMapFromParticipants(
  participants: readonly SurnameSortable[],
): Map<string, SurnameSortable> {
  const map = new Map<string, SurnameSortable>();
  for (const p of participants) {
    if (!p.id) continue;
    map.set(p.id, p);
  }
  return map;
}

/**
 * BL-076 — clinical flags for floor rolls (Allergy / Diet chips).
 * Interim source of truth: participants.allergies_notes + IDDSI levels.
 * Onboarding (BL-065) can later feed the same fields.
 */
import { iddsiLevel } from "@/lib/iddsi";

export type ClinicalFlagSource = {
  allergiesNotes?: string | null;
  iddsi?: { liquids: number; foods: number } | null;
};

export type ClinicalFlagChip = {
  kind: "allergy" | "diet";
  label: string;
  detail: string;
};

function isNoneAllergies(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === "" || t === "none" || t === "n/a" || t === "nil" || t === "-";
}

/** Default IDDSI = thin liquids (0) + regular foods (7). */
export function hasNonDefaultIddsi(iddsi?: {
  liquids: number;
  foods: number;
} | null): boolean {
  if (!iddsi) return false;
  return iddsi.liquids !== 0 || iddsi.foods !== 7;
}

export function clinicalFlagsFromParticipant(
  p: ClinicalFlagSource,
): ClinicalFlagChip[] {
  const chips: ClinicalFlagChip[] = [];
  const notes = (p.allergiesNotes ?? "").trim();
  if (notes && !isNoneAllergies(notes)) {
    chips.push({
      kind: "allergy",
      label: "Allergy",
      detail: notes,
    });
  }
  if (hasNonDefaultIddsi(p.iddsi ?? null)) {
    const liq = iddsiLevel("liquids", p.iddsi!.liquids);
    const food = iddsiLevel("foods", p.iddsi!.foods);
    const short = [liq?.short ?? `L${p.iddsi!.liquids}`, food?.short ?? `F${p.iddsi!.foods}`]
      .join("/");
    chips.push({
      kind: "diet",
      label: `Diet ${short}`,
      detail: [
        liq ? `Liquids: ${liq.name}` : null,
        food ? `Foods: ${food.name}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return chips;
}

/** Soft office/open warning when allergy note never captured. */
export function missingAllergyNote(p: ClinicalFlagSource): boolean {
  return !(p.allergiesNotes ?? "").trim();
}

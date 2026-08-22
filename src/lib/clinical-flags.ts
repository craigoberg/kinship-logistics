/**
 * BL-076 / BL-114 — clinical flags for floor rolls (Allergy / Diet / Comms chips).
 * Source of truth: participants.allergies_notes, IDDSI, communication_*.
 */
import { iddsiLevel } from "@/lib/iddsi";

export type ClinicalFlagSource = {
  allergiesNotes?: string | null;
  iddsi?: { liquids: number; foods: number } | null;
  communicationMode?: string | null;
  communicationStrategies?: string | null;
};

export type ClinicalFlagChip = {
  kind: "allergy" | "diet" | "comms";
  label: string;
  detail: string;
};

function isNoneAllergies(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === "" || t === "none" || t === "n/a" || t === "nil" || t === "-";
}

function isTrivialComms(mode: string, strategies: string): boolean {
  const m = mode.trim().toLowerCase();
  const s = strategies.trim();
  if (!m && !s) return true;
  const trivialMode =
    !m ||
    ["speech", "verbal", "spoken", "talking", "none", "n/a", "nil", "-"].includes(m);
  return trivialMode && !s;
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
  const mode = (p.communicationMode ?? "").trim();
  const strategies = (p.communicationStrategies ?? "").trim();
  if (!isTrivialComms(mode, strategies)) {
    const label = mode ? (mode.length > 18 ? "Comms" : `Comms ${mode}`) : "Comms";
    chips.push({
      kind: "comms",
      label,
      detail: [mode ? `Mode: ${mode}` : null, strategies || null]
        .filter(Boolean)
        .join("\n"),
    });
  }
  return chips;
}

/** Soft office/open warning when allergy note never captured. */
export function missingAllergyNote(p: ClinicalFlagSource): boolean {
  return !(p.allergiesNotes ?? "").trim();
}

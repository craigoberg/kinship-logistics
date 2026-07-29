/**
 * BL-073 — shared meal open rules (Centre + Trips).
 */
export type MealSource =
  | "delivered_by_us"
  | "own_food"
  | "venue_provided"
  | "packed"
  | "purchase";

export type PreparerCertStatus = "ok" | "warn_missing" | "warn_expired" | "na";

/** Who sealed the prep checklist (action PIN step-up — not day login). */
export type PrepAttestationMode = "preparer_pin" | "manager_guest_override";

export type MealPrepAttestation = {
  mode: PrepAttestationMode;
  /** Staff whose PIN sealed the attestation (preparer or Manager on Duty). */
  attestedByStaffId: string;
  /**
   * PIN for server-side re-verify only — never persisted.
   * Preparer PIN for `preparer_pin`; Manager PIN for guest override.
   */
  pin: string;
  /** External / guest kitchen lead when mode is manager_guest_override. */
  guestPreparerName?: string | null;
  /** Why Manager is attesting on a guest’s behalf (min 10). */
  overrideNote?: string | null;
};

/** Manager / Coordinator PIN approval when SFH missing or expired. */
export type MealSfhManagerApproval = {
  managerStaffId: string;
  note: string;
  /** PIN for server re-verify — never persisted. */
  pin: string;
};

export type MealOpenPayload = {
  mealSource: MealSource;
  menuNotes: string | null;
  /** Staff kitchen lead — null when guest preparer override. */
  preparedByStaffId: string | null;
  preparerCertStatus: PreparerCertStatus;
  /** SFH Manager justification when warn_* (also stored as preparer_ack_note). */
  preparerAckNote: string | null;
  /** Required when preparerCertStatus is warn_missing / warn_expired. */
  sfhManagerApproval: MealSfhManagerApproval | null;
  /** Completed prep walkthrough labels (cooked/packed only). */
  prepChecksCompleted: string[];
  /** Required for cooked/packed — PIN verified again in API. */
  prepAttestation: MealPrepAttestation | null;
};

/** Admin key — JSON string array on system_parameters. */
export const MEAL_PREP_CHECKS_PARAM_KEY = "meal.prep_checks" as const;

export const MEAL_SOURCE_LABELS: Record<MealSource, string> = {
  delivered_by_us: "Cooked / delivered by us",
  own_food: "Brought own food",
  venue_provided: "Venue provided",
  packed: "Packed from centre",
  purchase: "Takeaway / purchase",
};

export const MEAL_SOURCE_OPTIONS: Array<{
  id: MealSource;
  title: string;
  subtitle: string;
}> = [
  {
    id: "delivered_by_us",
    title: MEAL_SOURCE_LABELS.delivered_by_us,
    subtitle: "We cook or plate on site — preparer PIN attest",
  },
  {
    id: "packed",
    title: MEAL_SOURCE_LABELS.packed,
    subtitle: "Packed from centre — preparer PIN attest",
  },
  {
    id: "purchase",
    title: MEAL_SOURCE_LABELS.purchase,
    subtitle: "Corner shop / takeaway orders",
  },
  {
    id: "venue_provided",
    title: MEAL_SOURCE_LABELS.venue_provided,
    subtitle: "Hotel, café, sit-down venue meal",
  },
  {
    id: "own_food",
    title: MEAL_SOURCE_LABELS.own_food,
    subtitle: "Client / family brought food — no menu required",
  },
];

export function mealSourceNeedsMenu(source: MealSource): boolean {
  return source !== "own_food";
}

export function mealSourceNeedsPreparer(source: MealSource): boolean {
  return source === "delivered_by_us" || source === "packed";
}

/** Prep checklist applies only when we cook/pack (same gate as preparer). */
export function mealSourceNeedsPrepChecks(source: MealSource): boolean {
  return mealSourceNeedsPreparer(source);
}

/**
 * When `requiredLabels` is empty → high-trust (no ticks).
 * Otherwise completed labels must match the required set (order-independent).
 */
export function validateMealPrepChecks(
  source: MealSource,
  requiredLabels: string[],
  completed: string[],
): string | null {
  if (!mealSourceNeedsPrepChecks(source)) return null;
  const required = requiredLabels.map((l) => l.trim()).filter(Boolean);
  if (required.length === 0) return null;
  const done = new Set(completed.map((l) => l.trim()).filter(Boolean));
  const missing = required.filter((l) => !done.has(l));
  if (missing.length > 0) {
    return `Confirm all prep checks (${done.size}/${required.length} done).`;
  }
  return null;
}

export function validateMealPrepAttestation(
  source: MealSource,
  attestation: MealPrepAttestation | null | undefined,
  preparedByStaffId: string | null,
): string | null {
  if (!mealSourceNeedsPreparer(source)) return null;
  if (!attestation) {
    return "Prep attestation required — preparer PIN or Manager guest override.";
  }
  if (!attestation.attestedByStaffId) {
    return "Attesting staff is required.";
  }
  if (!/^\d{4,6}$/.test(attestation.pin ?? "")) {
    return "Valid attestation PIN required.";
  }
  if (attestation.mode === "preparer_pin") {
    if (!preparedByStaffId) {
      return "Select the staff preparer before PIN attestation.";
    }
    if (attestation.attestedByStaffId !== preparedByStaffId) {
      return "Preparer PIN must match the nominated kitchen lead.";
    }
    return null;
  }
  if (attestation.mode === "manager_guest_override") {
    if ((attestation.guestPreparerName ?? "").trim().length < 2) {
      return "Enter the guest preparer’s name (at least 2 characters).";
    }
    if ((attestation.overrideNote ?? "").trim().length < 10) {
      return "Manager override — add at least 10 characters explaining why you are attesting for a guest.";
    }
    return null;
  }
  return "Unknown attestation mode.";
}

export function validateMealOpenPayload(
  p: MealOpenPayload,
  requiredPrepLabels: string[] = [],
): string | null {
  if (mealSourceNeedsMenu(p.mealSource)) {
    const menu = (p.menuNotes ?? "").trim();
    if (menu.length < 3) {
      return "Enter what the meal is / was (at least 3 characters).";
    }
  }
  if (mealSourceNeedsPreparer(p.mealSource)) {
    const mode = p.prepAttestation?.mode;
    if (mode === "manager_guest_override") {
      // Guest path — staff preparer not required; SFH n/a.
    } else if (!p.preparedByStaffId) {
      return "Select who prepared / led the kitchen for this meal.";
    } else if (
      p.preparerCertStatus === "warn_missing" ||
      p.preparerCertStatus === "warn_expired"
    ) {
      const appr = p.sfhManagerApproval;
      if (!appr?.managerStaffId) {
        return "Safe Food Handling gap — Manager on Duty must approve.";
      }
      if ((appr.note ?? "").trim().length < 10) {
        return "Manager SFH approval — add at least 10 characters of justification.";
      }
      if (!/^\d{4,6}$/.test(appr.pin ?? "")) {
        return "Manager SFH approval PIN required.";
      }
    }
    const attErr = validateMealPrepAttestation(
      p.mealSource,
      p.prepAttestation,
      p.preparedByStaffId,
    );
    if (attErr) return attErr;
  }
  return validateMealPrepChecks(
    p.mealSource,
    requiredPrepLabels,
    p.prepChecksCompleted ?? [],
  );
}

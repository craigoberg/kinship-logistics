/**
 * BL-073 — server-side re-verify of meal prep PIN attestation.
 * PIN is never persisted.
 */
import { verifyCoordinatorPin, verifyStaffPin } from "@/lib/data-store";
import {
  mealSourceNeedsPreparer,
  type MealOpenPayload,
  type MealPrepAttestation,
} from "@/lib/meal-open";

export async function assertMealSfhManagerApproval(
  mealOpen: MealOpenPayload,
): Promise<void> {
  if (
    mealOpen.preparerCertStatus !== "warn_missing" &&
    mealOpen.preparerCertStatus !== "warn_expired"
  ) {
    return;
  }
  const appr = mealOpen.sfhManagerApproval;
  if (!appr?.managerStaffId) {
    throw new Error("Safe Food Handling gap — Manager on Duty must approve.");
  }
  try {
    const ok = await verifyCoordinatorPin(appr.managerStaffId, appr.pin);
    if (!ok) throw new Error("Incorrect manager PIN for SFH approval.");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Incorrect")) throw e;
    throw e instanceof Error
      ? e
      : new Error("Manager SFH PIN verification failed.");
  }
}

export async function assertMealPrepAttestationPin(
  mealOpen: MealOpenPayload,
): Promise<MealPrepAttestation | null> {
  if (!mealSourceNeedsPreparer(mealOpen.mealSource)) return null;
  await assertMealSfhManagerApproval(mealOpen);
  const att = mealOpen.prepAttestation;
  if (!att) throw new Error("Prep attestation required.");

  if (att.mode === "preparer_pin") {
    if (!mealOpen.preparedByStaffId) {
      throw new Error("Select the staff preparer before PIN attestation.");
    }
    if (att.attestedByStaffId !== mealOpen.preparedByStaffId) {
      throw new Error("Preparer PIN must match the nominated kitchen lead.");
    }
    const ok = await verifyStaffPin(att.attestedByStaffId, att.pin);
    if (!ok) throw new Error("Incorrect preparer PIN.");
    return att;
  }

  if (att.mode === "manager_guest_override") {
    try {
      const ok = await verifyCoordinatorPin(att.attestedByStaffId, att.pin);
      if (!ok) throw new Error("Incorrect manager PIN.");
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Incorrect")) throw e;
      throw e instanceof Error
        ? e
        : new Error("Manager PIN verification failed.");
    }
    return att;
  }

  throw new Error("Unknown attestation mode.");
}

/** Columns to persist (no PIN). */
export function mealPrepAttestationPatch(mealOpen: MealOpenPayload): {
  prep_attestation_mode: string | null;
  prep_attested_by_staff_id: string | null;
  guest_preparer_name: string | null;
  prep_attestation_note: string | null;
  sfh_approved_by_staff_id: string | null;
} {
  const sfhApprovedBy =
    mealOpen.preparerCertStatus === "warn_missing" ||
    mealOpen.preparerCertStatus === "warn_expired"
      ? mealOpen.sfhManagerApproval?.managerStaffId ?? null
      : null;

  if (!mealSourceNeedsPreparer(mealOpen.mealSource) || !mealOpen.prepAttestation) {
    return {
      prep_attestation_mode: null,
      prep_attested_by_staff_id: null,
      guest_preparer_name: null,
      prep_attestation_note: null,
      sfh_approved_by_staff_id: sfhApprovedBy,
    };
  }
  const att = mealOpen.prepAttestation;
  return {
    prep_attestation_mode: att.mode,
    prep_attested_by_staff_id: att.attestedByStaffId,
    guest_preparer_name:
      att.mode === "manager_guest_override"
        ? att.guestPreparerName?.trim() || null
        : null,
    prep_attestation_note:
      att.mode === "manager_guest_override"
        ? att.overrideNote?.trim() || null
        : null,
    sfh_approved_by_staff_id: sfhApprovedBy,
  };
}

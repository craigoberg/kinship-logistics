/**
 * One human, several hats. Client, Staff, Volunteer, and Carer.
 * Driver, food prep, and floor leader are duties, not hats.
 * System access level (Manager, Support Worker, Driver, …) is not a hat.
 *
 * A volunteer hat is personnel_type containing "volunteer".
 * A job title that says Driver or Food prep does not change the hat.
 * A blank personnel_type may still read Volunteer from the title (older rows).
 */

export const PERSON_HATS = [
  { key: "client", label: "Client" },
  { key: "staff", label: "Staff" },
  { key: "volunteer", label: "Volunteer" },
  { key: "carer", label: "Carer" },
] as const;

export type PersonHat = (typeof PERSON_HATS)[number]["key"];

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function personHatLabel(hat: PersonHat): string {
  return PERSON_HATS.find((h) => h.key === hat)?.label ?? hat;
}

/** Workforce hat from the staff register. Not "any row in staff_registry is staff". */
export function workforceHat(
  personnelType: string | null | undefined,
  roleTitle?: string | null,
): "staff" | "volunteer" {
  const access = norm(personnelType);
  if (access.includes("volunteer")) return "volunteer";
  if (access) return "staff";
  if (norm(roleTitle).includes("volunteer")) return "volunteer";
  return "staff";
}

export function isVolunteerHat(
  personnelType: string | null | undefined,
  roleTitle?: string | null,
): boolean {
  return workforceHat(personnelType, roleTitle) === "volunteer";
}

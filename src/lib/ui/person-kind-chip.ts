/**
 * Who-is-who chips. Soft outline fills so they stay labels.
 * Floor amber / green / blue / red and RYGE stay for actions and health.
 */
import { classifyWorkforceKind } from "@/lib/support-person";
import type { PersonHat } from "@/lib/person-hats";

export type PersonKindChip = "participant" | "guest" | "staff" | "volunteer" | "carer";

export const PERSON_KIND_LABEL: Record<PersonKindChip, string> = {
  participant: "Participant",
  guest: "Guest",
  staff: "Staff",
  volunteer: "Volunteer",
  carer: "Carer",
};

/** Outline chip: border, soft fill, matching text. Light and dark. */
export const PERSON_KIND_CHIP_CLASS: Record<PersonKindChip, string> = {
  participant:
    "border-sky-600/50 bg-sky-500/15 text-sky-900 dark:border-sky-400/50 dark:bg-sky-500/20 dark:text-sky-100",
  guest:
    "border-sky-600/50 bg-sky-500/15 text-sky-900 dark:border-sky-400/50 dark:bg-sky-500/20 dark:text-sky-100",
  staff:
    "border-violet-600/50 bg-violet-500/15 text-violet-900 dark:border-violet-400/50 dark:bg-violet-500/20 dark:text-violet-100",
  volunteer:
    "border-teal-600/50 bg-teal-500/15 text-teal-900 dark:border-teal-400/50 dark:bg-teal-500/20 dark:text-teal-100",
  carer:
    "border-rose-600/50 bg-rose-500/15 text-rose-900 dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-100",
};

/** Forced light row (amber, slate, solid green) inside a dark theme. */
export const PERSON_KIND_CHIP_ON_LIGHT: Record<PersonKindChip, string> = {
  participant: "border-sky-700/50 bg-sky-100 text-sky-950",
  guest: "border-sky-700/50 bg-sky-100 text-sky-950",
  staff: "border-violet-700/50 bg-violet-100 text-violet-950",
  volunteer: "border-teal-700/50 bg-teal-100 text-teal-950",
  carer: "border-rose-700/50 bg-rose-100 text-rose-950",
};

/** Same hue when the word sits in a sentence instead of a chip. */
export const PERSON_KIND_TEXT_CLASS: Record<PersonKindChip, string> = {
  participant: "text-sky-800 dark:text-sky-200",
  guest: "text-sky-800 dark:text-sky-200",
  staff: "text-violet-800 dark:text-violet-200",
  volunteer: "text-teal-800 dark:text-teal-200",
  carer: "text-rose-800 dark:text-rose-200",
};

export const PERSON_KIND_TEXT_ON_LIGHT: Record<PersonKindChip, string> = {
  participant: "text-sky-950",
  guest: "text-sky-950",
  staff: "text-violet-950",
  volunteer: "text-teal-950",
  carer: "text-rose-950",
};

export function personKindFromLabel(label: string | null | undefined): PersonKindChip | null {
  switch ((label ?? "").trim().toLowerCase()) {
    case "participant":
    case "client":
      return "participant";
    case "guest":
      return "guest";
    case "staff":
      return "staff";
    case "volunteer":
      return "volunteer";
    case "carer":
      return "carer";
    default:
      return null;
  }
}

export function personKindFromHat(hat: PersonHat, guest = false): PersonKindChip {
  if (hat === "client") return guest ? "guest" : "participant";
  return hat;
}

export function manifestPersonKind(input: {
  participantId?: string | null;
  staffId?: string | null;
  carerId?: string | null;
  personnelType?: string | null;
  role?: string | null;
  guest?: boolean;
}): PersonKindChip | null {
  if (input.participantId) return input.guest ? "guest" : "participant";
  if (input.carerId) return "carer";
  if (input.staffId) return classifyWorkforceKind(input.personnelType, input.role);
  return null;
}

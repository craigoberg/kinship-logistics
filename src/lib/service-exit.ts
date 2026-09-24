/** Service exit — clients and staff/volunteers leave future operations; history stays. */

export const CLIENT_EXIT_REASONS = [
  { code: "ended_by_participant", label: "Ended by participant" },
  { code: "moved_provider", label: "Moved to another provider" },
  { code: "funding_ended", label: "Funding ended" },
  { code: "relocated", label: "Relocated" },
  { code: "no_longer_suitable", label: "No longer suitable" },
  { code: "deceased", label: "Deceased" },
  { code: "other", label: "Other" },
] as const;

export const STAFF_EXIT_REASONS = [
  { code: "resigned", label: "Resigned" },
  { code: "contract_ended", label: "Contract ended" },
  { code: "role_ended", label: "Role ended" },
  { code: "ceased_volunteering", label: "Ceased volunteering" },
  { code: "other", label: "Other" },
] as const;

export type ClientExitReason = (typeof CLIENT_EXIT_REASONS)[number]["code"];
export type StaffExitReason = (typeof STAFF_EXIT_REASONS)[number]["code"];

const REASON_LABELS = new Map<string, string>(
  [...CLIENT_EXIT_REASONS, ...STAFF_EXIT_REASONS].map((r) => [r.code, r.label]),
);

export function exitReasonLabel(code: string | null | undefined): string {
  const key = (code ?? "").trim();
  if (!key) return "";
  return REASON_LABELS.get(key) ?? key;
}

/** Notes (min 20) for Other, Deceased, and every reactivate. */
export function exitNotesRequired(
  reason: string | null | undefined,
  mode: "offboard" | "reactivate",
): boolean {
  if (mode === "reactivate") return true;
  const key = (reason ?? "").trim();
  return key === "other" || key === "deceased";
}

export function isDeceasedExit(reason: string | null | undefined): boolean {
  return (reason ?? "").trim() === "deceased";
}

/** Guests stay pickable until Archive guest. Exited clients leave operational screens. */
export function isOperationalParticipant(person: {
  participantKind?: string | null;
  serviceStatus?: string | null;
}): boolean {
  if (person.participantKind === "guest") return true;
  return (person.serviceStatus ?? "active") !== "exited";
}

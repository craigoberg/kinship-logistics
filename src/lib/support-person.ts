/** BL-125 — staff / volunteer / carer identity keys (not fake participants). */

export type SupportPersonKind = "staff" | "volunteer" | "carer";
export type RoutePersonKind = "participant" | SupportPersonKind;

export function classifyWorkforceKind(
  personnelType: string | null | undefined,
  role: string | null | undefined,
): "staff" | "volunteer" {
  const blob = `${personnelType ?? ""} ${role ?? ""}`.toLowerCase();
  return blob.includes("volunteer") ? "volunteer" : "staff";
}

export function supportPersonKey(kind: SupportPersonKind, id: string): string {
  return kind === "carer" ? `c:${id}` : `s:${id}`;
}

export function routePersonKey(kind: RoutePersonKind, id: string): string {
  return kind === "participant" ? id : supportPersonKey(kind, id);
}

export function parseRoutePersonKey(
  key: string,
): { kind: RoutePersonKind; id: string } {
  if (key.startsWith("c:")) return { kind: "carer", id: key.slice(2) };
  if (key.startsWith("s:")) return { kind: "staff", id: key.slice(2) };
  return { kind: "participant", id: key };
}

export function supportPersonKindLabel(kind: SupportPersonKind): string {
  if (kind === "volunteer") return "Volunteer";
  if (kind === "carer") return "Carer";
  return "Staff";
}

export type TransportRosterPerson = {
  id: string;
  name: string;
  address: string | null;
  participantId: string | null;
  staffId: string | null;
  carerId: string | null;
  personKind: RoutePersonKind;
};

export function clientRosterPerson(input: {
  participantId: string;
  name: string;
  address: string | null;
}): TransportRosterPerson {
  return {
    id: input.participantId,
    name: input.name,
    address: input.address,
    participantId: input.participantId,
    staffId: null,
    carerId: null,
    personKind: "participant",
  };
}

export function supportRosterPerson(input: {
  kind: SupportPersonKind;
  staffId?: string | null;
  carerId?: string | null;
  name: string;
  address: string | null;
}): TransportRosterPerson {
  const id =
    input.kind === "carer"
      ? supportPersonKey("carer", input.carerId ?? "")
      : supportPersonKey(input.kind, input.staffId ?? "");
  return {
    id,
    name: input.name,
    address: input.address,
    participantId: null,
    staffId: input.kind === "carer" ? null : input.staffId ?? null,
    carerId: input.kind === "carer" ? input.carerId ?? null : null,
    personKind: input.kind,
  };
}

export function rosterPersonRefs(entry: TransportRosterPerson | null | undefined): {
  participant_id: string | null;
  staff_id: string | null;
  carer_id: string | null;
} {
  if (!entry) {
    return { participant_id: null, staff_id: null, carer_id: null };
  }
  return {
    participant_id: entry.participantId,
    staff_id: entry.staffId,
    carer_id: entry.carerId,
  };
}

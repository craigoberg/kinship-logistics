import { supabase } from "@/integrations/supabase/client";

export interface OperationalIncident {
  id: string;
  incidentType: "mechanical" | "human_operational";
  severity: "sev1" | "sev2" | "sev3";
  description: string;
  vehicleId?: string;
  eventId?: string;
  reportedBy: string;
  status: "pending" | "resolved";
  createdAt: string;
  /** When it happened (operator). Falls back to createdAt when unset. */
  occurredAt: string;
  affectedParticipantIds: string[];
  assistingStaffIds: string[];
  noParticipantInvolved: boolean;
}

interface RaiseIncidentInput {
  incidentType: OperationalIncident["incidentType"];
  severity: OperationalIncident["severity"];
  description: string;
  vehicleId?: string;
  eventId?: string;
  reportedBy: string;
  /** Required for new filings — when the event actually happened. */
  occurredAt: string;
  affectedParticipantIds?: string[];
  assistingStaffIds?: string[];
  noParticipantInvolved?: boolean;
}

/**
 * Insert a new operational incident. For Sev 1 we also push a broadcast onto
 * the shared escalation-pool realtime channel so coordinator dashboards light
 * up instantly without waiting on the postgres_changes round-trip.
 */
export async function raiseOperationalIncident(
  input: RaiseIncidentInput,
): Promise<OperationalIncident> {
  const payload = {
    incident_type: input.incidentType,
    severity: input.severity,
    description: input.description,
    vehicle_id: input.vehicleId ?? null,
    event_id: input.eventId ?? null,
    reported_by: input.reportedBy,
    status: "pending" as const,
    occurred_at: input.occurredAt,
    affected_participant_ids: input.affectedParticipantIds ?? [],
    assisting_staff_ids: input.assistingStaffIds ?? [],
    // Legacy single column — first selected (nullable) for older readers.
    assisting_staff_id: input.assistingStaffIds?.[0] ?? null,
    no_participant_involved: input.noParticipantInvolved ?? false,
  };

  const { data, error } = await supabase
    .from("operational_incidents")
    .insert([payload])
    .select("*")
    .single();

  if (error) {
    console.error("[raiseOperationalIncident] insert failed", error);
    throw error;
  }

  const row = data as Record<string, unknown>;
  const createdAt = String(row.created_at ?? new Date().toISOString());
  const incident: OperationalIncident = {
    id: String(row.id),
    incidentType: row.incident_type as OperationalIncident["incidentType"],
    severity: row.severity as OperationalIncident["severity"],
    description: String(row.description ?? ""),
    vehicleId: (row.vehicle_id as string | null) ?? undefined,
    eventId: (row.event_id as string | null) ?? undefined,
    reportedBy: String(row.reported_by ?? ""),
    status: row.status as OperationalIncident["status"],
    createdAt,
    occurredAt: String(row.occurred_at ?? createdAt),
    affectedParticipantIds: Array.isArray(row.affected_participant_ids)
      ? (row.affected_participant_ids as string[])
      : [],
    assistingStaffIds: (() => {
      if (Array.isArray(row.assisting_staff_ids)) {
        return row.assisting_staff_ids as string[];
      }
      const legacy = row.assisting_staff_id as string | null;
      return legacy ? [legacy] : [];
    })(),
    noParticipantInvolved: Boolean(row.no_participant_involved),
  };

  if (incident.severity === "sev1") {
    try {
      const channel = supabase.channel("escalation-pool");
      await channel.send({
        type: "broadcast",
        event: "sev1_incident",
        payload: incident,
      });
      supabase.removeChannel(channel);
    } catch (broadcastErr) {
      console.warn("[raiseOperationalIncident] sev1 broadcast failed", broadcastErr);
    }
  }

  return incident;
}

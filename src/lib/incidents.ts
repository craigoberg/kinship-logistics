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
}

interface RaiseIncidentInput {
  incidentType: OperationalIncident["incidentType"];
  severity: OperationalIncident["severity"];
  description: string;
  vehicleId?: string;
  eventId?: string;
  reportedBy: string;
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
  const incident: OperationalIncident = {
    id: String(row.id),
    incidentType: row.incident_type as OperationalIncident["incidentType"],
    severity: row.severity as OperationalIncident["severity"],
    description: String(row.description ?? ""),
    vehicleId: (row.vehicle_id as string | null) ?? undefined,
    eventId: (row.event_id as string | null) ?? undefined,
    reportedBy: String(row.reported_by ?? ""),
    status: row.status as OperationalIncident["status"],
    createdAt: String(row.created_at ?? new Date().toISOString()),
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

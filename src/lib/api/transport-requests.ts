import { supabase } from "@/integrations/supabase/client";
import { getStaffId } from "@/lib/data-store";

export type TransportRequestStatus =
  | "requested"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface TransportRequest {
  id: string;
  participantId: string;
  requestDate: string;
  scheduledTime: string | null;
  pickupAddress: string | null;
  destinationLabel: string;
  reason: string | null;
  hoistRequired: boolean;
  status: TransportRequestStatus;
  assignedDriverStaffId: string | null;
  assignedAssetId: string | null;
  notes: string | null;
  completedSyncLogId: string | null;
  completedAt: string | null;
  createdByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
  participantName?: string;
}

interface TransportRequestRow {
  id: string;
  participant_id: string;
  request_date: string;
  scheduled_time: string | null;
  pickup_address: string | null;
  destination_label: string;
  reason: string | null;
  hoist_required: boolean;
  status: TransportRequestStatus;
  assigned_driver_staff_id: string | null;
  assigned_asset_id: string | null;
  notes: string | null;
  completed_sync_log_id: string | null;
  completed_at: string | null;
  created_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
  participants?:
    | { first_name: string; last_name: string }
    | Array<{ first_name: string; last_name: string }>
    | null;
}

function rowToRequest(r: TransportRequestRow): TransportRequest {
  const p = Array.isArray(r.participants) ? r.participants[0] : r.participants;
  const participantName = p
    ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()
    : undefined;
  return {
    id: r.id,
    participantId: r.participant_id,
    requestDate: r.request_date,
    scheduledTime: r.scheduled_time,
    pickupAddress: r.pickup_address,
    destinationLabel: r.destination_label,
    reason: r.reason,
    hoistRequired: r.hoist_required,
    status: r.status,
    assignedDriverStaffId: r.assigned_driver_staff_id,
    assignedAssetId: r.assigned_asset_id,
    notes: r.notes,
    completedSyncLogId: r.completed_sync_log_id,
    completedAt: r.completed_at,
    createdByStaffId: r.created_by_staff_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    participantName: participantName || undefined,
  };
}

export interface ListTransportRequestsArgs {
  requestDate?: string;
  status?: TransportRequestStatus | TransportRequestStatus[];
  includeCompleted?: boolean;
}

export async function listTransportRequests(
  args: ListTransportRequestsArgs = {},
): Promise<TransportRequest[]> {
  let q = supabase
    .from("transport_requests")
    .select(
      "id, participant_id, request_date, scheduled_time, pickup_address, destination_label, reason, hoist_required, status, assigned_driver_staff_id, assigned_asset_id, notes, completed_sync_log_id, completed_at, created_by_staff_id, created_at, updated_at, participants(first_name, last_name)",
    )
    .order("scheduled_time", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (args.requestDate) q = q.eq("request_date", args.requestDate);
  if (args.status) {
    const statuses = Array.isArray(args.status) ? args.status : [args.status];
    q = q.in("status", statuses);
  } else if (!args.includeCompleted) {
    q = q.not("status", "in", "(completed,cancelled)");
  }

  const { data, error } = await q;
  if (error) {
    console.error("[listTransportRequests] failed", error);
    throw error;
  }
  return ((data ?? []) as TransportRequestRow[]).map(rowToRequest);
}

export interface UpsertTransportRequestInput {
  id?: string;
  participantId: string;
  requestDate: string;
  scheduledTime?: string | null;
  pickupAddress?: string | null;
  destinationLabel: string;
  reason?: string | null;
  hoistRequired?: boolean;
  status?: TransportRequestStatus;
  assignedDriverStaffId?: string | null;
  assignedAssetId?: string | null;
  notes?: string | null;
}

export async function upsertTransportRequest(
  input: UpsertTransportRequestInput,
): Promise<TransportRequest> {
  const row = {
    participant_id: input.participantId,
    request_date: input.requestDate,
    scheduled_time: input.scheduledTime ?? null,
    pickup_address: input.pickupAddress?.trim() || null,
    destination_label: input.destinationLabel.trim(),
    reason: input.reason?.trim() || null,
    hoist_required: input.hoistRequired ?? false,
    status: input.status ?? "requested",
    assigned_driver_staff_id: input.assignedDriverStaffId ?? null,
    assigned_asset_id: input.assignedAssetId ?? null,
    notes: input.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("transport_requests")
      .update(row)
      .eq("id", input.id)
      .select(
        "id, participant_id, request_date, scheduled_time, pickup_address, destination_label, reason, hoist_required, status, assigned_driver_staff_id, assigned_asset_id, notes, completed_sync_log_id, completed_at, created_by_staff_id, created_at, updated_at, participants(first_name, last_name)",
      )
      .single();
    if (error) throw error;
    return rowToRequest(data as TransportRequestRow);
  }

  const { data, error } = await supabase
    .from("transport_requests")
    .insert({ ...row, created_by_staff_id: getStaffId() })
    .select(
      "id, participant_id, request_date, scheduled_time, pickup_address, destination_label, reason, hoist_required, status, assigned_driver_staff_id, assigned_asset_id, notes, completed_sync_log_id, completed_at, created_by_staff_id, created_at, updated_at, participants(first_name, last_name)",
    )
    .single();
  if (error) throw error;
  return rowToRequest(data as TransportRequestRow);
}

export async function completeTransportRequest(
  requestId: string,
  syncLogId: string,
): Promise<void> {
  const { error } = await supabase
    .from("transport_requests")
    .update({
      status: "completed",
      completed_sync_log_id: syncLogId,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (error) throw error;
}

export async function cancelTransportRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from("transport_requests")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
  if (error) throw error;
}

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const TRANSPORT_REQUEST_STATUS_LABELS: Record<TransportRequestStatus, string> = {
  requested: "Requested",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

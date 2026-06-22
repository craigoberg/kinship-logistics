// src/lib/api/clearance.ts
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the most recent in-flight Sev 1 escalation for the given driver,
 * or `null` when none exists.
 *
 * Escalations are stored in `operational_escalations`. That table is keyed
 * by `driver_name` (free text), NOT by a staff UUID — so we resolve the
 * driver's `full_name` from `staff_registry` first, then filter the
 * escalation pool by name + an active status (`pending` or `claimed`).
 */
export const getActiveEscalation = async (driverId: string) => {
  // 1. Resolve the driver's display name. Without it we can't match the
  //    `driver_name` column on `operational_escalations`.
  const { data: staff, error: staffError } = await supabase
    .from("staff_registry")
    .select("full_name")
    .eq("id", driverId)
    .maybeSingle();

  if (staffError) {
    console.error("[getActiveEscalation] staff lookup failed:", staffError);
    throw staffError;
  }

  const driverName = staff?.full_name;
  if (!driverName) {
    // No staff row for this id — no escalation can match.
    return null;
  }

  // 2. Look for an active escalation. The shield must stay up across THREE
  //    phases of the single-rail escalation lifecycle:
  //      • pending / claimed                           → office still working it
  //      • resolved_approved + operator_ack IS NULL    → manager approved a
  //        workaround; the driver must still confirm with their PIN before
  //        rolling. Dropping the shield here would silently close the
  //        handshake without the driver acknowledging the manager's notes.
  //
  //    `resolved_denied` and fully-acknowledged approvals fall through and
  //    return null so the manifest unblocks.
  // NOTE: each branch is wrapped in its own `and(...)` so that the comma
  // inside `status.in.(pending,claimed)` cannot collide with the top-level
  // `.or()` separator (PostgREST grouping rule).
  const { data, error } = await supabase
    .from("operational_escalations")
    .select("*")
    .eq("driver_name", driverName)
    .or(
      "and(status.eq.pending),and(status.eq.claimed),and(status.eq.resolved_approved,operator_acknowledged_at.is.null)",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getActiveEscalation] escalation query failed:", error);
    throw error;
  }

  return data;
};

/**
 * Returns true when the most recent escalation for this vehicle on `dateStr`
 * was resolved as `resolved_denied` — i.e. a manager has officially grounded
 * the bus. Used by `ClearanceGate` to block a new walkaround on a grounded
 * vehicle until the office overrides the status.
 *
 * The `operational_escalations` table does not store an `asset_id`; vehicles
 * are identified by the free-text `vehicle_info` column written by
 * `raiseOperationalEscalation` as `"${asset.name} · ${asset.regoPlate}"`.
 * Callers must pass the same composed string.
 */
export const getAssetGroundedStatus = async (
  vehicleInfo: string,
  dateStr: string,
): Promise<boolean> => {
  const { data, error } = await supabase
    .from("operational_escalations")
    .select("status")
    .eq("vehicle_info", vehicleInfo)
    .gte("created_at", dateStr)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getAssetGroundedStatus] query failed:", error);
    return false;
  }

  return data?.status === "resolved_denied";
};

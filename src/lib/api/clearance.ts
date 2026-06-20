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

  // 2. Look for an active escalation (still pending coordinator pickup or
  //    already claimed but not resolved) attached to this driver.
  const { data, error } = await supabase
    .from("operational_escalations")
    .select("*")
    .eq("driver_name", driverName)
    .in("status", ["pending", "claimed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getActiveEscalation] escalation query failed:", error);
    throw error;
  }

  return data;
};

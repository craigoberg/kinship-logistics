// src/lib/api/clearance.ts
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the most recent in-flight clearance for a driver that is still
 * awaiting manager review (i.e. an active Sev 1 escalation), or `null`
 * when none exists. Uses `asset_daily_clearance` (the per-day clearance
 * record) keyed by `driver_staff_id`.
 */
export const getActiveEscalation = async (driverId: string) => {
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .select("*")
    .eq("driver_staff_id", driverId)
    .eq("status", "awaiting_manager_review")
    .order("clearance_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getActiveEscalation] Supabase error:", error);
    throw error;
  }

  return data;
};

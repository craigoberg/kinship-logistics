// src/lib/api/clearance.ts
import { supabase } from "@/integrations/supabase/client";

export const getActiveEscalation = async (driverId: string) => {
  // Corrected: Using 'asset_clearance_items' as indicated by your Supabase error log
  const { data, error } = await supabase
    .from("asset_clearance_items")
    .select("*")
    .eq("driver_id", driverId)
    .eq("status", "ESCALATED")
    .maybeSingle();

  if (error) {
    console.error("Supabase Query Error:", error);
    throw error;
  }

  return data;
};

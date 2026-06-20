import { supabase } from "@/integrations/supabase/client";

export const getActiveEscalation = async (driverId: string) => {
  const { data, error } = await supabase
    .from("clearances") // Ensure this matches your actual table name
    .select("*")
    .eq("driver_id", driverId)
    .eq("status", "ESCALATED")
    .maybeSingle();

  if (error) throw error;
  return data;
};

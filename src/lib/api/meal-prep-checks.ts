/**
 * BL-073 — load Admin meal prep walkthrough labels.
 */
import { supabase } from "@/integrations/supabase/client";
import { MEAL_PREP_CHECKS_PARAM_KEY } from "@/lib/meal-open";

export function asStringLabelArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function fetchMealPrepCheckLabels(): Promise<string[]> {
  const { data, error } = await supabase
    .from("system_parameters")
    .select("value")
    .eq("key", MEAL_PREP_CHECKS_PARAM_KEY)
    .maybeSingle();
  if (error) throw error;
  return asStringLabelArray(data?.value);
}

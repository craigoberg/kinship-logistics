import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { writeToLedger } from "@/lib/api/ledger";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export interface SystemParameterRow {
  key: string;
  value: JsonValue;
  description: string;
  updated_by: string | null;
  updated_at: string;
}

export async function listSystemParameters(): Promise<SystemParameterRow[]> {
  const { data, error } = await supabase
    .from("system_parameters")
    .select("key, value, description, updated_by, updated_at")
    .order("key", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SystemParameterRow[];
}

export interface UpdateSystemParameterArgs {
  key: string;
  newValue: JsonValue;
  justification: string;
}

export interface UpdateSystemParameterResult {
  key: string;
  oldValue: JsonValue;
  newValue: JsonValue;
}

/**
 * Update a system parameter and append a SYSTEM_PARAMETER_UPDATED ledger row.
 * Ledger write is best-effort; the parameter write itself must succeed.
 */
export async function updateSystemParameter(
  args: UpdateSystemParameterArgs,
): Promise<UpdateSystemParameterResult> {
  const justification = args.justification.trim();
  if (justification.length < 10) {
    throw new Error("Justification must be at least 10 characters.");
  }

  // 1. Read current value for old_value capture.
  const { data: current, error: readErr } = await supabase
    .from("system_parameters")
    .select("key, value")
    .eq("key", args.key)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw new Error(`Unknown system parameter: ${args.key}`);

  const oldValue = current.value as JsonValue;

  const staffId = await resolveStaffIdWithFallback();

  // 2. Update the row.
  const { error: updErr } = await supabase
    .from("system_parameters")
    .update({
      value: args.newValue as unknown as object,
      updated_by: staffId,
      updated_at: new Date().toISOString(),
    })
    .eq("key", args.key);
  if (updErr) throw updErr;

  // 3. Audit ledger entry — best effort.
  await writeToLedger({
    staff_id: staffId,
    category: "CENTRE",
    severity: "INFO",
    action_type: "SYSTEM_PARAMETER_UPDATED",
    gps_lat: null,
    gps_lng: null,
    metadata: {
      key: args.key,
      old_value: oldValue,
      new_value: args.newValue,
      justification,
    },
  });

  return { key: args.key, oldValue, newValue: args.newValue };
}

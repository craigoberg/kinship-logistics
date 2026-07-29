import { supabase } from "@/integrations/supabase/client";
import { auditIdentity } from "./identity";

/** Resolve staff_registry ids → display names (batched). Honours BL-093 identity mode. */
export async function resolveStaffNames(
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from("staff_registry")
    .select("id, full_name")
    .in("id", unique);
  if (error) {
    console.warn("[audit-pack] staff name lookup failed", error);
    return map;
  }
  const book = auditIdentity();
  for (const row of data ?? []) {
    const r = row as { id: string; full_name?: string | null };
    const real = (r.full_name ?? "").trim() || r.id;
    map.set(r.id, book.staffLabel(r.id, real));
  }
  // Ensure codes exist even when lookup missed a row.
  for (const id of unique) {
    if (!map.has(id)) map.set(id, book.staffLabel(id, id));
  }
  return map;
}

export async function resolveParticipantNames(
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from("participants")
    .select("id, first_name, last_name")
    .in("id", unique);
  if (error) {
    console.warn("[audit-pack] participant name lookup failed", error);
    return map;
  }
  const book = auditIdentity();
  for (const row of data ?? []) {
    const r = row as { id: string; first_name?: string; last_name?: string };
    const real = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.id;
    map.set(r.id, book.participantLabel(r.id, real));
  }
  for (const id of unique) {
    if (!map.has(id)) map.set(id, book.participantLabel(id, id));
  }
  return map;
}

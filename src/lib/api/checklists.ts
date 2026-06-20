import { supabase } from "@/integrations/supabase/client";

export interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

export type ChecklistStatus = "pass" | "fail" | "na";

export interface ChecklistResponseRow {
  itemId: string;
  label: string;
  status: ChecklistStatus;
  notes: string | null;
}

/** List active checklist items for a category, ordered by sort_order then label. */
export async function listChecklistItems(
  category: string,
): Promise<ChecklistItem[]> {
  const { data, error } = await supabase
    .from("checklist_items")
    .select("id, label, category, sort_order, is_active")
    .eq("category", category)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    category: r.category as string,
    sortOrder: r.sort_order as number,
    isActive: r.is_active as boolean,
  }));
}

/** Insert one row per checklist response, keyed by the parent ledger entry. */
export async function insertChecklistResponses(
  ledgerId: string,
  rows: ChecklistResponseRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    ledger_id: ledgerId,
    item_id: r.itemId,
    status: r.status,
    notes: r.notes && r.notes.trim() !== "" ? r.notes.trim() : null,
  }));
  const { error } = await supabase.from("checklist_responses").insert(payload);
  if (error) throw error;
}

/**
 * A note that part of a trip day was run on the printed leader pack.
 * The sheet stays the record. This does not copy ticks back onto the tablet.
 */
import { supabase } from "@/integrations/supabase/client";
import { recordOfficeChange } from "@/lib/api/office-change-log";
import { getActiveUserProfile } from "@/lib/data-store";
import { isAppOnline } from "@/lib/simulated-offline";

export type PaperPackScope = "whole_day" | "roll" | "place" | "bus";

export type PaperPackNote = {
  id: string;
  createdAt: string;
  summary: string;
  sessionDate: string;
  dayNumber: number;
  scope: PaperPackScope;
  placeName: string | null;
  filedWhere: string;
};

const SCOPE_WORD: Record<PaperPackScope, string> = {
  whole_day: "the whole day",
  roll: "the roll",
  place: "a place",
  bus: "the bus",
};

export function paperPackScopeWord(scope: PaperPackScope, placeName: string | null): string {
  if (scope === "place" && placeName?.trim()) return placeName.trim();
  return SCOPE_WORD[scope];
}

export async function recordPaperPackUsed(input: {
  eventId: string;
  eventTitle: string;
  sessionDate: string;
  dayNumber: number;
  scope: PaperPackScope;
  placeName: string | null;
  filedWhere: string;
}): Promise<void> {
  if (!isAppOnline()) {
    throw new Error("Offline. Record the paper pack when the link is back.");
  }
  const who = getActiveUserProfile()?.fullName?.trim() || "The leader";
  const what = paperPackScopeWord(input.scope, input.placeName);
  const summary = `${who} recorded that Day ${input.dayNumber} of ${input.eventTitle} was run on the leader pack (${what}). Sheet filed in ${input.filedWhere.trim()}.`;
  await recordOfficeChange({
    action: "created",
    entity: "event",
    category: "TRIP",
    recordId: input.eventId,
    recordName: input.eventTitle,
    summary,
    after: {
      paper_pack: true,
      session_date: input.sessionDate.slice(0, 10),
      day_number: input.dayNumber,
      scope: input.scope,
      place_name: input.placeName?.trim() || null,
      filed_where: input.filedWhere.trim(),
    },
  });
}

export async function listPaperPackNotes(eventId: string): Promise<PaperPackNote[]> {
  const { data, error } = await supabase
    .from("operational_ledger")
    .select("id, created_at, metadata")
    .eq("action_type", "OFFICE_RECORD_CHANGED")
    .filter("metadata->>record_id", "eq", eventId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  const notes: PaperPackNote[] = [];
  for (const row of data ?? []) {
    const record = row as { id: string; created_at: string; metadata?: Record<string, unknown> | null };
    const meta = record.metadata ?? {};
    const after = (meta.after ?? null) as Record<string, unknown> | null;
    if (!after || after.paper_pack !== true) continue;
    const scope = after.scope;
    if (scope !== "whole_day" && scope !== "roll" && scope !== "place" && scope !== "bus") continue;
    notes.push({
      id: record.id,
      createdAt: record.created_at,
      summary: typeof meta.summary === "string" ? meta.summary : "Paper pack was used",
      sessionDate: String(after.session_date ?? "").slice(0, 10),
      dayNumber: Number(after.day_number ?? 0),
      scope,
      placeName: typeof after.place_name === "string" ? after.place_name : null,
      filedWhere: typeof after.filed_where === "string" ? after.filed_where : "",
    });
  }
  return notes;
}

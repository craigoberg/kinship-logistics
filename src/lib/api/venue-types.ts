/**
 * Admin list of venue types. venues.venue_type stores `code`.
 * Hotel stays the overnight type (isAccommodationVenueType).
 */
import { supabase } from "@/integrations/supabase/client";
import { operationalNowIso } from "@/lib/operational-clock";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

export type VenueTypeStatus = "active" | "archived";

export interface VenueType {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  status: VenueTypeStatus;
}

export interface VenueTypeCatalog {
  types: VenueType[];
  /** False until docs/sql/2026-10-14_venue_types.sql has been applied. */
  fromDatabase: boolean;
}

/** Codes the overnight rule already understands. Do not archive these. */
export const OVERNIGHT_VENUE_TYPE_CODES = new Set(["hotel", "accommodation"]);

export const BUILTIN_VENUE_TYPES: VenueType[] = [
  { id: "builtin-general", code: "general", label: "General", sort_order: 10, status: "active" },
  { id: "builtin-park", code: "park", label: "Park / outdoor", sort_order: 20, status: "active" },
  { id: "builtin-hotel", code: "hotel", label: "Hotel / accommodation", sort_order: 30, status: "active" },
  { id: "builtin-cinema", code: "cinema", label: "Cinema / theatre", sort_order: 40, status: "active" },
  { id: "builtin-museum", code: "museum", label: "Museum / gallery", sort_order: 50, status: "active" },
  { id: "builtin-sports", code: "sports", label: "Sports / recreation", sort_order: 60, status: "active" },
  { id: "builtin-restaurant", code: "restaurant", label: "Restaurant / café", sort_order: 70, status: "active" },
  { id: "builtin-shopping", code: "shopping", label: "Shopping centre", sort_order: 80, status: "active" },
  { id: "builtin-club", code: "club", label: "Club / social venue", sort_order: 90, status: "active" },
];

const SQL_HINT = "Run docs/sql/2026-10-14_venue_types.sql in the database, then try again.";

/** Name shown on an itinerary line. The stored snapshot wins over today's name. */
export function stopVenueTypeName(
  stop: { venue_type_label?: string | null; venue_type?: string | null },
  types?: VenueType[],
): string {
  const frozen = stop.venue_type_label?.trim();
  if (frozen) return frozen;
  return venueTypeLabel(types, stop.venue_type);
}

export function venueTypeLabel(
  types: VenueType[] | undefined,
  code: string | null | undefined,
): string {
  const c = (code ?? "").trim();
  if (!c) return "";
  return (
    types?.find((t) => t.code === c)?.label ??
    BUILTIN_VENUE_TYPES.find((t) => t.code === c)?.label ??
    c
  );
}

export function venueTypeCodeFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "type";
}

function uniqueCode(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function mapRow(row: {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  status: string;
}): VenueType {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    sort_order: row.sort_order,
    status: row.status === "archived" ? "archived" : "active",
  };
}

export async function listVenueTypes(): Promise<VenueTypeCatalog> {
  const { data, error } = await supabase
    .from("venue_types")
    .select("id, code, label, sort_order, status")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) {
    if (isSchemaMismatchError(error)) {
      return { types: BUILTIN_VENUE_TYPES, fromDatabase: false };
    }
    throw new Error(error.message);
  }
  return { types: (data ?? []).map(mapRow), fromDatabase: true };
}

async function assertManager(): Promise<void> {
  const allowed = await canManageSystemParameters();
  if (!allowed) throw new Error("Only Managers can change venue types.");
}

export async function createVenueType(label: string): Promise<VenueType> {
  await assertManager();
  const trimmed = label.trim();
  if (trimmed.length < 2) throw new Error("Venue type name needs at least 2 characters.");

  const existing = await listVenueTypes();
  if (!existing.fromDatabase) throw new Error(SQL_HINT);

  const taken = new Set(existing.types.map((t) => t.code));
  const code = uniqueCode(venueTypeCodeFromLabel(trimmed), taken);
  const sort_order =
    existing.types.reduce((max, t) => Math.max(max, t.sort_order), 0) + 10;
  const now = operationalNowIso();

  const { data, error } = await supabase
    .from("venue_types")
    .insert({ code, label: trimmed, sort_order, status: "active", created_at: now, updated_at: now })
    .select("id, code, label, sort_order, status")
    .single();
  if (error) {
    if (isSchemaMismatchError(error)) throw new Error(SQL_HINT);
    throw new Error(error.message);
  }
  const row = mapRow(data);
  void recordOfficeChangeBestEffort({
    action: "created",
    entity: "venue_type",
    recordId: row.id,
    recordName: row.label,
    summary: `Added venue type ${row.label}`,
    after: { code: row.code, label: row.label },
  });
  return row;
}

export async function updateVenueTypeLabel(id: string, label: string): Promise<VenueType> {
  await assertManager();
  const trimmed = label.trim();
  if (trimmed.length < 2) throw new Error("Venue type name needs at least 2 characters.");
  if (id.startsWith("builtin-")) throw new Error(SQL_HINT);

  const { data: before, error: readErr } = await supabase
    .from("venue_types")
    .select("id, code, label, sort_order, status")
    .eq("id", id)
    .single();
  if (readErr) throw new Error(readErr.message);

  const { data, error } = await supabase
    .from("venue_types")
    .update({ label: trimmed, updated_at: operationalNowIso() })
    .eq("id", id)
    .select("id, code, label, sort_order, status")
    .single();
  if (error) throw new Error(error.message);
  const row = mapRow(data);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "venue_type",
    recordId: row.id,
    recordName: row.label,
    summary: `Renamed venue type to ${row.label}. Itinerary lines already saved keep the old name.`,
    before: { label: (before as VenueType).label },
    after: { label: row.label },
  });
  return row;
}

export async function setVenueTypeStatus(id: string, status: VenueTypeStatus): Promise<void> {
  await assertManager();
  if (id.startsWith("builtin-")) throw new Error(SQL_HINT);

  const { data: before, error: readErr } = await supabase
    .from("venue_types")
    .select("id, code, label, status")
    .eq("id", id)
    .single();
  if (readErr) throw new Error(readErr.message);
  const prior = before as { code: string; label: string; status: string };
  if (status === "archived" && OVERNIGHT_VENUE_TYPE_CODES.has(prior.code)) {
    throw new Error("Hotel / accommodation is the overnight type and stays on the list.");
  }

  const { error } = await supabase
    .from("venue_types")
    .update({ status, updated_at: operationalNowIso() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  void recordOfficeChangeBestEffort({
    action: status === "archived" ? "archived" : "updated",
    entity: "venue_type",
    recordId: id,
    recordName: prior.label,
    summary:
      status === "archived"
        ? `Archived venue type ${prior.label}`
        : `Restored venue type ${prior.label}`,
    before: { status: prior.status },
    after: { status },
  });
}

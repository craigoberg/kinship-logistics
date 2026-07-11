/**
 * Maintenance & Repairs API
 *
 * Covers maintenance_items + maintenance_notes — physical repair tasks,
 * equipment faults, and venue defects that need follow-up after a RYGE log.
 *
 * SQL: docs/sql/2026-07-11_maintenance_items.sql
 *      docs/sql/2026-07-11_maintenance_items_v2.sql
 */
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MaintenanceSeverity = "green" | "yellow" | "red";
export type MaintenanceStatus =
  | "open"
  | "in_progress"
  | "deferred"
  | "resolved"
  | "closed";
export type MaintenanceSource =
  | "venue_issue"    // Venue walkround (Log Venue Issue on an event trip)
  | "centre_issue"   // Day Centre walkround (site-day LogAnomalyModal)
  | "vehicle_issue"  // Bus / Vehicle pre-trip walkround (IssueAccumulatorPanel)
  | "incident_fault" // Big Red Button → Equipment & Asset lane
  | "manual";        // Manually added from Maintenance HUB tab

export interface MaintenanceItem {
  id: string;
  title: string;
  description: string;
  severity: MaintenanceSeverity;
  status: MaintenanceStatus;
  source: MaintenanceSource;
  sourceRefId: string | null;
  venueId: string | null;
  eventId: string | null;
  locationLabel: string | null;
  reportedBy: string | null;
  assignedTo: string | null;
  resolutionNotes: string | null;
  deferredUntil: string | null;
  deferredReason: string | null;
  deferCount: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceNote {
  id: string;
  itemId: string;
  noteText: string;
  author: string | null;
  createdAt: string;
}

export interface NewMaintenanceItem {
  title: string;
  description: string;
  severity?: MaintenanceSeverity;
  source?: MaintenanceSource;
  sourceRefId?: string | null;
  venueId?: string | null;
  eventId?: string | null;
  locationLabel?: string | null;
  reportedBy?: string | null;
}

// ── Row → domain mappers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToItem(r: Record<string, any>): MaintenanceItem {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    severity: r.severity as MaintenanceSeverity,
    status: r.status as MaintenanceStatus,
    source: r.source as MaintenanceSource,
    sourceRefId: r.source_ref_id ?? null,
    venueId: r.venue_id ?? null,
    eventId: r.event_id ?? null,
    locationLabel: r.location_label ?? null,
    reportedBy: r.reported_by ?? null,
    assignedTo: r.assigned_to ?? null,
    resolutionNotes: r.resolution_notes ?? null,
    deferredUntil: r.deferred_until ?? null,
    deferredReason: r.deferred_reason ?? null,
    deferCount: r.defer_count ?? 0,
    resolvedAt: r.resolved_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToNote(r: Record<string, any>): MaintenanceNote {
  return {
    id: r.id,
    itemId: r.item_id,
    noteText: r.note_text,
    author: r.author ?? null,
    createdAt: r.created_at,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a note as a single monospace timeline line (matching hub_issue_notes style). */
export function renderMaintenanceNote(n: MaintenanceNote): string {
  const dt = new Date(n.createdAt).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `[${dt}${n.author ? ` · ${n.author}` : ""}] ${n.noteText}`;
}

/**
 * Returns true if a deferred item should be shown on the Active tab
 * because its deferred_until date has passed.
 */
export function isDeferredItemOverdue(item: MaintenanceItem): boolean {
  if (item.status !== "deferred" || !item.deferredUntil) return false;
  return new Date(item.deferredUntil) <= new Date();
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Active   — open + in_progress + deferred items whose date has passed
 * Deferred — deferred items whose date is still in the future
 * Resolved — resolved + closed
 * All      — no filter
 */
export type MaintenanceTabFilter = "active" | "deferred" | "resolved" | "all";

export interface ListMaintenanceItemsArgs {
  tab?: MaintenanceTabFilter;
  severity?: MaintenanceSeverity;
  source?: MaintenanceSource;
  eventId?: string;
}

export async function listMaintenanceItems(
  args: ListMaintenanceItemsArgs = {},
): Promise<MaintenanceItem[]> {
  // Fetch broadly; tab filtering is done client-side so overdue deferrals
  // surface on the Active tab without a server-side date comparison.
  let q = supabase
    .from("maintenance_items")
    .select(
      "id, title, description, severity, status, source, source_ref_id, venue_id, event_id, location_label, reported_by, assigned_to, resolution_notes, deferred_until, deferred_reason, defer_count, resolved_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  // Pre-filter server-side where unambiguous
  if (args.tab === "resolved") {
    q = q.in("status", ["resolved", "closed"]);
  } else if (args.tab === "all") {
    // no status filter
  } else {
    // active + deferred — fetch both, sort client-side
    q = q.not("status", "in", '("resolved","closed")');
  }

  if (args.severity) q = q.eq("severity", args.severity);
  if (args.source) q = q.eq("source", args.source);
  if (args.eventId) q = q.eq("event_id", args.eventId);

  const { data, error } = await q;
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data ?? []).map((r) => rowToItem(r as Record<string, any>));

  // Client-side tab split
  if (args.tab === "active") {
    return items.filter(
      (i) =>
        i.status === "open" ||
        i.status === "in_progress" ||
        isDeferredItemOverdue(i),
    );
  }
  if (args.tab === "deferred") {
    return items.filter(
      (i) => i.status === "deferred" && !isDeferredItemOverdue(i),
    );
  }

  return items;
}

export async function listMaintenanceNotes(
  itemId: string,
): Promise<MaintenanceNote[]> {
  const { data, error } = await supabase
    .from("maintenance_notes")
    .select("id, item_id, note_text, author, created_at")
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r) => rowToNote(r as Record<string, any>));
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createMaintenanceItem(
  item: NewMaintenanceItem,
): Promise<MaintenanceItem> {
  const { data, error } = await supabase
    .from("maintenance_items")
    .insert({
      title: item.title,
      description: item.description,
      severity: item.severity ?? "yellow",
      source: item.source ?? "manual",
      source_ref_id: item.sourceRefId ?? null,
      venue_id: item.venueId ?? null,
      event_id: item.eventId ?? null,
      location_label: item.locationLabel ?? null,
      reported_by: item.reportedBy ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rowToItem(data as Record<string, any>);
}

export async function addMaintenanceNote(
  itemId: string,
  noteText: string,
  author?: string,
): Promise<MaintenanceNote> {
  const { data, error } = await supabase
    .from("maintenance_notes")
    .insert({ item_id: itemId, note_text: noteText, author: author ?? null })
    .select()
    .single();
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rowToNote(data as Record<string, any>);
}

export async function updateMaintenanceStatus(
  id: string,
  status: MaintenanceStatus,
  resolutionNotes?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (resolutionNotes !== undefined) patch.resolution_notes = resolutionNotes;
  if (status === "resolved" || status === "closed") {
    patch.resolved_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("maintenance_items")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deferMaintenanceItem(
  id: string,
  untilDate: string,
  reason: string,
  author?: string,
): Promise<void> {
  // Increment defer_count + set defer fields
  const { data: current, error: fetchErr } = await supabase
    .from("maintenance_items")
    .select("defer_count")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const newCount = ((current as { defer_count?: number } | null)?.defer_count ?? 0) + 1;

  const { error } = await supabase
    .from("maintenance_items")
    .update({
      status: "deferred",
      deferred_until: untilDate,
      deferred_reason: reason,
      defer_count: newCount,
    })
    .eq("id", id);
  if (error) throw error;

  // Also log a note so the timeline shows the defer action
  await addMaintenanceNote(
    id,
    `Deferred to ${untilDate}. Reason: ${reason}`,
    author,
  );
}

export async function assignMaintenanceItem(
  id: string,
  assignedTo: string,
): Promise<void> {
  const { error } = await supabase
    .from("maintenance_items")
    .update({ assigned_to: assignedTo, status: "in_progress" })
    .eq("id", id);
  if (error) throw error;
}

// ── Query key ─────────────────────────────────────────────────────────────────

export const MAINTENANCE_ITEMS_KEY = ["maintenance-items"] as const;
export const maintenanceNotesKey = (itemId: string) =>
  ["maintenance-notes", itemId] as const;

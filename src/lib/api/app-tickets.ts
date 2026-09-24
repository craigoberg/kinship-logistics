/**
 * App tickets API — BL-116
 *
 * Dedicated register for in-app support notes (TEST + PROD).
 * Not operational_incidents / maintenance_items.
 */
import { supabase } from "@/integrations/supabase/client";
import { operationalNowIso } from "@/lib/operational-clock";
import { formatDate, formatDateTime } from "@/lib/utils";

export type AppTicketStatus =
  | "open"
  | "in_progress"
  | "deferred"
  | "resolved"
  | "closed";

export type AppTicketTabFilter = "active" | "deferred" | "resolved" | "all";

export interface AppTicketContext {
  path: string;
  pathLabel: string;
  formTitle: string | null;
  lastControlLabel: string | null;
  staffId: string | null;
  staffName: string;
  role: string | null;
  staffRole: string | null;
  eventId?: string;
  eventTitle?: string;
  eventDaySessionId?: string;
  siteDaySessionId?: string;
  siteDayPhase?: string;
  vehicleId?: string;
  lane: string;
  simClock: boolean;
  operationalNow: string;
  userAgent: string;
}

export interface AppTicket {
  id: string;
  title: string;
  description: string;
  status: AppTicketStatus;
  reportedByStaffId: string | null;
  reportedByName: string;
  pathLabel: string;
  formTitle: string | null;
  lastControlLabel: string | null;
  context: AppTicketContext | Record<string, unknown>;
  resolutionNotes: string | null;
  deferredUntil: string | null;
  deferredReason: string | null;
  deferCount: number;
  resolvedAt: string | null;
  resolvedByName: string | null;
  lastNoteAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppTicketNote {
  id: string;
  ticketId: string;
  noteText: string;
  author: string | null;
  createdAt: string;
}

export interface NewAppTicket {
  title: string;
  description: string;
  reportedByStaffId?: string | null;
  reportedByName: string;
  pathLabel: string;
  formTitle?: string | null;
  lastControlLabel?: string | null;
  context: AppTicketContext | Record<string, unknown>;
}

function rowToTicket(r: Record<string, unknown>): AppTicket {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    description: String(r.description ?? ""),
    status: r.status as AppTicketStatus,
    reportedByStaffId: r.reported_by_staff_id ? String(r.reported_by_staff_id) : null,
    reportedByName: String(r.reported_by_name ?? "Unknown staff"),
    pathLabel: String(r.path_label ?? ""),
    formTitle: r.form_title ? String(r.form_title) : null,
    lastControlLabel: r.last_control_label ? String(r.last_control_label) : null,
    context: (r.context_json as AppTicketContext | Record<string, unknown>) ?? {},
    resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : null,
    deferredUntil: r.deferred_until ? String(r.deferred_until) : null,
    deferredReason: r.deferred_reason ? String(r.deferred_reason) : null,
    deferCount: Number(r.defer_count ?? 0),
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
    lastNoteAt: r.last_note_at ? String(r.last_note_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToNote(r: Record<string, unknown>): AppTicketNote {
  return {
    id: String(r.id),
    ticketId: String(r.ticket_id),
    noteText: String(r.note_text ?? ""),
    author: r.author ? String(r.author) : null,
    createdAt: String(r.created_at),
  };
}

export function renderAppTicketNote(n: AppTicketNote): string {
  const dt = formatDateTime(n.createdAt);
  return `[${dt}${n.author ? ` · ${n.author}` : ""}] ${n.noteText}`;
}

export function isDeferredTicketVisible(
  ticket: AppTicket,
  deferRewarnMs = 0,
): boolean {
  if (ticket.status !== "deferred" || !ticket.deferredUntil) return false;
  const deferMs = new Date(ticket.deferredUntil).getTime();
  const now = Date.now();
  return now >= deferMs || deferMs - now <= deferRewarnMs;
}

export async function listAppTickets(
  tab: AppTicketTabFilter = "active",
): Promise<AppTicket[]> {
  let q = supabase
    .from("app_tickets")
    .select(
      "id, title, description, status, reported_by_staff_id, reported_by_name, path_label, form_title, last_control_label, context_json, resolution_notes, deferred_until, deferred_reason, defer_count, resolved_at, resolved_by_name, last_note_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (tab === "resolved") {
    q = q.in("status", ["resolved", "closed"]);
  } else if (tab !== "all") {
    q = q.not("status", "in", '("resolved","closed")');
  }

  const { data, error } = await q;
  if (error) throw error;

  const items = (data ?? []).map((r) => rowToTicket(r as Record<string, unknown>));

  if (tab === "active") {
    return items.filter(
      (t) =>
        t.status === "open" ||
        t.status === "in_progress" ||
        isDeferredTicketVisible(t),
    );
  }
  if (tab === "deferred") {
    return items.filter((t) => t.status === "deferred" && !isDeferredTicketVisible(t));
  }
  return items;
}

export async function listAppTicketNotes(ticketId: string): Promise<AppTicketNote[]> {
  const { data, error } = await supabase
    .from("app_ticket_notes")
    .select("id, ticket_id, note_text, author, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowToNote(r as Record<string, unknown>));
}

export async function createAppTicket(input: NewAppTicket): Promise<AppTicket> {
  const payload = {
    title: input.title,
    description: input.description,
    status: "open",
    reported_by_staff_id: input.reportedByStaffId ?? null,
    reported_by_name: input.reportedByName,
    path_label: input.pathLabel,
    form_title: input.formTitle ?? null,
    last_control_label: input.lastControlLabel ?? null,
    context_json: input.context,
    defer_count: 0,
  };

  const { data, error } = await supabase
    .from("app_tickets")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return rowToTicket(data as Record<string, unknown>);
}

export async function addAppTicketNote(
  ticketId: string,
  noteText: string,
  author?: string,
): Promise<AppTicketNote> {
  const { data, error } = await supabase
    .from("app_ticket_notes")
    .insert({
      ticket_id: ticketId,
      note_text: noteText,
      author: author ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase
    .from("app_tickets")
    .update({ last_note_at: operationalNowIso() })
    .eq("id", ticketId)
    .then(() => null);

  return rowToNote(data as Record<string, unknown>);
}

export async function updateAppTicketStatus(
  id: string,
  status: AppTicketStatus,
  extras?: {
    resolutionNotes?: string;
    resolvedByName?: string;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (extras?.resolutionNotes !== undefined) {
    patch.resolution_notes = extras.resolutionNotes;
  }
  if (status === "resolved" || status === "closed") {
    patch.resolved_at = operationalNowIso();
    if (extras?.resolvedByName) patch.resolved_by_name = extras.resolvedByName;
  }
  const { error } = await supabase.from("app_tickets").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deferAppTicket(
  id: string,
  untilDate: string,
  reason: string,
  author?: string,
): Promise<void> {
  const { data: current, error: fetchErr } = await supabase
    .from("app_tickets")
    .select("defer_count")
    .eq("id", id)
    .single();
  if (fetchErr) throw fetchErr;

  const newCount = ((current as { defer_count?: number } | null)?.defer_count ?? 0) + 1;

  const { error } = await supabase
    .from("app_tickets")
    .update({
      status: "deferred",
      deferred_until: untilDate,
      deferred_reason: reason,
      defer_count: newCount,
    })
    .eq("id", id);
  if (error) throw error;

  await addAppTicketNote(
    id,
    `Deferred to ${formatDate(untilDate)}. Reason: ${reason}`,
    author,
  );
}

export const APP_TICKETS_KEY = ["app-tickets"] as const;
export const appTicketNotesKey = (ticketId: string) =>
  ["app-ticket-notes", ticketId] as const;

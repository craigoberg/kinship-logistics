import { supabase } from "@/integrations/supabase/client";
import { formatDateWithWeekday } from "@/lib/utils";

/** Why a guest is still on the Participants list, and the Hub issue if one was raised. */
export interface GuestDirectoryContext {
  participantId: string;
  line: string;
  issueId: string | null;
}

interface BookingHit {
  participantId: string;
  eventTitle: string;
  startDate: string;
  eventStatus: string;
  isWalkOn: boolean;
  walkOnSource: string | null;
  issueId: string | null;
  note: string | null;
  hostName: string | null;
}

function eventStateLabel(status: string): string | null {
  const s = status.trim();
  if (s === "Open") return "event still open";
  if (s === "Confirmed") return "event confirmed";
  if (s === "Planning") return "event in planning";
  if (s === "Closed" || s === "Complete" || s === "Completed") return "event closed";
  return s ? `event ${s.toLowerCase()}` : null;
}

function reasonFor(hit: BookingHit): string {
  const note = (hit.note ?? "").trim();
  if (/off-boarded/i.test(note)) return "Off-boarded person accepted as a guest";
  if (hit.isWalkOn && hit.walkOnSource === "venue") return "Turned up at the event";
  if (hit.isWalkOn && hit.walkOnSource === "manifest") return "Turned up on the bus";
  if (hit.isWalkOn) return "Unexpected arrival";
  return "Added as a guest";
}

function lineFor(hit: BookingHit, extraEvents: number): string {
  const when = hit.startDate ? formatDateWithWeekday(hit.startDate) : null;
  const state = eventStateLabel(hit.eventStatus);
  const parts = [
    reasonFor(hit),
    "Event",
    hit.eventTitle || "Untitled event",
    when,
    hit.hostName ? `with ${hit.hostName}` : null,
    state,
    extraEvents > 0 ? `and ${extraEvents} more event${extraEvents === 1 ? "" : "s"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * One line per guest still on the directory: why they are a guest, which event,
 * and the day. Walk-on Hub issues are linked when the booking recorded one.
 */
export async function loadGuestDirectoryContext(
  participantIds: string[],
): Promise<Map<string, GuestDirectoryContext>> {
  const out = new Map<string, GuestDirectoryContext>();
  const ids = [...new Set(participantIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("event_roster_bookings")
    .select(
      "participant_id, booking_status, is_walk_on, walk_on_source, walk_on_issue_id, guest_ops_note, host_participant_id, created_at, event_manifest!inner(title, start_date, status)",
    )
    .in("participant_id", ids)
    .neq("booking_status", "Cancelled");
  if (error) {
    console.warn("[guest-directory] bookings", error.message);
    return out;
  }

  const hostIds = [
    ...new Set(
      (data ?? [])
        .map((row) => String((row as { host_participant_id?: string | null }).host_participant_id ?? ""))
        .filter(Boolean),
    ),
  ];
  const hostNames = new Map<string, string>();
  if (hostIds.length > 0) {
    const { data: hosts } = await supabase
      .from("participants")
      .select("id, first_name, last_name")
      .in("id", hostIds);
    for (const raw of hosts ?? []) {
      const h = raw as { id: string; first_name?: string | null; last_name?: string | null };
      const name = `${h.first_name ?? ""} ${h.last_name ?? ""}`.trim();
      if (h.id && name) hostNames.set(h.id, name);
    }
  }

  const byPerson = new Map<string, BookingHit[]>();
  for (const raw of data ?? []) {
    const row = raw as {
      participant_id: string;
      is_walk_on?: boolean | null;
      walk_on_source?: string | null;
      walk_on_issue_id?: string | null;
      guest_ops_note?: string | null;
      host_participant_id?: string | null;
      event_manifest?: { title?: string | null; start_date?: string | null; status?: string | null } | { title?: string | null; start_date?: string | null; status?: string | null }[] | null;
    };
    const event = Array.isArray(row.event_manifest) ? row.event_manifest[0] : row.event_manifest;
    const hit: BookingHit = {
      participantId: row.participant_id,
      eventTitle: (event?.title ?? "").trim() || "Untitled event",
      startDate: (event?.start_date ?? "").slice(0, 10),
      eventStatus: (event?.status ?? "").trim(),
      isWalkOn: row.is_walk_on === true,
      walkOnSource: row.walk_on_source ?? null,
      issueId: row.walk_on_issue_id ?? null,
      note: row.guest_ops_note ?? null,
      hostName: row.host_participant_id ? hostNames.get(row.host_participant_id) ?? null : null,
    };
    const list = byPerson.get(hit.participantId) ?? [];
    list.push(hit);
    byPerson.set(hit.participantId, list);
  }

  for (const [participantId, hits] of byPerson) {
    const sorted = [...hits].sort((a, b) => b.startDate.localeCompare(a.startDate));
    const chosen = sorted.find((h) => h.issueId) ?? sorted[0];
    if (!chosen) continue;
    out.set(participantId, {
      participantId,
      line: lineFor(chosen, Math.max(0, sorted.length - 1)),
      issueId: chosen.issueId,
    });
  }
  return out;
}

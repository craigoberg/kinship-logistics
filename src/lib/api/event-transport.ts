/**
 * Event outing transport — actual floor ops from event_attendance_log (§12.4.2)
 * and shared badge styling aligned with Participants directory (bus = blue, self = slate).
 */
import { supabase } from "@/integrations/supabase/client";
import { listEventDaySessions } from "@/lib/api/event-outing";

export type EventTransportMode = "bus" | "self";

export interface ParticipantActualTransport {
  outbound: EventTransportMode | null;
  return: EventTransportMode | null;
}

/** Tailwind classes — mirror participant-table TRANSPORT_CLASS for bus/private. */
export const EVENT_TRANSPORT_BADGE_CLASS: Record<EventTransportMode, string> = {
  bus: "bg-blue-600 text-white",
  self: "bg-slate-500 text-white",
};

export function normalizeEventTransportMode(
  mode: string | null | undefined,
): EventTransportMode {
  return mode === "self" ? "self" : "bus";
}

export function eventTransportLabel(mode: string): string {
  return normalizeEventTransportMode(mode) === "self" ? "Self" : "Bus";
}

function mapArrivalMethodToTransportMode(method: string): EventTransportMode {
  return method === "bus" ? "bus" : "self";
}

/** Collapse per-day attendance rows into one actual outbound/return per participant. */
export function buildParticipantActualTransport(
  sessions: Array<{ id: string; session_date: string }>,
  attendanceRows: Array<{
    event_day_session_id: string;
    participant_id: string;
    arrival_method: string;
    return_transport: string | null;
    status: string;
  }>,
): Map<string, ParticipantActualTransport> {
  const dateBySession = Object.fromEntries(sessions.map((s) => [s.id, s.session_date]));
  const byParticipant = new Map<string, typeof attendanceRows>();
  for (const row of attendanceRows) {
    const list = byParticipant.get(row.participant_id) ?? [];
    list.push(row);
    byParticipant.set(row.participant_id, list);
  }

  const result = new Map<string, ParticipantActualTransport>();

  for (const [participantId, rows] of byParticipant) {
    const sorted = [...rows].sort(
      (a, b) =>
        (dateBySession[a.event_day_session_id] ?? "").localeCompare(
          dateBySession[b.event_day_session_id] ?? "",
        ),
    );
    const firstArrived = sorted.find(
      (r) => r.status === "checked_in" || r.status === "checked_out",
    );
    const lastCheckout = [...sorted].reverse().find(
      (r) => r.status === "checked_out" && r.return_transport,
    );
    result.set(participantId, {
      outbound: firstArrived
        ? mapArrivalMethodToTransportMode(firstArrived.arrival_method)
        : null,
      return:
        lastCheckout?.return_transport === "bus" ||
        lastCheckout?.return_transport === "self"
          ? (lastCheckout.return_transport as EventTransportMode)
          : null,
    });
  }

  return result;
}

export async function fetchActualTransportForSessions(
  sessions: Array<{ id: string; session_date: string }>,
): Promise<Map<string, ParticipantActualTransport>> {
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("event_attendance_log")
    .select(
      "event_day_session_id, participant_id, arrival_method, return_transport, status",
    )
    .in("event_day_session_id", sessionIds);
  if (error) throw error;

  return buildParticipantActualTransport(sessions, (data ?? []) as Array<{
    event_day_session_id: string;
    participant_id: string;
    arrival_method: string;
    return_transport: string | null;
    status: string;
  }>);
}

/** Load actual outbound/return per participant for an outing event. */
export async function fetchEventActualTransport(
  eventId: string,
): Promise<Map<string, ParticipantActualTransport>> {
  const sessions = await listEventDaySessions(eventId);
  return fetchActualTransportForSessions(sessions);
}

export const eventActualTransportKey = (eventId: string) =>
  ["event-actual-transport", eventId] as const;

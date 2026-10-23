/**
 * Blank leader pack — one printed page per trip day, from the office plan.
 * Times stay empty. The leader writes them on the sheet.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  isMealStop,
  isMedicationStop,
  isPassengerStop,
  isVenueTransportStop,
  listEventDaySessions,
  listEventVenueStops,
  type EventVenueStop,
} from "@/lib/api/event-outing";
import { resolveOvernightWakeBase } from "@/lib/api/event-deliver-status";

export type LeaderPackRow = {
  name: string;
  travel: string;
  kind: "place" | "meal" | "med";
  sameBus: boolean;
};

export type LeaderPackDay = {
  dayNumber: number;
  date: string;
  leader: string;
  wake: string;
  rollLabel: "Check-in" | "Morning roll";
  showEveningRoll: boolean;
  participants: string[];
  rows: LeaderPackRow[];
};

export type LeaderPack = {
  eventTitle: string;
  days: LeaderPackDay[];
};

function placeName(stop: EventVenueStop): string {
  return stop.label_override?.trim() || stop.venue_name?.trim() || "Place";
}

function travelLabel(method: string | null | undefined): string {
  if (method === "bus") return "Bus";
  if (method === "walk") return "Walk";
  if (method === "on_site") return "On site";
  if (method === "other") return "Other";
  return "Not chosen";
}

function mealName(stop: EventVenueStop): string {
  const slot = stop.meal_slot?.replace(/_/g, " ");
  return stop.label_override?.trim() || (slot ? slot[0]!.toUpperCase() + slot.slice(1) : "Meal");
}

export async function buildLeaderPack(eventId: string, eventTitle: string): Promise<LeaderPack> {
  const [sessions, stops] = await Promise.all([
    listEventDaySessions(eventId),
    listEventVenueStops(eventId),
  ]);
  const { data: bookings, error: bookingErr } = await supabase
    .from("event_roster_bookings")
    .select("participant_id")
    .eq("event_id", eventId)
    .neq("booking_status", "Cancelled");
  if (bookingErr) throw bookingErr;
  const ids = [
    ...new Set(
      (bookings ?? [])
        .map((row) => (row as { participant_id?: string }).participant_id)
        .filter((id): id is string => !!id),
    ),
  ];
  let participants: string[] = [];
  if (ids.length > 0) {
    const { data: people, error: peopleErr } = await supabase
      .from("participants")
      .select("id, first_name, last_name")
      .in("id", ids);
    if (peopleErr) throw peopleErr;
    participants = (people ?? [])
      .map((row) => {
        const person = row as { first_name?: string | null; last_name?: string | null };
        return `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
      })
      .filter(Boolean)
      .sort((a, b) => a.split(" ").slice(-1)[0]!.localeCompare(b.split(" ").slice(-1)[0]!));
  }

  const dates = [
    ...new Set([
      ...sessions.map((session) => session.session_date.slice(0, 10)),
      ...stops.map((stop) => stop.session_date.slice(0, 10)),
    ]),
  ].sort();
  if (dates.length === 0) {
    throw new Error("This trip has no days to print.");
  }

  const days: LeaderPackDay[] = dates.map((date, index) => {
    const session = sessions.find((row) => row.session_date.slice(0, 10) === date);
    const todayStops = stops
      .filter((stop) => stop.session_date.slice(0, 10) === date)
      .sort((a, b) => a.stop_order - b.stop_order);
    const wake = resolveOvernightWakeBase(stops, date, todayStops);
    const venues = todayStops.filter((stop) => isVenueTransportStop(stop));
    const firstPlace = venues[0] ?? null;
    const wakeName =
      index === 0
        ? (firstPlace ? placeName(firstPlace) : "Meeting point")
        : wake.label || (firstPlace ? placeName(firstPlace) : "Overnight");

    let medSeen = false;
    let busSeen = false;
    const rows: LeaderPackRow[] = [];
    for (const stop of todayStops) {
      if (isPassengerStop(stop)) continue;
      if (isMedicationStop(stop)) {
        if (medSeen) continue;
        medSeen = true;
        rows.push({ name: "Medication round", travel: "On site", kind: "med", sameBus: false });
        continue;
      }
      if (isMealStop(stop)) {
        rows.push({ name: mealName(stop), travel: "On site", kind: "meal", sameBus: false });
        continue;
      }
      const travel = travelLabel(stop.movement_method);
      const busLike = travel === "Bus" || travel === "Not chosen";
      const sameBus = busLike && busSeen;
      if (busLike) busSeen = true;
      rows.push({ name: placeName(stop), travel, kind: "place", sameBus });
    }
    if (!medSeen) {
      rows.push({ name: "Medication round", travel: "On site", kind: "med", sameBus: false });
    }

    return {
      dayNumber: index + 1,
      date,
      leader: session?.manager_name?.trim() || "Not assigned",
      wake: wakeName || "Meeting point",
      rollLabel: index === 0 ? "Check-in" : "Morning roll",
      showEveningRoll: index < dates.length - 1,
      participants,
      rows,
    };
  });

  return { eventTitle, days };
}

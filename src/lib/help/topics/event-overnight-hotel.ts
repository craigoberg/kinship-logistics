import type { HelpTopic } from "../types";

export const eventOvernightHotelTopic: HelpTopic = {
  id: "event-overnight-hotel",
  kind: "howto",
  title: "Overnight events — hotel must be the last stop",
  summary:
    "On multi-day tours, every non-final calendar day must end with a Hotel / accommodation venue or Confirm / Open stay blocked.",
  keywords: [
    "overnight",
    "hotel",
    "accommodation",
    "multi-day",
    "last stop",
    "itinerary",
    "confirm",
    "open event",
  ],
  menus: ["events", "event-deliver", "admin"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "admin-venues",
    "events-create-confirm-open",
    "event-open-checks",
    "event-deliver-happy-path",
  ],
  steps: [
    {
      heading: "Create or open a multi-day event",
      body: "In Event Manage, set start and end dates so the outing spans more than one calendar day. Single-day outings do not need an overnight hotel gate.",
    },
    {
      heading: "Build each day’s itinerary",
      body: "On the Itinerary tab, add stops in order. First stop is the day’s origin; last stop is end of day. Use venues from Admin → Venues.",
    },
    {
      heading: "Non-final nights → last stop = Hotel",
      body: "For every night that is not the final day of the tour, the last stop must be a venue typed Hotel / accommodation. The itinerary shows Overnight OK or Needs overnight hotel badges.",
    },
    {
      heading: "Fix amber failures",
      body: "If a day shows Needs overnight hotel, add a hotel venue as the last stop or drag an existing hotel stop to the end. Confirm event, Open event, and Open location stay blocked until all overnight days pass.",
    },
    {
      heading: "Final day is exempt",
      body: "The last calendar day of the tour does not need to end at a hotel (e.g. activity then Transport HOME). Evening roll applies on non-final nights when the group is back at the overnight base.",
    },
    {
      heading: "Day 2+ with hotel omitted on the list",
      body: "A later day may list only activities (hotel not repeated). Wake / boarding still starts from last night’s final hotel stop — Programme synthesizes that hop. Do not treat “one stop today” as meaning the overnight base is gone.",
    },
  ],
};

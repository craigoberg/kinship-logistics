import type { HelpTopic } from "../types";

export const eventsCreateConfirmOpenTopic: HelpTopic = {
  id: "events-create-confirm-open",
  kind: "howto",
  title: "Events — create, Confirm, then Open",
  summary:
    "Office Event Manage ladder: Create New Event (Planning) → Confirm event → Open event, with roster, itinerary, and trip-leader gates.",
  keywords: [
    "create event",
    "confirm event",
    "open event",
    "planning",
    "roster",
    "itinerary",
    "trip leader",
    "med bag",
    "finance",
  ],
  menus: ["events", "event-deliver"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "event-live-watch",
    "event-overnight-hotel",
    "event-open-checks",
    "admin-venues",
    "event-deliver-happy-path",
  ],
  steps: [
    {
      heading: "Create New Event",
      body: "Event Manage → Create New Event. Fill Event title, Event type, dates, optional Primary venue and ticket price. Optional Clone roster from prior event. Save Event — status starts as Planning.",
    },
    {
      heading: "Details, Roster, Itinerary, Trip Days",
      body: "Complete Details & Config as needed. Roster: book participants; for bus passengers set Transport med bag (must not stay not_set). Itinerary: add venue stops per day. Trip Days: assign Trip leader on each date and Save.",
    },
    {
      heading: "Overnight hotel rule",
      body: "Multi-day tours: every non-final calendar day must end with Hotel / accommodation or Confirm / Open stay blocked. See the overnight hotel how-to.",
    },
    {
      heading: "Confirm event (Planning → Confirmed)",
      body: "Use Confirm event when trip leaders are saved, bus med-bag decisions are set, and overnight hotel days pass. Incomplete guest intake may warn on Confirm and hard-block later Open location.",
    },
    {
      heading: "Open event (Confirmed → Open)",
      body: "Open event requires start_date ≤ today, at least one venue stop per day, trip leaders still assigned, and the same overnight hotel rule. This is the office lifecycle — not the same as opening the floor.",
    },
    {
      heading: "Floor still needs Open location",
      body: "After Open event, field ops use Event Deliver (or Run this event). The trip leader opens the location with walkthrough ticks + PIN. Office watch is Event Manage → Live (read-only). Finance & P&L and Trip Report stay on Event Manage.",
    },
  ],
};

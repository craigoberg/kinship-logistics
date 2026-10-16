import type { HelpTopic } from "../types";

export const eventsCreateConfirmOpenTopic: HelpTopic = {
  id: "events-create-confirm-open",
  kind: "howto",
  title: "Events — create, Confirm, then Open",
  summary:
    "Office Event Manage: click the row, then Details, Itinerary, Roster, Travel, Live, Finance, and Trip Report. Confirm, then Open.",
  keywords: [
    "create event",
    "confirm event",
    "open event",
    "planning",
    "roster",
    "itinerary",
    "travel",
    "trip leader",
    "med bag",
    "finance",
    "trip report",
    "live",
  ],
  menus: ["events", "event-deliver"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "event-travel",
    "event-live-watch",
    "event-overnight-hotel",
    "event-open-checks",
    "admin-venues",
    "event-deliver-happy-path",
  ],
  steps: [
    {
      heading: "Create New Event",
      body: "Event Manage → Create New Event. Fill Event title, Event type, dates, optional Primary venue and ticket price. Optional Clone roster from prior event. Save Event — status starts as Planning. Afterwards, click the event row to open it. There is no Manage button. Run stays a separate button on Confirmed and Open events.",
    },
    {
      heading: "The event card",
      body: "The header shows the title, event type, single-day outing or multi-day tour, venue, dates, and ticket price. The status ladder is Planning, Confirmed, Open, and Closed. Run this event (Confirmed or Open) opens the floor. Incident / Fault raises a Health and Safety action. Tabs along the top are Details & Config, Itinerary, Roster, Travel, Live, Finance & P&L, and Trip Report. A non-outing hides Itinerary, Live, and Trip Report.",
    },
    {
      heading: "Details, Itinerary, and Roster",
      body: "Details & Config holds the title, type, dates, venue, price, and briefing. Itinerary: on each date name the trip leader (and morning and evening roll times on a multi-day tour), then add the places. The first place is the meeting point. The last place is the departure point. Roster: Add Participant to Roster, Add support person, or Add guest. Drag a person between Confirmed, Waitlisted, and Cancelled. Each list stays alphabetical by surname. Money stays on the row. A carer is listed under each person they travel with. For bus passengers set Transport med bag (must not stay not_set).",
    },
    {
      heading: "Travel",
      body: "Travel is how each confirmed person reaches the meeting point and leaves the departure point. Joins trip is At meeting point or On trip. Leaves trip is At departure point or Before departure. Staff, volunteers, and carers are their own line. A carer with more than one person is still one line. See the who joins and who leaves how-to.",
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
      body: "After Open event, field ops use Event Deliver (or the Run button on that row). The trip leader opens the location with walkthrough ticks + PIN. Office watch is the Live tab inside the event (read-only). Finance & P&L and Trip Report stay on that same event card.",
    },
  ],
};

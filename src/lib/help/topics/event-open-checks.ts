import type { HelpTopic } from "../types";

export const eventOpenChecksTopic: HelpTopic = {
  id: "event-open-checks",
  kind: "howto",
  title: "Event Deliver — Open location walkthrough",
  summary:
    "On-the-day Confirm venue walkthrough ticks, Log Venue Issue if a check fails, then trip-leader PIN to open the location.",
  keywords: [
    "open location",
    "venue open",
    "walkthrough",
    "venue_open_checks",
    "trip leader",
    "mandated checks",
    "log venue issue",
  ],
  menus: ["events", "event-deliver", "admin"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "events-create-confirm-open",
    "event-overnight-hotel",
    "admin-venues",
    "event-deliver-happy-path",
    "admin-overview",
  ],
  steps: [
    {
      heading: "Office must be ready first",
      body: "Event should be Confirmed or Open, each day needs a trip leader and itinerary stops, overnight hotel rule must pass, and guest bookings must not hard-block Open location. Open event in the office is not enough by itself.",
    },
    {
      heading: "Open Event Deliver",
      body: "Open Event Deliver, or from Event Manage use Run this event. On the location panel tap Open location (dialog Open location?).",
    },
    {
      heading: "Confirm venue walkthrough",
      body: "Complete every tick under Confirm venue walkthrough (from Admin → System Parameters → Mandated walkthrough checklists → Event Deliver — Open location). Empty list = high-trust 1-tap.",
    },
    {
      heading: "If a check is not OK",
      body: "Use Log Venue Issue (Green / Yellow / Red) for walkthrough failures — not the global Big Red path for ordinary walkthrough fails. Incomplete ticks keep PIN disabled (Complete walkthrough checks first).",
    },
    {
      heading: "Trip leader PIN",
      body: "When ticks (and any open-RED gates) are clear, Tap to enter PIN and open with the trip leader PIN. Ledger records EVENT_LOCATION_OPENED with completed check labels. Open RED on the session blocks PIN.",
    },
    {
      heading: "Configure the tick list (Admin)",
      body: "Managers edit the list under Mandated walkthrough checklists. Planning venue baseline sign-off (Admin → Venues) is separate from these day-of ticks.",
    },
  ],
};

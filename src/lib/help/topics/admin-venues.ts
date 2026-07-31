import type { HelpTopic } from "../types";

export const adminVenuesTopic: HelpTopic = {
  id: "admin-venues",
  kind: "howto",
  title: "Venues — create and set up destinations",
  summary:
    "Register destinations in Admin → Venues, seed the safety template, and sign the planning baseline before relying on the venue for events.",
  keywords: [
    "venue",
    "venues",
    "hotel",
    "accommodation",
    "add venue",
    "create venue",
    "baseline",
    "sign off",
    "risk tier",
    "safety",
  ],
  menus: ["admin", "events"],
  roles: ["manager", "assistant_manager"],
  relatedIds: [
    "event-overnight-hotel",
    "event-open-checks",
    "events-create-confirm-open",
    "admin-overview",
  ],
  steps: [
    {
      heading: "Open Admin → Venues",
      body: "Admin Configuration → Venues lists the destination registry. Search before creating a duplicate.",
    },
    {
      heading: "Add venue → Create venue",
      body: "Tap Add venue. Enter Venue name (required), Venue type (use Hotel / accommodation for overnight bases), risk tier, and street address. Tap Create venue — mandatory safety template fields are seeded automatically (answers are not copied if you clone structure later).",
    },
    {
      heading: "Template, sign-offs, compliance",
      body: "Open the venue and use its template / sign-offs / compliance areas. A new venue has template structure only until someone signs a baseline.",
    },
    {
      heading: "Sign baseline",
      body: "Tap Sign baseline (or Re-sign baseline), complete Venue safety baseline sign-off, then Sign off baseline. Compliance badges reflect missing / overdue / deferred grace for that planning baseline.",
    },
    {
      heading: "Day-of walkthrough is separate",
      body: "Baseline sign-off is office planning. Opening a location on Event Deliver still uses the short Mandated walkthrough list (Event Deliver — Open location) plus trip-leader PIN.",
    },
    {
      heading: "Use on events",
      body: "Create event and Itinerary pick venues from this registry. Multi-day non-final nights must end on Hotel / accommodation — see the overnight hotel how-to.",
    },
  ],
};

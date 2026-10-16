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
      body: "Admin Configuration → Venues has two tabs. Venues is the destination registry. Venue types is the list behind the Venue type dropdown (Park, Hotel, and any names you add). Search before creating a duplicate. Click a row to edit the venue. The chevron on the row expands the template and baseline under that venue. Clone and Archive stay their own buttons.",
    },
    {
      heading: "Add venue → Create venue",
      body: "Tap Add venue. Enter Venue name (required), Venue type (use Hotel / accommodation for overnight bases), risk tier, and street address. Tap Create venue — mandatory safety template fields are seeded automatically (answers are not copied if you clone structure later).",
    },
    {
      heading: "Template, sign-offs, compliance",
      body: "Use the chevron on the venue row for template, sign-offs, and compliance. It opens under that row. Each check has Yes or No for this venue. No, on a required check, needs a reason. Venue types is where a new type such as Cruise gets its checks: expand the type, search the list, and tick them. Edit on a check can archive it when you say why. A new venue copies that list. Changing the list, or the venue type, needs a new baseline. Clicking the row opens the venue edit.",
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

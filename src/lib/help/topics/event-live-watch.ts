import type { HelpTopic } from "../types";

export const eventLiveWatchTopic: HelpTopic = {
  id: "event-live-watch",
  kind: "howto",
  title: "Event Manage — watch a live outing",
  summary:
    "Office Live tab shows pickups, who is on the bus, programme progress, rolls, and open issues. Read-only — field taps stay on Event Deliver and Manifest.",
  keywords: [
    "live",
    "watch",
    "office",
    "pickup",
    "on bus",
    "programme",
    "group status",
    "event manage",
  ],
  menus: ["events"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "events-create-confirm-open",
    "event-deliver-happy-path",
    "manifest-active-run",
    "governance-hub-issue",
  ],
  steps: [
    {
      heading: "Open Live on the event card",
      body: "Event Manage → open the outing → Live tab. Multi-day events show day chips; the default is operational today (or the open day).",
    },
    {
      heading: "What you can see",
      body: "Group status (same timeline as Event Deliver), who is waiting / picked up / on the bus, who is checked in at the venue, which programme stop is open, hops / HOME boarding, morning or evening roll, and open issues.",
    },
    {
      heading: "What you cannot do here",
      body: "Live is watch-only. Boarding, check-in, open location, and Resolve stay on Event Deliver, Manifest, or the Hub. If the bus tablet is offline, names update when it syncs.",
    },
  ],
};

import type { HelpTopic } from "../types";

export const eventDeliverHappyPathTopic: HelpTopic = {
  id: "event-deliver-happy-path",
  kind: "howto",
  title: "Event Deliver — Day happy path",
  summary:
    "Open the trip day, Check-In, run Programme stops (and bus hops via Manifest), then Close day.",
  keywords: [
    "event deliver",
    "trip day",
    "programme",
    "venue",
    "check-in",
    "roll call",
    "morning roll",
    "evening roll",
    "close day",
    "offline",
    "no signal",
    "check-out",
  ],
  menus: ["event-deliver", "manifest", "events"],
  roles: ["support_worker", "manager", "assistant_manager", "driver"],
  relatedIds: [
    "events-create-confirm-open",
    "event-travel",
    "event-live-watch",
    "event-open-checks",
    "event-overnight-hotel",
    "checkin-roll-escalations",
    "meals-service",
    "medication-rounds",
    "manifest-start-run",
    "red-verbal-consultation",
  ],
  steps: [
    {
      heading: "Start from Event Manage or Deliver",
      body: "Office setup lives under Event Manage. For the floor, open Event Deliver (or Run this event). Open the trip day with PIN when prompted.",
    },
    {
      heading: "Check-In / arrival",
      body: "Mark who is with the group. Absent / Not attending uses the safety disposition dialog (plan + PIN) when required. Group status shows progress toward roll complete.",
    },
    {
      heading: "Morning roll (Day 2+)",
      body: "On overnight trips, complete morning roll before releasing the next hop or programme block when the gate requires it.",
    },
    {
      heading: "No signal at a venue",
      body: "If a read fails or does not answer, the tablet stays offline until a health check succeeds. It will not quietly load the server over taps already saved here. Check-in, check-out, venue open, activity check-in, morning or evening roll, and Close day save on this tablet and upload when the link returns. Meals and medication are still being moved onto the same path.",
    },
    {
      heading: "Programme and bus hops",
      body: "Open a venue/activity from Programme (venue safety ticks + PIN). Boarding hops run through Manifest — complete the hop run, then continue on the floor. Someone who joins on the trip is collected at their Pickup stop, not at the meeting point. Someone who leaves before the departure point gets off at their Drop-off stop. Close the location when leaving.",
    },
    {
      heading: "Evening roll and Close day",
      body: "On non-final nights, complete evening roll. Close day when the itinerary and rolls allow; Day N+1 stays blocked while Day N is still open.",
    },
  ],
};

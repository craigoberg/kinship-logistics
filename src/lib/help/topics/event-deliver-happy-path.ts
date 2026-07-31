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
  ],
  menus: ["event-deliver", "manifest", "events"],
  roles: ["support_worker", "manager", "assistant_manager", "driver"],
  relatedIds: [
    "events-create-confirm-open",
    "event-open-checks",
    "event-overnight-hotel",
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
      heading: "Programme and bus hops",
      body: "Open a venue/activity from Programme (venue safety ticks + PIN). Boarding hops run through Manifest — complete the hop run, then continue on the floor. Close the location when leaving.",
    },
    {
      heading: "Evening roll and Close day",
      body: "On non-final nights, complete evening roll. Close day when the itinerary and rolls allow; Day N+1 stays blocked while Day N is still open.",
    },
  ],
};

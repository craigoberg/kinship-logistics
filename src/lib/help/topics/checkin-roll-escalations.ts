import type { HelpTopic } from "../types";

export const checkinRollEscalationsTopic: HelpTopic = {
  id: "checkin-roll-escalations",
  kind: "howto",
  title: "Check-in & roll calls — late clocks and escalations",
  summary:
    "How Day Centre arrival, event Check-In, and morning/evening rolls move Green → Yellow → Red — times and grace windows are set in Admin, not hard-coded in the app UI.",
  keywords: [
    "check-in",
    "checkin",
    "arrival",
    "no-show",
    "roll call",
    "morning roll",
    "evening roll",
    "escalation",
    "yellow",
    "red",
    "sms",
    "defer",
  ],
  menus: ["day", "event-deliver", "admin", "governance"],
  roles: ["manager", "assistant_manager", "support_worker", "driver"],
  relatedIds: [
    "deferral-across-ops",
    "ryge-philosophy",
    "day-centre-happy-path",
    "event-deliver-happy-path",
    "admin-overview",
    "hub-update-sla",
  ],
  steps: [
    {
      heading: "Shared idea — expected time, then escalate",
      body: "Check-ins and rolls compare wall-clock (or Deferred until) to an expected time. Before/at the deadline you get a Green-style prompt; after the deadline Yellow (overdue / caution); further past the deadline Red (breach, Hub/dashboard attention, and for some rolls SMS once). Exact minutes and hours are Admin-configured.",
    },
    {
      heading: "Day Centre Check-In / arrival",
      body: "Each expected participant has an expected arrival time from their schedule. If they are still outstanding after that time, the roll and duty-of-care tiles escalate (No-Show / Missing style). Operators can defer expected arrival (single person or bulk group) when the bus is late — that pushes the clock forward. Mark Absent with a real reason when they are not coming; do not endless-defer a true absence.",
    },
    {
      heading: "Event / trip Check-In (arrival)",
      body: "Event Deliver Check-In uses the trip day’s arrival expectation (including expected_arrival_by when set on open). Late unaccounted people follow the same Green → Yellow → Red idea for the floor and Hub. Not attending / Left trip uses disposition dialogs (safety plan + PIN) — that is a different path from “still arriving late.”",
    },
    {
      heading: "Morning and evening roll calls (multi-day)",
      body: "On overnight tours, Morning roll (Day 2+) and Evening roll (non-final nights) have default clock times seeded from Admin. Event Deliver shows sticky alert bands: Green approaching / at deadline → Yellow overdue → Red (SMS once per person at Red — does not repeat on a timer). Programme / hops can stay gated until morning roll is complete.",
    },
    {
      heading: "Roll deferral moves “Deferred until”",
      body: "Leaders can defer outstanding people (or all) — Yellow path with PIN + reason; Red path via verbal consultation then the same push. Banners use Deferred until, not only the original Config clock. Max deferral length is capped in Admin (Tour roll call settings).",
    },
    {
      heading: "Where to configure times (Admin)",
      body: "Admin → System Parameters → Multi-day tour roll calls (default evening/morning times, Green-before / Red-after minutes, max deferral). Other keys in System Parameters cover Day Centre / dashboard no-show red hours and roll-call grace for the Roll Call Breach tile. Change values there — do not expect hard-coded minutes in Help or training handouts to stay correct.",
    },
    {
      heading: "Not the same as Hub Update Due",
      body: "Arrival and roll escalations are about people being late or unaccounted on the floor. Hub Update Due / Stale is about open tickets with no Log Note — see Hub issues — regular updates. Both use RYGE colours, but different clocks and Admin keys.",
    },
  ],
};

import type { HelpTopic } from "../types";

export const manifestActiveRunTopic: HelpTopic = {
  id: "manifest-active-run",
  kind: "howto",
  title: "Manifest — Active run and Close Run",
  summary:
    "Depart and arrive stops, confirm passengers, handle cancel/no-show, log distance, then Close Run with PIN.",
  keywords: [
    "manifest",
    "depart",
    "arrive",
    "close run",
    "cancel pickup",
    "no-show",
    "leg",
    "boarding",
    "return",
    "maps",
    "directions",
  ],
  menus: ["manifest"],
  roles: ["driver", "support_worker", "manager", "assistant_manager"],
  relatedIds: ["manifest-start-run", "red-verbal-consultation"],
  steps: [
    {
      heading: "Work the current leg",
      body: "The active leg shows from → to. Use Depart Stop when leaving, Arrive when you reach the next stop. While en route, Open in Google Maps uses the start and end addresses. The app does not calculate kilometres from the phone’s GPS.",
    },
    {
      heading: "Confirm passengers",
      body: "Everyone on the run boards — participants, staff, volunteers and carers — unless marked not travelling (same Skip path as a client). On outbound pickups, confirm boarding at each stop. On return/drop-off runs and venue hops, complete the boarding roll before Depart unlocks. Overnight morning/evening rolls are participants only.",
    },
    {
      heading: "Cancel pickup or no-show",
      body: "If a passenger is not travelling, use the cancel / not-travelling flow (bottom sheet). Acknowledge cancelled pickups before Close Run when the summary asks.",
    },
    {
      heading: "Log leg distance",
      body: "After a leg, enter the kilometres from the odometer on the numeric pad (half-km steps). Totals feed the Close Run odometer suggestion. There is no GPS estimate.",
    },
    {
      heading: "Close Run",
      body: "When all legs are done, open Close Run: review the summary, clear open-RED / cancelled-pickup gates, enter ending odometer, sign with operator PIN. Close Run stays blocked if Manifest offline queue still has pending writes — reconnect and flush first.",
    },
  ],
};

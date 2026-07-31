import type { HelpTopic } from "../types";

export const manifestStartRunTopic: HelpTopic = {
  id: "manifest-start-run",
  kind: "howto",
  title: "Manifest — Start a run",
  summary:
    "Pick a Day Centre or event trip, complete walkaround clearance, enter starting odometer, and Start Run.",
  keywords: [
    "manifest",
    "start run",
    "walkaround",
    "odometer",
    "bus",
    "pickup",
    "vehicle",
    "clearance",
  ],
  menus: ["manifest"],
  roles: ["driver", "support_worker", "manager", "assistant_manager"],
  relatedIds: ["manifest-active-run", "red-verbal-consultation"],
  steps: [
    {
      heading: "Open Manifest",
      body: "From the bottom or side menu, tap Manifest. You should see the run/event picker — not a full passenger list yet (pre-start).",
    },
    {
      heading: "Choose the run or trip",
      body: "Select today’s Day Centre run or the event transport card (IN / HOME / hop). Confirm vehicle and start point if prompted.",
    },
    {
      heading: "Vehicle clearance / walkaround",
      body: "Complete the mandated walkaround ticks. Severity-1 failures may block start or raise an alert — fix or escalate before continuing.",
    },
    {
      heading: "Starting odometer",
      body: "Enter the starting km on the numeric pad. Alpha may suggest a value from Fleet current KM — adjust if the dial differs, then confirm.",
    },
    {
      heading: "Start Run",
      body: "When clearance and odometer are done, tap Start Run. The unified leg list appears; you can reorder pickup legs before departing the first stop (chain stays drivable — the bus does not teleport).",
    },
  ],
};

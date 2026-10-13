import type { HelpTopic } from "../types";

export const manifestStartRunTopic: HelpTopic = {
  id: "manifest-start-run",
  kind: "howto",
  title: "Manifest — Start a run",
  summary:
    "Pick today's vehicle, confirm the starting kilometres during clearance, choose the run, and Start Run.",
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
      body: "From the bottom or side menu, tap Manifest.",
    },
    {
      heading: "Choose the vehicle",
      body: "Pick today's bus, then continue to clearance. Kilometres are not asked on this step.",
    },
    {
      heading: "Vehicle clearance",
      body: "Full walkaround, or Fast Pass when this vehicle was already cleared today. Confirm the number on the dash before Confirm & Roll or Lock In. The last known reading is only a suggestion — the bus may have moved for petrol, maintenance, or shopping. On Fast Pass, Log an issue opens the walkaround if you can see something the earlier check missed.",
    },
    {
      heading: "Choose the run and start",
      body: "Select today’s Day Centre run or the event transport card. When clearance and the starting kilometres are done, tap Start Run. You enter the ending reading only when you Close Run.",
    },
  ],
};

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
    "offline",
    "release",
    "paper roll",
    "signal",
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
    {
      heading: "Group not released yet",
      body: "On a trip hop, Start hop manifest appears after the trip leader releases the group on Event Deliver. If that has not happened and you still need to leave, tap Start this leg anyway under “Not released to the bus yet”. When this tablet already has the expected people, confirm Start from that list, then mark each person on the bus or not travelling. You can add a name that was not on the list — the office confirms it later. If the tablet has no list, the prompt is: System offline. Write who is on the bus on the paper roll for this leg and start. That sheet is filed in the office against this trip and this leg. The leg uploads when the tablet has signal, and a later Release joins this same leg. It does not open a second manifest.",
    },
  ],
};

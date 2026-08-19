import type { HelpTopic } from "../types";

export const appTicketsTopic: HelpTopic = {
  id: "app-tickets",
  kind: "howto",
  title: "Raise an app ticket (GREEN note)",
  summary:
    "Tell the office about an app problem or unclear form. Not an Incident / Fault or a maintenance repair.",
  keywords: [
    "ticket",
    "bug",
    "app",
    "green",
    "note",
    "raise ticket",
    "testing",
    "hub",
  ],
  menus: ["governance"],
  roles: "all",
  relatedIds: ["governance-hub-issue", "hub-three-streams", "ryge-philosophy"],
  steps: [
    {
      heading: "Use the green Raise ticket button — not the red Incident / Fault",
      body: "Raise ticket is the green / teal pill (and a Ticket chip on open forms). Use it for “this screen looks wrong”, “save did not work”, or “I am stuck”. Injuries, welfare, and broken buses still go through Incident / Fault.",
    },
    {
      heading: "Write what happened",
      body: "Describe what you were doing and what you expected. Who you are, which screen, which form, last tap, SIM clock, and TEST vs PROD are attached automatically.",
    },
    {
      heading: "Find it in Hub → App tickets",
      body: "Everyone can see the list. The office adds Log Notes, can Defer, and Resolve / Close with a manager PIN. This tab is not Maintenance & Repairs and is not part of the Human Incidents register.",
    },
  ],
};

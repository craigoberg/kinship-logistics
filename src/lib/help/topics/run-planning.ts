import type { HelpTopic } from "../types";

export const runPlanningTopic: HelpTopic = {
  id: "run-planning",
  kind: "howto",
  title: "Run Planning — who is on which day",
  summary:
    "One row per person. Day columns follow Admin operating days. Click the row to change IN/OUT. Drag the default run order underneath.",
  keywords: [
    "run planning",
    "operating days",
    "centre run",
    "in out",
    "pickup order",
    "tuesday",
    "thursday",
    "bus",
  ],
  menus: ["run_planning"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: ["add-participants", "add-staff", "admin-overview", "manifest-start-run"],
  steps: [
    {
      heading: "Days come from Operating days",
      body: "The board only shows days set in Admin → Lookups → Operating days. If the centre is open Tuesday and Thursday, those are the only columns. Saturday appears only after you add it there. The same list is the Participants day filter and day columns.",
    },
    {
      heading: "Click a row to change IN/OUT",
      body: "Everyone on the board is one person per row (participants, staff, volunteers, carers). Click the row to open their Participant or Staff record and set Transport IN and OUT. There is no pencil at the end of the row.",
    },
    {
      heading: "Default run order",
      body: "Under the board, pick the operating day and Morning pickup or Afternoon return, then drag stops. People not attending that day are skipped. The driver can still reorder on Manifest.",
    },
    {
      heading: "Add someone to a run",
      body: "Add support person offers only the operating days. Medical one-off runs stay on Transport, not on this board.",
    },
  ],
};

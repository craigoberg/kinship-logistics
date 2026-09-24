import type { HelpTopic } from "../types";

export const adminDutyRolesTopic: HelpTopic = {
  id: "admin-duty-roles",
  kind: "howto",
  title: "Duty roles — requirements for jobs, not logins",
  summary:
    "Create Duty roles (Food Preparation, On the floor, Bus Driver) and attach certificates or orientations. Bind them to floor functions. Separate from Manager / Driver menu access.",
  keywords: [
    "duty role",
    "duty roles",
    "certificate",
    "orientation",
    "food handler",
    "safe food",
    "licence",
    "wwcc",
    "ndis",
    "worker screening",
    "requirements",
    "admin",
  ],
  menus: ["admin", "staff"],
  roles: ["manager", "assistant_manager"],
  relatedIds: [
    "admin-overview",
    "add-staff",
    "meals-service",
    "manifest-start-run",
    "day-centre-happy-path",
    "medication-rounds",
    "event-open-checks",
  ],
  steps: [
    {
      heading: "Official names first",
      body: "Create and rename certificates and orientations only in Admin → Lookups → Certificates & orientations. Also-matches maps old spellings (Food Handler Basic). Duty roles and Staff cannot invent a name.",
    },
    {
      heading: "Open Admin → Duty roles",
      body: "Two tabs: Duty roles and Bindings. This is not Menu Access — a Bus Driver duty does not open extra screens.",
    },
    {
      heading: "Duty roles",
      body: "Create the job (Food Preparation, Bus Driver, Car Driver) and tick which Lookups types it needs. A person can hold several Duty roles.",
    },
    {
      heading: "Bindings",
      body: "Bind a Duty role to a function the app already has: Meal preparation, Drive fleet, On the floor (helper check-in), Centre open/close, Open event location, Close event day, Medical admin, Medication witness. No binding, or a role with no tickets, falls through and allows the action.",
    },
    {
      heading: "Staff sheet",
      body: "Assign Duty roles on the person, then pick certificates and orientations from the Lookups dropdown. Number and expiry stay on the person.",
    },
    {
      heading: "Floor gap",
      body: "If the person doing that function is missing or expired on the bound tickets, a Manager writes a justification and enters their PIN. The action can proceed; the approval is ledgered. Staff and volunteers on Personnel are checked at helper Arrived. Carers are not yet (no catalogue holds on the carer record).",
    },
  ],
};

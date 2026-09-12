import type { HelpTopic } from "../types";

export const adminDutyRolesTopic: HelpTopic = {
  id: "admin-duty-roles",
  kind: "howto",
  title: "Duty roles — requirements for jobs, not logins",
  summary:
    "Create Duty roles (Food Preparation, Bus Driver) and attach certificates or orientations. Bind them to meal prep or vehicles. Separate from Manager / Driver menu access.",
  keywords: [
    "duty role",
    "duty roles",
    "certificate",
    "orientation",
    "food handler",
    "safe food",
    "licence",
    "wwcc",
    "requirements",
    "admin",
  ],
  menus: ["admin", "staff"],
  roles: ["manager", "assistant_manager"],
  relatedIds: ["admin-overview", "add-staff", "meals-service", "manifest-start-run"],
  steps: [
    {
      heading: "Open Admin → Duty roles",
      body: "Three tabs: Duty roles, Requirements, Bindings. This is not Menu Access — a Bus Driver duty does not open extra screens.",
    },
    {
      heading: "Requirements",
      body: "Add a certificate (Safe Food Handler, LR, WWCC) or an orientation (kitchen induction). Also-matches names map old spellings like Food Handler Basic. Expiry is set on the person, not here — leave expiry blank if it never expires.",
    },
    {
      heading: "Duty roles",
      body: "Create the job (Food Preparation, Bus Driver, Car Driver) and tick which requirements it needs. A person can hold several Duty roles.",
    },
    {
      heading: "Bindings",
      body: "Meal preparation uses Food Preparation. Fleet categories (bus / Coaster / HiAce) use Bus or Car Driver. You can bind one extra vehicle. Centre Open/Close can be listed but do not gate the floor unless you add that later.",
    },
    {
      heading: "Staff sheet",
      body: "Assign Duty roles on the person, then pick catalogue items for their certificates and orientations.",
    },
    {
      heading: "Floor gap",
      body: "If someone is preparing a meal or starting a run without current requirements, a Manager writes a justification and enters their PIN — same as today’s meal path. The run or meal can proceed; the approval is ledgered.",
    },
  ],
};

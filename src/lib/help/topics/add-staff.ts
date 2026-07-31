import type { HelpTopic } from "../types";

export const addStaffTopic: HelpTopic = {
  id: "add-staff",
  kind: "howto",
  title: "Staff — add personnel and set role / PIN",
  summary:
    "Managers add staff and volunteers in Staff → Add personnel with role, system access level, and a 4-digit PIN.",
  keywords: [
    "staff",
    "personnel",
    "add personnel",
    "pin",
    "role",
    "system access",
    "volunteer",
    "directory",
  ],
  menus: ["staff", "admin"],
  roles: ["manager", "assistant_manager"],
  relatedIds: ["sign-in-pin", "add-participants", "admin-overview"],
  steps: [
    {
      heading: "Open Staff",
      body: "From the menu open Staff. Use Staff & Volunteers for employees/volunteers; Carers & Support Networks is a separate list for family/support contacts.",
    },
    {
      heading: "Add personnel (manager-only)",
      body: "Managers see Add personnel. Non-managers see a Manager-only badge. Writes go to staff_registry.",
    },
    {
      heading: "Name, role, system access",
      body: "Enter Full name, Role / title, and SYSTEM ACCESS LEVEL (Manager, Assistant Manager, Support Worker, Driver, etc.). Optional: Phone, Email, Street address; keep Active on for working staff.",
    },
    {
      heading: "4-digit PIN",
      body: "Enter a 4-digit PIN on the Pin pad (required for new personnel). Used for terminal sign-in, med witness, and step-up dialogs. Guardian PINs cannot log into the staff terminal.",
    },
    {
      heading: "Save and verify",
      body: "Tap Add personnel. Have the person sign in on Auth with their PIN (after day email login when enabled). Managers can reopen a row later via Edit personnel / Save changes.",
    },
    {
      heading: "Certifications later",
      body: "WWC, First Aid, SFH, licence and similar certs are tracked via compliance / Hub after intake — get identity and PIN correct first.",
    },
  ],
};

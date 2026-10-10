import type { HelpTopic } from "../types";

export const addStaffTopic: HelpTopic = {
  id: "add-staff",
  kind: "howto",
  title: "Staff — add personnel and set role / PIN",
  summary:
    "Managers add staff and volunteers with Quick add (role, system access, 6-digit PIN). Click a row to open the person again.",
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
  relatedIds: ["sign-in-pin", "add-participants", "admin-overview", "run-planning"],
  steps: [
    {
      heading: "Open Staff",
      body: "From the menu open Staff. Use Staff & Volunteers for employees/volunteers; Carers & Support Networks is a separate list for family/support contacts.",
    },
    {
      heading: "Quick add (manager-only)",
      body: "Managers see Quick add on Staff & Volunteers, and Quick add carer on Carers. Non-managers see a Manager-only badge on the staff list. Writes go to staff_registry. Click a row to open that person. There is no separate Edit button.",
    },
    {
      heading: "Name, role, system access",
      body: "Enter Full name, Role / title, and SYSTEM ACCESS LEVEL (Manager, Assistant Manager, Support Worker, Driver, etc.). Optional: Phone, Email, Street address; keep Active on for working staff.",
    },
    {
      heading: "6-digit PIN",
      body: "Enter a 6-digit PIN on the Pin pad (required for new personnel). Used for terminal sign-in, med witness, and step-up dialogs. Guardian PINs cannot log into the staff terminal.",
    },
    {
      heading: "Save and verify",
      body: "On Quick add, tap Add personnel. Have the person sign in on Auth with their PIN (after day email login when enabled). To change them later, click their row and Save changes.",
    },
    {
      heading: "Staff onboarding pack",
      body: "Staff onboarding or Volunteer onboarding types the pack. Nothing is stored until Save draft. Print blank staff or Print blank volunteer on this page, or from inside the open pack, if you need paper. The inbox is Hub → Onboarding (not Admin): click the row to open, Delete stays, and Search sits beside Show and Pack.",
    },
    {
      heading: "Certifications later",
      body: "After identity and PIN, add certificates and orientations from the Lookups list (Admin → Lookups → Certificates & orientations). You pick a name; you do not type one. Assign Duty roles separately from System access. Hub still tracks expiry.",
    },
  ],
};

import type { HelpTopic } from "../types";

export const adminOverviewTopic: HelpTopic = {
  id: "admin-overview",
  kind: "howto",
  title: "Admin — what each tab is for",
  summary:
    "Quick map of Admin Configuration tabs and the main System Parameters panels operators actually use.",
  keywords: [
    "admin",
    "system parameters",
    "lookups",
    "fleet",
    "backup",
    "menu access",
    "operating hours",
    "audit pack",
    "configuration",
  ],
  menus: ["admin"],
  roles: ["manager", "assistant_manager"],
  relatedIds: [
    "admin-venues",
    "admin-vendors",
    "hub-update-sla",
    "checkin-roll-escalations",
    "event-open-checks",
    "add-staff",
  ],
  steps: [
    {
      heading: "Lookups",
      body: "Editable code lists (event types, financial codes, Day Centre Bus Runs / bus_runs, transport types, colours). Named runs (R1, R2, …) feed multi-bus events and directory filters.",
    },
    {
      heading: "Fleet Register",
      body: "Vehicles for Manifest — rego/compliance context, current odometer hints, and odometer corrections. Depot/bus-run name lists often live under Lookups.",
    },
    {
      heading: "Venues & Vendors",
      body: "Venues = destination registry + safety baseline. Vendors = MYOB-aligned supplier names for Finance & P&L expenses. See the dedicated how-tos.",
    },
    {
      heading: "System Parameters — structured panels",
      body: "Prefer named panels over raw JSON: Multi-day tour roll calls (default times + Green/Yellow/Red alert minutes + max deferral); Mandated walkthrough checklists (Day Centre open/close, Event Deliver open location, meal prep ticks); Council email; MYOB export; NDIS Audit Pack. Hub Update Due / Stale thresholds and attendance no-show / roll-call grace keys also live here as System Parameters.",
    },
    {
      heading: "System Parameters — JSON table",
      body: "Other tunable keys live in the parameter table. Managers edit with justification; changes are ledgered. Do not put secrets (alarm codes) in checklist text — that belongs in the secrets backlog item.",
    },
    {
      heading: "Centre Operating Hours",
      body: "Expected centre open/close hours for the site calendar — not the same as Declare Site Safe & Open Day Centre PIN.",
    },
    {
      heading: "Menu Access",
      body: "Role × menu matrix (Manager-only). Checkboxes are placeholders until BL-002 wires role_menu_access. Help soft-filters by role today.",
    },
    {
      heading: "Backup & Restore",
      body: "Full database backup download and restore. Can preserve local login / staff_registry when moving between environments — use only with the documented RPC prerequisites.",
    },
  ],
};

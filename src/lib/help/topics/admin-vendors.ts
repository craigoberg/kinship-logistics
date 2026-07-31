import type { HelpTopic } from "../types";

export const adminVendorsTopic: HelpTopic = {
  id: "admin-vendors",
  kind: "howto",
  title: "Vendors — add and use supplier names",
  summary:
    "Maintain the vendor registry in Admin, then pick (or add) a vendor when logging a trip expense on Finance & P&L.",
  keywords: [
    "vendor",
    "vendors",
    "supplier",
    "myob",
    "expense",
    "log expense",
    "finance",
    "p&l",
    "admin",
  ],
  menus: ["admin", "events"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: ["admin-overview", "events-create-confirm-open"],
  steps: [
    {
      heading: "Open Admin → Vendors",
      body: "From the menu open Admin Configuration, then the Vendors tab. This is the shared supplier list used when logging expenses (use exact MYOB supplier spelling where possible).",
    },
    {
      heading: "Add vendor",
      body: "Tap Add vendor. Enter Vendor name (at least 2 characters). Managers maintain the list; others may see a read-only view.",
    },
    {
      heading: "Edit or Archive",
      body: "Edit vendor if the trading name changes. Archive vendor hides it from expense pickers — prefer archive over inventing one-off spellings on every expense.",
    },
    {
      heading: "Log Event Expense",
      body: "Event Manage → open the event → Finance & P&L → Log Event Expense. Fill Transaction date, Amount ($), Financial code, and Description. Vendor is optional but preferred.",
    },
    {
      heading: "Unknown name → Add vendor to list?",
      body: "Type-ahead match an existing vendor, or type a new name. On Save Expense, if the name is unknown the app asks Add vendor to list? — add it now, or log the expense without adding.",
    },
  ],
};

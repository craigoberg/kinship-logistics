import type { HelpTopic } from "../types";

export const hubUpdateSlaTopic: HelpTopic = {
  id: "hub-update-sla",
  kind: "howto",
  title: "Hub issues — regular updates (Update Due / Stale)",
  summary:
    "Open Hub items need ongoing Log Notes. Without a Defer, silence escalates to Update Due then Stale — thresholds live in Admin System Parameters.",
  keywords: [
    "hub",
    "sla",
    "update due",
    "stale",
    "log note",
    "weekly",
    "urgency",
    "overdue",
    "action due",
    "governance",
  ],
  menus: ["governance", "admin"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "governance-hub-issue",
    "hub-three-streams",
    "deferral-across-ops",
    "ryge-philosophy",
    "admin-overview",
  ],
  steps: [
    {
      heading: "Open items are living work",
      body: "Human Incidents, Maintenance, and Compliance tickets that stay Open / In progress are not “set and forget.” Someone must keep the trail current with Log Note (what changed, next step, who owns it) until Resolve / close — or explicitly Defer to a next-action date.",
    },
    {
      heading: "Active SLA clock (not deferred)",
      body: "While an item is active (not deferred), the Hub watches time since the last log-note activity (or created time if there are no notes yet). After the Admin yellow threshold with no update, the card shows Update Due (amber). After the Admin red threshold with still no update, it shows Stale (red). This urgency badge is separate from the RYGE Green/Yellow/Red severity of the original issue.",
    },
    {
      heading: "Defer pauses the silence clock",
      body: "Defer / Set next action date parks the item and pauses the Update Due / Stale clock while the defer deadline is still in the future. When the deadline passes with no new activity, urgency becomes Action Due, then Overdue after the Admin overdue window. A Log Note after the deadline restarts the normal active SLA.",
    },
    {
      heading: "How to stay green on urgency",
      body: "Open Manage issue → Log Note with a real operational update (or Resolve if done). Cosmetic “bump” notes without substance waste the audit trail — write what a manager or auditor needs next week.",
    },
    {
      heading: "Thresholds are configured in Admin",
      body: "Do not memorise hours/days from training slides. Managers set Human, Maintenance, and Compliance urgency keys under Admin → System Parameters (active yellow / active red, plus defer rewarn and defer overdue). Human issues use hour-based keys; Maintenance and Compliance use day-based keys. Dashboard tiles such as Hub Human Issues (stale) follow the same idea.",
    },
    {
      heading: "Dashboard pairing",
      body: "The Operations Dashboard surfaces stale / overdue Hub work in Duty of Care tiles (e.g. Hub Human Issues). Treat those tiles as a prompt to open Governance Hub and update or defer — not as a different rule set.",
    },
  ],
};

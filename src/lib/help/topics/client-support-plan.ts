import type { HelpTopic } from "../types";

export const clientSupportPlanTopic: HelpTopic = {
  id: "client-support-plan",
  kind: "howto",
  title: "Client support plan, risk and communication",
  summary:
    "Record a thin organisational support plan (goals, strengths, needs, communication, risk) in the Client intake pack and Care Profile. Hub review dates reset when the pack is signed and filed.",
  keywords: [
    "support plan",
    "risk assessment",
    "communication",
    "goals",
    "strengths",
    "onboarding",
    "care profile",
    "BL-114",
    "intake",
  ],
  menus: ["participants", "admin", "governance"],
  roles: ["manager", "assistant_manager"],
  relatedIds: ["add-participants", "hub-update-sla", "admin-overview"],
  steps: [
    {
      heading: "Use the Client intake pack for signed evidence",
      body: "Participants → Client onboarding (or Care Profile → onboarding). Inbox is Hub → Onboarding — not Admin. Print blank anytime (no fields required), fill by hand, then type it in. Continue to confirm: tick the office box in the footer (red until ticked), then Confirm fields — PIN. Print the filled pack, wet-sign, then Signed & filed with a Filing location.",
    },
    {
      heading: "What to write (keep it thin)",
      body: "Day centre, community access and transport only (0136 / 0125 / 0108) — not a SIL care plan. Goals, strengths, needs, preferences; how they communicate and what staff should do; what to watch for and what staff do. If nothing extra applies, write that clearly (e.g. None identified for YADA supports).",
    },
    {
      heading: "Rights and handbook acknowledgement",
      body: "The Client pack now includes a tick for the Participant Handbook, rights, and how to complain (including anonymously). That tick is required before Confirm. Photo consent can still be declined.",
    },
    {
      heading: "Care Profile is the live office copy",
      body: "Participants → open the person → Support & risk. Office can update the live fields there. Hub review dates do not move until you Onboarding Review/Update, print, and re-file.",
    },
    {
      heading: "Hub review currency",
      body: "On Signed & filed, Hub Compliance gets Client support plan and Client risk assessment cards (same +12 months as profile review and consent pack). Upcoming reviews also appear on Hub → Onboarding (Review due) and the Dashboard Band 3 Onboarding review tile. Yellow/red days are Admin → System Parameters → Onboarding review windows (default 30 / 0). Review/Update supersedes the old pack and resets those dates. If you file after the due date, a Why was this review late? note is required — it stays on the pack trail, not as a Human Incident.",
    },
  ],
};

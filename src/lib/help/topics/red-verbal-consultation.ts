import type { HelpTopic } from "../types";

export const redVerbalConsultationTopic: HelpTopic = {
  id: "red-verbal-consultation",
  kind: "howto",
  title: "RED button — Verbal consultation",
  summary:
    "Log a RED anomaly, name the manager you spoke with, sign with operator PIN; the ticket lands in the Governance Hub.",
  keywords: [
    "red",
    "anomaly",
    "verbal",
    "consultation",
    "escalation",
    "incident",
    "workaround",
    "big red",
  ],
  menus: ["red", "governance", "manifest", "day", "event-deliver"],
  roles: ["driver", "support_worker", "manager", "assistant_manager"],
  relatedIds: [
    "ryge-philosophy",
    "hub-three-streams",
    "governance-hub-issue",
    "sign-in-pin",
  ],
  steps: [
    {
      heading: "Open Log anomaly / RED",
      body: "From Manifest, Day Centre, Event Deliver, or the global Big Red paths, choose the RED / Log anomaly action for what went wrong (transport, site, trip-day, etc.).",
    },
    {
      heading: "Describe the issue",
      body: "Fill the anomaly form with enough detail for the Hub. Required fields stay outlined until complete — the primary action stays off until they pass.",
    },
    {
      heading: "Verbal consultation dialog",
      body: "For RED, you select the manager you contacted (or attempted to reach) by name. You do not need the manager’s PIN on the floor — only the operator PIN for sign-off.",
    },
    {
      heading: "Operator PIN sign-off",
      body: "Enter your PIN on the Pad. On success the app writes the ledger verbal-consultation event and creates a Hub issue (often tagged as a verbal workaround) for manager confirmation later.",
    },
    {
      heading: "After the ticket lands",
      body: "Continue the safe workaround agreed verbally. Managers confirm and progress the issue in Governance Hub. Do not treat the old escalation-lock panel as the current RED path.",
    },
  ],
};

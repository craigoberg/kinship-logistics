import type { HelpTopic } from "../types";

export const governanceHubIssueTopic: HelpTopic = {
  id: "governance-hub-issue",
  kind: "howto",
  title: "Governance Hub — Find and update an issue",
  summary:
    "Locate a Hub ticket, read severity and notes, add an update, and progress resolution (manager-leaning).",
  keywords: [
    "hub",
    "governance",
    "issue",
    "ticket",
    "ryge",
    "resolve",
    "note",
    "maintenance",
    "ndis",
  ],
  menus: ["governance"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "ryge-philosophy",
    "hub-three-streams",
    "deferral-across-ops",
    "red-verbal-consultation",
    "day-centre-happy-path",
  ],
  steps: [
    {
      heading: "Open Governance Hub",
      body: "From the menu, open Governance Hub. Work sits in three streams — Human, Maintenance, Compliance — plus Health & Safety tiles for emergencies (see Hub three streams).",
    },
    {
      heading: "Find the issue",
      body: "Use the tab / tile that matches the subject (person vs asset vs expiry), then severity (RED → YELLOW → GREEN). Tap the card to open Manage issue.",
    },
    {
      heading: "Read the trail",
      body: "Check RYGE severity, when it was raised, verbal-workaround tags, and prior Hub notes. Stale or deferred-until urgency may colour the card.",
    },
    {
      heading: "Add an update",
      body: "Log Note with what changed operationally. Keep facts clear for auditors — free text is retained in packs.",
    },
    {
      heading: "Progress, defer, or resolve",
      body: "Confirm verbal RED when needed, Defer / Set next action date to park with a deadline, Resolve to close, or escalate to council where applicable. Sign with PIN when the dialog requires it.",
    },
  ],
};

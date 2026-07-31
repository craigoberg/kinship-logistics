import type { HelpTopic } from "../types";

export const hubThreeStreamsTopic: HelpTopic = {
  id: "hub-three-streams",
  kind: "howto",
  title: "Governance Hub — three streams (what goes where)",
  summary:
    "Human Incidents, Maintenance & Repairs, and Compliance & Renewals — purpose of each stream and what information belongs there.",
  keywords: [
    "hub",
    "governance",
    "human",
    "maintenance",
    "compliance",
    "streams",
    "tabs",
    "renewals",
    "health and safety",
  ],
  menus: ["governance"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "ryge-philosophy",
    "deferral-across-ops",
    "governance-hub-issue",
    "red-verbal-consultation",
  ],
  steps: [
    {
      heading: "Three streams, one RYGE language",
      body: "Governance Hub organises work by what the issue is about — not by colour. Any stream can hold Green, Yellow, or Red items. Pick the tab that matches the subject; use RYGE for urgency.",
    },
    {
      heading: "Human Incidents — people",
      body: "Injuries, welfare concerns, disputes, near-misses, left-trip safety dispositions, and other person-centred events. Big Red → Human / Operational lands here. Notes and resolution live on the Manage issue trail for auditors.",
    },
    {
      heading: "Maintenance & Repairs — things and places",
      body: "Physical faults: venue defects, broken equipment, bus/vehicle issues, dented panels, graffiti. Walk-arounds (Day Centre, venue, pre-trip bus) and Big Red → Equipment & Asset Fault route here. Green cosmetic items still belong in this stream until closed.",
    },
    {
      heading: "Compliance & Renewals — dates and certificates",
      body: "Expiry-driven items: insurance, vehicle rego, staff certs (WWC, First Aid, SFH, licence), venue safety baseline renewals, formal audits. Severity is usually computed from dates (e.g. approaching expiry = Yellow, overdue = Red) — you do not manually “paint” compliance Green/Yellow/Red the same way as a walk-around.",
    },
    {
      heading: "Health & Safety sits beside the three streams",
      body: "Infectious exclusion, lockdown / do-not-open, programme suspend, and Drill/Live emergencies use the Big Red → Health & Safety lane and Hub Health & Safety / Emergency tiles. They are not free-text Human or Asset INCIDENT forms. Stand-down clears floor banners but does not auto-resolve the Hub Open ticket.",
    },
    {
      heading: "What to put in notes",
      body: "Facts: who/what/when, workaround in use, who was consulted, next action, evidence links. Append-only notes (no silent edit/delete) — treat the trail as the audit story for the NDIS pack.",
    },
    {
      heading: "Active vs Deferred vs resolved",
      body: "Active lists what needs attention now. Defer parks an item until a next-action date (see Defer how-to). Resolve closes the operational loop with justification; Compliance may archive/renew instead of a simple resolve.",
    },
  ],
};

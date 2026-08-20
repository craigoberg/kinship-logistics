import type { HelpTopic } from "../types";

export const hubThreeStreamsTopic: HelpTopic = {
  id: "hub-three-streams",
  kind: "howto",
  title: "Governance Hub — streams (what goes where)",
  summary:
    "Human Incidents, Maintenance & Repairs, Compliance & Renewals, and App tickets — purpose of each stream and what information belongs there.",
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
    "app tickets",
  ],
  menus: ["governance"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "ryge-philosophy",
    "hub-update-sla",
    "deferral-across-ops",
    "governance-hub-issue",
    "red-verbal-consultation",
    "app-tickets",
  ],
  steps: [
    {
      heading: "Streams by subject, not by colour",
      body: "Governance Hub organises work by what the issue is about — not by colour. Human, Maintenance, and Compliance can each hold Green, Yellow, or Red items. App tickets are always GREEN notes about the software. Pick the tab that matches the subject.",
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
      heading: "App tickets — the software, not the bus",
      body: "GREEN notes about Connect itself (a form would not save, a button did the wrong thing). Raised from the green Raise ticket control. Lives in Hub → App tickets and on the Dashboard App tickets tile. Do not put these in Maintenance or Human Incidents.",
    },
    {
      heading: "Health & Safety sits beside the streams",
      body: "Infectious exclusion, lockdown / do-not-open, programme suspend, and Drill/Live emergencies use the Big Red → Health & Safety lane and Hub Health & Safety / Emergency tiles. They are not free-text Human or Asset INCIDENT forms. Stand-down clears floor banners but does not auto-resolve the Hub Open ticket.",
    },
    {
      heading: "What to put in notes",
      body: "Facts: who/what/when, workaround in use, who was consulted, next action, evidence links. Append-only notes (no silent edit/delete) — treat the trail as the audit story for the NDIS pack.",
    },
    {
      heading: "Active vs Deferred vs resolved",
      body: "Active lists what needs attention now — and open Active items need regular Log Notes or they show Update Due / Stale (see Hub regular updates). Defer parks an item until a next-action date (see Defer how-to). Resolve closes the operational loop with justification; Compliance may archive/renew instead of a simple resolve.",
    },
  ],
};

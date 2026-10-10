import type { HelpTopic } from "../types";

export const addParticipantsTopic: HelpTopic = {
  id: "add-participants",
  kind: "howto",
  title: "Participants — add and open a care profile",
  summary:
    "Create an active participant (name + NDIS), open the care profile, then book them on Day Centre and event rosters.",
  keywords: [
    "participant",
    "participants",
    "client",
    "add new",
    "ndis",
    "directory",
    "care profile",
    "roster",
    "support plan",
  ],
  menus: ["participants", "events", "day"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "add-staff",
    "medication-rounds",
    "events-create-confirm-open",
    "client-support-plan",
    "run-planning",
  ],
  steps: [
    {
      heading: "Open Participants",
      body: "From the menu open Participants. Search by name or NDIS number. Under the search, turn on Participants, Guests, and Archived — selected is green. The day filter and the day columns only list days set in Admin → Lookups → Operating days (not every weekday). Transport / run is a separate filter.",
    },
    {
      heading: "Quick add",
      body: "Tap Quick add. First name, Last name, and NDIS number are required before Add participant enables. Optional fields include street address and IDDSI liquids/foods levels. Quick add is a short record. The full intake pack is Client onboarding.",
    },
    {
      heading: "Open a care profile",
      body: "Tap a row to open the care profile — allergies, diet/IDDSI, medications, transport preferences, and related notes. Support plan, communication and risk live on the Support & risk tab. Office edits here drive chips on Check-In and meal service.",
    },
    {
      heading: "Record medication admin (office)",
      body: "Use Record medication admin when capturing standing medication administration details into the profile (separate from giving a dose on the floor round).",
    },
    {
      heading: "Put them on a roster",
      body: "Day Centre attendance and Event Manage (click the event row → Roster) book participants from this directory. For bus passengers set Transport med bag before Confirm event. Weekly IN/OUT for the centre is on Run Planning, and only on operating days.",
    },
    {
      heading: "Client onboarding pack",
      body: "Client onboarding types the pack. Nothing is stored until Save draft. Print blank client on this page, or print a blank form from inside the open pack, if you need paper first. Hub → Onboarding is the inbox: Show, Pack, and Search, then click a row to open it. Delete stays on the row. The Person column shows the name saved on the form.",
    },
    {
      heading: "Guests vs registered clients",
      body: "Event Add guest creates a guest participant booking. Day Centre floor visitors are temporary site visitors — not the same as event guests.",
    },
  ],
};

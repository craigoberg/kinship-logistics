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
  ],
  menus: ["participants", "events", "day"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: ["add-staff", "medication-rounds", "events-create-confirm-open"],
  steps: [
    {
      heading: "Open Participants",
      body: "From the menu open Participants. Search by name or NDIS number; filter by day or transport/run if needed.",
    },
    {
      heading: "Add new participant",
      body: "Tap Add new participant. First name, Last name, and NDIS number are required before Add participant enables. Optional fields include street address and IDDSI liquids/foods levels.",
    },
    {
      heading: "Open a care profile",
      body: "Tap a row to open the care profile — allergies, diet/IDDSI, medications, transport preferences, and related notes. Office edits here drive chips on Check-In and meal service.",
    },
    {
      heading: "Record medication admin (office)",
      body: "Use Record medication admin when capturing standing medication administration details into the profile (separate from giving a dose on the floor round).",
    },
    {
      heading: "Put them on a roster",
      body: "Day Centre attendance and Event Manage → Roster book participants from this directory. For bus passengers set Transport med bag before Confirm event.",
    },
    {
      heading: "Guests vs registered clients",
      body: "Event Add guest creates a guest participant booking. Day Centre floor visitors are temporary site visitors — not the same as event guests.",
    },
  ],
};

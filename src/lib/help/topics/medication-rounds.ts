import type { HelpTopic } from "../types";

export const medicationRoundsTopic: HelpTopic = {
  id: "medication-rounds",
  kind: "howto",
  title: "Medication — rounds, handover, and Give Dose",
  summary:
    "Run medication rounds on Day Centre and Programme: dual staff PIN or sole carer, outcomes, Complete, plus transport med-bag handover on bus.",
  keywords: [
    "medication",
    "meds",
    "med round",
    "give dose",
    "handover",
    "prn",
    "dual pin",
    "sole carer",
    "med bag",
    "administered",
  ],
  menus: ["day", "event-deliver", "participants"],
  roles: ["support_worker", "manager", "assistant_manager"],
  relatedIds: ["meals-service", "add-participants", "day-centre-happy-path"],
  steps: [
    {
      heading: "Open the medication round",
      body: "Day Centre → Activities or Event Deliver → Programme → Medication round. Open / start when pending, then expand today’s due doses.",
    },
    {
      heading: "Administer a dose",
      body: "Tap Due Soon / Administer (or the administer control) to open Medication administration. Set Outcome: Administered, Refused, or Missed (Refused / sole-carer need notes ≥10 characters).",
    },
    {
      heading: "Sign-off mode",
      body: "Choose Dual staff PIN (administering + witness — never a client as witness) or Sole carer PIN with justification ≥10 when only one authorised carer is available.",
    },
    {
      heading: "Complete the round",
      body: "Complete stays disabled until required doses are managed. Day 2+ morning roll can block opening activities until wake accountability is done.",
    },
    {
      heading: "Office profile vs floor dose",
      body: "Participants → Record medication admin and the care profile hold standing medication setup. Floor rounds record what was given that session — they are not the same action.",
    },
    {
      heading: "Transport med bag",
      body: "On Event Manage Roster, bus passengers need a Transport med bag decision before Confirm. Outbound Manifest prompts handover when a bag is required — treat that as part of med custody for the run.",
    },
  ],
};

import type { HelpTopic } from "../types";

export const dayCentreHappyPathTopic: HelpTopic = {
  id: "day-centre-happy-path",
  kind: "howto",
  title: "Day Centre — Open, Check-In, Close",
  summary:
    "Happy path for Alpha: clear RED blockers, open the centre, check participants in/out, run Activities, then close.",
  keywords: [
    "day centre",
    "open centre",
    "close centre",
    "check-in",
    "check-out",
    "attendance",
    "activities",
    "meals",
    "end of day report",
    "end-of-day",
    "meds",
  ],
  menus: ["day"],
  roles: ["support_worker", "manager", "assistant_manager", "driver"],
  relatedIds: [
    "checkin-roll-escalations",
    "meals-service",
    "medication-rounds",
    "red-verbal-consultation",
    "manifest-start-run",
  ],
  steps: [
    {
      heading: "Clear open RED blockers",
      body: "Day Centre cannot open while unresolved RED site issues lack an agreed workaround. A manager must clear or workaround them in the Hub first.",
    },
    {
      heading: "Open the Day Centre",
      body: "On Day Centre → Start of day, complete mandated open checks, then Declare Site Safe & Open with the Site Opener PIN.",
    },
    {
      heading: "Check-In",
      body: "On Active Day → Check-In, mark expected participants present (or absent with reason + PIN). Absent people stay on the roll but are off morning and afternoon Manifest. If they turn up later, set arrival method (usually Self / family) and tap the wide row — that is a late arrival: they check in, go onto Check-Out, and onto the afternoon bus if that is how they go home. + Add Attendee is for a registered client who was not on today’s roll (or was Off today and then arrived); you must pick how they go home. + Add visitor is for non-clients (family, trades, site visitors).",
    },
    {
      heading: "Activities (meals & meds)",
      body: "Use the Activities tab for meal open/serve and medication rounds. Complete required dispositions before hard-complete on timed items.",
    },
    {
      heading: "Check-Out and Close",
      body: "Check participants out as they leave. Visitors must not remain present at Close. Initiate Day Centre Closure, complete close checks, and re-auth with PIN.",
    },
    {
      heading: "End of Day Report",
      body: "Scroll to End of Day Report on Day Centre. The calendar defaults to operational today (honours SIM TIME). Pick another day to see who came in (how and when), meal dispositions (Served / Modified / Own order / Declined / N/A), who went home, visitors, and issues raised.",
    },
  ],
};

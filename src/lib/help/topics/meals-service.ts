import type { HelpTopic } from "../types";

export const mealsServiceTopic: HelpTopic = {
  id: "meals-service",
  kind: "howto",
  title: "Meals — open, prepare, and serve",
  summary:
    "How meal service works on Day Centre Activities and trip Programme: Open meal, preparer / SFH, dispositions, then Complete.",
  keywords: [
    "meal",
    "meals",
    "food",
    "sfh",
    "safe food handling",
    "preparer",
    "serve",
    "activities",
    "menu",
    "complete",
  ],
  menus: ["day", "event-deliver", "admin"],
  roles: ["support_worker", "manager", "assistant_manager", "driver"],
  relatedIds: ["medication-rounds", "day-centre-happy-path", "event-deliver-happy-path"],
  steps: [
    {
      heading: "Find the meal",
      body: "Day Centre → Activities (centre must be open) or Event Deliver → Programme → meal row. Tap Open to launch Open meal.",
    },
    {
      heading: "Meal source",
      body: "Choose source such as Cooked / delivered by us, Packed from centre, Brought own food, Venue provided, or Takeaway / purchase. Cooked/packed paths require preparer and prep ticks (from Admin meal.prep_checks).",
    },
    {
      heading: "Preparer and SFH",
      body: "Pick Staff preparer or Guest / external preparer. Missing or expired Safe Food Handling needs a Manager note (≥10 characters) and Manager PIN before the preparer can attest.",
    },
    {
      heading: "Open meal service",
      body: "Hand the tablet to the preparer (or MoD for guest): confirm prep ticks, then PIN. Open meal service leaves the day-session user logged in.",
    },
    {
      heading: "Serve roll — checked-in only",
      body: "Mark each person Served, Modified, Own order, Declined, or N/A. Complete stays blocked while anyone is still expected on the roll.",
    },
    {
      heading: "Trip morning-roll gate",
      body: "On Day 2+ Event Deliver, Morning Roll Call may block Open (“Morning roll required before Open”) until the wake roll is done.",
    },
  ],
};

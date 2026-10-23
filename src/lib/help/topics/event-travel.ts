import type { HelpTopic } from "../types";

export const eventTravelTopic: HelpTopic = {
  id: "event-travel",
  kind: "howto",
  title: "Event Manage — who joins and who leaves",
  summary:
    "On Travel, each confirmed person joins at the meeting point or on the trip, and leaves at the departure point or before it. Saved places and a one-off address are on that line.",
  keywords: [
    "travel",
    "joins trip",
    "leaves trip",
    "meeting point",
    "on trip",
    "departure point",
    "before departure",
    "pickup",
    "drop-off",
    "bus",
    "self",
    "address",
    "one-off",
    "staff",
    "carer",
  ],
  menus: ["events"],
  roles: ["manager", "assistant_manager", "support_worker"],
  relatedIds: [
    "events-create-confirm-open",
    "event-overnight-hotel",
    "event-deliver-happy-path",
    "manifest-start-run",
  ],
  steps: [
    {
      heading: "Open Travel",
      body: "Event Manage → click the event row → Travel. Only people set to Confirmed on Roster appear. Waitlisted and cancelled stay on Roster. The list splits into On the bus and Self — not on the bus. Drag people on the bus to set pickup order. The driver can still reorder on the manifest.",
    },
    {
      heading: "Everyone has their own line",
      body: "Participants, staff, volunteers, and carers each have Joins trip and Leaves trip on this tab only. A carer travelling with someone is still named under that person on Roster, without these choices. The same carer with more than one person is one line here, and a change is saved for each of them. The pencil opens the roster edit form.",
    },
    {
      heading: "Joins at the meeting point",
      body: "Joins trip → At meeting point. To meeting point is then Bus or Self. Bus is a door pickup to the meeting point. Self means they make their own way to the meeting point. They are on the bus from the meeting point.",
    },
    {
      heading: "Joins on the trip",
      body: "Joins trip → On trip. Bus and Self for the meeting point are hidden. Where they join is the address they make their own way to. The bus collects them there. They are not also picked up on the way to the meeting point. The itinerary gains a Pickup row just after the meeting point. Drag that row if the stop belongs later.",
    },
    {
      heading: "Leaves at the departure point",
      body: "Leaves trip → At departure point. They stay with the group until then. Home from departure is Bus or Self. Bus drives them home from the departure point. Self means they get themselves home, and there is no extra stop.",
    },
    {
      heading: "Leaves before the departure point",
      body: "Leaves trip → Before departure. Bus and Self for the way home are hidden. Where they leave is the address. The bus drops them there and does not also drive them home afterwards. The itinerary gains a Drop-off row just before the departure point. Drag that row if they get off earlier.",
    },
    {
      heading: "Choose the address",
      body: "Tap the address. Home is the street on their profile. Other places saved under Contact are listed under it. One-off address is typed for this trip only and is not added to their places. An empty address that would add an itinerary row shows a warning border until it is filled.",
    },
    {
      heading: "Pickup and Drop-off rows",
      body: "Those itinerary rows are not programme places. They do not become the meeting point or the departure point, and they are not opened as an activity. The row stays, and cannot be deleted, while anyone is assigned to that address. Putting everyone back on the meeting point or the departure point removes it. Two people at the same address share one row.",
    },
  ],
};

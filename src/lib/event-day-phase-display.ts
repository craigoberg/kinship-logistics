/**
 * Trip-day phase labels for Event Deliver (field) vs office event status.
 *
 * Office "Open" = event promoted for operations. Each calendar day still has its
 * own `event_day_sessions.phase` until the trip leader opens that day's location.
 */
export type EventDayPhaseDisplay = {
  label: string;
  classes: string;
};

export function getEventDayPhaseDisplay(
  phase: string,
  eventStatus?: string | null,
): EventDayPhaseDisplay {
  const eventOpen = eventStatus === "Open";

  switch (phase) {
    case "active":
      return { label: "Open — live", classes: "bg-emerald-600 text-white" };
    case "closed_orderly":
      return { label: "Day closed", classes: "bg-zinc-600 text-white" };
    case "closed_incident":
      return { label: "Day closed — incident", classes: "bg-destructive text-destructive-foreground" };
    case "pre_departure":
      return { label: "Pre-departure", classes: "bg-yellow-500 text-black" };
    case "in_transit":
      return { label: "In transit", classes: "bg-yellow-500 text-black" };
    case "at_base":
      return { label: "At base", classes: "bg-blue-600 text-white" };
    case "planning":
      if (eventOpen) {
        return {
          label: "Day not started",
          classes: "border border-primary/40 bg-primary/10 text-primary",
        };
      }
      return { label: "Awaiting open", classes: "bg-muted text-muted-foreground" };
    default:
      return { label: phase, classes: "bg-muted text-muted-foreground" };
  }
}

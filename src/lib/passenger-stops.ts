/**
 * Where a person joins an outing, and where they leave it.
 *
 * Joins at the meeting point: Bus is a door pickup to that point, Self is
 * their own way there. Joins on the trip (`address`): they make their own
 * way to that stop and the bus collects them there.
 *
 * Leaves at the departure point: Bus is a door drop-off from that point, Self
 * is their own way home. Leaves before it (`address` or `same`): the bus
 * drops them at that stop, which sits on the itinerary before the departure
 * point.
 *
 * Null still matches the older door-to-door run. New rows default to the
 * meeting point and the departure point.
 */

export type PickupJoin = "meeting_point" | "home" | "address";
export type AlightMode = "departure_point" | "home" | "same" | "address";

export type PassengerStopKind = "passenger_pickup" | "passenger_dropoff";

export function normalizeStopAddress(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function addressKey(value: string | null | undefined): string {
  return normalizeStopAddress(value).toLowerCase();
}

/** Null keeps the door-to-door pickup that existed before passenger stops. */
export function effectivePickupJoin(value: string | null | undefined): PickupJoin {
  if (value === "meeting_point" || value === "address" || value === "home") return value;
  return "home";
}

/** Null keeps the door-to-door drop-off that existed before passenger stops. */
export function effectiveAlightMode(value: string | null | undefined): AlightMode {
  if (
    value === "departure_point" ||
    value === "home" ||
    value === "same" ||
    value === "address"
  ) {
    return value;
  }
  return "home";
}

export function isPassengerStopKind(kind: string | null | undefined): boolean {
  return kind === "passenger_pickup" || kind === "passenger_dropoff";
}

/** On the bus from the meeting point, not a door on the way there. */
export function boardsAtMeetingPoint(value: string | null | undefined): boolean {
  return effectivePickupJoin(value) === "meeting_point";
}

/** Collected at an itinerary stop after the bus leaves the meeting point. */
export function joinsOnTheWay(value: string | null | undefined): boolean {
  return effectivePickupJoin(value) === "address";
}

/** Leaves at the departure point and is not driven on to a home door. */
export function alightsAtDeparturePoint(value: string | null | undefined): boolean {
  return effectiveAlightMode(value) === "departure_point";
}

/** Leaves before the departure point. The address is an itinerary drop-off. */
export function alightsOnTheWay(value: string | null | undefined): boolean {
  const mode = effectiveAlightMode(value);
  return mode === "same" || mode === "address";
}

export function passengerStopLabel(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  return unique.join(", ") || "Passenger";
}

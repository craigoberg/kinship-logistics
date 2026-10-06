import { operationalNowMs } from "@/lib/operational-clock";

export type FloorRollMode = "all" | "check_in" | "check_out";
export type FloorEscalation = "yellow" | "red" | null;

/**
 * One colour rule for a Day Centre floor row. Clients pass the stored
 * departure severity. Support derives it from the operational clock.
 */
export function floorRollStatus(args: {
  mode: FloorRollMode;
  status: string;
  escalationSeverity: FloorEscalation;
  departureSeverity: FloorEscalation;
}) {
  const isIn = args.status === "checked_in";
  const isOut = args.status === "checked_out";
  const isAbsent = args.status === "absent";
  const depRed = args.departureSeverity === "red" && isIn;
  const depYellow = args.departureSeverity === "yellow" && isIn && !depRed;
  const isRed =
    !isAbsent && !isOut && ((args.escalationSeverity === "red" && !isIn) || depRed);
  const isYellow =
    !isAbsent &&
    !isOut &&
    !isRed &&
    ((args.escalationSeverity === "yellow" && !isIn) || depYellow);
  const arrivalDone = args.mode !== "check_out" && isIn && !isYellow && !isRed;
  const departureDone = args.mode === "check_out" && isOut;
  const awaitingDeparture = args.mode === "check_out" && isIn && !isYellow && !isRed;
  const hiVisDone = arrivalDone || departureDone;
  return {
    isIn,
    isOut,
    isAbsent,
    depRed,
    depYellow,
    isRed,
    isYellow,
    arrivalDone,
    departureDone,
    awaitingDeparture,
    hiVisDone,
  };
}

/** Same yellow/red windows as the client departure sweep, without a second store. */
export function departureSeverityFromClock(
  expectedDepartureAt: string | null,
  checkedIn: boolean,
  yellowMins: number,
  redMins: number,
  nowMs = operationalNowMs(),
): FloorEscalation {
  if (!checkedIn || !expectedDepartureAt) return null;
  const expected = Date.parse(expectedDepartureAt);
  if (!Number.isFinite(expected)) return null;
  const overdueMins = Math.floor((nowMs - expected) / 60_000);
  if (overdueMins >= redMins) return "red";
  if (overdueMins >= yellowMins) return "yellow";
  return null;
}

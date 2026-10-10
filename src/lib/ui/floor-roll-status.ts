export type FloorRollMode = "all" | "check_in" | "check_out";
export type FloorEscalation = "yellow" | "red" | null;

/**
 * One colour rule for a Day Centre floor row. Clients pass stored
 * arrival and departure severity. Non-clients pass null for both.
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

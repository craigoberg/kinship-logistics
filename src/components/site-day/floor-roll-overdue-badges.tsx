import { Badge } from "@/components/ui/badge";

/** Amber/red chips shared by the client roll and the support roll. */
export function FloorRollOverdueBadges({
  depRed,
  depYellow,
  isRed,
  isYellow,
  departureManagerNotified = false,
}: {
  depRed: boolean;
  depYellow: boolean;
  isRed: boolean;
  isYellow: boolean;
  /** True when a departure sweep has written the Hub issue (clients). */
  departureManagerNotified?: boolean;
}) {
  return (
    <>
      {depRed && (
        <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
          {departureManagerNotified
            ? "Departure Escalated — Manager notified"
            : "Departure Escalated"}
        </Badge>
      )}
      {depYellow && (
        <Badge className="bg-amber-500 text-white text-[10px] uppercase">
          Departure Overdue
        </Badge>
      )}
      {isRed && !depRed && (
        <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
          Escalated — Manager notified
        </Badge>
      )}
      {isYellow && !depYellow && (
        <Badge className="bg-amber-500 text-white text-[10px] uppercase">
          Overdue
        </Badge>
      )}
    </>
  );
}

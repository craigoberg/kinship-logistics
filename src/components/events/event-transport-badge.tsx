import { cn } from "@/lib/utils";
import {
  EVENT_TRANSPORT_BADGE_CLASS,
  eventTransportLabel,
  normalizeEventTransportMode,
} from "@/lib/api/event-transport";

interface Props {
  mode: string;
  /** Optional prefix, e.g. "Out" or "Ret". */
  prefix?: string;
  /**
   * BL-069 — when mode is bus, show run short label (R1/R2) instead of "Bus".
   * Ignored for self / private.
   */
  runLabel?: string | null;
  className?: string;
}

/** Colored bus/self badge — matches Participants directory (blue bus, slate self). */
export function EventTransportBadge({ mode, prefix, runLabel, className }: Props) {
  const normalized = normalizeEventTransportMode(mode);
  const base = eventTransportLabel(mode);
  const phrase = runLabel?.trim() ?? "";
  const keepCase = normalized === "bus" && phrase.includes(" ");
  const label =
    normalized === "bus" && phrase && phrase.toUpperCase() !== "BUS"
      ? keepCase
        ? phrase
        : phrase.toUpperCase()
      : base;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
        keepCase ? "normal-case" : "uppercase",
        EVENT_TRANSPORT_BADGE_CLASS[normalized],
        className,
      )}
    >
      {prefix ? `${prefix}: ${label}` : label}
    </span>
  );
}

interface PairProps {
  outbound: string;
  return: string;
  plannedOutbound?: string;
  plannedReturn?: string;
  /** BL-069 short labels e.g. R1 / R2 for bus modes. */
  outboundRunLabel?: string | null;
  returnRunLabel?: string | null;
  className?: string;
}

/** Roster trip legs: blue Out line, then blue Ret line. Self uses the same chips. */
function TripLegBadge({
  mode,
  prefix,
  runLabel,
}: {
  mode: string;
  prefix: "Out" | "Ret";
  runLabel?: string | null;
}) {
  const phrase = runLabel?.trim();
  const label = phrase && phrase.toUpperCase() !== "BUS" ? phrase : eventTransportLabel(mode);
  return (
    <span className="inline-flex items-center rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
      {prefix}: {label}
    </span>
  );
}

/** Out + Ret pair for roster rows; shows struck-through plan when floor ops differed. */
export function EventTransportPair({
  outbound,
  return: returnMode,
  plannedOutbound,
  plannedReturn,
  outboundRunLabel,
  returnRunLabel,
  className,
}: PairProps) {
  const outChanged = plannedOutbound != null && outbound !== plannedOutbound;
  const retChanged = plannedReturn != null && returnMode !== plannedReturn;

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <TripLegBadge mode={outbound} prefix="Out" runLabel={outboundRunLabel} />
      {outChanged && (
        <span className="text-[9px] text-muted-foreground line-through">
          Planned {eventTransportLabel(plannedOutbound!)}
        </span>
      )}
      <TripLegBadge mode={returnMode} prefix="Ret" runLabel={returnRunLabel} />
      {retChanged && (
        <span className="text-[9px] text-muted-foreground line-through">
          Planned {eventTransportLabel(plannedReturn!)}
        </span>
      )}
    </div>
  );
}

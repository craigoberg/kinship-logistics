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
  const label =
    normalized === "bus" && runLabel && runLabel.trim() && runLabel.trim().toUpperCase() !== "BUS"
      ? runLabel.trim().toUpperCase()
      : base;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
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
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <div className="flex flex-col gap-0.5">
        <EventTransportBadge mode={outbound} prefix="Out" runLabel={outboundRunLabel} />
        {outChanged && (
          <span className="text-[9px] text-muted-foreground line-through">
            Planned {eventTransportLabel(plannedOutbound!)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <EventTransportBadge mode={returnMode} prefix="Ret" runLabel={returnRunLabel} />
        {retChanged && (
          <span className="text-[9px] text-muted-foreground line-through">
            Planned {eventTransportLabel(plannedReturn!)}
          </span>
        )}
      </div>
    </div>
  );
}

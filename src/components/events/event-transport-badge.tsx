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
  className?: string;
}

/** Colored bus/self badge — matches Participants directory (blue bus, slate self). */
export function EventTransportBadge({ mode, prefix, className }: Props) {
  const normalized = normalizeEventTransportMode(mode);
  const label = eventTransportLabel(mode);
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
  className?: string;
}

/** Out + Ret pair for roster rows; shows struck-through plan when floor ops differed. */
export function EventTransportPair({
  outbound,
  return: returnMode,
  plannedOutbound,
  plannedReturn,
  className,
}: PairProps) {
  const outChanged = plannedOutbound != null && outbound !== plannedOutbound;
  const retChanged = plannedReturn != null && returnMode !== plannedReturn;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <div className="flex flex-col gap-0.5">
        <EventTransportBadge mode={outbound} prefix="Out" />
        {outChanged && (
          <span className="text-[9px] text-muted-foreground line-through">
            Planned {eventTransportLabel(plannedOutbound!)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <EventTransportBadge mode={returnMode} prefix="Ret" />
        {retChanged && (
          <span className="text-[9px] text-muted-foreground line-through">
            Planned {eventTransportLabel(plannedReturn!)}
          </span>
        )}
      </div>
    </div>
  );
}

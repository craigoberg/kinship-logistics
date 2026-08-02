import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  HALF_HOUR_CLOCK_OPTIONS,
  isHalfHourClockTime,
  isValidClockTime,
  padClockTime,
} from "@/lib/tour-roll-call";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** When true, only :00 and :30 minutes are accepted. */
  halfHourOnly?: boolean;
}

/**
 * Single HH:mm field — free-typed or picked from a 24-hour half-hour popup.
 */
export function HalfHourTimeField({
  id,
  value,
  onChange,
  disabled,
  className,
  halfHourOnly = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedValue = padClockTime(value);
  const invalid =
    !!value &&
    (!isValidClockTime(value) || (halfHourOnly && !isHalfHourClockTime(value)));

  // Radix renders the popover into a portal — listRef isn't populated until
  // after the first paint.  Use rAF to defer both DOM operations.
  useEffect(() => {
    if (!open) return;
    let raf: number;
    raf = requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;

      // Scroll current selection into view (centred) without touching outer scroll.
      const selected = el.querySelector<HTMLElement>("[data-selected='true']");
      if (selected) {
        const itemTop = selected.offsetTop;
        const itemH = selected.offsetHeight;
        const listH = el.clientHeight;
        el.scrollTop = Math.max(0, itemTop - listH / 2 + itemH / 2);
      }

      // Mouse-wheel scrolling (Radix portal intercepts the passive wheel event).
      const onWheel = (e: WheelEvent) => {
        el.scrollTop += e.deltaY;
        e.preventDefault();
        e.stopPropagation();
      };
      el.addEventListener("wheel", onWheel, { passive: false });

      // Store cleanup on the element so we can remove it when the popover closes.
      (el as HTMLElement & { _wheelCleanup?: () => void })._wheelCleanup = () =>
        el.removeEventListener("wheel", onWheel);
    });

    return () => {
      cancelAnimationFrame(raf);
      const el = listRef.current;
      (el as (HTMLElement & { _wheelCleanup?: () => void }) | null)?._wheelCleanup?.();
    };
  }, [open]);

  const commit = (next: string) => {
    onChange(padClockTime(next));
  };

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const padded = padClockTime(value);
            if (padded && padded !== value) onChange(padded);
          }}
          placeholder="21:00"
          disabled={disabled}
          className={cn(
            "h-8 pr-9 font-mono text-sm",
            invalid && "border-destructive",
          )}
          inputMode="numeric"
          maxLength={5}
        />
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="absolute right-0 top-0 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Pick nearest half hour"
            title="Pick half-hour time"
          >
            <Clock className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-36 p-1" align="end">
        <div
          ref={listRef}
          className="max-h-52 overflow-y-auto overscroll-contain"
        >
          {HALF_HOUR_CLOCK_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              data-selected={selectedValue === t ? "true" : undefined}
              className={cn(
                "w-full rounded-sm px-2 py-1.5 text-left font-mono text-sm hover:bg-muted",
                selectedValue === t && "bg-primary/10 font-semibold text-primary",
              )}
              onClick={() => {
                commit(t);
                setOpen(false);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

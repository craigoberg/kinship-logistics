import type { ReactNode, KeyboardEvent } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  HUB_URGENCY_BADGE,
  type HubUrgency,
} from "@/lib/governance/hub-workflow-status";

interface HubListCardProps {
  /** Used for aria-label and accessibility. */
  summary: string;
  body: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  status?: ReactNode;
  /**
   * Staleness / deadline urgency badge. Rendered below the workflow status
   * badge. Pass "none" or omit to show nothing.
   */
  urgency?: HubUrgency;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}

/** Governance Hub list row — whole card opens Manage (BL-060). */
export function HubListCard({
  summary,
  body,
  meta,
  badges,
  status,
  urgency,
  onClick,
  disabled = false,
  ariaLabel,
  className,
}: HubListCardProps) {
  const urgencyBadge =
    urgency && urgency !== "none" ? HUB_URGENCY_BADGE[urgency] : null;
  const interactive = !!onClick && !disabled;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      aria-disabled={disabled || undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors",
        interactive &&
          "cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "opacity-70",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {badges && (
          <div className="flex w-[4.5rem] shrink-0 flex-col items-start gap-1.5">
            {badges}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              {body}
              {meta && (
                <div className="text-[11px] leading-snug text-muted-foreground">
                  {meta}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 pl-1">
              {status}
              {urgencyBadge && (
                <Badge className={cn("text-[10px] px-1.5 py-0", urgencyBadge.classes)}>
                  {urgencyBadge.label}
                </Badge>
              )}
              {interactive && (
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">{summary}</span>
    </div>
  );
}

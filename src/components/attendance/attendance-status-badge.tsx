import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/lib/data-store";

/**
 * Vibrant, high-contrast attendance pill — always solid background +
 * `text-white`. Mirrors the global status-color rules in
 * `.lovable/plan.md` §4.
 */
export function AttendanceStatusBadge({
  status,
  className,
}: {
  status: AttendanceStatus;
  className?: string;
}) {
  const tone =
    status === "Attended"
      ? "bg-success"
      : status === "No-Show"
        ? "bg-destructive"
        : status === "Cancelled" || status === "Sick"
          ? "bg-warning"
          : status === "Suspended"
            ? "bg-muted-foreground"
            : "bg-info";

  return (
    <Badge
      className={cn(
        "gap-1 border-transparent font-semibold text-white",
        tone,
        className,
      )}
    >
      {status}
    </Badge>
  );
}

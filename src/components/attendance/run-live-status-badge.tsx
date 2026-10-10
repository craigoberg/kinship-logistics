import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import type { RunLiveStatus } from "@/lib/api/run-live-status";

const TONE: Record<string, string> = {
  awaiting_pu: "bg-muted text-muted-foreground",
  traveling_to: "bg-blue-600 text-white",
  stopped_at: "bg-amber-500 text-amber-950",
  on_bus: "bg-success text-white",
  off_today: "bg-destructive text-white",
  dropped: "bg-slate-600 text-white",
  not_started: "bg-muted/60 text-muted-foreground",
};

export function RunLiveStatusBadge({
  status,
}: {
  status: RunLiveStatus | null | undefined;
}) {
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
          TONE[status.kind] ?? TONE.not_started,
        )}
      >
        {status.label}
      </span>
      {status.setAt ? (
        <ClientTime
          iso={status.setAt}
          options={{ hour: "2-digit", minute: "2-digit" }}
          className="font-mono text-[10px] tabular-nums text-muted-foreground"
        />
      ) : null}
    </span>
  );
}

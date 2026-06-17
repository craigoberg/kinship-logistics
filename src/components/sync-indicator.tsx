import { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useSyncQueue } from "@/hooks/use-sync-queue";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  compact?: boolean;
}

export function SyncIndicator({ className, compact = false }: Props) {
  const online = useOnlineStatus();
  const queue = useSyncQueue();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const pending = queue.filter((q) => q.status !== "synced").length;
  const stateLabel = !mounted ? "—" : online ? "Online" : "Offline";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white shadow-sm",
        online ? "bg-success" : "bg-destructive",
        className,
      )}
      aria-live="polite"
    >
      {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      <span>{stateLabel}</span>
      {pending > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white">
          <RefreshCw className="h-3 w-3" />
          {pending} {compact ? "" : "in queue"}
        </span>
      )}
    </div>
  );
}

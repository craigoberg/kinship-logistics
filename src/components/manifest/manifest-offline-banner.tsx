/**
 * Manifest mid-run offline status (BL-082 Alpha).
 * Banner when offline or outbox has pending / failed actions.
 */
import { CloudOff, Loader2, RefreshCw, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { useManifestOffline } from "@/hooks/use-manifest-offline";

interface Props {
  tripId: string;
  className?: string;
}

export function ManifestOfflineBanner({ tripId, className }: Props) {
  const { online, pendingCount, failedCount, flushing, lastFlushError, flush, hasPending } =
    useManifestOffline(tripId);

  if (online && !hasPending && !flushing) return null;

  const tone = !online
    ? "border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100"
    : failedCount > 0
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : "border-blue-500/40 bg-blue-500/10 text-blue-950 dark:text-blue-100";

  return (
    <div className={cn("rounded-xl border-2 px-3 py-3", tone, className)}>
      <div className="flex items-start gap-2">
        {!online ? (
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
        ) : flushing ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin opacity-80" />
        ) : (
          <Wifi className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">
            {!online
              ? pendingCount > 0
                ? `Offline — ${pendingCount} action${pendingCount === 1 ? "" : "s"} waiting to sync`
                : "Offline — mid-run actions are saved on this device"
              : flushing
                ? "Syncing manifest actions…"
                : failedCount > 0
                  ? `${failedCount} action${failedCount === 1 ? "" : "s"} failed to sync`
                  : `${pendingCount} action${pendingCount === 1 ? "" : "s"} waiting to sync`}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            {!online
              ? "Depart, arrive, boarding, and leg confirms keep working. Close Run needs signal."
              : lastFlushError ??
                "Close Run stays locked until these sync."}
          </p>
          {online && hasPending && (
            <div className="mt-2">
              <FieldActionButton
                variant="secondary"
                size="sm"
                className="inline-flex items-center justify-center"
                disabled={flushing}
                onClick={() => void flush()}
              >
                {flushing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry sync
                  </>
                )}
              </FieldActionButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

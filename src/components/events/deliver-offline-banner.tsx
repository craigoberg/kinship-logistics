/**
 * Trip Deliver offline status. Same banner as Manifest mid-run (BL-082).
 * Check-in, check-out, venue open/close, and activity check-in queue on this tablet.
 */
import { CloudOff, Loader2, RefreshCw, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { useDeliverOffline } from "@/hooks/use-deliver-offline";

interface Props {
  sessionId: string;
  className?: string;
}

export function DeliverOfflineBanner({ sessionId, className }: Props) {
  const { online, pendingCount, failedCount, flushing, lastFlushError, flush, hasPending } =
    useDeliverOffline(sessionId);

  const workflowHold =
    failedCount > 0 &&
    /not a connection problem|activity check-in|meal roll|already underway or this stop is open|no longer needed/i.test(
      lastFlushError ?? "",
    );

  if (online && !hasPending && !flushing) return null;

  const tone = !online || workflowHold
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
                : "Offline — check-in and venue taps are saved on this tablet"
              : flushing
                ? "Syncing Trip Deliver actions…"
                : failedCount > 0
                  ? workflowHold
                    ? "Held by the programme"
                    : "1 action could not sync"
                  : `${pendingCount} action${pendingCount === 1 ? "" : "s"} waiting to sync`}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            {!online
              ? "Taps stay on this tablet and upload in order when the link is back."
              : failedCount > 0
                ? `${lastFlushError ?? "The server did not take this tap."}${
                    pendingCount > failedCount
                      ? ` ${pendingCount - failedCount} later tap${pendingCount - failedCount === 1 ? "" : "s"} wait behind it.`
                      : ""
                  }`
                : lastFlushError ?? "These taps upload in the order they were made."}
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

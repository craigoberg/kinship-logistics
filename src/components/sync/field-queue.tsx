import { AlertCircle, Clock, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { FieldSyncRow } from "@/hooks/use-field-sync-queue";
import { discardDeliverOutboxItem } from "@/lib/deliver-offline/outbox";
import { flushDeliverOutbox } from "@/lib/deliver-offline/outbox";
import { discardManifestOutboxItem, flushManifestOutbox } from "@/lib/manifest-offline";
import { formatDateTime } from "@/lib/utils";

export function FieldQueue({ items }: { items: FieldSyncRow[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.source}:${item.id}`}>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {item.status === "failed" ? (
                  <Badge className="gap-1 border-transparent bg-destructive text-white">
                    <AlertCircle className="h-3 w-3" />
                    {/not a connection problem|activity check-in|meal roll|already underway or this stop is open|no longer needed/i.test(item.error ?? "")
                      ? "Held"
                      : "Could not sync"}
                  </Badge>
                ) : (
                  <Badge className="gap-1 border-transparent bg-info text-white">
                    <Clock className="h-3 w-3" /> Waiting
                  </Badge>
                )}
                <span className="text-sm font-semibold">{item.label}</span>
                <span className="text-xs text-muted-foreground">· {item.detail}</span>
                <span className="text-xs text-muted-foreground">· {item.source}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(item.createdAt)}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    if (item.source === "Trip Deliver") void flushDeliverOutbox();
                    else void flushManifestOutbox();
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (item.source === "Trip Deliver") void discardDeliverOutboxItem(item.id);
                    else void discardManifestOutboxItem(item.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </div>
            </div>
            {item.error ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{item.error}</span>
              </div>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

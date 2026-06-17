import { RefreshCw, Trash2, AlertCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { retry, discard } from "@/lib/sync-queue";
import type { SyncQueueItem } from "@/lib/data-store";

const TYPE_LABEL: Record<SyncQueueItem["type"], string> = {
  participant_update: "Participant update",
  transport_log: "Transport log",
  iddsi_change: "IDDSI change",
};

export function QueueTable({ items }: { items: SyncQueueItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        The sync queue is empty. All records have been delivered.
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id}>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={item.status} />
                <span className="text-sm font-semibold">{TYPE_LABEL[item.type]}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
                {item.attempts > 0 && (
                  <span className="text-xs text-muted-foreground">· {item.attempts} attempts</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retry(item.id)}
                  disabled={item.status === "retrying"}
                  className="gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => discard(item.id)}
                  className="gap-1 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard
                </Button>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(item.payload, null, 2)}
            </pre>
            {item.error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{item.error}</span>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: SyncQueueItem["status"] }) {
  if (status === "pending")
    return (
      <Badge variant="outline" className="gap-1 border-info/40 text-info-foreground">
        <Clock className="h-3 w-3" /> Pending
      </Badge>
    );
  if (status === "retrying")
    return (
      <Badge variant="outline" className="gap-1 border-warning/50 text-warning-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Retrying
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  return <Badge className="bg-success text-success-foreground">Synced</Badge>;
}

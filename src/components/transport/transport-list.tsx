import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock } from "lucide-react";
import type { SyncLog, Participant, TransportPayload, TransportStatus } from "@/lib/data-store";

interface Props {
  logs: SyncLog[];
  participants: Participant[];
}

function asTransport(log: SyncLog): TransportPayload | null {
  if (log.actionType !== "transport_log") return null;
  const p = log.payload as Partial<TransportPayload>;
  if (typeof p.pickup_odometer !== "number" || typeof p.dropoff_odometer !== "number") return null;
  return p as TransportPayload;
}

export function TransportList({ logs, participants }: Props) {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const transportLogs = logs
    .map((log) => ({ log, t: asTransport(log) }))
    .filter((x): x is { log: SyncLog; t: TransportPayload } => x.t !== null);

  if (transportLogs.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No transport logs yet today.
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {transportLogs.map(({ log, t }) => {
        const p = byId.get(t.participant_id);
        const km = t.dropoff_odometer - t.pickup_odometer;
        return (
          <li key={log.id}>
            <Card className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate font-medium">{p?.fullName ?? "Unknown participant"}</div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {new Date(t.timestamp).toLocaleString()} · {km} km
                </div>
                {t.notes && <div className="mt-1 text-xs italic text-muted-foreground">"{t.notes}"</div>}
              </div>
              <StatusBadge status={t.status} />
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge({ status }: { status: TransportStatus }) {
  if (status === "Arrived")
    return (
      <Badge className="gap-1 bg-success text-success-foreground hover:bg-success">
        <Check className="h-3 w-3" /> Arrived
      </Badge>
    );
  if (status === "No-show")
    return (
      <Badge variant="destructive" className="gap-1">
        <X className="h-3 w-3" /> No-show
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" /> En route
    </Badge>
  );
}

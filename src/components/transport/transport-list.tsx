import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Clock } from "lucide-react";
import type { TransportLog, Participant } from "@/lib/data-store";

interface Props {
  logs: TransportLog[];
  participants: Participant[];
}

export function TransportList({ logs, participants }: Props) {
  const byId = new Map(participants.map((p) => [p.id, p]));
  if (logs.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No transport logs yet today.
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {logs.map((log) => {
        const p = byId.get(log.participantId);
        const km = log.dropoffOdometer - log.pickupOdometer;
        return (
          <li key={log.id}>
            <Card className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="truncate font-medium">{p?.fullName ?? "Unknown participant"}</div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {new Date(log.timestamp).toLocaleString()} · {km} km
                </div>
                {log.notes && <div className="mt-1 text-xs italic text-muted-foreground">"{log.notes}"</div>}
              </div>
              <StatusBadge status={log.status} />
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge({ status }: { status: TransportLog["status"] }) {
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

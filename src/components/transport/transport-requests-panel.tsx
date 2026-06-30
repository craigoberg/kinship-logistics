import { useMemo, useState } from "react";
import { Plus, Pencil, X, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import type { Participant } from "@/lib/data-store";
import {
  todayDateStr,
  TRANSPORT_REQUEST_STATUS_LABELS,
  type TransportRequest,
} from "@/lib/api/transport-requests";
import {
  useTransportRequests,
  useCancelTransportRequest,
} from "@/hooks/use-supabase-data";
import { TransportRequestFormDialog } from "./transport-request-form-dialog";

function parseISODate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_CLS: Record<string, string> = {
  requested: "bg-slate-500 text-white",
  assigned: "bg-blue-600 text-white",
  in_progress: "bg-amber-500 text-black",
  completed: "bg-emerald-600 text-white",
  cancelled: "bg-muted text-muted-foreground",
};

interface Props {
  participants: Participant[];
  onLogRequest?: (request: TransportRequest) => void;
}

export function TransportRequestsPanel({ participants, onLogRequest }: Props) {
  const [filterDate, setFilterDate] = useState<Date | undefined>(() =>
    parseISODate(todayDateStr()),
  );
  const dateStr = filterDate ? toISODate(filterDate) : todayDateStr();

  const { data: requests = [], isLoading } = useTransportRequests({
    requestDate: dateStr,
    includeCompleted: true,
  });
  const cancel = useCancelTransportRequest();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransportRequest | null>(null);

  const openRows = useMemo(
    () => requests.filter((r) => r.status !== "cancelled"),
    [requests],
  );

  const handleCancel = async (r: TransportRequest) => {
    try {
      await cancel.mutateAsync({ id: r.id, requestDate: r.requestDate });
      toast.success("Request cancelled");
    } catch (err) {
      toast.error("Could not cancel", { description: (err as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Schedule one-off medical or special transport. Open requests appear in Log run for drivers.
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> New request
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Showing</span>
        <DatePicker
          value={filterDate}
          onChange={(d) => setFilterDate(d)}
          className="w-auto max-w-[200px]"
          dateFormat="dd MMM yyyy"
        />
      </div>

      {isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Loading requests…</Card>
      ) : openRows.length === 0 ? (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">
          No transport requests for this date.
        </Card>
      ) : (
        <ul className="space-y-2">
          {openRows.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.participantName ?? "Participant"}</span>
                    <Badge className={STATUS_CLS[r.status] ?? ""}>
                      {TRANSPORT_REQUEST_STATUS_LABELS[r.status]}
                    </Badge>
                    {r.hoistRequired && (
                      <Badge variant="outline" className="text-blue-600">
                        Hoist
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-start gap-1 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {r.pickupAddress ? `${r.pickupAddress} → ` : ""}
                      <span className="text-foreground">{r.destinationLabel}</span>
                    </span>
                  </div>
                  {r.scheduledTime && (
                    <div className="text-xs text-muted-foreground">
                      Scheduled {r.scheduledTime.slice(0, 5)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </div>
                  )}
                  {!r.scheduledTime && r.reason && (
                    <div className="text-xs text-muted-foreground">{r.reason}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {r.status !== "completed" && onLogRequest && (
                    <Button size="sm" variant="secondary" onClick={() => onLogRequest(r)}>
                      Log run
                    </Button>
                  )}
                  {r.status !== "completed" && r.status !== "cancelled" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(r);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCancel(r)}
                        disabled={cancel.isPending}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <TransportRequestFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        participants={participants}
        editing={editing}
        defaultDate={dateStr}
      />
    </div>
  );
}

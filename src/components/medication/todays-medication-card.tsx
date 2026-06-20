import { useMemo, useState } from "react";
import { Pill, CheckCircle2, Clock, AlertOctagon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { GiveDoseModal } from "@/components/medication/give-dose-modal";
import { ClientTime, useClientFormattedDate } from "@/components/ui/client-time";

import {
  useAllActiveSchedules,
  useParticipants,
  useTodaysComplianceLogs,
} from "@/hooks/use-supabase-data";
import {
  type ComplianceLog,
  type MedicationSchedule,
  type Participant,
} from "@/lib/data-store";

type Status = "administered" | "amber" | "red" | "future";

interface Row {
  schedule: MedicationSchedule;
  participant: Participant | undefined;
  scheduledMinutes: number;
  status: Status;
  administeredLog?: ComplianceLog;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function findAdministrationLog(
  schedule: MedicationSchedule,
  logs: ComplianceLog[],
): ComplianceLog | undefined {
  const target = schedule.medicationName.trim().toLowerCase();
  return logs.find((l) => {
    if (!l.participantId || l.participantId !== schedule.participantId) return false;
    const meta = l.metadata as Record<string, unknown>;
    const name = String(meta.medication_name ?? "").trim().toLowerCase();
    return name === target;
  });
}

export function TodaysMedicationCard() {
  const { data: schedules = [], isLoading: schedLoading } = useAllActiveSchedules();
  const { data: participants = [] } = useParticipants();
  const { data: logs = [] } = useTodaysComplianceLogs();
  const [verifying, setVerifying] = useState<Row | null>(null);
  const [historyFor, setHistoryFor] = useState<Row | null>(null);

  const nowMinutes =
    new Date().getHours() * 60 + new Date().getMinutes();

  const participantById = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const rows: Row[] = useMemo(() => {
    return schedules
      .filter((s): s is MedicationSchedule & { participantId: string } => !!s.participantId)
      .map<Row>((s) => {
        const participant = participantById.get(s.participantId);
        const log = findAdministrationLog(s, logs);
        const scheduledMinutes = timeToMinutes(s.expectedTime.slice(0, 5));
        let status: Status;
        if (log) status = "administered";
        else if (nowMinutes > scheduledMinutes + 15) status = "red";
        else if (nowMinutes >= scheduledMinutes - 60) status = "amber";
        else status = "future";
        return {
          schedule: s,
          participant,
          scheduledMinutes,
          status,
          administeredLog: log,
        };
      })
      .sort((a, b) => {
        const order = { red: 0, amber: 1, future: 2, administered: 3 } as const;
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.scheduledMinutes - b.scheduledMinutes;
      });
  }, [schedules, logs, participantById, nowMinutes]);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Pill className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold">Today&apos;s Care &amp; Medication Schedule</h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {rows.length} routine{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {schedLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading schedules…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          No active medication routines on file.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Medication / Dose</th>
                <th className="px-3 py-2 font-medium">Scheduled</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.schedule.id} className="border-t border-border align-middle">
                  <td className="px-3 py-2 font-medium">
                    {r.participant?.fullName ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.schedule.medicationName}</div>
                    <div className="text-xs text-muted-foreground">{r.schedule.dosage}</div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.schedule.expectedTime.slice(0, 5)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <StatusButton
                      row={r}
                      onAdminister={() => setVerifying(r)}
                      onHistory={() => setHistoryFor(r)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GiveDoseModal
        open={!!verifying}
        onOpenChange={(o) => !o && setVerifying(null)}
        schedule={verifying?.schedule ?? null}
        participantName={verifying?.participant?.fullName ?? ""}
      />

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Administration log</DialogTitle>
            <DialogDescription>
              {historyFor?.schedule.medicationName} · {historyFor?.participant?.fullName}
            </DialogDescription>
          </DialogHeader>
          {historyFor?.administeredLog ? (
            <div className="space-y-2 text-sm">
              <LogRow label="Administered at" value={<ClientTime iso={historyFor.administeredLog.timestamp} />} />
              <LogRow label="Witness 1" value={historyFor.administeredLog.witness1 ?? "—"} />
              <LogRow label="Witness 2" value={historyFor.administeredLog.witness2 ?? "—"} />
              <LogRow label="Action" value={historyFor.administeredLog.actionPerformed} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No log entry available.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusButton({
  row,
  onAdminister,
  onHistory,
}: {
  row: Row;
  onAdminister: () => void;
  onHistory: () => void;
}) {
  if (row.status === "administered" && row.administeredLog) {
    const label = new Date(row.administeredLog.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <Button
        size="sm"
        onClick={onHistory}
        className="gap-1.5 bg-success text-white hover:bg-success/90"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Administered {label}
      </Button>
    );
  }
  if (row.status === "red") {
    return (
      <Button
        size="sm"
        onClick={onAdminister}
        className="gap-1.5 animate-pulse bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500"
      >
        <AlertOctagon className="h-3.5 w-3.5" />
        OVERDUE / Action Required
      </Button>
    );
  }
  if (row.status === "amber") {
    return (
      <Button
        size="sm"
        onClick={onAdminister}
        className="gap-1.5 bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500"
      >
        <Clock className="h-3.5 w-3.5" />
        Due Soon / Administer
      </Button>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={onAdminister} className="gap-1.5">
      <Clock className="h-3.5 w-3.5" />
      Scheduled
    </Button>
  );
}

function LogRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right">{value}</span>
    </div>
  );
}

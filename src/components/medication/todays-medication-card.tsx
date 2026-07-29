import { useState, type ReactNode } from "react";
import { Pill, CheckCircle2, Clock, AlertOctagon, Loader2 } from "lucide-react";

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
import { useMedicationRound } from "@/hooks/use-medication-round";
import type { MedicationRoundRow } from "@/lib/medication/todays-medication-round";
import { isPrnSchedule } from "@/lib/medication/todays-medication-round";
import { cn } from "@/lib/utils";

type Props = {
  /** Trip: pass presence set. Centre: omit (uses Day Centre checked-in). */
  presenceIds?: Set<string> | null;
  presenceLabel?: string;
  allowSoleCarer?: boolean;
  source?: string;
  eventId?: string | null;
  eventDaySessionId?: string | null;
  /** Compact embed inside Activities / Programme card. */
  embedded?: boolean;
};

export function TodaysMedicationCard({
  presenceIds,
  presenceLabel = "checked in",
  allowSoleCarer = true,
  source = "care_profile_give_dose",
  eventId = null,
  eventDaySessionId = null,
  embedded = false,
}: Props) {
  const { rows, isLoading, presenceCount } = useMedicationRound(presenceIds);
  const [verifying, setVerifying] = useState<MedicationRoundRow | null>(null);
  const [historyFor, setHistoryFor] = useState<MedicationRoundRow | null>(null);

  const body = (
    <>
      <div className="flex items-center gap-2">
        <Pill className="h-4 w-4 text-primary" />
        <h3 className="text-base font-semibold">
          {embedded ? "Medication board" : "Today's Care & Medication Schedule"}
        </h3>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </span>
          ) : (
            <>
              {rows.length} routine{rows.length === 1 ? "" : "s"} ·{" "}
              {presenceCount} {presenceLabel}
            </>
          )}
        </span>
      </div>

      {isLoading ? (
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading medication requirements…
        </p>
      ) : presenceCount === 0 ? (
        <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          No people on the medication board yet — check-in first (or clear
          alternate plans).
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          No active medication routines for people on this board.
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
                    <div className="text-xs text-muted-foreground">
                      {r.schedule.dosage}
                      {isPrnSchedule(r.schedule.frequency) ? " · PRN" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {isPrnSchedule(r.schedule.frequency)
                      ? "As needed"
                      : r.schedule.expectedTime.slice(0, 5)}
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
        allowSoleCarer={allowSoleCarer}
        source={source}
        eventId={eventId}
        eventDaySessionId={eventDaySessionId}
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
    </>
  );

  if (embedded) {
    return <div className={cn("space-y-3")}>{body}</div>;
  }
  return <Card className="space-y-3 p-5">{body}</Card>;
}

function StatusButton({
  row,
  onAdminister,
  onHistory,
}: {
  row: MedicationRoundRow;
  onAdminister: () => void;
  onHistory: () => void;
}) {
  const administeredAt = useClientFormattedDate(
    row.administeredLog?.timestamp ?? null,
    { hour: "2-digit", minute: "2-digit" },
  );
  if (row.status === "administered" && row.administeredLog) {
    return (
      <Button
        size="sm"
        onClick={onHistory}
        className="gap-1.5 bg-success text-white hover:bg-success/90"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Administered {administeredAt ?? "…"}
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
        className="gap-1.5 animate-pulse bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500"
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

function LogRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/**
 * Day Centre Support roll — staff / volunteer / carer. Not meal/med recipients.
 * Same floor cadence as clients: Arrived, clock/defer, PIN absent, late arrival.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { TransportMethodPickerSheet } from "@/components/ui/transport-method-picker-sheet";
import { ClientTime } from "@/components/ui/client-time";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import {
  buildBusSelfPickerOptions,
  type FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";
import {
  SUPPORT_ROLL_KEY,
  checkOutSupport,
  listSupportAttendanceRoll,
  recordSupportArrival,
  seedSupportRollFromSchedules,
  type SupportAttendanceRow,
} from "@/lib/api/support-attendance";
import { supportPersonKindLabel } from "@/lib/support-person";
import type { ArrivalMethod } from "@/lib/api/client-attendance";
import type { AttendanceRollMode } from "./attendance-roll-panel";
import { AdjustExpectedTimeModal } from "./adjust-expected-time-modal";

interface Props {
  sessionId: string;
  mode?: AttendanceRollMode;
}

export function SupportAttendanceSection({ sessionId, mode = "all" }: Props) {
  const qc = useQueryClient();
  const [pickerFor, setPickerFor] = useState<SupportAttendanceRow | null>(null);
  const [adjustRow, setAdjustRow] = useState<SupportAttendanceRow | null>(null);
  const yellowMins = useSystemParameter<number>("attendance_yellow_threshold_mins", 30);
  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);
  const arrivalOptions = useMemo(
    () => buildBusSelfPickerOptions(busOpts, "dayCentre"),
    [busOpts],
  );

  const rollQ = useQuery({
    queryKey: SUPPORT_ROLL_KEY(sessionId),
    queryFn: () => listSupportAttendanceRoll(sessionId),
    staleTime: 10_000,
  });

  useEffect(() => {
    void seedSupportRollFromSchedules(sessionId)
      .then((n) => {
        if (n > 0) void qc.invalidateQueries({ queryKey: SUPPORT_ROLL_KEY(sessionId) });
      })
      .catch(() => undefined);
  }, [sessionId, qc]);

  const rows = rollQ.data ?? [];
  const visible = rows.filter((r) => {
    if (mode === "check_in") return r.status !== "checked_out";
    if (mode === "check_out") return r.status === "checked_in" || r.status === "checked_out";
    return true;
  });

  const checkIn = useMutation({
    mutationFn: (input: { row: SupportAttendanceRow; method: ArrivalMethod; run?: string | null }) =>
      recordSupportArrival({
        rowId: input.row.id,
        arrivalMethod: input.method,
        arrivalBusRunCode: input.run,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SUPPORT_ROLL_KEY(sessionId) }),
    onError: (err: Error) => toast.error(err.message),
  });
  const checkOut = useMutation({
    mutationFn: (row: SupportAttendanceRow) =>
      checkOutSupport({
        rowId: row.id,
        departureVector: row.departureVector,
        departureBusRunCode: row.departureBusRunCode,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SUPPORT_ROLL_KEY(sessionId) }),
    onError: (err: Error) => toast.error(err.message),
  });

  if (visible.length === 0) return null;

  return (
    <section className="mt-6 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4" />
        Support
        <span className="text-xs font-normal text-muted-foreground">
          Staff, volunteers, carers — not on meals or meds
        </span>
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {visible.map((row) => {
          const inMode = mode !== "check_out";
          const canArrive = row.status === "expected" || row.status === "absent";
          return (
            <div
              key={row.id}
              className="flex min-h-14 items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{row.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {supportPersonKindLabel(row.personKind)}
                  {row.expectedArrivalAt && row.status === "expected" && (
                    <>
                      {" · due "}
                      <ClientTime iso={row.expectedArrivalAt} />
                    </>
                  )}
                  {row.checkedInAt && (
                    <>
                      {" · "}
                      <ClientTime iso={row.checkedInAt} />
                    </>
                  )}
                </div>
              </div>
              <Badge
                variant={row.escalationSeverity === "red" ? "destructive" : "outline"}
              >
                {row.escalationSeverity === "yellow"
                  ? "Yellow"
                  : row.escalationSeverity === "red"
                    ? "Red"
                    : row.status.replace("_", " ")}
              </Badge>
              {inMode && canArrive && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10"
                    aria-label="Adjust expected time or mark absent"
                    onClick={() => setAdjustRow(row)}
                  >
                    <Clock className="h-4 w-4" />
                  </Button>
                  <EmbeddedMethodButton
                    label={row.arrivalMethod === "bus" ? "Bus" : "Self"}
                    onClick={() => setPickerFor(row)}
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      checkIn.mutate({
                        row,
                        method: row.arrivalMethod,
                        run: row.arrivalBusRunCode,
                      })
                    }
                  >
                    {row.status === "absent" ? "Late arrival" : "Arrived"}
                  </Button>
                </>
              )}
              {row.status === "checked_in" && (mode === "check_out" || mode === "all") && (
                <Button size="sm" variant="secondary" onClick={() => checkOut.mutate(row)}>
                  Left
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <TransportMethodPickerSheet
        open={!!pickerFor}
        onOpenChange={(v) => !v && setPickerFor(null)}
        title="How they arrived"
        options={arrivalOptions}
        onSelect={(sel: FloorTransportSelection) => {
          if (!pickerFor) return;
          const method: ArrivalMethod = sel.kind === "bus" ? "bus" : "private";
          const run = sel.kind === "bus" ? sel.busRunCode : null;
          checkIn.mutate({ row: pickerFor, method, run });
          setPickerFor(null);
        }}
      />
      <AdjustExpectedTimeModal
        row={null}
        supportRow={adjustRow}
        participantName={adjustRow?.displayName ?? "Support"}
        yellowThresholdMins={yellowMins}
        onClose={(changed) => {
          setAdjustRow(null);
          if (changed) void qc.invalidateQueries({ queryKey: SUPPORT_ROLL_KEY(sessionId) });
        }}
      />
    </section>
  );
}

/**
 * Day Centre Support roll — staff / volunteer / carer. Not meal/med recipients.
 * Same arrival and home-method chips as the client roll.
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
import { useLookupParameters, useTodaysPlannedBusRunCodes } from "@/hooks/use-supabase-data";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import { normalizeDayCode } from "@/lib/api/run-planning";
import { todaysSydneyDayCode } from "@/lib/operational-time";
import {
  buildBusSelfPickerOptions,
  filterBusRunOptions,
  selectionFromScheduleLabel,
  type FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";
import {
  SUPPORT_ROLL_KEY,
  checkOutSupport,
  listSupportAttendanceRoll,
  listSupportSchedules,
  persistSupportArrivalMethod,
  persistSupportDepartureMethod,
  recordSupportArrival,
  seedSupportRollFromSchedules,
  type SupportAttendanceRow,
  type SupportSchedule,
} from "@/lib/api/support-attendance";
import {
  scheduleLabelIsSelf,
  type ArrivalMethod,
  type DepartureVector,
} from "@/lib/api/client-attendance";
import { supportPersonKindLabel } from "@/lib/support-person";
import type { AttendanceRollMode } from "./attendance-roll-panel";
import { AdjustExpectedTimeModal } from "./adjust-expected-time-modal";
import {
  DutyOnDutyConfirmSheet,
  type DutyOnDutyPending,
} from "@/components/duty/duty-on-duty-confirm-sheet";

interface Props {
  sessionId: string;
  mode?: AttendanceRollMode;
}

function scheduleForRow(
  schedules: SupportSchedule[],
  row: SupportAttendanceRow,
  dayCode: string,
): SupportSchedule | null {
  return (
    schedules.find((s) => {
      if (normalizeDayCode(s.dayOfWeek) !== dayCode) return false;
      if (row.carerId) return s.carerId === row.carerId;
      return s.staffId === row.staffId && s.personKind === row.personKind;
    }) ?? null
  );
}

export function SupportAttendanceSection({ sessionId, mode = "all" }: Props) {
  const qc = useQueryClient();
  const [picker, setPicker] = useState<{
    rowId: string;
    phase: "arrival" | "departure";
  } | null>(null);
  const [methodByKey, setMethodByKey] = useState<Record<string, FloorTransportSelection>>({});
  const [adjustRow, setAdjustRow] = useState<SupportAttendanceRow | null>(null);
  const [dutyPending, setDutyPending] = useState<DutyOnDutyPending | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const yellowMins = useSystemParameter<number>("attendance_yellow_threshold_mins", 30);
  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const plannedRuns = useTodaysPlannedBusRunCodes();
  const busOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);
  const arrivalBusOpts = useMemo(
    () => filterBusRunOptions(busOpts, plannedRuns.morningCodes),
    [busOpts, plannedRuns.morningCodes],
  );
  const departureBusOpts = useMemo(
    () => filterBusRunOptions(busOpts, plannedRuns.afternoonCodes),
    [busOpts, plannedRuns.afternoonCodes],
  );
  const arrivalOptions = useMemo(
    () =>
      buildBusSelfPickerOptions(arrivalBusOpts, "dayCentre", {
        busTitlePrefix: "Arrived on",
        selfTitle: "Self / family",
        selfSubtitle: "Not on the centre bus",
      }),
    [arrivalBusOpts],
  );
  const departureOptions = useMemo(
    () => [
      ...buildBusSelfPickerOptions(departureBusOpts, "dayCentre", {
        busTitlePrefix: "Departing on",
        selfTitle: "Family / carer",
        selfSubtitle: "Collected by family or carer",
      }),
      {
        id: "independent",
        kind: "independent" as const,
        busRunCode: null,
        title: "Independent",
        subtitle: "Left under own arrangement",
        label: "Indep",
      },
    ],
    [departureBusOpts],
  );

  const rollQ = useQuery({
    queryKey: SUPPORT_ROLL_KEY(sessionId),
    queryFn: () => listSupportAttendanceRoll(sessionId),
    staleTime: 10_000,
  });
  const schedQ = useQuery({
    queryKey: ["support-attendance-schedules"],
    queryFn: listSupportSchedules,
    staleTime: 30_000,
  });

  useEffect(() => {
    let cancelled = false;
    void seedSupportRollFromSchedules(sessionId)
      .then((n) => {
        if (cancelled) return;
        setSeedError(null);
        if (n > 0) void qc.invalidateQueries({ queryKey: SUPPORT_ROLL_KEY(sessionId) });
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setSeedError(err.message || "Could not load expected staff, volunteers, and carers.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, qc]);

  const dayCode = todaysSydneyDayCode();
  const rows = rollQ.data ?? [];
  const visible = [...rows]
    .filter((r) => {
      if (mode === "check_in") return r.status !== "checked_out";
      if (mode === "check_out") return r.status === "checked_in";
      return true;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: SUPPORT_ROLL_KEY(sessionId) });
    void qc.invalidateQueries({ queryKey: ["bus-run-roster"] });
  };

  const checkIn = useMutation({
    mutationFn: (input: { row: SupportAttendanceRow; method: ArrivalMethod; run?: string | null }) =>
      recordSupportArrival({
        rowId: input.row.id,
        arrivalMethod: input.method,
        arrivalBusRunCode: input.run,
      }),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const checkOut = useMutation({
    mutationFn: (input: {
      row: SupportAttendanceRow;
      vector: DepartureVector;
      run: string | null;
    }) =>
      checkOutSupport({
        rowId: input.row.id,
        departureVector: input.vector,
        departureBusRunCode: input.run,
      }),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });

  function methodKey(phase: "arrival" | "departure", rowId: string) {
    return `${phase}:${rowId}`;
  }

  function arrivalSelectionFor(row: SupportAttendanceRow): FloorTransportSelection {
    const key = methodKey("arrival", row.id);
    if (methodByKey[key]) return methodByKey[key];
    if (row.status === "absent") return { kind: "self", busRunCode: null, label: "Self" };
    if (row.arrivalMethod === "private" || row.arrivalMethod === "walk_in") {
      return { kind: "self", busRunCode: null, label: "Self" };
    }
    if (row.arrivalBusRunCode) {
      return selectionFromScheduleLabel(
        row.arrivalBusRunCode,
        arrivalBusOpts,
        "dayCentre",
        scheduleLabelIsSelf,
      );
    }
    const planned = scheduleForRow(schedQ.data ?? [], row, dayCode)?.inboundTransport;
    return selectionFromScheduleLabel(planned, arrivalBusOpts, "dayCentre", scheduleLabelIsSelf);
  }

  function departureSelectionFor(row: SupportAttendanceRow): FloorTransportSelection {
    const key = methodKey("departure", row.id);
    if (methodByKey[key]) return methodByKey[key];
    if (row.departureVector === "independent") {
      return { kind: "independent", busRunCode: null, label: "Indep" };
    }
    if (row.departureVector === "family") {
      return { kind: "self", busRunCode: null, label: "Self" };
    }
    if (row.departureVector === "bus" && row.departureBusRunCode) {
      return selectionFromScheduleLabel(
        row.departureBusRunCode,
        departureBusOpts,
        "dayCentre",
        scheduleLabelIsSelf,
      );
    }
    const planned = scheduleForRow(schedQ.data ?? [], row, dayCode)?.outboundTransport;
    return selectionFromScheduleLabel(planned, departureBusOpts, "dayCentre", scheduleLabelIsSelf);
  }

  const pickerRow = rows.find((r) => r.id === picker?.rowId) ?? null;
  const pickerSelection = pickerRow
    ? picker?.phase === "departure"
      ? departureSelectionFor(pickerRow)
      : arrivalSelectionFor(pickerRow)
    : null;

  const requestArrive = (row: SupportAttendanceRow, selection: FloorTransportSelection) => {
    const method: ArrivalMethod = selection.kind === "bus" ? "bus" : "private";
    const run = selection.kind === "bus" ? selection.busRunCode : null;
    setDutyPending({
      staffId: row.staffId,
      displayName: row.displayName,
      onProceed: () => checkIn.mutate({ row, method, run }),
    });
  };

  return (
    <section className="mt-6 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4" />
        Support
        <span className="text-xs font-normal text-muted-foreground">
          Staff, volunteers, carers — not on meals or meds
        </span>
      </h3>
      {seedError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {seedError}
        </p>
      ) : null}
      {rollQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading who is expected…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {rows.length === 0
            ? "No staff, volunteers, or carers are expected at the centre today."
            : "No one in Support is waiting on this list."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {visible.map((row) => {
            const canArrive = row.status === "expected" || row.status === "absent";
            const canLeave = row.status === "checked_in" && mode !== "check_in";
            const showMethod = canArrive || canLeave;
            const arrivalSel = arrivalSelectionFor(row);
            const departureSel = departureSelectionFor(row);
            const chip = canLeave ? departureSel : arrivalSel;
            const plannedIn =
              scheduleForRow(schedQ.data ?? [], row, dayCode)?.inboundTransport ?? "";
            const plannedSelf = scheduleLabelIsSelf(plannedIn);
            const plannedRunLabel = plannedSelf
              ? "Self"
              : (arrivalBusOpts.find((o) => o.code === plannedIn)?.displayName ?? plannedIn);
            const actualSelf = arrivalSel.kind !== "bus";
            const mismatch =
              row.status === "expected" &&
              plannedIn.length > 0 &&
              (plannedSelf !== actualSelf ||
                (!plannedSelf &&
                  arrivalSel.kind === "bus" &&
                  !!arrivalSel.busRunCode &&
                  arrivalSel.busRunCode !== plannedIn));
            return (
              <div
                key={row.id}
                className="flex min-h-14 items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.displayName}</span>
                    {row.status === "expected" && plannedIn ? (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        Planned {plannedRunLabel}
                      </Badge>
                    ) : null}
                    {mismatch ? (
                      <Badge className="border-amber-500/50 bg-amber-500/10 text-[10px] font-medium text-amber-800">
                        ≠ planned
                      </Badge>
                    ) : null}
                  </div>
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
                <Badge variant={row.escalationSeverity === "red" ? "destructive" : "outline"}>
                  {row.escalationSeverity === "yellow"
                    ? "Yellow"
                    : row.escalationSeverity === "red"
                      ? "Red"
                      : row.status.replace("_", " ")}
                </Badge>
                {canArrive && (
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
                )}
                {showMethod && (
                  <EmbeddedMethodButton
                    label={chip.label}
                    onClick={() =>
                      setPicker({
                        rowId: row.id,
                        phase: canLeave ? "departure" : "arrival",
                      })
                    }
                  />
                )}
                {canArrive && (
                  <Button size="sm" onClick={() => requestArrive(row, arrivalSel)}>
                    {row.status === "absent" ? "Late arrival" : "Arrived"}
                  </Button>
                )}
                {canLeave && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const vector: DepartureVector =
                        departureSel.kind === "bus"
                          ? "bus"
                          : departureSel.kind === "independent"
                            ? "independent"
                            : "family";
                      checkOut.mutate({
                        row,
                        vector,
                        run: vector === "bus" ? departureSel.busRunCode : null,
                      });
                    }}
                  >
                    Left
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <TransportMethodPickerSheet
        open={!!picker}
        onOpenChange={(v) => !v && setPicker(null)}
        title={
          picker?.phase === "departure"
            ? `Departure method — ${pickerRow?.displayName ?? "Support"}`
            : `Arrival method — ${pickerRow?.displayName ?? "Support"}`
        }
        description="Tap to select. Then tap Arrived or Left to confirm."
        options={picker?.phase === "departure" ? departureOptions : arrivalOptions}
        selected={pickerSelection}
        pending={checkIn.isPending || checkOut.isPending}
        onSelect={(next: FloorTransportSelection) => {
          if (!picker || !pickerRow) return;
          setMethodByKey((prev) => ({
            ...prev,
            [methodKey(picker.phase, picker.rowId)]: next,
          }));
          if (picker.phase === "departure") {
            const vector: DepartureVector =
              next.kind === "bus" ? "bus" : next.kind === "independent" ? "independent" : "family";
            void persistSupportDepartureMethod({
              rowId: pickerRow.id,
              departureVector: vector,
              departureBusRunCode: vector === "bus" ? next.busRunCode : null,
            }).then(refresh, (err: Error) => toast.error(err.message));
          } else if (pickerRow.status !== "absent") {
            void persistSupportArrivalMethod({
              rowId: pickerRow.id,
              arrivalMethod: next.kind === "bus" ? "bus" : "private",
              arrivalBusRunCode: next.kind === "bus" ? next.busRunCode : null,
            }).then(refresh, (err: Error) => toast.error(err.message));
          }
          setPicker(null);
        }}
      />
      <DutyOnDutyConfirmSheet pending={dutyPending} onDismiss={() => setDutyPending(null)} />
      <AdjustExpectedTimeModal
        row={null}
        supportRow={adjustRow}
        participantName={adjustRow?.displayName ?? "Support"}
        yellowThresholdMins={yellowMins}
        onClose={(changed) => {
          setAdjustRow(null);
          if (changed) refresh();
        }}
      />
    </section>
  );
}

/**
 * Day Centre Support roll — staff / volunteer / carer. Not meal/med recipients.
 * Same floor row as the client roll: tap the wide row to confirm, method chip
 * only changes transport, clock defers, Undo puts them back to expected.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Users } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { TransportMethodPickerSheet } from "@/components/ui/transport-method-picker-sheet";
import { ClientTime } from "@/components/ui/client-time";
import { cn } from "@/lib/utils";
import { useLookupParameters, useTodaysPlannedBusRunCodes } from "@/hooks/use-supabase-data";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { eventBusRunOptions, eventBusRunShortLabel } from "@/lib/event-bus-runs";
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
  undoSupportCheckIn,
  undoSupportCheckOut,
  type SupportAttendanceRow,
  type SupportSchedule,
} from "@/lib/api/support-attendance";
import {
  arrivalMethodBadgeLabel,
  scheduleLabelIsSelf,
  type ArrivalMethod,
  type DepartureVector,
} from "@/lib/api/client-attendance";
import { supportPersonKindLabel } from "@/lib/support-person";
import type { AttendanceRollMode } from "./attendance-roll-panel";
import { AdjustExpectedTimeModal } from "./adjust-expected-time-modal";
import { FloorRollUndoButton } from "./floor-roll-undo-button";
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
  const [undoTarget, setUndoTarget] = useState<SupportAttendanceRow | null>(null);
  const [undoKind, setUndoKind] = useState<"check_in" | "check_out">("check_in");
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
  const byName = (a: SupportAttendanceRow, b: SupportAttendanceRow) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  const visible = rows
    .filter((r) => {
      if (mode === "check_in") return r.status !== "checked_out";
      if (mode === "check_out") return r.status === "checked_in" || r.status === "checked_out";
      return true;
    })
    .sort(byName);
  const leftToday = mode === "check_in"
    ? rows.filter((r) => r.status === "checked_out").sort(byName)
    : [];

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
  const undoMut = useMutation({
    mutationFn: (row: SupportAttendanceRow) => undoSupportCheckIn(row),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error("Could not undo check-in", { description: err.message }),
  });
  const undoOutMut = useMutation({
    mutationFn: (row: SupportAttendanceRow) => undoSupportCheckOut(row),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error("Could not undo check-out", { description: err.message }),
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
      ) : visible.length === 0 && leftToday.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          {rows.length === 0
            ? "No staff, volunteers, or carers are expected at the centre today."
            : "No one in Support is waiting on this list."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => {
            const isIn = row.status === "checked_in";
            const isOut = row.status === "checked_out";
            const isAbsent = row.status === "absent";
            const isRed = !isAbsent && !isOut && !isIn && row.escalationSeverity === "red";
            const isYellow =
              !isAbsent && !isOut && !isRed && row.escalationSeverity === "yellow";
            const absentMatch = isAbsent && row.notes
              ? /\[FLOOR ABSENT:([A-Z_]+)\]\s*([^—(]+)/.exec(row.notes)
              : null;
            const absentLabel = absentMatch?.[2]?.trim() ?? "Absent today";
            const arrivalDone = mode !== "check_out" && isIn && !isYellow && !isRed;
            const departureDone = mode === "check_out" && isOut;
            const awaitingDeparture =
              mode === "check_out" && isIn && !isYellow && !isRed;
            const hiVisDone = arrivalDone || departureDone;
            const subTextCls = hiVisDone
              ? "text-success-foreground/90"
              : isYellow || isAbsent || (isOut && !departureDone)
                ? "text-slate-900/80"
                : "text-muted-foreground";
            const busy = undoMut.isPending || undoOutMut.isPending || checkIn.isPending || checkOut.isPending;
            const canConfirmArrival =
              mode !== "check_out" && !busy && !isOut && !isIn && !row.checkedOutAt;
            const canConfirmDeparture =
              mode !== "check_in" && !busy && isIn && !isOut && !row.checkedOutAt;
            const arrivalSel = arrivalSelectionFor(row);
            const departureSel = departureSelectionFor(row);
            const plannedIn =
              scheduleForRow(schedQ.data ?? [], row, dayCode)?.inboundTransport ?? "";
            const plannedSelf = scheduleLabelIsSelf(plannedIn);
            const plannedRunLabel = plannedSelf
              ? "Self"
              : (arrivalBusOpts.find((o) => o.code === plannedIn)?.displayName ?? plannedIn);
            const actualSelf =
              row.arrivalMethod === "private" || row.arrivalMethod === "walk_in";
            const actualBus = row.arrivalMethod === "bus";
            const methodMismatch =
              isIn &&
              plannedIn.length > 0 &&
              (plannedSelf !== actualSelf ||
                (!plannedSelf &&
                  actualBus &&
                  !!row.arrivalBusRunCode &&
                  row.arrivalBusRunCode !== plannedIn));
            const actualBadge = actualBus
              ? eventBusRunShortLabel(row.arrivalBusRunCode, busOpts) ||
                arrivalMethodBadgeLabel(row.arrivalMethod)
              : arrivalMethodBadgeLabel(row.arrivalMethod);
            return (
              <li key={row.id}>
                <div
                  className={cn(
                    "flex w-full min-h-[56px] items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-left",
                    hiVisDone &&
                      "border-2 border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40",
                    (awaitingDeparture ||
                      (!hiVisDone && !isRed && !isYellow && !isAbsent && !isOut)) &&
                      "border-border bg-card",
                    isYellow && "border-amber-500 bg-amber-50 text-slate-900",
                    isRed && "border-2 border-destructive bg-destructive/10 text-destructive",
                    isAbsent && "border-slate-400 bg-slate-200/70 text-slate-900",
                    isOut && !departureDone && "border-slate-400 bg-slate-100 text-slate-900",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (canConfirmArrival) {
                        requestArrive(row, arrivalSel);
                        return;
                      }
                      if (canConfirmDeparture) {
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
                      }
                    }}
                    disabled={!canConfirmArrival && !canConfirmDeparture}
                    aria-pressed={mode === "check_out" ? isOut : isIn}
                    aria-label={
                      canConfirmDeparture
                        ? `Check out ${row.displayName} via ${departureSel.label}`
                        : canConfirmArrival
                          ? isAbsent
                            ? `Late arrival check-in for ${row.displayName} via ${arrivalSel.label}`
                            : `Check in ${row.displayName} via ${arrivalSel.label}`
                          : row.displayName
                    }
                    className={cn(
                      "min-w-0 flex-1 rounded-md text-left transition-colors",
                      "active:scale-[0.99] disabled:opacity-100",
                      (canConfirmArrival || canConfirmDeparture) && "hover:bg-black/5",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-base font-semibold",
                          (isAbsent || (isOut && !departureDone)) &&
                            "line-through decoration-slate-500/60",
                        )}
                      >
                        {row.displayName}
                      </span>
                      {!isIn && !isOut && !isAbsent && (
                        <Badge
                          variant="outline"
                          className="border border-slate-400 bg-white text-[10px] uppercase text-slate-900"
                        >
                          Planned {plannedRunLabel || arrivalMethodBadgeLabel(row.arrivalMethod)}
                        </Badge>
                      )}
                      {(isIn || isOut) && (
                        <Badge className="border border-slate-400 bg-white text-[10px] uppercase text-slate-900">
                          {actualBadge}
                        </Badge>
                      )}
                      {methodMismatch && (
                        <Badge className="border-amber-500/50 bg-amber-500/10 text-[10px] font-medium normal-case text-amber-800">
                          ≠ planned
                        </Badge>
                      )}
                      {isRed && (
                        <Badge className="bg-destructive text-[10px] uppercase text-destructive-foreground">
                          Escalated — Manager notified
                        </Badge>
                      )}
                      {isYellow && (
                        <Badge className="bg-amber-500 text-[10px] uppercase text-white">
                          Overdue
                        </Badge>
                      )}
                      {isAbsent && (
                        <Badge className="bg-slate-600 text-[10px] uppercase text-white">
                          Absent · {absentLabel}
                        </Badge>
                      )}
                      {isIn && (
                        <Badge className="border border-slate-400 bg-white text-[10px] uppercase text-slate-900">
                          Checked in
                        </Badge>
                      )}
                      {isOut && (
                        <Badge
                          className={
                            departureDone
                              ? "border border-slate-400 bg-white text-[10px] uppercase text-slate-900"
                              : "bg-slate-600 text-[10px] uppercase text-white"
                          }
                        >
                          Checked out
                        </Badge>
                      )}
                    </div>
                    <div className={cn("mt-0.5 text-xs", subTextCls)}>
                      {supportPersonKindLabel(row.personKind)}
                      {row.expectedArrivalAt && (
                        <>
                          {" · Expected "}
                          <ClientTime
                            iso={row.expectedArrivalAt}
                            options={{ hour: "2-digit", minute: "2-digit" }}
                          />
                        </>
                      )}
                      {row.expectedDepartureAt && (
                        <>
                          {" → "}
                          <ClientTime
                            iso={row.expectedDepartureAt}
                            options={{ hour: "2-digit", minute: "2-digit" }}
                          />
                        </>
                      )}
                      {row.checkedInAt && (
                        <>
                          {" · In "}
                          <ClientTime
                            iso={row.checkedInAt}
                            options={{ hour: "2-digit", minute: "2-digit" }}
                          />
                        </>
                      )}
                      {row.checkedOutAt && (
                        <>
                          {" · Out "}
                          <ClientTime
                            iso={row.checkedOutAt}
                            options={{ hour: "2-digit", minute: "2-digit" }}
                          />
                        </>
                      )}
                      {isAbsent && (
                        <> · Tap row to record a late arrival</>
                      )}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isOut && (canConfirmArrival || canConfirmDeparture) && (
                      <EmbeddedMethodButton
                        label={canConfirmDeparture ? departureSel.label : arrivalSel.label}
                        disabled={busy}
                        onClick={() =>
                          setPicker({
                            rowId: row.id,
                            phase: canConfirmDeparture ? "departure" : "arrival",
                          })
                        }
                        aria-label={
                          canConfirmDeparture
                            ? `Change departure method, currently ${departureSel.label}`
                            : `Change arrival method, currently ${arrivalSel.label}`
                        }
                      />
                    )}
                    {isIn && !isOut && mode !== "check_out" && (
                      <FloorRollUndoButton
                        kind="check_in"
                        personName={row.displayName}
                        disabled={busy}
                        onClick={() => {
                          setUndoKind("check_in");
                          setUndoTarget(row);
                        }}
                      />
                    )}
                    {departureDone && (
                      <FloorRollUndoButton
                        kind="check_out"
                        personName={row.displayName}
                        disabled={busy}
                        onClick={() => {
                          setUndoKind("check_out");
                          setUndoTarget(row);
                        }}
                      />
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Adjust expected time for ${row.displayName}`}
                      onClick={() => setAdjustRow(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setAdjustRow(row);
                        }
                      }}
                      className={cn(
                        "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md p-2",
                        "border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-100",
                      )}
                    >
                      <Clock className="h-4 w-4" />
                    </span>
                    <div
                      className={cn(
                        "rounded-full p-2",
                        hiVisDone
                          ? "bg-green-600 text-white"
                          : isAbsent || (isOut && !departureDone)
                            ? "bg-slate-400 text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      <Check className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {leftToday.length > 0 && (
        <div className="space-y-2 pt-1">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Left today{" "}
            <span className="font-mono normal-case text-muted-foreground/70">
              ({leftToday.length})
            </span>
          </h4>
          <ul className="space-y-1">
            {leftToday.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 opacity-80"
              >
                <span className="font-medium line-through decoration-slate-500/60">
                  {row.displayName}
                </span>
                <span className="ml-2 text-xs text-slate-700">
                  {supportPersonKindLabel(row.personKind)}
                </span>
                {row.checkedOutAt && (
                  <span className="ml-2 text-xs text-slate-700">
                    Out{" "}
                    <ClientTime
                      iso={row.checkedOutAt}
                      options={{ hour: "2-digit", minute: "2-digit" }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
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
        description="Tap to select. Then tap the wide row to confirm."
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
      <AlertDialog
        open={!!undoTarget}
        onOpenChange={(open) => {
          if (!open) setUndoTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {undoKind === "check_out" ? "Undo check-out?" : "Undo check-in?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {undoKind === "check_out"
                ? undoTarget
                  ? `${undoTarget.displayName} will go back to still on site — checked in, not yet left.`
                  : "This person will go back to still on site — checked in, not yet left."
                : undoTarget
                  ? `${undoTarget.displayName} will go back to expected — not yet arrived.`
                  : "This person will go back to expected — not yet arrived."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoMut.isPending || undoOutMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={(undoMut.isPending || undoOutMut.isPending) || !undoTarget}
              onClick={() => {
                if (!undoTarget) return;
                if (undoKind === "check_out") undoOutMut.mutate(undoTarget);
                else undoMut.mutate(undoTarget);
                setUndoTarget(null);
              }}
            >
              {undoKind === "check_out" ? "Undo check-out" : "Undo check-in"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

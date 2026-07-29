// MASTER_GUARDRAILS §4.4 — Mobile Checklist Tokens.
// Floor row embedded method override (UI Style Guide): wide row confirms
// check-in/out with the current method; method chip only updates selection.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  LogOut,
  RotateCcw,
  Users,
  Bus,
  UserPlus,
  UserRoundPlus,
} from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { TransportMethodPickerSheet } from "@/components/ui/transport-method-picker-sheet";
import { cn, formatUnknownError } from "@/lib/utils";
import { listParticipants, LOOKUP_CATEGORIES } from "@/lib/data-store";
import { useSystemParameter } from "@/hooks/use-system-parameters";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import {
  arrivalMethodBadgeLabel,
  checkOutParticipant,
  listAttendanceRoll,
  loadInboundTransportLabelsForToday,
  loadOutboundTransportLabelsForToday,
  recordClientArrival,
  scheduleLabelIsSelf,
  seedRollFromSchedules,
  sweepOverdueArrivals,
  sweepOverdueDepartures,
  toggleCheckIn,
  type ClientAttendanceRow,
  type DepartureVector,
} from "@/lib/api/client-attendance";
import {
  listSiteDayVisitors,
  markSiteDayVisitorLeft,
  siteDayVisitorsKey,
  VISITOR_KIND_LABELS,
  type SiteDayVisitor,
} from "@/lib/api/site-day-visitors";
import { eventBusRunOptions, eventBusRunShortLabel } from "@/lib/event-bus-runs";
import {
  buildBusSelfPickerOptions,
  selectionFromScheduleLabel,
  type FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { AdjustExpectedTimeModal } from "./adjust-expected-time-modal";
import { BulkDeferGroupModal } from "./bulk-defer-group-modal";
import { AddAttendeeModal } from "./add-attendee-modal";
import { AddVisitorModal } from "./add-visitor-modal";
import { PromoteVisitorToEventDialog } from "./promote-visitor-to-event-dialog";
import { ClinicalFlagChips } from "@/components/ui/clinical-flag-chips";
import { clinicalFlagsFromParticipant } from "@/lib/clinical-flags";

export type AttendanceRollMode = "all" | "check_in" | "check_out";

interface Props {
  sessionId: string;
  /** Split Day Centre Active Day into Check-In / Check-Out tabs (BL-100). */
  mode?: AttendanceRollMode;
}

const ROLL_KEY = (sid: string) => ["client-attendance-roll", sid] as const;

export function AttendanceRollPanel({ sessionId, mode = "all" }: Props) {
  const qc = useQueryClient();
  const yellowMins = useSystemParameter<number>("attendance_yellow_threshold_mins", 30);
  const redMins = useSystemParameter<number>("attendance_red_threshold_mins", 60);
  const depYellowMins = useSystemParameter<number>(
    "attendance_departure_yellow_threshold_mins",
    30,
  );
  const depRedMins = useSystemParameter<number>(
    "attendance_departure_red_threshold_mins",
    60,
  );

  const [adjustRow, setAdjustRow] = useState<ClientAttendanceRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [visitorOpen, setVisitorOpen] = useState(false);
  const [promoteVisitor, setPromoteVisitor] = useState<SiteDayVisitor | null>(
    null,
  );
  /** Per-row method overrides (arrival / departure). Key: `${phase}:${rowId}`. */
  const [methodByKey, setMethodByKey] = useState<
    Record<string, FloorTransportSelection>
  >({});
  const [picker, setPicker] = useState<{
    rowId: string;
    phase: "arrival" | "departure";
  } | null>(null);
  /** Undo check-in: chip → AlertDialog confirm (two taps / fat-finger safe). */
  const [undoTarget, setUndoTarget] = useState<ClientAttendanceRow | null>(null);

  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busRunOpts = useMemo(
    () => eventBusRunOptions(busRunLookups),
    [busRunLookups],
  );
  const arrivalPickerOptions = useMemo(
    () =>
      buildBusSelfPickerOptions(busRunOpts, "dayCentre", {
        busTitlePrefix: "Arrived on",
        selfTitle: "Self / family",
        selfSubtitle: "Not on the centre bus",
      }),
    [busRunOpts],
  );
  const departurePickerOptions = useMemo(
    () => [
      ...buildBusSelfPickerOptions(busRunOpts, "dayCentre", {
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
    [busRunOpts],
  );

  const participantsQ = useQuery({
    queryKey: ["participants", "all-for-roll"],
    queryFn: listParticipants,
    staleTime: 5 * 60_000,
  });
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of participantsQ.data ?? []) map[p.id] = p.fullName;
    return map;
  }, [participantsQ.data]);
  const participantById = useMemo(() => {
    const map = new Map(
      (participantsQ.data ?? []).map((p) => [p.id, p] as const),
    );
    return map;
  }, [participantsQ.data]);

  const transportLabelsQ = useQuery({
    queryKey: ["attendance-inbound-transport-labels", "today"],
    queryFn: loadInboundTransportLabelsForToday,
    staleTime: 5 * 60_000,
  });
  const outboundLabelsQ = useQuery({
    queryKey: ["attendance-outbound-transport-labels", "today"],
    queryFn: loadOutboundTransportLabelsForToday,
    staleTime: 5 * 60_000,
  });
  const transportLabelMap = transportLabelsQ.data ?? {};
  const outboundLabelMap = outboundLabelsQ.data ?? {};

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const seeded = await seedRollFromSchedules(sessionId);
        if (!cancelled && seeded > 0) {
          qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }
      } catch (e) {
        const msg = formatUnknownError(e);
        console.error("[AttendanceRollPanel] seed failed", e);
        if (!cancelled) {
          toast.error("Attendance roll could not initialise", {
            description: msg,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, qc]);

  const rollQ = useQuery({
    queryKey: ROLL_KEY(sessionId),
    queryFn: async () => {
      const rows = await listAttendanceRoll(sessionId);
      if (Object.keys(nameMap).length > 0) {
        await sweepOverdueArrivals(sessionId, yellowMins, redMins, nameMap).catch(
          (e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[AttendanceRollPanel] arrival sweep failed", e);
            toast.error("Attendance overdue sweep failed", { description: msg });
          },
        );
        await sweepOverdueDepartures(
          sessionId,
          depYellowMins,
          depRedMins,
          nameMap,
        ).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[AttendanceRollPanel] departure sweep failed", e);
          toast.error("Departure overdue sweep failed", { description: msg });
        });
      }
      return rows;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    enabled: !!sessionId && participantsQ.isSuccess,
  });

  // Realtime push — silently refresh the roll when the underlying log row
  // changes. Keeps the screen live without nuking any open modal state.
  useRealtimeInvalidate({
    table: "client_attendance_log",
    filter: sessionId ? `session_id=eq.${sessionId}` : undefined,
    queryKeys: [ROLL_KEY(sessionId)],
    enabled: !!sessionId,
  });
  useRealtimeInvalidate({
    table: "site_issues_register",
    filter: sessionId ? `session_id=eq.${sessionId}` : undefined,
    queryKeys: [ROLL_KEY(sessionId)],
    enabled: !!sessionId,
  });

  const visitorsQ = useQuery({
    queryKey: siteDayVisitorsKey(sessionId),
    queryFn: () => listSiteDayVisitors(sessionId),
    enabled: !!sessionId,
    staleTime: 15_000,
  });
  useRealtimeInvalidate({
    table: "site_day_visitors",
    filter: sessionId ? `session_id=eq.${sessionId}` : undefined,
    queryKeys: [siteDayVisitorsKey(sessionId)],
    enabled: !!sessionId,
  });

  const leaveVisitorMut = useMutation({
    mutationFn: (v: SiteDayVisitor) => markSiteDayVisitorLeft(v),
    onSuccess: (row) => {
      toast.success(`${row.displayName} marked left.`);
      qc.invalidateQueries({ queryKey: siteDayVisitorsKey(sessionId) });
    },
    onError: (e: Error) =>
      toast.error("Could not mark visitor left", { description: e.message }),
  });

  /** Undo check-in only (checked_in → expected). Check-in uses arrival sheet. */
  const undoMut = useMutation({
    mutationFn: (row: ClientAttendanceRow) => toggleCheckIn(row),
    onMutate: async (row) => {
      await qc.cancelQueries({ queryKey: ROLL_KEY(sessionId) });
      const prev = qc.getQueryData<ClientAttendanceRow[]>(ROLL_KEY(sessionId));
      const flipped: ClientAttendanceRow = {
        ...row,
        status: "expected",
        checkedInAt: null,
        checkedInBy: null,
      };
      qc.setQueryData<ClientAttendanceRow[]>(ROLL_KEY(sessionId), (prevRows) =>
        (prevRows ?? []).map((r) => (r.id === row.id ? flipped : r)),
      );
      return { prev };
    },
    onError: (e: Error, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(ROLL_KEY(sessionId), ctx.prev);
      toast.error("Could not undo check-in", { description: e.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
    },
  });

  const arrivalMut = useMutation({
    mutationFn: ({
      row,
      selection,
    }: {
      row: ClientAttendanceRow;
      selection: FloorTransportSelection;
    }) =>
      recordClientArrival(row, {
        arrival: selection.kind === "self" ? "self" : "bus",
        busRunCode: selection.kind === "bus" ? selection.busRunCode : null,
        alsoCheckIn: true,
      }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.selection.kind === "self"
          ? "Checked in — self / family."
          : "Checked in — arrived by bus.",
      );
      qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
    },
    onError: (e: Error) => {
      toast.error("Could not check in", { description: e.message });
    },
  });

  const checkoutMut = useMutation({
    mutationFn: ({
      row,
      vector,
    }: {
      row: ClientAttendanceRow;
      vector: DepartureVector;
    }) => checkOutParticipant(row, vector),
    onSuccess: (result, vars) => {
      toast.success(
        `${nameMap[vars.row.participantId] ?? "Client"} checked out via ${vars.vector}.`,
        {
          description:
            result.departureAutoCloseOutcome === "red_left_open"
              ? "RED issue remains open in the Governance Hub for manager review."
              : result.departureAutoCloseOutcome === "yellow_closed"
                ? "YELLOW departure issue auto-resolved."
                : undefined,
        },
      );
      qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
    },
    onError: (e: Error) =>
      toast.error("Check-out failed", { description: e.message }),
  });

  function methodKey(phase: "arrival" | "departure", rowId: string) {
    return `${phase}:${rowId}`;
  }

  function arrivalSelectionFor(row: ClientAttendanceRow): FloorTransportSelection {
    const key = methodKey("arrival", row.id);
    if (methodByKey[key]) return methodByKey[key];
    return selectionFromScheduleLabel(
      transportLabelMap[row.participantId],
      busRunOpts,
      "dayCentre",
      scheduleLabelIsSelf,
    );
  }

  function departureSelectionFor(row: ClientAttendanceRow): FloorTransportSelection {
    const key = methodKey("departure", row.id);
    if (methodByKey[key]) return methodByKey[key];
    return selectionFromScheduleLabel(
      outboundLabelMap[row.participantId] ||
        transportLabelMap[row.participantId],
      busRunOpts,
      "dayCentre",
      scheduleLabelIsSelf,
    );
  }

  const allRows = rollQ.data ?? [];
  const rows = useMemo(() => {
    if (mode === "check_in") {
      // Still need arrival (expected / absent placeholders).
      return allRows.filter(
        (r) =>
          r.status !== "checked_in" &&
          r.status !== "checked_out" &&
          !r.checkedOutAt,
      );
    }
    if (mode === "check_out") {
      return allRows.filter((r) => r.status === "checked_in");
    }
    return allRows;
  }, [allRows, mode]);
  /** Check-In tab: people already on site (visible record; actions on Check-Out). */
  const alreadyInRows = useMemo(() => {
    if (mode !== "check_in") return [];
    return allRows.filter((r) => r.status === "checked_in");
  }, [allRows, mode]);
  const leftTodayRows = useMemo(() => {
    if (mode !== "check_in") return [];
    return allRows.filter((r) => r.status === "checked_out");
  }, [allRows, mode]);
  const visitors = visitorsQ.data ?? [];
  const visitorsPresent = visitors.filter((v) => !v.leftAt);
  const showVisitors = mode !== "check_out";
  const showCheckInActions = mode !== "check_out";
  const pickerRow = picker
    ? allRows.find((r) => r.id === picker.rowId) ?? null
    : null;
  const pickerSelection = pickerRow
    ? picker.phase === "arrival"
      ? arrivalSelectionFor(pickerRow)
      : departureSelectionFor(pickerRow)
    : null;
  const checkedIn = allRows.filter((r) => r.status === "checked_in").length;
  // Arrival overdue only — exclude departed / absent; ignore stale severity
  // left on rows that already have an Out stamp.
  const overdue = allRows.filter(
    (r) =>
      r.escalationSeverity !== null &&
      !r.checkedInAt &&
      !r.checkedOutAt &&
      r.status !== "checked_out" &&
      r.status !== "absent",
  );
  const hasUnarrived = allRows.some(
    (r) => r.status !== "checked_in" && r.status !== "accounted",
  );
  const title =
    mode === "check_in"
      ? "Check-In"
      : mode === "check_out"
        ? "Check-Out"
        : "Attendance Roll";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}{" "}
          <span className="ml-1 font-mono normal-case text-muted-foreground/70">
            {mode === "check_out" ? (
              <>
                ({rows.length} on site
                {visitorsPresent.length > 0 && showVisitors && (
                  <>
                    {" "}· {visitorsPresent.length} visitor
                    {visitorsPresent.length === 1 ? "" : "s"}
                  </>
                )}
                )
              </>
            ) : (
              <>
                ({checkedIn}/{allRows.length} in
                {visitorsPresent.length > 0 && showVisitors && (
                  <>
                    {" "}· {visitorsPresent.length} visitor
                    {visitorsPresent.length === 1 ? "" : "s"} on site
                  </>
                )}
                {overdue.length > 0 && mode !== "check_out" && (
                  <>
                    {" "}·{" "}
                    <span className="text-destructive">
                      {overdue.length} overdue
                    </span>
                  </>
                )}
                )
              </>
            )}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {rollQ.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {showCheckInActions && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setVisitorOpen(true)}
                className="h-8 gap-1.5"
              >
                <UserRoundPlus className="h-4 w-4" />
                + Add visitor
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAddOpen(true)}
                className="h-8 gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                + Add Attendee
              </Button>
              {hasUnarrived && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => setBulkOpen(true)}
                  className="h-8 gap-1.5"
                >
                  <Bus className="h-4 w-4" />
                  Bulk Defer Group
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {rollQ.isError && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              <div className="font-medium">Could not load attendance roll.</div>
              <div className="text-xs">{(rollQ.error as Error).message}</div>
            </div>
          </div>
        </Card>
      )}

      {!rollQ.isError &&
        allRows.length === 0 &&
        !rollQ.isLoading && (
          <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              No clients scheduled for today, or the roll has not seeded yet.
            </div>
          </Card>
        )}

      {!rollQ.isError &&
        mode === "check_in" &&
        allRows.length > 0 &&
        rows.length === 0 &&
        alreadyInRows.length > 0 && (
          <Card className="border-dashed border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-muted-foreground">
            All expected arrivals are checked in. Names below — use{" "}
            <span className="font-semibold text-foreground">Check-Out</span> to
            depart people still on site.
          </Card>
        )}

      {!rollQ.isError &&
        mode === "check_out" &&
        rows.length === 0 &&
        !rollQ.isLoading &&
        allRows.length > 0 && (
          <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Nobody on site waiting to check out.
            </div>
          </Card>
        )}

      <ul className="space-y-2">
        {rows.map((r) => {
          const isIn = r.status === "checked_in";
          const isOut = r.status === "checked_out";
          const isAbsent = r.status === "absent";
          // Departure rail takes precedence over arrival rail when the
          // participant is already checked in (arrival rail is, by
          // definition, satisfied at that point).
          const depRed = r.departureSeverity === "red" && isIn;
          const depYellow = r.departureSeverity === "yellow" && isIn && !depRed;
          const isRed =
            !isAbsent && !isOut &&
            ((r.escalationSeverity === "red" && !isIn) || depRed);
          const isYellow =
            !isAbsent && !isOut && !isRed &&
            ((r.escalationSeverity === "yellow" && !isIn) || depYellow);
          // Parse the [ABSENT:CODE] tag we wrote into notes for the badge.
          const absentMatch = isAbsent && r.notes
            ? /\[ABSENT:([A-Z_]+)\]\s*([^—(]+)/.exec(r.notes)
            : null;
          const absentLabel = absentMatch?.[2]?.trim() ?? "Absent today";
          // WCAG: on Green/Yellow/Absent tinted surfaces, force solid charcoal
          // so text + timestamp both clear AA contrast.
          const subTextCls =
            isIn || isYellow || isAbsent || isOut
              ? "text-slate-900/80"
              : "text-muted-foreground";
          const busy =
            undoMut.isPending ||
            arrivalMut.isPending ||
            checkoutMut.isPending;
          const canConfirmArrival =
            mode !== "check_out" &&
            !busy &&
            !isAbsent &&
            !isOut &&
            !isIn &&
            !r.checkedOutAt;
          const canConfirmDeparture =
            mode !== "check_in" &&
            !busy &&
            isIn &&
            !isOut &&
            !r.checkedOutAt;
          const plannedLabel = transportLabelMap[r.participantId] ?? "";
          const plannedSelf = scheduleLabelIsSelf(plannedLabel);
          const actualSelf =
            r.arrivalMethod === "private" || r.arrivalMethod === "walk_in";
          const actualBus = r.arrivalMethod === "bus";
          const methodMismatch =
            isIn &&
            plannedLabel.length > 0 &&
            ((plannedSelf && actualBus) || (!plannedSelf && actualSelf));
          const actualBadge = actualBus
            ? eventBusRunShortLabel(r.arrivalBusRunCode, busRunOpts) ||
              arrivalMethodBadgeLabel(r.arrivalMethod)
            : arrivalMethodBadgeLabel(r.arrivalMethod);
          const arrivalSel = arrivalSelectionFor(r);
          const departureSel = departureSelectionFor(r);
          const displayName = nameMap[r.participantId] ?? "client";
          const clinicalChips = clinicalFlagsFromParticipant(
            participantById.get(r.participantId) ?? {},
          );

          return (
            <li key={r.id}>
              <div
                className={cn(
                  "w-full min-h-[56px] rounded-lg border-2 px-4 py-3 text-left",
                  "flex items-center justify-between gap-3",
                  isIn && !isYellow && !isRed &&
                    "border-green-600 bg-green-50 text-slate-900",
                  !isIn && !isRed && !isYellow && !isAbsent && !isOut &&
                    "border-border bg-card",
                  isYellow &&
                    "border-amber-500 bg-amber-50 text-slate-900",
                  isRed &&
                    "border-2 border-destructive bg-destructive/10 text-destructive",
                  isAbsent &&
                    "border-slate-400 bg-slate-200/70 text-slate-900",
                  isOut &&
                    "border-slate-400 bg-slate-100 text-slate-900",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (canConfirmArrival) {
                      arrivalMut.mutate({
                        row: r,
                        selection: arrivalSel,
                      });
                      return;
                    }
                    if (canConfirmDeparture) {
                      const vector: DepartureVector =
                        departureSel.kind === "bus"
                          ? "bus"
                          : departureSel.kind === "independent"
                            ? "independent"
                            : "family";
                      checkoutMut.mutate({ row: r, vector });
                    }
                  }}
                  disabled={!canConfirmArrival && !canConfirmDeparture}
                  aria-pressed={isIn}
                  aria-label={
                    canConfirmDeparture
                      ? `Check out ${displayName} via ${departureSel.label}`
                      : canConfirmArrival
                        ? `Check in ${displayName} via ${arrivalSel.label}`
                        : `${displayName}`
                  }
                  className={cn(
                    "min-w-0 flex-1 rounded-md text-left transition-colors",
                    "active:scale-[0.99] disabled:opacity-100",
                    (canConfirmArrival || canConfirmDeparture) &&
                      "hover:bg-black/5",
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "truncate text-base font-semibold",
                        (isAbsent || isOut) && "line-through decoration-slate-500/60",
                      )}
                    >
                      {nameMap[r.participantId] ?? "Loading…"}
                    </span>
                    {!isIn && !isOut && !isAbsent && (
                      <Badge
                        variant="outline"
                        className="border border-slate-400 bg-white text-slate-900 text-[10px] uppercase"
                      >
                        Planned{" "}
                        {plannedLabel ||
                          arrivalMethodBadgeLabel(r.arrivalMethod)}
                      </Badge>
                    )}
                    {(isIn || isOut) && (
                      <Badge className="border border-slate-400 bg-white text-slate-900 text-[10px] uppercase">
                        {actualBadge}
                      </Badge>
                    )}
                    {methodMismatch && (
                      <Badge className="text-[10px] border-amber-500/50 bg-amber-500/10 text-amber-800 font-medium normal-case">
                        ≠ planned
                      </Badge>
                    )}

                    {depRed && (
                      <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
                        Departure Escalated — Manager notified
                      </Badge>
                    )}
                    {depYellow && (
                      <Badge className="bg-amber-500 text-white text-[10px] uppercase">
                        Departure Overdue
                      </Badge>
                    )}
                    {isRed && !depRed && (
                      <Badge className="bg-destructive text-destructive-foreground text-[10px] uppercase">
                        Escalated — Manager notified
                      </Badge>
                    )}
                    {isYellow && !depYellow && (
                      <Badge className="bg-amber-500 text-white text-[10px] uppercase">
                        Overdue
                      </Badge>
                    )}
                    {isAbsent && (
                      <Badge className="bg-slate-600 text-white text-[10px] uppercase">
                        Absent · {absentLabel}
                      </Badge>
                    )}
                    {isOut && (
                      <Badge className="bg-slate-600 text-white text-[10px] uppercase">
                        Checked out
                      </Badge>
                    )}
                    {clinicalChips.length > 0 && (
                      <ClinicalFlagChips
                        chips={clinicalChips}
                        personName={displayName}
                      />
                    )}
                  </div>
                  <div className={cn("mt-0.5 text-xs", subTextCls)}>
                    Expected{" "}
                    <ClientTime
                      iso={r.expectedArrivalAt}
                      options={{ hour: "2-digit", minute: "2-digit" }}
                    />
                    {r.expectedDepartureAt && (
                      <>
                        {" "}→{" "}
                        <ClientTime
                          iso={r.expectedDepartureAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                    {r.checkedInAt && (
                      <>
                        {" "}· In{" "}
                        <ClientTime
                          iso={r.checkedInAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                    {r.checkedOutAt && (
                      <>
                        {" "}· Out{" "}
                        <ClientTime
                          iso={r.checkedOutAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </>
                    )}
                    {isAbsent && absentMatch && (
                      <> · Not attending today (PIN verified)</>
                    )}
                    {isAbsent && !absentMatch && r.notes?.trim() && (
                      <> · {r.notes.trim()}</>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  {!isAbsent && !isOut && (canConfirmArrival || canConfirmDeparture) && (
                    <EmbeddedMethodButton
                      label={
                        canConfirmDeparture
                          ? departureSel.label
                          : arrivalSel.label
                      }
                      disabled={busy}
                      onClick={() =>
                        setPicker({
                          rowId: r.id,
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setUndoTarget(r)}
                      className={cn(
                        "inline-flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-md px-2",
                        "border border-slate-300 bg-white text-slate-900 shadow-sm",
                        "hover:bg-slate-100 active:scale-[0.98] touch-manipulation",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                      title="Undo check-in"
                      aria-label={`Undo check-in for ${displayName}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium uppercase leading-none text-slate-500">
                        Undo
                      </span>
                    </button>
                  )}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Adjust expected time for ${displayName}`}
                    onClick={() => setAdjustRow(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setAdjustRow(r);
                      }
                    }}
                    className={cn(
                      "inline-flex items-center justify-center rounded-md p-2",
                      "min-h-11 min-w-11 cursor-pointer",
                      "border border-slate-300 bg-white hover:bg-slate-100",
                      "text-slate-900 shadow-sm",
                    )}
                  >
                    <Clock className="h-4 w-4" />
                  </span>
                  <div
                    className={cn(
                      "rounded-full p-2",
                      isIn
                        ? "bg-green-600 text-white"
                        : isAbsent || isOut
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

      {mode === "check_in" && alreadyInRows.length > 0 && (
        <div className="space-y-2 pt-1">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Already checked in{" "}
            <span className="font-mono normal-case text-muted-foreground/70">
              ({alreadyInRows.length})
            </span>
          </h4>
          <ul className="space-y-1.5">
            {alreadyInRows.map((r) => {
              const displayName = nameMap[r.participantId] ?? "client";
              const clinicalChips = clinicalFlagsFromParticipant(
                participantById.get(r.participantId) ?? {},
              );
              const busy = undoMut.isPending;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-lg border-2 border-green-600/50 bg-green-50 px-3 py-2.5 text-slate-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {displayName}
                      </span>
                      <Badge className="bg-green-600 text-[10px] uppercase text-white">
                        In
                      </Badge>
                      {clinicalChips.length > 0 && (
                        <ClinicalFlagChips
                          chips={clinicalChips}
                          personName={displayName}
                        />
                      )}
                    </div>
                    {r.checkedInAt && (
                      <p className="mt-0.5 text-xs text-slate-900/80">
                        In{" "}
                        <ClientTime
                          iso={r.checkedInAt}
                          options={{ hour: "2-digit", minute: "2-digit" }}
                        />
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setUndoTarget(r)}
                    className={cn(
                      "inline-flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-2",
                      "border border-slate-300 bg-white text-slate-900 shadow-sm",
                      "hover:bg-slate-100 active:scale-[0.98] touch-manipulation",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                    title="Undo check-in"
                    aria-label={`Undo check-in for ${displayName}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="text-[9px] font-medium uppercase leading-none text-slate-500">
                      Undo
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {mode === "check_in" && leftTodayRows.length > 0 && (
        <div className="space-y-2 pt-1">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Left today{" "}
            <span className="font-mono normal-case text-muted-foreground/70">
              ({leftTodayRows.length})
            </span>
          </h4>
          <ul className="space-y-1">
            {leftTodayRows.map((r) => (
              <li
                key={r.id}
                className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 opacity-80"
              >
                <span className="font-medium line-through decoration-slate-500/60">
                  {nameMap[r.participantId] ?? "client"}
                </span>
                {r.checkedOutAt && (
                  <span className="ml-2 text-xs text-slate-700">
                    Out{" "}
                    <ClientTime
                      iso={r.checkedOutAt}
                      options={{ hour: "2-digit", minute: "2-digit" }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showVisitors && (visitors.length > 0 || visitorsQ.isError) && (
        <div className="space-y-2 pt-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Visitors{" "}
            {visitorsPresent.length > 0 && (
              <span className="font-mono normal-case text-muted-foreground/70">
                ({visitorsPresent.length} on site)
              </span>
            )}
          </h4>
          {visitorsQ.isError && (
            <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load visitors.{" "}
              {(visitorsQ.error as Error).message}
            </Card>
          )}
          <ul className="space-y-2">
            {visitors.map((v) => {
              const present = !v.leftAt;
              const linked =
                v.linkedParticipantId != null
                  ? (nameMap[v.linkedParticipantId] ?? null)
                  : null;
              return (
                <li
                  key={v.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border-2 px-4 py-3",
                    present
                      ? "border-amber-500 bg-amber-50 text-slate-900"
                      : "border-slate-300 bg-slate-100 text-slate-900 opacity-80",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "truncate text-base font-semibold",
                          !present && "line-through decoration-slate-500/60",
                        )}
                      >
                        {v.displayName}
                      </span>
                      <Badge
                        variant="outline"
                        className="border border-slate-400 bg-white text-[10px] uppercase text-slate-900"
                      >
                        {VISITOR_KIND_LABELS[v.kind]}
                      </Badge>
                      {present ? (
                        <Badge className="bg-amber-500 text-[10px] uppercase text-white">
                          On site
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-600 text-[10px] uppercase text-white">
                          Left
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-900/80">
                      In{" "}
                      <ClientTime
                        iso={v.arrivedAt}
                        options={{ hour: "2-digit", minute: "2-digit" }}
                      />
                      {v.leftAt && (
                        <>
                          {" "}
                          · Out{" "}
                          <ClientTime
                            iso={v.leftAt}
                            options={{ hour: "2-digit", minute: "2-digit" }}
                          />
                        </>
                      )}
                      {linked && <> · With {linked}</>}
                      {v.note?.trim() && <> · {v.note.trim()}</>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 gap-1.5"
                      onClick={() => setPromoteVisitor(v)}
                    >
                      <UserRoundPlus className="h-4 w-4" />
                      Add to event…
                    </Button>
                    {present && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-11 gap-1.5"
                        disabled={leaveVisitorMut.isPending}
                        onClick={() => leaveVisitorMut.mutate(v)}
                      >
                        <LogOut className="h-4 w-4" />
                        Mark left
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AdjustExpectedTimeModal
        row={adjustRow}
        yellowThresholdMins={yellowMins}
        participantName={
          adjustRow ? (nameMap[adjustRow.participantId] ?? "Client") : ""
        }
        onClose={(changed: boolean) => {
          setAdjustRow(null);
          if (changed) qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }}
      />

      <BulkDeferGroupModal
        open={bulkOpen}
        sessionId={sessionId}
        rows={rows}
        nameMap={nameMap}
        yellowThresholdMins={yellowMins}
        onClose={(changed: boolean) => {
          setBulkOpen(false);
          if (changed) qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }}
      />

      <AddAttendeeModal
        open={addOpen}
        sessionId={sessionId}
        onClose={(changed: boolean) => {
          setAddOpen(false);
          if (changed) qc.invalidateQueries({ queryKey: ROLL_KEY(sessionId) });
        }}
      />

      <AddVisitorModal
        open={visitorOpen}
        sessionId={sessionId}
        onClose={() => setVisitorOpen(false)}
      />

      <PromoteVisitorToEventDialog
        open={!!promoteVisitor}
        visitor={promoteVisitor}
        onClose={() => setPromoteVisitor(null)}
      />

      <TransportMethodPickerSheet
        open={!!picker}
        onOpenChange={(o) => {
          if (!o) setPicker(null);
        }}
        title={
          picker?.phase === "departure"
            ? `Departure method — ${
                pickerRow
                  ? (nameMap[pickerRow.participantId] ?? "Client")
                  : "Client"
              }`
            : `Arrival method — ${
                pickerRow
                  ? (nameMap[pickerRow.participantId] ?? "Client")
                  : "Client"
              }`
        }
        description="Tap to select. Then tap the wide row to confirm."
        options={
          picker?.phase === "departure"
            ? departurePickerOptions
            : arrivalPickerOptions
        }
        selected={pickerSelection}
        pending={arrivalMut.isPending || checkoutMut.isPending}
        onSelect={(next) => {
          if (!picker) return;
          setMethodByKey((prev) => ({
            ...prev,
            [methodKey(picker.phase, picker.rowId)]: next,
          }));
        }}
      />

      <AlertDialog
        open={!!undoTarget}
        onOpenChange={(open) => {
          if (!open) setUndoTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo check-in?</AlertDialogTitle>
            <AlertDialogDescription>
              {undoTarget
                ? `${nameMap[undoTarget.participantId] ?? "This person"} will go back to expected — not yet arrived.`
                : "This person will go back to expected — not yet arrived."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoMut.isPending || !undoTarget}
              onClick={() => {
                if (!undoTarget) return;
                undoMut.mutate(undoTarget);
                setUndoTarget(null);
              }}
            >
              Undo check-in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

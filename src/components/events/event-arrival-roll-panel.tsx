/**
 * EventArrivalRollPanel — event-floor arrival/departure roll (§12.4.2 / Phase 8)
 *
 * Floor row embedded method override: wide row confirms check-in with current
 * method; method chip only updates selection. UserX = options (absent, etc.).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarX2,
  Check,
  Loader2,
  LogOut,
  MapPin,
  RotateCcw,
  Users,
  UserX,
} from "lucide-react";
import {
  WalkOnBadge,
  WalkOnFloorButton,
  WalkOnPersonModal,
} from "@/components/events/walk-on-person-modal";
import {
  listWalkOnBookings,
  walkOnParticipantIds,
} from "@/lib/api/event-walk-on";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { TransportMethodPickerSheet } from "@/components/ui/transport-method-picker-sheet";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import {
  buildBusSelfPickerOptions,
  selectionFromEventMode,
  type FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";
import {
  TripAbsentDispositionDialog,
  TripReinstateDialog,
  type TripAbsentDispositionResult,
} from "@/components/events/trip-absent-disposition-dialog";
import {
  checkoutEventParticipant,
  listEventAttendanceRoll,
  listPriorAbsences,
  markEventAttendanceAbsent,
  recordEventArrival,
  reinstateFromAbsent,
  seedEventAttendanceRoll,
  toggleEventCheckIn,
  type EventArrivalChoice,
  type EventAttendanceRow,
  type ReturnTransport,
} from "@/lib/api/event-attendance";
import { ClinicalFlagChips } from "@/components/ui/clinical-flag-chips";
import { clinicalFlagsFromParticipant } from "@/lib/clinical-flags";
import { getExpectedArrivalBy } from "@/lib/api/event-activity-roll";
import { EventTransportBadge } from "@/components/events/event-transport-badge";
import { listParticipants, LOOKUP_CATEGORIES } from "@/lib/data-store";
import { formatLeftTripDisplay } from "@/lib/trip-absent";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { eventBusRunOptions, eventBusRunShortLabel } from "@/lib/event-bus-runs";
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";
import {
  sortByParticipantSurname,
  surnameMapFromParticipants,
} from "@/lib/ui/sort-participants";

const rollKey = (sessionId: string) => ["event-attendance-log", sessionId] as const;

// ── Arrival urgency ──────────────────────────────────────────────────────────

type ArrivalUrgency = "warning" | "overdue" | null;

function getArrivalUrgency(
  row: EventAttendanceRow,
  now: Date,
  gate: Date | null,
): ArrivalUrgency {
  if (row.status !== "expected" || !gate) return null;
  const diffMin = (now.getTime() - gate.getTime()) / 60_000;
  if (diffMin >= 30) return "overdue";
  if (diffMin >= 0) return "warning";
  return null;
}
const priorAbsencesKey = (ids: string[]) =>
  ["event-attendance-prior-absences", ...ids.slice().sort()] as const;

interface PriorSession {
  id: string;
  session_date: string;
}

interface Props {
  sessionId: string;
  eventId: string;
  sessionDate: string;
  /** When false, roll is read-only (location closed). */
  editable?: boolean;
  /** When true, hides the departure handover button (Check-Out tab owns that flow). */
  hideDeparture?: boolean;
  /** True when this event has more than one day. */
  isMultiDay?: boolean;
  /** True when this is the last session day (hides "Joining from Day 2"). */
  isFinalDay?: boolean;
  /** Sessions that come before the current session (for "Absent Day X" badge). */
  priorSessions?: PriorSession[];
}

export function EventArrivalRollPanel({
  sessionId,
  eventId,
  sessionDate,
  editable = true,
  hideDeparture = false,
  isMultiDay = false,
  isFinalDay = true,
  priorSessions = [],
}: Props) {
  const qc = useQueryClient();

  // Late roster/guest adds after Open Location — pull missing names onto the roll.
  useEffect(() => {
    let cancelled = false;
    void seedEventAttendanceRoll(sessionId, eventId, sessionDate)
      .then(() => {
        if (cancelled) return;
        void qc.invalidateQueries({ queryKey: rollKey(sessionId) });
      })
      .catch((e) => console.warn("[EventArrivalRollPanel] seed sync", e));
    return () => {
      cancelled = true;
    };
  }, [sessionId, eventId, sessionDate, qc]);

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: rollKey(sessionId),
    queryFn: () => listEventAttendanceRoll(sessionId),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 60_000,
  });

  const { data: walkOnFlags = [] } = useQuery({
    queryKey: ["event-walk-ons", eventId],
    queryFn: () => listWalkOnBookings(eventId),
    staleTime: 15_000,
  });
  const walkOnIds = useMemo(
    () => walkOnParticipantIds(walkOnFlags),
    [walkOnFlags],
  );
  const [walkOnOpen, setWalkOnOpen] = useState(false);

  const priorSessionIds = priorSessions.map((s) => s.id);
  const { data: priorAbsenceMap = {} } = useQuery({
    queryKey: priorAbsencesKey(priorSessionIds),
    queryFn: () => listPriorAbsences(priorSessionIds),
    enabled: priorSessionIds.length > 0,
    staleTime: 60_000,
  });

  const { data: expectedArrivalBy = null } = useQuery({
    queryKey: ["event-arrival-gate", sessionId],
    queryFn: () => getExpectedArrivalBy(sessionId),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });

  // Tick every 30 s so urgency banners update without a page reload
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  /** Map: priorSessionId → human-readable day label */
  const priorSessionLabel = useMemo(() => {
    return Object.fromEntries(
      priorSessions.map((s, idx) => [
        s.id,
        `Day ${idx + 1} — ${new Date(s.session_date + "T00:00:00").toLocaleDateString("en-AU", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}`,
      ]),
    );
  }, [priorSessions]);

  const nameMap = useMemo(() => {
    return Object.fromEntries(
      participants.map((p) => [
        p.id,
        `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Participant",
      ]),
    );
  }, [participants]);

  const surnameById = useMemo(
    () => surnameMapFromParticipants(participants),
    [participants],
  );
  const sortedRows = useMemo(
    () =>
      sortByParticipantSurname(rows, (r) => r.participantId, surnameById),
    [rows, surnameById],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: rollKey(sessionId) });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-actual-transport" });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "trip-report" });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-issues" });
    // Curfew/morning rolls are derived from check-in state — invalidate so they
    // reflect the new arrival immediately without a manual Re-sync.
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-accountability-roll" });
    qc.invalidateQueries({ queryKey: ["event-unreconciled-checkins", sessionId] });
  };

  const toggleMut = useMutation({
    mutationFn: (row: EventAttendanceRow) => toggleEventCheckIn(row),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const checkoutMut = useMutation({
    mutationFn: ({
      row,
      transport,
      busRunCode,
    }: {
      row: EventAttendanceRow;
      transport: ReturnTransport;
      busRunCode?: string | null;
    }) => checkoutEventParticipant(row, transport, busRunCode),
    onSuccess: () => {
      toast.success("Departure handover recorded.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busRunOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);

  const arrivalMut = useMutation({
    mutationFn: ({
      row,
      arrival,
      busRunCode,
      notes,
      alsoCheckIn,
    }: {
      row: EventAttendanceRow;
      arrival: EventArrivalChoice;
      busRunCode?: string | null;
      notes?: string;
      alsoCheckIn?: boolean;
    }) =>
      recordEventArrival(row, {
        arrival,
        busRunCode,
        notes,
        alsoCheckIn,
      }),
    onSuccess: (_data, vars) => {
      const checkedInNow = vars.alsoCheckIn !== false && vars.row.status === "expected";
      if (vars.arrival === "self") {
        toast.success(
          checkedInNow
            ? "Checked in — self / meeting at venue."
            : "Arrival updated — self / meeting at venue.",
        );
      } else {
        toast.success(
          checkedInNow
            ? "Checked in — arrived by bus."
            : "Arrival updated — bus.",
        );
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  type PlannedOutbound = {
    mode: "bus" | "self";
    busRunCode: string | null;
  };
  const { data: plannedOutboundByParticipant = new Map<string, PlannedOutbound>() } =
    useQuery({
      queryKey: ["event-roster-outbound-plan", eventId],
      queryFn: async () => {
        const withRuns =
          "participant_id, outbound_transport_mode, outbound_bus_run_code";
        let result = await supabase
          .from("event_roster_bookings")
          .select(withRuns)
          .eq("event_id", eventId)
          .neq("booking_status", "Cancelled");
        if (result.error && isSchemaMismatchError(result.error)) {
          result = await supabase
            .from("event_roster_bookings")
            .select("participant_id, outbound_transport_mode")
            .eq("event_id", eventId)
            .neq("booking_status", "Cancelled");
        }
        if (result.error) throw result.error;
        const map = new Map<string, PlannedOutbound>();
        for (const raw of result.data ?? []) {
          const r = raw as {
            participant_id: string;
            outbound_transport_mode?: string | null;
            outbound_bus_run_code?: string | null;
          };
          map.set(r.participant_id, {
            mode: r.outbound_transport_mode === "self" ? "self" : "bus",
            busRunCode: (r.outbound_bus_run_code ?? "").trim() || null,
          });
        }
        return map;
      },
      staleTime: 60_000,
    });

  const absentMut = useMutation({
    mutationFn: (params: Parameters<typeof markEventAttendanceAbsent>[0]) =>
      markEventAttendanceAbsent(params),
    onSuccess: (result, vars) => {
      if (!result.hubIssueCreated) {
        toast.warning("Absence recorded — Hub issue could not be created automatically.", {
          description: "Roll updated.",
        });
      } else {
        toast.success(
          vars.joiningDay2
            ? "Marked absent — joining Day 2 noted."
            : "Marked absent. Hub welfare issue created.",
          { description: "Roll updated." },
        );
      }
      invalidate();
    },
    onError: (e: Error) =>
      toast.error("Could not mark absent.", { description: e.message }),
  });

  const reinstateMut = useMutation({
    mutationFn: ({
      row,
      reason,
      participantName,
    }: {
      row: EventAttendanceRow;
      reason: string;
      participantName: string;
    }) =>
      reinstateFromAbsent(row, { reason, toStatus: "expected", participantName }),
    onSuccess: () => {
      toast.success("Reinstated — participant marked as expected.");
      invalidate();
    },
    onError: (e: Error) => toast.error("Could not reinstate.", { description: e.message }),
  });

  // Progress counter: "absent" rows are resolved — they do not count as pending check-ins
  const checkedIn = rows.filter((r) => r.status === "checked_in").length;
  const checkedOut = rows.filter((r) => r.status === "checked_out").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const pending = rows.filter((r) => r.status === "expected").length;
  const total = rows.length;

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showJoiningDay2 = isMultiDay && !isFinalDay;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Check in each person <strong>as they arrive</strong> — tap the wide row when
          the method chip is right, or change the chip first (roster plan is
          a hint only). Use Check-Out at end of programme for return transport.
        </p>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-wrap gap-3 text-xs font-medium">
        <span>
          {checkedIn}/{total} checked in
        </span>
        {pending > 0 && (
          <span className="text-amber-600">{pending} still expected</span>
        )}
        {absent > 0 && (
          <span className="text-destructive">{absent} absent</span>
        )}
        {checkedOut > 0 && (
          <span className="text-muted-foreground">{checkedOut} handed to transport</span>
        )}
      </div>

      {/* ── Arrival gate banner ── */}
      {expectedArrivalBy && pending > 0 && (() => {
        const diffMin = (now.getTime() - expectedArrivalBy.getTime()) / 60_000;
        if (diffMin >= 30) {
          return (
            <div className="rounded-lg border border-destructive/60 bg-destructive/5 px-3 py-2.5 text-sm font-medium text-destructive">
              🔴 Arrival overdue — {pending} participant{pending !== 1 ? "s" : ""} not accounted for. Action required.
            </div>
          );
        }
        if (diffMin >= 0) {
          return (
            <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800">
              ⚠ Arrival window has passed — {pending} still expected. Mark absent or reinstate if late.
            </div>
          );
        }
        return null;
      })()}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-5 w-5" />
          No roster entries — open the location to seed the arrival roll.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sortedRows.map((row) => {
            const absentPriorSessionId = priorAbsenceMap[row.participantId];
            const absentDayLabel = absentPriorSessionId
              ? priorSessionLabel[absentPriorSessionId]
              : null;
            return (
              <RollCard
                key={row.id}
                row={row}
                name={nameMap[row.participantId] ?? "Loading…"}
                editable={editable}
                hideDeparture={hideDeparture}
                showJoiningDay2={showJoiningDay2}
                busy={
                  toggleMut.isPending ||
                  checkoutMut.isPending ||
                  arrivalMut.isPending ||
                  absentMut.isPending ||
                  reinstateMut.isPending
                }
                absentDayLabel={absentDayLabel}
                arrivalUrgency={getArrivalUrgency(row, now, expectedArrivalBy)}
                busRunOpts={busRunOpts}
                plannedOutbound={
                  plannedOutboundByParticipant.get(row.participantId) ?? null
                }
                isWalkOn={walkOnIds.has(row.participantId)}
                clinicalChips={clinicalFlagsFromParticipant(
                  participants.find((p) => p.id === row.participantId) ?? {},
                )}
                onUndoCheckIn={() => toggleMut.mutate(row)}
                onCheckout={(transport, busRunCode) =>
                  checkoutMut.mutate({ row, transport, busRunCode })
                }
                onRecordArrival={(arrival, busRunCode, notes, alsoCheckIn) =>
                  arrivalMut.mutate({
                    row,
                    arrival,
                    busRunCode,
                    notes,
                    alsoCheckIn,
                  })
                }
                onAbsent={(result, joiningDay2) =>
                  absentMut.mutateAsync({
                    row,
                    disposition: result.disposition,
                    safetyPlan: result.safetyPlan,
                    severity: result.severity,
                    eventId,
                    joiningDay2,
                    participantName: nameMap[row.participantId] ?? "Participant",
                  })
                }
                onReinstate={(reason) =>
                  reinstateMut.mutateAsync({
                    row,
                    reason,
                    participantName: nameMap[row.participantId] ?? "Participant",
                  })
                }
                reinstatePending={reinstateMut.isPending}
                absentPending={absentMut.isPending}
              />
            );
          })}
        </ul>
      )}

      <WalkOnFloorButton
        label="Someone extra arrived"
        onClick={() => setWalkOnOpen(true)}
      />
      <WalkOnPersonModal
        open={walkOnOpen}
        onOpenChange={setWalkOnOpen}
        eventId={eventId}
        source="venue"
        eventDaySessionId={sessionId}
      />
    </div>
  );
}

// ─── Roll card ────────────────────────────────────────────────────────────────

type AbsentIntent = "absent" | "joining_day2";

function RollCard({
  row,
  name,
  editable,
  hideDeparture,
  showJoiningDay2,
  busy,
  absentDayLabel,
  arrivalUrgency = null,
  busRunOpts,
  plannedOutbound,
  isWalkOn = false,
  clinicalChips = [],
  onUndoCheckIn,
  onCheckout,
  onRecordArrival,
  onAbsent,
  onReinstate,
  reinstatePending = false,
  absentPending = false,
}: {
  row: EventAttendanceRow;
  name: string;
  editable: boolean;
  hideDeparture: boolean;
  showJoiningDay2: boolean;
  busy: boolean;
  absentDayLabel: string | null;
  arrivalUrgency?: ArrivalUrgency;
  busRunOpts: ReturnType<typeof eventBusRunOptions>;
  plannedOutbound: { mode: "bus" | "self"; busRunCode: string | null } | null;
  isWalkOn?: boolean;
  clinicalChips?: import("@/lib/clinical-flags").ClinicalFlagChip[];
  onUndoCheckIn: () => void;
  onCheckout: (t: ReturnTransport, busRunCode?: string | null) => void;
  onRecordArrival: (
    arrival: EventArrivalChoice,
    busRunCode?: string | null,
    notes?: string,
    alsoCheckIn?: boolean,
  ) => void;
  onAbsent: (
    result: TripAbsentDispositionResult,
    joiningDay2: boolean,
  ) => void | Promise<unknown>;
  onReinstate: (reason: string) => void | Promise<unknown>;
  reinstatePending?: boolean;
  absentPending?: boolean;
}) {
  const isIn = row.status === "checked_in";
  const isOut = row.status === "checked_out";
  const isAbsent = row.status === "absent";
  const absentReason = formatLeftTripDisplay(row.notes);
  const actualIsBus = row.arrivalMethod === "bus";
  const actualIsSelf =
    row.arrivalMethod === "walk_in" || row.arrivalMethod === "private";
  const plannedIsBus = (plannedOutbound?.mode ?? "bus") === "bus";
  const methodMismatch =
    (isIn || isOut) &&
    plannedOutbound != null &&
    ((plannedIsBus && actualIsSelf) || (!plannedIsBus && actualIsBus));

  // Sheet visibility
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [methodPickerOpen, setMethodPickerOpen] = useState(false);
  const [departOpen, setDepartOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [absentOpen, setAbsentOpen] = useState(false);
  const [reinstateOpen, setReinstateOpen] = useState(false);

  const plannedSelection = selectionFromEventMode(
    plannedOutbound?.mode ?? "bus",
    plannedOutbound?.busRunCode ?? null,
    busRunOpts,
  );
  const [arrivalOverride, setArrivalOverride] =
    useState<FloorTransportSelection | null>(null);
  const arrivalSel = arrivalOverride ?? plannedSelection;
  const arrivalPickerOptions = useMemo(
    () =>
      buildBusSelfPickerOptions(busRunOpts, "event", {
        busTitlePrefix: "Arrived on",
        selfTitle: "Self / Meeting at venue",
        selfSubtitle: "Family or independent — not on the bus",
      }),
    [busRunOpts],
  );

  // Walk-in state
  const [walkInNote, setWalkInNote] = useState("");

  // Absent form state
  const [absentIntent, setAbsentIntent] = useState<AbsentIntent>("absent");

  function openAbsentFlow(intent: AbsentIntent) {
    setOptionsOpen(false);
    setAbsentIntent(intent);
    setTimeout(() => setAbsentOpen(true), 150);
  }

  function openWalkInFlow() {
    setOptionsOpen(false);
    setWalkInNote("");
    setTimeout(() => setWalkInOpen(true), 150);
  }

  function applyArrivalSelection(next: FloorTransportSelection) {
    if (isIn || isOut) {
      // Already on floor — correcting method applies immediately.
      onRecordArrival(
        next.kind === "self" ? "self" : "bus",
        next.kind === "bus" ? next.busRunCode : null,
        undefined,
        false,
      );
      return;
    }
    setArrivalOverride(next);
  }

  function confirmArrival() {
    onRecordArrival(
      arrivalSel.kind === "self" ? "self" : "bus",
      arrivalSel.kind === "bus" ? arrivalSel.busRunCode : null,
      undefined,
      true,
    );
  }

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2",
        // Hi-vis checked-in — solid success fill (§4.5 / UI-STYLE-GUIDE)
        isIn &&
          "border-2 border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40",
        isOut && "border-muted bg-muted/20 opacity-80",
        isAbsent && "border-destructive/60 bg-destructive/5",
        !isIn && !isOut && !isAbsent && arrivalUrgency === "warning" && "border-amber-400 bg-amber-50",
        !isIn && !isOut && !isAbsent && arrivalUrgency === "overdue" && "border-destructive/60 bg-destructive/5",
      )}
    >
      {/* Floor row: wide confirm + method chip + options */}
      {editable && !isOut && !isAbsent && !isIn ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={confirmArrival}
            className={cn(
              "min-w-0 flex-1 rounded-md text-left transition-colors",
              "min-h-11 touch-manipulation active:scale-[0.99]",
              "hover:bg-black/5 disabled:opacity-60",
            )}
            aria-label={`Check in ${name} via ${arrivalSel.label}`}
          >
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium text-sm leading-tight">{name}</span>
              {isWalkOn && <WalkOnBadge />}
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Planned{" "}
                {plannedIsBus
                  ? eventBusRunShortLabel(
                      plannedOutbound?.busRunCode ?? null,
                      busRunOpts,
                    ) || "Bus"
                  : "Self"}
              </Badge>
              {absentDayLabel && (
                <Badge className="text-[10px] border-amber-500/50 bg-amber-500/10 text-amber-700 font-medium">
                  Absent {absentDayLabel}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Tap to check in via {arrivalSel.label}
            </p>
          </button>
          {clinicalChips.length > 0 && (
            <ClinicalFlagChips chips={clinicalChips} personName={name} />
          )}
          <EmbeddedMethodButton
            label={arrivalSel.label}
            disabled={busy}
            onClick={() => setMethodPickerOpen(true)}
          />
          <button
            type="button"
            onClick={() => setOptionsOpen(true)}
            className={cn(
              "inline-flex items-center justify-center rounded-md p-2 min-h-11 min-w-11 border shadow-sm",
              "border-slate-300 bg-white hover:bg-red-50 text-slate-500 hover:text-destructive",
            )}
            title="Mark absent / meeting at venue"
            aria-label="Options for this participant"
          >
            <UserX className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          {/* Checked-in / absent / read-only: one dense row — keep min-h-11 chips */}
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-medium text-sm leading-tight">{name}</span>
                {isWalkOn && <WalkOnBadge />}
                {absentDayLabel && (
                  <Badge className="text-[10px] border-amber-500/50 bg-amber-500/10 text-amber-700 font-medium">
                    Absent {absentDayLabel}
                  </Badge>
                )}
                {isAbsent && (
                  <Badge variant="destructive" className="text-[10px]">
                    Absent
                  </Badge>
                )}
                {methodMismatch && (
                  <Badge className="text-[10px] border-amber-500/50 bg-amber-500/10 text-amber-800 font-medium">
                    ≠ planned
                  </Badge>
                )}
                {isOut && row.returnTransport && (
                  <EventTransportBadge mode={row.returnTransport} prefix="Ret" />
                )}
              </div>
              {row.checkedInAt && (
                <p
                  className={cn(
                    "mt-0.5 text-[11px] leading-snug",
                    isIn
                      ? "text-success-foreground/90"
                      : "text-muted-foreground",
                  )}
                >
                  In <ClientTime iso={row.checkedInAt} />
                  {row.checkedOutAt && (
                    <>
                      {" · "}Out <ClientTime iso={row.checkedOutAt} />
                    </>
                  )}
                </p>
              )}
              {isAbsent && absentReason && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground italic line-clamp-2">
                  {absentReason}
                </p>
              )}
              {isOut && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] leading-snug text-emerald-700">
                  <LogOut className="h-3 w-3 shrink-0" />
                  Departure handover complete
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* Read-only method badge when chip is not shown (avoids R1 chip + R1 badge double) */}
              {!isAbsent && (isIn || isOut) && !(editable && isIn && !isOut) && (
                <MethodBadge
                  method={row.arrivalMethod}
                  busShortLabel={
                    row.arrivalMethod === "bus"
                      ? eventBusRunShortLabel(row.arrivalBusRunCode, busRunOpts)
                      : null
                  }
                />
              )}

              {editable && isIn && !isOut && (
                <EmbeddedMethodButton
                  label={
                    actualIsBus
                      ? eventBusRunShortLabel(row.arrivalBusRunCode, busRunOpts) ||
                        "Bus"
                      : "Self"
                  }
                  disabled={busy}
                  onClick={() => setMethodPickerOpen(true)}
                  aria-label="Change arrival method"
                />
              )}

              {editable && isIn && !isOut && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onUndoCheckIn()}
                  className={cn(
                    "inline-flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-md px-2",
                    "border border-slate-300 bg-white text-slate-900 shadow-sm",
                    "hover:bg-slate-100 active:scale-[0.98] touch-manipulation",
                    "disabled:opacity-50 disabled:pointer-events-none",
                  )}
                  title="Undo check-in"
                  aria-label={`Undo check-in for ${name}`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="text-[9px] font-medium uppercase leading-none text-slate-500">
                    Undo
                  </span>
                </button>
              )}

              {editable && isAbsent && (
                <button
                  type="button"
                  onClick={() => setOptionsOpen(true)}
                  className={cn(
                    "inline-flex items-center justify-center rounded-md p-2 min-h-11 min-w-11 border shadow-sm",
                    "border-destructive/40 bg-white hover:bg-destructive/5 text-destructive/70 hover:text-destructive",
                  )}
                  title="Reinstate / options"
                  aria-label="Options for this participant"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {editable && isIn && !isOut && !hideDeparture && (
            <Button
              variant="secondary"
              className="mt-1.5 h-11 min-h-11 w-full touch-manipulation gap-1.5"
              disabled={busy}
              onClick={() => setDepartOpen(true)}
            >
              <LogOut className="h-4 w-4" />
              Departure handover
            </Button>
          )}
        </>
      )}

      {/* ── Options bottom sheet (long-press) ── */}
      <BottomSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        title={name}
        description="Select an action for this person"
      >
        <div className="space-y-2 pb-2">
          {/* Reinstate — only when absent */}
          {isAbsent && (
            <MobileFieldButton
              title="Reinstate"
              subtitle="Mark as expected — participant may still attend"
              icon={<RotateCcw className="h-5 w-5 text-blue-500" />}
              tone="info"
              onClick={() => {
                setOptionsOpen(false);
                setTimeout(() => setReinstateOpen(true), 150);
              }}
            />
          )}

          {/* Change arrival method */}
          {!isOut && !isAbsent && (
            <MobileFieldButton
              title={isIn ? "Change arrival method" : "Arrival method"}
              subtitle="Bus vs self — then tap the wide row to check in"
              icon={<Check className="h-5 w-5 text-emerald-600" />}
              tone="success"
              onClick={() => {
                setOptionsOpen(false);
                setTimeout(() => setMethodPickerOpen(true), 150);
              }}
            />
          )}

          {/* Undo check-in — only when checked in */}
          {isIn && (
            <MobileFieldButton
              title="Undo Check-In"
              subtitle="Mark as not yet arrived"
              tone="neutral"
              onClick={() => {
                setOptionsOpen(false);
                onUndoCheckIn();
              }}
            />
          )}

          {/* Meeting at Venue — self inbound with optional note */}
          {!isOut && !isAbsent && (
            <MobileFieldButton
              title="Meeting at Venue"
              subtitle="Self-transport — optional note"
              icon={<MapPin className="h-5 w-5 text-blue-500" />}
              tone="info"
              active={actualIsSelf}
              onClick={openWalkInFlow}
            />
          )}

          {/* Not Attending Today */}
          {!isAbsent && (
            <MobileFieldButton
              title="Not Attending Today"
              subtitle="Confirmed no-show — leader PIN + reason required"
              icon={<UserX className="h-5 w-5" />}
              tone="danger"
              onClick={() => openAbsentFlow("absent")}
            />
          )}

          {/* Joining from Day 2 — multi-day non-final only */}
          {showJoiningDay2 && !isAbsent && (
            <MobileFieldButton
              title="Joining from Day 2"
              subtitle="Skipping today, joining the trip tomorrow"
              icon={<CalendarX2 className="h-5 w-5" />}
              tone="warning"
              onClick={() => openAbsentFlow("joining_day2")}
            />
          )}

          {/* Departure handover — checked-in, departure not hidden */}
          {isIn && !hideDeparture && (
            <MobileFieldButton
              title="Departure Handover"
              subtitle="Assign return transport"
              icon={<LogOut className="h-5 w-5" />}
              tone="neutral"
              onClick={() => { setOptionsOpen(false); setTimeout(() => setDepartOpen(true), 150); }}
            />
          )}
        </div>
      </BottomSheet>

      <TransportMethodPickerSheet
        open={methodPickerOpen}
        onOpenChange={setMethodPickerOpen}
        title={`Arrival method — ${name}`}
        description={
          isIn
            ? "Correct how they actually arrived."
            : "Tap to select. Then tap the wide row to check in."
        }
        options={arrivalPickerOptions}
        selected={
          isIn
            ? selectionFromEventMode(
                actualIsSelf ? "self" : "bus",
                row.arrivalBusRunCode,
                busRunOpts,
              )
            : arrivalSel
        }
        pending={busy}
        onSelect={applyArrivalSelection}
      />

      {/* ── Walk-in sheet (optional note) ── */}
      <BottomSheet
        open={walkInOpen}
        onOpenChange={setWalkInOpen}
        title="Meeting at Venue"
        description={`${name} arrived directly at the activity (self-transport).`}
      >
        <div className="space-y-4 pb-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Note (optional)
            </label>
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
              rows={2}
              placeholder="e.g. Family dropping off at venue gate…"
              value={walkInNote}
              onChange={(e) => setWalkInNote(e.target.value)}
              maxLength={200}
            />
          </div>
          <Button
            className="h-12 w-full touch-manipulation text-base"
            onClick={() => {
              setWalkInOpen(false);
              onRecordArrival("self", null, walkInNote, !isIn);
            }}
          >
            Confirm — Meeting at Venue
          </Button>
        </div>
      </BottomSheet>

      <TripAbsentDispositionDialog
        open={absentOpen}
        onOpenChange={setAbsentOpen}
        participantName={name}
        title={
          absentIntent === "joining_day2" ? "Joining from Day 2" : "Not Attending Today"
        }
        description={
          absentIntent === "joining_day2"
            ? `${name} will skip today and join from tomorrow.`
            : `Record a confirmed no-show for ${name}. They stay on the list as Absent until reinstated.`
        }
        pending={absentPending}
        onConfirm={async (result) => {
          await onAbsent(result, absentIntent === "joining_day2");
        }}
      />

      <TripReinstateDialog
        open={reinstateOpen}
        onOpenChange={setReinstateOpen}
        participantName={name}
        pending={reinstatePending}
        onConfirm={async (reason) => {
          await onReinstate(reason);
        }}
      />

      {/* ── Departure vector sheet ── */}
      <BottomSheet
        open={departOpen}
        onOpenChange={setDepartOpen}
        title={`Departure — ${name}`}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Assign how this person is getting home.
        </p>
        <div className="space-y-2">
          {busRunOpts.length === 0 ? (
            <MobileFieldButton
              title="Hand to bus"
              subtitle="Return bus transport"
              onClick={() => {
                setDepartOpen(false);
                onCheckout("bus", null);
              }}
            />
          ) : (
            busRunOpts.map((opt) => (
              <MobileFieldButton
                key={opt.code}
                title={`Hand to ${opt.shortLabel}`}
                subtitle={opt.displayName}
                onClick={() => {
                  setDepartOpen(false);
                  onCheckout("bus", opt.code);
                }}
              />
            ))
          )}
          <MobileFieldButton
            title="Self transport"
            subtitle="Family / independent"
            onClick={() => {
              setDepartOpen(false);
              onCheckout("self", null);
            }}
          />
        </div>
      </BottomSheet>

    </li>
  );
}

// ─── Method badge ─────────────────────────────────────────────────────────────

function MethodBadge({
  method,
  busShortLabel,
}: {
  method: string;
  busShortLabel?: string | null;
}) {
  if (method === "bus") {
    return (
      <EventTransportBadge
        mode="bus"
        prefix={
          busShortLabel && busShortLabel !== "Bus" ? busShortLabel : "In"
        }
        className="gap-0.5"
      />
    );
  }
  if (method === "private") {
    return <EventTransportBadge mode="self" prefix="In" className="gap-0.5" />;
  }
  if (method === "walk_in") {
    return (
      <Badge
        variant="outline"
        className="gap-0.5 text-[10px] border-blue-500/40 text-blue-600"
      >
        <MapPin className="h-2.5 w-2.5" />
        Walk-in
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-[10px]">{method}</Badge>;
}

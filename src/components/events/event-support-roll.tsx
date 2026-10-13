/**
 * Event Deliver support roll — staff / volunteer / carer.
 * Same floor row as participants: tap the line, Bus or Self chip, Undo, missing.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ClientTime } from "@/components/ui/client-time";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { FloorRollUndoButton } from "@/components/site-day/floor-roll-undo-button";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { TransportMethodPickerSheet } from "@/components/ui/transport-method-picker-sheet";
import { cn } from "@/lib/utils";
import {
  EVENT_SUPPORT_KEY,
  EVENT_SUPPORT_ROLL_KEY,
  checkOutEventSupport,
  listEventSupportAttendance,
  listEventSupportBookings,
  markEventSupportAbsent,
  recordEventSupportArrival,
  reinstateEventSupport,
  seedEventSupportRoll,
  undoEventSupportCheckIn,
  undoEventSupportCheckOut,
  updateEventSupportArrivalMethod,
  type EventSupportAttendanceRow,
} from "@/lib/api/event-support";
import { eventDeliverStatusKey } from "@/lib/api/event-deliver-status";
import { supportPersonKindLabel } from "@/lib/support-person";
import type { FloorMethodPickerOption, FloorTransportSelection } from "@/lib/ui/floor-transport-method";
import {
  DutyOnDutyConfirmSheet,
  type DutyOnDutyPending,
} from "@/components/duty/duty-on-duty-confirm-sheet";
import {
  TripAbsentDispositionDialog,
  TripReinstateDialog,
  type TripAbsentDispositionResult,
} from "@/components/events/trip-absent-disposition-dialog";

interface Props {
  sessionId: string;
  eventId: string;
  mode?: "check_in" | "check_out";
}

function isBusMethod(method: string | null | undefined): boolean {
  return method === "bus";
}

function methodLabel(method: string | null | undefined): "Bus" | "Self" {
  return isBusMethod(method) ? "Bus" : "Self";
}

const BUS_SELF_OPTIONS = (busCode: string | null, arriving: boolean): FloorMethodPickerOption[] => [
  {
    id: "bus",
    kind: "bus",
    busRunCode: busCode,
    title: arriving ? "Arrived on Bus" : "Leaving on Bus",
    subtitle: "On the trip bus",
    label: "Bus",
  },
  {
    id: "self",
    kind: "self",
    busRunCode: null,
    title: arriving ? "Self / Meeting at venue" : "Self transport",
    subtitle: arriving
      ? "Family or independent — not on the bus"
      : "Family / independent",
    label: "Self",
  },
];

export function EventSupportRoll({ sessionId, eventId, mode = "check_in" }: Props) {
  const qc = useQueryClient();
  const [dutyPending, setDutyPending] = useState<DutyOnDutyPending | null>(null);
  const rollQ = useQuery({
    queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId),
    queryFn: () => listEventSupportAttendance(sessionId),
    staleTime: 10_000,
  });
  const bookingsQ = useQuery({
    queryKey: EVENT_SUPPORT_KEY(eventId),
    queryFn: () => listEventSupportBookings(eventId),
    staleTime: 30_000,
  });

  useEffect(() => {
    void seedEventSupportRoll(sessionId, eventId)
      .then((n) => {
        if (n > 0) void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId) });
      })
      .catch(() => undefined);
  }, [sessionId, eventId, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: EVENT_SUPPORT_ROLL_KEY(sessionId) });
    void qc.invalidateQueries({ queryKey: eventDeliverStatusKey(sessionId) });
  };

  const arrive = useMutation({
    mutationFn: (row: {
      id: string;
      arrivalMethod: "bus" | "private";
      arrivalBusRunCode: string | null;
    }) =>
      recordEventSupportArrival({
        rowId: row.id,
        arrivalMethod: row.arrivalMethod,
        arrivalBusRunCode: row.arrivalMethod === "bus" ? row.arrivalBusRunCode : null,
      }),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const correctArrival = useMutation({
    mutationFn: updateEventSupportArrivalMethod,
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const leave = useMutation({
    mutationFn: (row: {
      id: string;
      returnTransport: "bus" | "self";
      returnBusRunCode: string | null;
    }) =>
      checkOutEventSupport({
        rowId: row.id,
        returnTransport: row.returnTransport,
        returnBusRunCode: row.returnTransport === "self" ? null : row.returnBusRunCode,
      }),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const absent = useMutation({
    mutationFn: ({ rowId, notes }: { rowId: string; notes: string }) =>
      markEventSupportAbsent(rowId, notes),
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const undoIn = useMutation({
    mutationFn: undoEventSupportCheckIn,
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const undoOut = useMutation({
    mutationFn: undoEventSupportCheckOut,
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const reinstate = useMutation({
    mutationFn: reinstateEventSupport,
    onSuccess: () => refresh(),
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = useMemo(() => {
    const order = new Map<string, number>();
    for (const booking of bookingsQ.data ?? []) {
      const key = booking.staffId ?? booking.carerId ?? "";
      if (!key) continue;
      order.set(key, booking.pickupOrder ?? 9999);
    }
    return (rollQ.data ?? [])
      .filter((r) => {
        if (mode === "check_in") return r.status !== "checked_out";
        return r.status === "checked_in" || r.status === "checked_out";
      })
      .slice()
      .sort((a, b) => {
        const ao = order.get(a.staffId ?? a.carerId ?? "") ?? 9999;
        const bo = order.get(b.staffId ?? b.carerId ?? "") ?? 9999;
        if (ao !== bo) return ao - bo;
        const byName = a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        });
        if (byName !== 0) return byName;
        return a.id.localeCompare(b.id);
      });
  }, [bookingsQ.data, mode, rollQ.data]);

  const busy =
    arrive.isPending ||
    correctArrival.isPending ||
    leave.isPending ||
    absent.isPending ||
    undoIn.isPending ||
    undoOut.isPending ||
    reinstate.isPending;

  if (rows.length === 0) return null;

  return (
    <section className="mt-6 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4" />
        Non-participants
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <SupportFloorRow
            key={row.id}
            row={row}
            mode={mode}
            busy={busy}
            onArrive={(method, busRunCode) =>
              setDutyPending({
                staffId: row.staffId,
                displayName: row.displayName,
                onProceed: () =>
                  arrive.mutate({
                    id: row.id,
                    arrivalMethod: method,
                    arrivalBusRunCode: busRunCode,
                  }),
              })
            }
            onCorrectArrival={(method, busRunCode) =>
              correctArrival.mutate({
                rowId: row.id,
                arrivalMethod: method,
                arrivalBusRunCode: busRunCode,
              })
            }
            onLeave={(transport, busRunCode) =>
              leave.mutate({
                id: row.id,
                returnTransport: transport,
                returnBusRunCode: busRunCode,
              })
            }
            onAbsent={(result) =>
              absent.mutateAsync({
                rowId: row.id,
                notes: `${result.disposition} — ${result.safetyPlan}`,
              })
            }
            onUndoIn={() => undoIn.mutate(row.id)}
            onUndoOut={() => undoOut.mutate(row.id)}
            onReinstate={() => reinstate.mutateAsync(row.id)}
          />
        ))}
      </ul>
      <DutyOnDutyConfirmSheet
        pending={dutyPending}
        onDismiss={() => setDutyPending(null)}
      />
    </section>
  );
}

function SupportFloorRow({
  row,
  mode,
  busy,
  onArrive,
  onCorrectArrival,
  onLeave,
  onAbsent,
  onUndoIn,
  onUndoOut,
  onReinstate,
}: {
  row: EventSupportAttendanceRow;
  mode: "check_in" | "check_out";
  busy: boolean;
  onArrive: (method: "bus" | "private", busRunCode: string | null) => void;
  onCorrectArrival: (method: "bus" | "private", busRunCode: string | null) => void;
  onLeave: (transport: "bus" | "self", busRunCode: string | null) => void;
  onAbsent: (result: TripAbsentDispositionResult) => void | Promise<unknown>;
  onUndoIn: () => void;
  onUndoOut: () => void;
  onReinstate: () => void | Promise<unknown>;
}) {
  const arriving = mode === "check_in";
  const isIn = row.status === "checked_in";
  const isOut = row.status === "checked_out";
  const isAbsent = row.status === "absent";
  const plannedBus = arriving
    ? isBusMethod(row.arrivalMethod)
    : row.returnTransport !== "self";
  const [override, setOverride] = useState<FloorTransportSelection | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [absentOpen, setAbsentOpen] = useState(false);
  const [reinstateOpen, setReinstateOpen] = useState(false);

  const storedCode = arriving ? row.arrivalBusRunCode : row.returnBusRunCode;
  const selection: FloorTransportSelection =
    override ??
    (plannedBus
      ? { kind: "bus", busRunCode: storedCode, label: "Bus" }
      : { kind: "self", busRunCode: null, label: "Self" });
  const label = selection.kind === "self" ? "Self" : "Bus";
  const pickerOptions = useMemo(
    () => BUS_SELF_OPTIONS(selection.kind === "bus" ? selection.busRunCode : storedCode, arriving),
    [arriving, selection.busRunCode, selection.kind, storedCode],
  );
  const kind = supportPersonKindLabel(row.personKind);

  function applyMethod(next: FloorTransportSelection) {
    setOverride(next);
    if (!arriving || !isIn) return;
    onCorrectArrival(
      next.kind === "self" ? "private" : "bus",
      next.kind === "bus" ? next.busRunCode : null,
    );
  }

  function confirm() {
    if (arriving) {
      onArrive(
        selection.kind === "self" ? "private" : "bus",
        selection.kind === "bus" ? selection.busRunCode : null,
      );
      return;
    }
    onLeave(
      selection.kind === "self" ? "self" : "bus",
      selection.kind === "bus" ? selection.busRunCode : null,
    );
  }

  const waiting = arriving ? !isIn && !isAbsent : !isOut;

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2",
        arriving && isIn &&
          "border-2 border-success bg-success text-success-foreground shadow-md ring-2 ring-success/40",
        isOut && "border-muted bg-muted/20 opacity-80",
        isAbsent && "border-destructive/60 bg-destructive/5",
      )}
    >
      {waiting ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={confirm}
            className={cn(
              "min-w-0 flex-1 rounded-md text-left transition-colors",
              "min-h-11 touch-manipulation active:scale-[0.99]",
              "hover:bg-black/5 disabled:opacity-60",
            )}
            aria-label={
              arriving
                ? `Check in ${row.displayName} via ${label}`
                : `Check out ${row.displayName} via ${label}`
            }
          >
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium text-sm leading-tight">{row.displayName}</span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {kind}
              </Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Planned {methodLabel(plannedBus ? "bus" : "self")}
              </Badge>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {arriving ? `Tap to check in via ${label}` : `Tap to check out via ${label}`}
            </p>
          </button>
          <EmbeddedMethodButton
            label={label}
            disabled={busy}
            onClick={() => setMethodOpen(true)}
          />
          {arriving && (
            <button
              type="button"
              onClick={() => setOptionsOpen(true)}
              className={cn(
                "inline-flex items-center justify-center rounded-md p-2 min-h-11 min-w-11 border shadow-sm",
                "border-slate-300 bg-white hover:bg-red-50 text-slate-500 hover:text-destructive",
              )}
              title="Mark absent"
              aria-label={`Options for ${row.displayName}`}
            >
              <UserX className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-medium text-sm leading-tight">{row.displayName}</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase",
                  arriving && isIn && "border-success-foreground/40 text-success-foreground",
                )}
              >
                {kind}
              </Badge>
              {isAbsent && (
                <Badge variant="destructive" className="text-[10px]">
                  Absent
                </Badge>
              )}
            </div>
            {row.checkedInAt && (
              <p
                className={cn(
                  "mt-0.5 text-[11px] leading-snug",
                  arriving && isIn ? "text-success-foreground/90" : "text-muted-foreground",
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
          </div>
          {arriving && isIn && (
            <EmbeddedMethodButton
              label={label}
              disabled={busy}
              onClick={() => setMethodOpen(true)}
              aria-label="Change arrival method"
            />
          )}
          {arriving && isIn && (
            <FloorRollUndoButton
              kind="check_in"
              personName={row.displayName}
              disabled={busy}
              onClick={onUndoIn}
            />
          )}
          {!arriving && isOut && (
            <FloorRollUndoButton
              kind="check_out"
              personName={row.displayName}
              disabled={busy}
              onClick={onUndoOut}
            />
          )}
          {isAbsent && (
            <button
              type="button"
              onClick={() => setReinstateOpen(true)}
              className={cn(
                "inline-flex items-center justify-center rounded-md p-2 min-h-11 min-w-11 border shadow-sm",
                "border-destructive/40 bg-white hover:bg-destructive/5 text-destructive/70 hover:text-destructive",
              )}
              title="Reinstate"
              aria-label={`Reinstate ${row.displayName}`}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <TransportMethodPickerSheet
        open={methodOpen}
        onOpenChange={setMethodOpen}
        title={`${arriving ? "Arrival" : "Departure"} method — ${row.displayName}`}
        description={
          isIn && arriving
            ? "Correct how they actually arrived."
            : "Tap to select. Then tap the wide row."
        }
        options={pickerOptions}
        selected={
          label === "Self"
            ? { kind: "self", busRunCode: null, label: "Self" }
            : {
                kind: "bus",
                busRunCode: selection.kind === "bus" ? selection.busRunCode : storedCode,
                label: "Bus",
              }
        }
        pending={busy}
        onSelect={applyMethod}
      />

      <BottomSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        title={row.displayName}
        description="Select an action for this person"
      >
        <div className="space-y-2 pb-2">
          <MobileFieldButton
            title="Not Attending Today"
            subtitle="Confirmed no-show — leader PIN + reason required"
            icon={<UserX className="h-5 w-5" />}
            tone="danger"
            onClick={() => {
              setOptionsOpen(false);
              setTimeout(() => setAbsentOpen(true), 150);
            }}
          />
        </div>
      </BottomSheet>

      <TripAbsentDispositionDialog
        open={absentOpen}
        onOpenChange={setAbsentOpen}
        participantName={row.displayName}
        title="Not Attending Today"
        description={`Record a confirmed no-show for ${row.displayName}. They stay on the list as Absent until reinstated.`}
        pending={busy}
        onConfirm={onAbsent}
      />

      <TripReinstateDialog
        open={reinstateOpen}
        onOpenChange={setReinstateOpen}
        participantName={row.displayName}
        pending={busy}
        onConfirm={async () => {
          onReinstate();
        }}
      />
    </li>
  );
}

/**
 * EventCheckOutPanel — departure roll for Event Deliver Check-Out tab.
 *
 * Shows checked-in people awaiting return transport, handed-to-transport rows,
 * and Left trip Absent placeholders (BL-090 — read-only reason, no assign).
 * When nobody remains checked_in, surfaces Close Trip via EventCloseDayPanel.
 *
 * Fat-finger: tap an assigned row again to undo → back to awaiting assignment.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LogOut, RotateCcw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientTime } from "@/components/ui/client-time";
import { EmbeddedMethodButton } from "@/components/ui/embedded-method-button";
import { TransportMethodPickerSheet } from "@/components/ui/transport-method-picker-sheet";
import { cn } from "@/lib/utils";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { TripReinstateDialog } from "@/components/events/trip-absent-disposition-dialog";
import {
  checkoutEventParticipant,
  listEventAttendanceRoll,
  reinstateLeftTripEverywhere,
  undoCheckoutEventParticipant,
  type EventAttendanceRow,
  type ReturnTransport,
} from "@/lib/api/event-attendance";
import { busHomeHandoverGapsKey } from "@/lib/api/event-transport";
import { type EventDaySession } from "@/lib/api/event-outing";
import { EventTransportBadge } from "@/components/events/event-transport-badge";
import { EventCloseDayPanel } from "@/components/events/event-close-day-panel";
import { EventSupportRoll } from "@/components/events/event-support-roll";
import { listParticipants, LOOKUP_CATEGORIES } from "@/lib/data-store";
import { formatLeftTripDisplay } from "@/lib/trip-absent";
import { eventDeliverStatusKey } from "@/lib/api/event-deliver-status";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { eventBusRunOptions, eventBusRunShortLabel } from "@/lib/event-bus-runs";
import {
  buildBusSelfPickerOptions,
  selectionFromEventMode,
  type FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";
import {
  sortByParticipantSurname,
  surnameMapFromParticipants,
} from "@/lib/ui/sort-participants";

const rollKey = (sessionId: string) => ["event-attendance-log", sessionId] as const;

interface Props {
  session: EventDaySession;
  onTripClosed: () => void;
}

export function EventCheckOutPanel({ session, onTripClosed }: Props) {
  const qc = useQueryClient();

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: rollKey(session.id),
    queryFn: () => listEventAttendanceRoll(session.id),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const { data: participants = [] } = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 60_000,
  });

  const nameMap = useMemo(
    () =>
      Object.fromEntries(
        participants.map((p) => [
          p.id,
          `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Participant",
        ]),
      ),
    [participants],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: rollKey(session.id) });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-actual-transport" });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "trip-report" });
    qc.invalidateQueries({ queryKey: eventDeliverStatusKey(session.id) });
    qc.invalidateQueries({ queryKey: busHomeHandoverGapsKey(session.id) });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-accountability-roll" });
    qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "event-issues" });
  };

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
      toast.success("Departure recorded.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undoMut = useMutation({
    mutationFn: (row: EventAttendanceRow) => undoCheckoutEventParticipant(row),
    onSuccess: () => {
      toast.success("Assignment cleared — pick return transport again.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
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
      reinstateLeftTripEverywhere({
        eventDaySessionId: row.eventDaySessionId,
        participantId: row.participantId,
        participantName,
        reason,
      }),
    onSuccess: () => {
      toast.success("Reinstated — assign return transport when ready.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const busRunOpts = useMemo(() => eventBusRunOptions(busRunLookups), [busRunLookups]);

  const surnameById = useMemo(
    () => surnameMapFromParticipants(participants),
    [participants],
  );
  // One surname A–Z list for assignable + handed-over — status styles the row
  // only (no jump into a separate “Handed to transport” block).
  const activeRoll = useMemo(
    () =>
      sortByParticipantSurname(
        rows.filter(
          (r) => r.status === "checked_in" || r.status === "checked_out",
        ),
        (r) => r.participantId,
        surnameById,
      ),
    [rows, surnameById],
  );
  const leftTrip = useMemo(
    () =>
      sortByParticipantSurname(
        rows.filter((r) => r.status === "absent"),
        (r) => r.participantId,
        surnameById,
      ),
    [rows, surnameById],
  );
  const pending = rows.filter((r) => r.status === "checked_in");
  const done = rows.filter((r) => r.status === "checked_out");
  /** Still with the group — gates Close trip (Absent placeholders do not block). */
  const stillWithGroup = pending.length;
  const assignedCount = done.length;
  const tracked = pending.length + done.length + leftTrip.length;
  const allDone = tracked > 0 && stillWithGroup === 0;
  const isClosed = session.phase === "closed_orderly" || session.phase === "closed_incident";
  const busy = checkoutMut.isPending || undoMut.isPending || reinstateMut.isPending;

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Assign each person still with the group to their return transport. People who left the
          trip stay listed under Left trip (no transport assign) until reinstated.
          {!isClosed && done.length > 0
            ? " Tap an assigned person to undo if you mistapped."
            : ""}
        </p>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
      </div>

      <div className="flex flex-wrap gap-3 text-xs font-medium">
        <span>
          {assignedCount} assigned
          {stillWithGroup > 0 ? ` · ${stillWithGroup} still with group` : ""}
        </span>
        {leftTrip.length > 0 && (
          <span className="text-muted-foreground">{leftTrip.length} left trip</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-5 w-5" />
          No checked-in participants — complete arrivals on the Check-In tab first.
        </div>
      ) : (
        <ul className="space-y-2">
          {activeRoll.map((row) => (
            <CheckOutCard
              key={row.id}
              row={row}
              name={nameMap[row.participantId] ?? "Loading…"}
              busy={busy}
              editable={!isClosed}
              onCheckout={(transport, busRunCode) =>
                checkoutMut.mutate({ row, transport, busRunCode })
              }
              busRunOpts={busRunOpts}
              onUndo={() => undoMut.mutate(row)}
            />
          ))}

          {leftTrip.length > 0 && (
            <li className="pt-1">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Left trip
              </p>
              <ul className="space-y-2">
                {leftTrip.map((row) => (
                  <LeftTripCard
                    key={row.id}
                    row={row}
                    name={nameMap[row.participantId] ?? "Loading…"}
                    editable={!isClosed}
                    pending={reinstateMut.isPending}
                    onReinstate={(reason) =>
                      reinstateMut.mutateAsync({
                        row,
                        reason,
                        participantName: nameMap[row.participantId] ?? "Participant",
                      })
                    }
                  />
                ))}
              </ul>
            </li>
          )}
        </ul>
      )}

      <EventSupportRoll sessionId={session.id} eventId={session.event_id} mode="check_out" />

      {allDone && (
        <div className="space-y-2">
          {!isClosed && (
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
              {stillWithGroup === 0 && assignedCount > 0
                ? "Everyone still with the group has return transport"
                : "No one left with the group"}
            </p>
          )}
          <EventCloseDayPanel
            session={session}
            requireEveningRoll={false}
            closeLabel="Close trip"
            onClosed={onTripClosed}
          />
        </div>
      )}
    </div>
  );
}

function LeftTripCard({
  row,
  name,
  editable,
  pending,
  onReinstate,
}: {
  row: EventAttendanceRow;
  name: string;
  editable: boolean;
  pending: boolean;
  onReinstate: (reason: string) => Promise<unknown>;
}) {
  const [reinstateOpen, setReinstateOpen] = useState(false);
  const reason = formatLeftTripDisplay(row.notes);

  return (
    <li className="rounded-lg border border-muted bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-medium text-sm">{name}</span>
        <Badge variant="secondary" className="text-[10px]">
          Absent
        </Badge>
        {editable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 gap-1.5 touch-manipulation"
            disabled={pending}
            onClick={() => setReinstateOpen(true)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reinstate
          </Button>
        )}
      </div>
      {reason && (
        <p className="mt-1.5 whitespace-pre-wrap text-[11px] italic text-muted-foreground">
          {reason}
        </p>
      )}
      <TripReinstateDialog
        open={reinstateOpen}
        onOpenChange={setReinstateOpen}
        participantName={name}
        pending={pending}
        onConfirm={onReinstate}
      />
    </li>
  );
}

function CheckOutCard({
  row,
  name,
  busy,
  editable,
  onCheckout,
  onUndo,
  busRunOpts,
}: {
  row: EventAttendanceRow;
  name: string;
  busy: boolean;
  editable: boolean;
  onCheckout: (t: ReturnTransport, busRunCode?: string | null) => void;
  onUndo: () => void;
  busRunOpts: ReturnType<typeof eventBusRunOptions>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const plannedSel = selectionFromEventMode(
    row.returnTransport ?? "bus",
    row.returnBusRunCode,
    busRunOpts,
  );
  const [override, setOverride] = useState<FloorTransportSelection | null>(null);
  const selection = override ?? plannedSel;
  const pickerOptions = useMemo(
    () =>
      buildBusSelfPickerOptions(busRunOpts, "event", {
        busTitlePrefix: "Hand to",
        selfTitle: "Self transport",
        selfSubtitle: "Family / independent",
      }),
    [busRunOpts],
  );

  const isOut = row.status === "checked_out";
  const needsRunChoice =
    selection.kind === "bus" &&
    !selection.busRunCode &&
    busRunOpts.length > 1;
  const assignedLabel =
    row.returnTransport === "self"
      ? "Self"
      : row.returnTransport === "bus"
        ? eventBusRunShortLabel(row.returnBusRunCode, busRunOpts)
        : null;

  if (isOut) {
    if (editable) {
      return (
        <li>
          <MobileFieldButton
            title={name}
            subtitle={
              row.checkedOutAt
                ? "Departure recorded — tap to undo"
                : "Assigned — tap to undo"
            }
            tone="success"
            active
            disabled={busy}
            onClick={onUndo}
            icon={<LogOut className="h-5 w-5" />}
            trailing={
              row.returnTransport ? (
                <EventTransportBadge
                  mode={row.returnTransport}
                  prefix={assignedLabel && assignedLabel !== "Bus" ? assignedLabel : "Ret"}
                />
              ) : undefined
            }
          />
          {row.checkedOutAt && (
            <p className="mt-1 px-1 text-[11px] text-muted-foreground">
              Out <ClientTime iso={row.checkedOutAt} />
            </p>
          )}
        </li>
      );
    }

    return (
      <li
        className={cn(
          "rounded-lg border p-3 border-muted bg-muted/20 opacity-75",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 font-medium text-sm">{name}</span>
          {row.returnTransport && (
            <EventTransportBadge
              mode={row.returnTransport}
              prefix={assignedLabel && assignedLabel !== "Bus" ? assignedLabel : "Ret"}
            />
          )}
        </div>
        {row.checkedOutAt && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Out <ClientTime iso={row.checkedOutAt} />
          </p>
        )}
        <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700">
          <LogOut className="h-3 w-3" />
          Departure recorded
        </p>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        "border-amber-500/40 bg-amber-500/5",
      )}
    >
      {editable ? (
        <div className="flex items-start gap-2">
          <button
            type="button"
            disabled={busy || needsRunChoice}
            onClick={() =>
              onCheckout(
                selection.kind === "self" ? "self" : "bus",
                selection.kind === "bus" ? selection.busRunCode : null,
              )
            }
            className={cn(
              "min-w-0 flex-1 rounded-md text-left transition-colors",
              "min-h-12 touch-manipulation active:scale-[0.99]",
              "hover:bg-black/5 disabled:opacity-60",
            )}
            aria-label={`Assign return transport ${selection.label} for ${name}`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-sm">{name}</span>
              <Badge
                variant="outline"
                className="text-[10px] text-amber-700 border-amber-500/40"
              >
                Awaiting assignment
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {needsRunChoice
                ? "Choose R1 or R2 first"
                : `Tap to hand to ${selection.label}`}
            </p>
          </button>
          <EmbeddedMethodButton
            label={selection.label}
            disabled={busy}
            onClick={() => setPickerOpen(true)}
            aria-label={`Change return method, currently ${selection.label}`}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 font-medium text-sm">{name}</span>
          <Badge
            variant="outline"
            className="text-[10px] text-amber-700 border-amber-500/40"
          >
            Awaiting assignment
          </Badge>
        </div>
      )}

      <TransportMethodPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={`Return transport — ${name}`}
        description="Tap to select. Then tap the wide row to assign."
        options={pickerOptions}
        selected={selection}
        pending={busy}
        onSelect={setOverride}
      />
    </li>
  );
}

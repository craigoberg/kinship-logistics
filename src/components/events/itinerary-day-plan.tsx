/**
 * Leader and roll times for one itinerary date.
 * A saved leader collapses onto the date line. Tap that name to edit.
 * Floor open/close stays in Event Deliver.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { HalfHourTimeField } from "@/components/ui/half-hour-time-field";
import { isValidClockTime } from "@/lib/tour-roll-call";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn, formatDate } from "@/lib/utils";
import {
  propagateTripLeaderToUnassignedDays,
  propagateTripRollTimesToUnsetDays,
  updateEventDaySession,
  type EventDaySession,
} from "@/lib/api/event-outing";
import { isEventLocationClosed, isEventLocationOpen } from "@/lib/api/event-location";
import { EventIssuesCard } from "./event-issues-card";
import { EventDayVerbalAnomalyFlow } from "./event-day-verbal-anomaly-flow";
import type { EventManifest } from "@/lib/data-store";

function normalizeRollTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isValidClockTime(trimmed) ? trimmed : null;
}

function clockSlice(value: string | null | undefined): string {
  return (value ?? "").slice(0, 5);
}

interface SaveInput {
  leaderId: string;
  evening: string;
  morning: string;
}

interface Props {
  event: EventManifest;
  session: EventDaySession | null;
  managers: Array<{ id: string; fullName: string }>;
  multiDay: boolean;
  /** First calendar day — its leader fills later days that still have none. */
  isFirstDay: boolean;
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  /** Stops and issue tools. Leader edit stays mounted either way. */
  showDetails: boolean;
  /** Leader just chosen, before the day list refreshes. */
  onLeaderPicked: (staffId: string) => void;
  onSaved: () => void;
}

export function ItineraryDayPlan({
  event,
  session,
  managers,
  multiDay,
  isFirstDay,
  editOpen,
  onEditOpenChange,
  showDetails,
  onLeaderPicked,
  onSaved,
}: Props) {
  const [curfewTime, setCurfewTime] = useState("");
  const [morningTime, setMorningTime] = useState("");
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [collapsedLeaderId, setCollapsedLeaderId] = useState<string | null>(null);

  useEffect(() => {
    if (session?.manager_staff_id) setCollapsedLeaderId(null);
  }, [session?.manager_staff_id]);

  useEffect(() => {
    if (!session) return;
    setCurfewTime(clockSlice(session.curfew_time));
    setMorningTime(clockSlice(session.morning_roll_time));
  }, [session?.id, session?.curfew_time, session?.morning_roll_time]);

  const saveMut = useMutation({
    mutationFn: async (input: SaveInput) => {
      if (!session) throw new Error("This day is not ready yet.");
      const eveningRoll = multiDay ? normalizeRollTime(input.evening) : null;
      const morningRoll = multiDay ? normalizeRollTime(input.morning) : null;
      if (multiDay && input.evening.trim() && !eveningRoll) {
        throw new Error("Evening roll call must be a valid 24-hour time (HH:mm).");
      }
      if (multiDay && input.morning.trim() && !morningRoll) {
        throw new Error("Morning roll call must be a valid 24-hour time (HH:mm).");
      }
      await updateEventDaySession({
        id: session.id,
        manager_staff_id: input.leaderId,
        curfew_time: eveningRoll,
        morning_roll_time: morningRoll,
      });
      const propagated =
        multiDay && isFirstDay
          ? await propagateTripLeaderToUnassignedDays(event.id, input.leaderId, session.id)
          : 0;
      const rollPropagated =
        multiDay && isFirstDay
          ? await propagateTripRollTimesToUnsetDays(event.id, session.id, {
              curfew_time: eveningRoll,
              morning_roll_time: morningRoll,
            })
          : { evening: 0, morning: 0 };
      return { propagated, rollPropagated, leaderId: input.leaderId };
    },
    onSuccess: ({ propagated, rollPropagated, leaderId }) => {
      const parts = ["Trip leader saved."];
      if (propagated > 0) {
        parts.push(
          `Leader applied to ${propagated} other day${propagated === 1 ? "" : "s"} with no leader.`,
        );
      }
      const rollParts: string[] = [];
      if (rollPropagated.evening > 0) {
        rollParts.push(
          `evening roll to ${rollPropagated.evening} day${rollPropagated.evening === 1 ? "" : "s"}`,
        );
      }
      if (rollPropagated.morning > 0) {
        rollParts.push(
          `morning roll to ${rollPropagated.morning} day${rollPropagated.morning === 1 ? "" : "s"}`,
        );
      }
      if (rollParts.length > 0) parts.push(`Copied ${rollParts.join(" and ")}.`);
      toast.success(parts.join(" "));
      setCollapsedLeaderId(leaderId);
      onLeaderPicked(leaderId);
      onEditOpenChange(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setPickingId(null),
  });

  if (!session) {
    if (!showDetails) return null;
    return (
      <p className="border-b px-4 py-3 text-xs text-muted-foreground">
        Preparing this day so a trip leader can be assigned.
      </p>
    );
  }

  const savedLeaderId = session.manager_staff_id ?? collapsedLeaderId;
  const floorLive = isEventLocationOpen(session.phase);
  const floorClosed = isEventLocationClosed(session.phase);
  const showPicker = !savedLeaderId;

  return (
    <div className={showDetails ? "border-b bg-muted/10" : undefined}>
      {showDetails && (floorLive || floorClosed || showPicker) && (
        <div className="space-y-3 px-4 py-3">
          {(floorLive || floorClosed) && (
            <p className="text-xs text-muted-foreground">
              {floorClosed
                ? "This day is closed. Open, rolls, and close run in Event Deliver."
                : "This day is open. Watch it on Live. The floor runs in Event Deliver."}
            </p>
          )}

          {showPicker && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Trip leader <span className="text-destructive">*</span>
                </Label>
                <div className={cn("space-y-1.5 rounded-md p-1", requiredFieldOutline(true))}>
                  {managers.map((m) => (
                    <MobileFieldButton
                      key={m.id}
                      title={m.fullName}
                      active={pickingId === m.id}
                      disabled={saveMut.isPending}
                      onClick={() => {
                        setPickingId(m.id);
                        saveMut.mutate({
                          leaderId: m.id,
                          evening: curfewTime,
                          morning: morningTime,
                        });
                      }}
                    />
                  ))}
                  {managers.length === 0 && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">No managers on file.</p>
                  )}
                </div>
                <p className="text-sm text-destructive">Need: Trip leader</p>
                <p className="text-[10px] text-muted-foreground">
                  Required before Confirm. The trip leader opens the day in Event Deliver with their PIN.
                  {multiDay &&
                    isFirstDay &&
                    " Choosing the Day 1 leader also fills later days that still have none."}
                </p>
              </div>

              {multiDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Evening roll call</Label>
                    <HalfHourTimeField
                      id={`evening-roll-${session.id}`}
                      value={curfewTime}
                      onChange={setCurfewTime}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Morning roll call</Label>
                    <HalfHourTimeField
                      id={`morning-roll-${session.id}`}
                      value={morningTime}
                      onChange={setMorningTime}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showDetails && (
      <div className={cn("space-y-3 px-4", showPicker || floorLive || floorClosed ? "pb-3" : "py-3")}>
        <Button
          size="sm"
          variant="outline"
          className="border-yellow-500/40 text-yellow-700 hover:bg-yellow-500/10 dark:text-yellow-300"
          onClick={() => setAnomalyOpen(true)}
        >
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
          Log venue issue
        </Button>
        <EventIssuesCard eventId={event.id} eventDaySessionId={session.id} />
      </div>
      )}

      <LeaderEditDialog
        open={editOpen}
        onOpenChange={onEditOpenChange}
        dateLabel={formatDate(session.session_date)}
        session={session}
        managers={managers}
        multiDay={multiDay}
        isFirstDay={isFirstDay}
        pending={saveMut.isPending}
        onSave={(input) => saveMut.mutate(input)}
      />

      <EventDayVerbalAnomalyFlow
        eventId={event.id}
        eventTitle={event.title}
        eventDaySessionId={session.id}
        sessionDate={session.session_date}
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
      />
    </div>
  );
}

function LeaderEditDialog({
  open,
  onOpenChange,
  dateLabel,
  session,
  managers,
  multiDay,
  isFirstDay,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateLabel: string;
  session: EventDaySession;
  managers: Array<{ id: string; fullName: string }>;
  multiDay: boolean;
  isFirstDay: boolean;
  pending: boolean;
  onSave: (input: SaveInput) => void;
}) {
  const [managerId, setManagerId] = useState(session.manager_staff_id ?? "");
  const [curfewTime, setCurfewTime] = useState(clockSlice(session.curfew_time));
  const [morningTime, setMorningTime] = useState(clockSlice(session.morning_roll_time));

  useEffect(() => {
    if (!open) return;
    setManagerId(session.manager_staff_id ?? "");
    setCurfewTime(clockSlice(session.curfew_time));
    setMorningTime(clockSlice(session.morning_roll_time));
  }, [open, session.id, session.manager_staff_id, session.curfew_time, session.morning_roll_time]);

  const leaderMissing = !managerId;
  const rollTimesValid =
    !multiDay ||
    ((!curfewTime.trim() || isValidClockTime(curfewTime)) &&
      (!morningTime.trim() || isValidClockTime(morningTime)));
  const dirty =
    managerId !== (session.manager_staff_id ?? "") ||
    curfewTime !== clockSlice(session.curfew_time) ||
    morningTime !== clockSlice(session.morning_roll_time);
  const missing: string[] = [];
  if (leaderMissing) missing.push("Trip leader");
  if (!rollTimesValid) missing.push("Roll times");
  const canSave = dirty && missing.length === 0 && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-1.5rem)] w-full max-w-md flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Trip leader · {dateLabel}</DialogTitle>
          <DialogDescription>
            {multiDay && isFirstDay
              ? "Saving the Day 1 leader also fills later days that still have none."
              : "The trip leader opens this day in Event Deliver with their PIN."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">
              Trip leader <span className="text-destructive">*</span>
            </Label>
            <div className={cn("space-y-1.5 rounded-md p-1", requiredFieldOutline(leaderMissing))}>
              {managers.map((m) => (
                <MobileFieldButton
                  key={m.id}
                  title={m.fullName}
                  active={managerId === m.id}
                  onClick={() => setManagerId(m.id)}
                />
              ))}
            </div>
          </div>
          {multiDay && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Evening roll call</Label>
                <HalfHourTimeField
                  id={`edit-evening-roll-${session.id}`}
                  value={curfewTime}
                  onChange={setCurfewTime}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Morning roll call</Label>
                <HalfHourTimeField
                  id={`edit-morning-roll-${session.id}`}
                  value={morningTime}
                  onChange={setMorningTime}
                />
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <p className="text-sm text-destructive">Need: {missing.join(", ")}</p>
          )}
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => onSave({ leaderId: managerId, evening: curfewTime, morning: morningTime })}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

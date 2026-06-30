import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupSelect } from "@/components/lookups/lookup-select";
import {
  LOOKUP_CATEGORIES,
  type AttendanceSchedule,
  type WeekDay,
} from "@/lib/data-store";
import {
  useInsertAttendanceSchedule,
  useUpdateAttendanceSchedule,
  useRemoveAttendanceSchedule,
  useLookupParameters,
  useBusRunMap,
} from "@/hooks/use-supabase-data";
import { listCentreHours } from "@/lib/api/centre-hours";
import { useQuery } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
  /** When present, the modal switches to edit mode. */
  editing?: AttendanceSchedule | null;
}

/** True when the inbound transport code is a Day Centre bus run. */
function isBusRunCode(code: string): boolean {
  return code.toUpperCase().startsWith("BUSRUN-");
}

export function AddAttendanceScheduleModal({
  open,
  onOpenChange,
  participantId,
  participantName,
  editing,
}: Props) {
  const isEdit = !!editing;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [dayLabel, setDayLabel] = useState<string>("");
  const [serviceType, setServiceType] = useState("");
  const [inboundTransport, setInboundTransport] = useState("");
  const [outboundTransport, setOutboundTransport] = useState("");
  const [arrivalTime, setArrivalTime] = useState("09:00");
  const [departureTime, setDepartureTime] = useState("15:00");
  const [dirty, setDirty] = useState(false);
  const insert = useInsertAttendanceSchedule();
  const update = useUpdateAttendanceSchedule();
  const remove = useRemoveAttendanceSchedule();
  const mutation = isEdit ? update : insert;

  // Bus run lookup — used in the inbound/outbound transport sections.
  const { data: busRuns = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  // Stable badge color map — same palette as the Participants Directory.
  const busRunMap = useBusRunMap();

  // Centre operating hours — used for the stretch-goal day validation.
  const { data: centreHours = [] } = useQuery({
    queryKey: ["centre-operating-hours"],
    queryFn: listCentreHours,
    staleTime: 5 * 60_000,
    enabled: open,
  });

  // Whether the selected day has a configured centre hours row.
  const centreClosedWarning =
    dayOfWeek.length > 0 &&
    centreHours.length > 0 &&
    !centreHours.some((h) => h.dayOfWeek === dayOfWeek);

  useEffect(() => {
    if (open && editing) {
      setDayOfWeek(editing.dayOfWeek);
      setDayLabel(editing.dayOfWeek);
      setServiceType(editing.serviceType);
      setInboundTransport(editing.inboundTransport || editing.transportRule);
      setOutboundTransport(editing.outboundTransport || editing.transportRule);
      setArrivalTime(editing.expectedArrivalTime || "09:00");
      setDepartureTime(editing.expectedDepartureTime || "15:00");
      setDirty(false);
    } else if (!open) {
      setDayOfWeek("");
      setDayLabel("");
      setServiceType("");
      setInboundTransport("");
      setOutboundTransport("");
      setArrivalTime("09:00");
      setDepartureTime("15:00");
      setDirty(false);
      setConfirmingRemove(false);
      setRemoveReason("");
    }
  }, [open, editing]);

  const valid =
    dayOfWeek.length > 0 &&
    serviceType.trim().length > 0 &&
    inboundTransport.trim().length > 0 &&
    outboundTransport.trim().length > 0 &&
    /^\d{2}:\d{2}$/.test(arrivalTime) &&
    /^\d{2}:\d{2}$/.test(departureTime);
  const canSubmit = dirty && valid && !mutation.isPending;
  const dayDisplay = dayLabel || dayOfWeek;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            dayOfWeek: dayOfWeek as WeekDay,
            serviceType: serviceType.trim(),
            inboundTransport: inboundTransport.trim(),
            outboundTransport: outboundTransport.trim(),
            expectedArrivalTime: arrivalTime,
            expectedDepartureTime: departureTime,
          },
        });
        toast.success("Operational schedule updated", {
          description: `${dayDisplay} · ${serviceType.trim()} for ${participantName}.`,
        });
      } else {
        await insert.mutateAsync({
          participantId,
          dayOfWeek: dayOfWeek as WeekDay,
          serviceType: serviceType.trim(),
          inboundTransport: inboundTransport.trim(),
          outboundTransport: outboundTransport.trim(),
          expectedArrivalTime: arrivalTime,
          expectedDepartureTime: departureTime,
        });
        toast.success("Operational schedule added", {
          description: `${dayDisplay} · ${serviceType.trim()} for ${participantName}.`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save schedule", {
        description: (err as Error).message,
      });
    }
  };

  // Derive the run label for the selected inbound transport (if it's a run).
  const selectedRunLabel = isBusRunCode(inboundTransport)
    ? (busRuns.find((r) => r.code === inboundTransport)?.displayName ?? inboundTransport)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>
            {confirmingRemove
              ? "Remove operational schedule"
              : isEdit
                ? "Edit operational schedule"
                : "Add operational schedule"}
          </DialogTitle>
          <DialogDescription>
            {confirmingRemove
              ? `Permanently remove this attendance rule for ${participantName}. The change will be audit-logged.`
              : isEdit
                ? `Update this recurring attendance rule for ${participantName}.`
                : `Define one recurring attendance rule for ${participantName}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Day of week
            </Label>
            <LookupSelect
              category={LOOKUP_CATEGORIES.operatingDay}
              value={dayOfWeek}
              onChange={(code, displayName) => {
                setDayOfWeek(code);
                setDayLabel(displayName);
                setDirty(true);
              }}
              placeholder="Select day"
            />
            {/* Stretch goal: warn if the centre isn't scheduled to operate */}
            {centreClosedWarning && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The centre is not scheduled to operate on this day. Confirm this is intentional
                  (e.g. an exceptional opening).
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Service type
            </Label>
            <LookupSelect
              category={LOOKUP_CATEGORIES.serviceType}
              value={serviceType}
              onChange={(code) => {
                setServiceType(code);
                setDirty(true);
              }}
              placeholder="Select service type"
            />
          </div>

          {/* ── Transport IN ──────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transport IN (morning)
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Choose a <span className="font-medium text-foreground">Day Centre Bus Run</span> to
              assign this client to a recurring bus manifest, or pick a general transport type.
            </p>

            {/* Day Centre Bus Run picker */}
            {busRuns.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-400">
                  Day Centre Bus Run
                </p>
                <div className="flex flex-wrap gap-2">
                  {busRuns.map((run) => {
                    const selected = inboundTransport === run.code;
                    const badge = busRunMap.get(run.code);
                    const color = badge?.color ?? "#7c3aed";
                    return (
                      <button
                        key={run.code}
                        type="button"
                        onClick={() => {
                          setInboundTransport(run.code);
                          if (!outboundTransport) setOutboundTransport("self");
                          setDirty(true);
                        }}
                        style={selected ? { backgroundColor: color, borderColor: color } : { borderColor: color, color }}
                        className={`rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
                          selected ? "text-white" : "bg-card hover:opacity-80"
                        }`}
                      >
                        {run.displayName}
                      </button>
                    );
                  })}
                  {/* Clear back to general transport */}
                  {isBusRunCode(inboundTransport) && (
                    <button
                      type="button"
                      onClick={() => {
                        setInboundTransport("");
                        setDirty(true);
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Use general transport instead
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* General transport fallback (hidden when a run is selected) */}
            {!isBusRunCode(inboundTransport) && (
              <div className="space-y-1.5">
                {busRuns.length > 0 && (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Or general transport type
                  </p>
                )}
                <LookupSelect
                  category={LOOKUP_CATEGORIES.transportRule}
                  value={inboundTransport}
                  onChange={(code) => {
                    setInboundTransport(code);
                    if (!outboundTransport) setOutboundTransport(code);
                    setDirty(true);
                  }}
                  placeholder="Morning trip"
                />
              </div>
            )}

            {/* Confirmation badge when a run is selected */}
            {selectedRunLabel && (
              <div className="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                {participantName} will be included in the <span className="font-bold">{selectedRunLabel}</span>{" "}
                manifest whenever the centre is open on this day.
              </div>
            )}
          </div>

          {/* ── Transport OUT ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transport OUT (afternoon)
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Assign to a <span className="font-medium text-foreground">Day Centre Bus Run</span>{" "}
              for the return journey, or pick a general transport type.
            </p>

            {/* Day Centre Bus Run picker for outbound */}
            {busRuns.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-400">
                  Day Centre Bus Run
                </p>
                <div className="flex flex-wrap gap-2">
                  {busRuns.map((run) => {
                    const selected = outboundTransport === run.code;
                    const badge = busRunMap.get(run.code);
                    const color = badge?.color ?? "#7c3aed";
                    return (
                      <button
                        key={run.code}
                        type="button"
                        onClick={() => {
                          setOutboundTransport(run.code);
                          setDirty(true);
                        }}
                        style={selected ? { backgroundColor: color, borderColor: color } : { borderColor: color, color }}
                        className={`rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
                          selected ? "text-white" : "bg-card hover:opacity-80"
                        }`}
                      >
                        {run.displayName}
                      </button>
                    );
                  })}
                  {isBusRunCode(outboundTransport) && (
                    <button
                      type="button"
                      onClick={() => {
                        setOutboundTransport("");
                        setDirty(true);
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Use general transport instead
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* General transport fallback (hidden when a run is selected) */}
            {!isBusRunCode(outboundTransport) && (
              <div className="space-y-1.5">
                {busRuns.length > 0 && (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Or general transport type
                  </p>
                )}
                <LookupSelect
                  category={LOOKUP_CATEGORIES.transportRule}
                  value={outboundTransport}
                  onChange={(code) => {
                    setOutboundTransport(code);
                    setDirty(true);
                  }}
                  placeholder="Afternoon trip"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label
                htmlFor="sched-arrival"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Expected arrival time
              </Label>
              <input
                id="sched-arrival"
                type="time"
                value={arrivalTime}
                onChange={(e) => {
                  setArrivalTime(e.target.value);
                  setDirty(true);
                }}
                className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground [color-scheme:dark]"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="sched-departure"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Expected departure time
              </Label>
              <input
                id="sched-departure"
                type="time"
                value={departureTime}
                onChange={(e) => {
                  setDepartureTime(e.target.value);
                  setDirty(true);
                }}
                className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground [color-scheme:dark]"
              />
            </div>
          </div>
        </div>

        {/* ── Remove confirmation panel (shown in-place when triggered) ── */}
        {confirmingRemove && isEdit && editing && (
          <div className="space-y-3 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">This permanently removes the schedule.</p>
                <p className="text-xs opacity-80">
                  Removing{" "}
                  <span className="font-medium">{dayLabel || editing.dayOfWeek}</span>{" "}
                  for {participantName}. Historical attendance records are not affected.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reason for removal <span className="text-destructive">*</span>
              </Label>
              <Textarea
                rows={3}
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                placeholder="e.g. Client no longer attending on Wednesdays — changed schedule from July."
                className="resize-none"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Minimum 10 characters. Logged to the Governance Hub audit trail.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {confirmingRemove ? (
            <>
              <Button
                variant="outline"
                onClick={() => { setConfirmingRemove(false); setRemoveReason(""); }}
                className="mr-auto"
              >
                ← Back to edit
              </Button>
              <Button
                variant="destructive"
                disabled={removeReason.trim().length < 10 || remove.isPending}
                onClick={async () => {
                  if (!editing) return;
                  try {
                    await remove.mutateAsync({ id: editing.id, reason: removeReason.trim() });
                    toast.success("Schedule removed", {
                      description: `${dayLabel || editing.dayOfWeek} · ${editing.serviceType} removed for ${participantName}.`,
                    });
                    onOpenChange(false);
                  } catch {
                    /* surfaced via hook */
                  }
                }}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                {remove.isPending ? "Removing…" : "Confirm Remove"}
              </Button>
            </>
          ) : (
            <>
              {/* Remove button only in edit mode — left-aligned, destructive */}
              {isEdit && (
                <Button
                  variant="ghost"
                  className="mr-auto gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmingRemove(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove schedule
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
                {isEdit ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {mutation.isPending
                  ? "Saving…"
                  : isEdit
                    ? "Save changes"
                    : "Save schedule"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

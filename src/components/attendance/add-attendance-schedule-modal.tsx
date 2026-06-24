import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
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
import { LookupSelect } from "@/components/lookups/lookup-select";
import {
  LOOKUP_CATEGORIES,
  type AttendanceSchedule,
  type WeekDay,
} from "@/lib/data-store";
import {
  useInsertAttendanceSchedule,
  useUpdateAttendanceSchedule,
} from "@/hooks/use-supabase-data";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
  /** When present, the modal switches to edit mode. */
  editing?: AttendanceSchedule | null;
}

export function AddAttendanceScheduleModal({
  open,
  onOpenChange,
  participantId,
  participantName,
  editing,
}: Props) {
  const isEdit = !!editing;
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [dayLabel, setDayLabel] = useState<string>("");
  const [serviceType, setServiceType] = useState("");
  const [transportRule, setTransportRule] = useState("");
  const [arrivalTime, setArrivalTime] = useState("09:00");
  const [departureTime, setDepartureTime] = useState("15:00");
  const [dirty, setDirty] = useState(false);
  const insert = useInsertAttendanceSchedule();
  const update = useUpdateAttendanceSchedule();
  const mutation = isEdit ? update : insert;

  useEffect(() => {
    if (open && editing) {
      setDayOfWeek(editing.dayOfWeek);
      setDayLabel(editing.dayOfWeek);
      setServiceType(editing.serviceType);
      setTransportRule(editing.transportRule);
      setArrivalTime(editing.expectedArrivalTime || "09:00");
      setDepartureTime(editing.expectedDepartureTime || "15:00");
      setDirty(false);
    } else if (!open) {
      setDayOfWeek("");
      setDayLabel("");
      setServiceType("");
      setTransportRule("");
      setArrivalTime("09:00");
      setDepartureTime("15:00");
      setDirty(false);
    }
  }, [open, editing]);

  const valid =
    dayOfWeek.length > 0 &&
    serviceType.trim().length > 0 &&
    transportRule.trim().length > 0 &&
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
            transportRule: transportRule.trim(),
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
          transportRule: transportRule.trim(),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit operational schedule" : "Add operational schedule"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
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

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transport required
            </Label>
            <LookupSelect
              category={LOOKUP_CATEGORIES.transportRule}
              value={transportRule}
              onChange={(code) => {
                setTransportRule(code);
                setDirty(true);
              }}
              placeholder="Select transport option"
            />
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


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            {isEdit ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {mutation.isPending
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

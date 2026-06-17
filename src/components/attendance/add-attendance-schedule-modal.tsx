import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { LOOKUP_CATEGORIES, type WeekDay } from "@/lib/data-store";
import { useInsertAttendanceSchedule } from "@/hooks/use-supabase-data";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
}

export function AddAttendanceScheduleModal({
  open,
  onOpenChange,
  participantId,
  participantName,
}: Props) {
  const [dayOfWeek, setDayOfWeek] = useState<string>("");
  const [dayLabel, setDayLabel] = useState<string>("");
  const [serviceType, setServiceType] = useState("");
  const [transportRule, setTransportRule] = useState("");
  const [dirty, setDirty] = useState(false);
  const mutation = useInsertAttendanceSchedule();

  useEffect(() => {
    if (!open) {
      setDayOfWeek("");
      setDayLabel("");
      setServiceType("");
      setTransportRule("");
      setDirty(false);
    }
  }, [open]);


  const valid =
    serviceType.trim().length > 0 && transportRule.trim().length > 0;
  const canSubmit = dirty && valid && !mutation.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await mutation.mutateAsync({
        participantId,
        dayOfWeek,
        serviceType: serviceType.trim(),
        transportRule: transportRule.trim(),
      });
      toast.success("Operational schedule added", {
        description: `${dayOfWeek} · ${serviceType.trim()} for ${participantName}.`,
      });
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
          <DialogTitle>Add operational schedule</DialogTitle>
          <DialogDescription>
            Define one recurring attendance rule for {participantName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Day of week
            </Label>
            <Select
              value={dayOfWeek}
              onValueChange={(v) => {
                setDayOfWeek(v as WeekDay);
                setDirty(true);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select day" />
              </SelectTrigger>
              <SelectContent>
                {WEEK_DAYS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {mutation.isPending ? "Saving…" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

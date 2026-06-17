import { useEffect, useState } from "react";
import { CalendarClock, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useInsertSchedule,
  useUpdateMedicationSchedule,
} from "@/hooks/use-supabase-data";
import { toast } from "sonner";
import type { MedicationSchedule } from "@/lib/data-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
  editing?: MedicationSchedule | null;
}

const FREQUENCIES = ["Daily", "Twice daily", "Weekly", "PRN (as needed)", "Custom"];

export function ScheduledMedicationModal({
  open,
  onOpenChange,
  participantId,
  participantName,
  editing,
}: Props) {
  const isEdit = !!editing;
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [expectedTime, setExpectedTime] = useState("");
  const [frequency, setFrequency] = useState("Daily");
  const [dirty, setDirty] = useState(false);
  const insert = useInsertSchedule();
  const update = useUpdateMedicationSchedule();
  const pending = isEdit ? update.isPending : insert.isPending;

  useEffect(() => {
    if (open && editing) {
      setMedicationName(editing.medicationName);
      setDosage(editing.dosage);
      setExpectedTime(editing.expectedTime.slice(0, 5));
      setFrequency(editing.frequency);
      setDirty(false);
    } else if (open) {
      setMedicationName("");
      setDosage("");
      setExpectedTime("");
      setFrequency("Daily");
      setDirty(false);
    }
  }, [open, editing]);

  const valid =
    medicationName.trim().length > 0 &&
    dosage.trim().length > 0 &&
    /^\d{2}:\d{2}$/.test(expectedTime) &&
    frequency.length > 0;

  const canSubmit = !pending && valid && (isEdit ? dirty : true);

  const submit = async () => {
    if (!canSubmit) return;
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            medicationName: medicationName.trim(),
            dosage: dosage.trim(),
            expectedTime,
            frequency,
          },
        });
        toast.success("Medication schedule updated", {
          description: `${medicationName.trim()} for ${participantName}.`,
        });
      } else {
        await insert.mutateAsync({
          participantId,
          medicationName: medicationName.trim(),
          dosage: dosage.trim(),
          expectedTime,
          frequency,
        });
        toast.success("Scheduled medication added", {
          description: `${medicationName.trim()} for ${participantName} at ${expectedTime}.`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save schedule", {
        description: (err as Error).message,
      });
    }
  };

  const track = <T extends string>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <DialogTitle>
              {isEdit ? "Edit scheduled medication" : "Add scheduled medication"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {isEdit
              ? `Update routine for ${participantName}.`
              : `Adds an expected routine for ${participantName}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label="Medication name">
            <Input
              value={medicationName}
              onChange={(e) => track(setMedicationName)(e.target.value)}
              placeholder="e.g. Paracetamol"
            />
          </Field>
          <Field label="Dosage">
            <Input
              value={dosage}
              onChange={(e) => track(setDosage)(e.target.value)}
              placeholder="e.g. 500mg — 1 tablet"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expected time">
              <Input
                type="time"
                value={expectedTime}
                onChange={(e) => track(setExpectedTime)(e.target.value)}
              />
            </Field>
            <Field label="Frequency">
              <Select value={frequency} onValueChange={track(setFrequency)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} className="gap-1.5">
            {isEdit ? <Save className="h-4 w-4" /> : null}
            {pending ? "Saving…" : isEdit ? "Save changes" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
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
import { useInsertSchedule } from "@/hooks/use-supabase-data";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
}

const FREQUENCIES = ["Daily", "Twice daily", "Weekly", "PRN (as needed)", "Custom"];

export function ScheduledMedicationModal({ open, onOpenChange, participantId, participantName }: Props) {
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [expectedTime, setExpectedTime] = useState("");
  const [frequency, setFrequency] = useState("Daily");
  const insert = useInsertSchedule();

  useEffect(() => {
    if (open) {
      setMedicationName("");
      setDosage("");
      setExpectedTime("");
      setFrequency("Daily");
    }
  }, [open]);

  const dirty =
    medicationName.trim().length > 0 ||
    dosage.trim().length > 0 ||
    expectedTime.length > 0;

  const canSubmit =
    !insert.isPending &&
    medicationName.trim().length > 0 &&
    dosage.trim().length > 0 &&
    /^\d{2}:\d{2}$/.test(expectedTime) &&
    frequency.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    try {
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
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <DialogTitle>Add scheduled medication</DialogTitle>
          </div>
          <DialogDescription>
            Adds an expected routine for {participantName} to{" "}
            <code className="rounded bg-muted px-1 text-[11px]">participant_medication_schedules</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Field label="Medication name">
            <Input
              value={medicationName}
              onChange={(e) => setMedicationName(e.target.value)}
              placeholder="e.g. Paracetamol"
            />
          </Field>
          <Field label="Dosage">
            <Input
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="e.g. 500mg — 1 tablet"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expected time">
              <Input
                type="time"
                value={expectedTime}
                onChange={(e) => setExpectedTime(e.target.value)}
              />
            </Field>
            <Field label="Frequency">
              <Select value={frequency} onValueChange={setFrequency}>
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
          <Button onClick={submit} disabled={!dirty || !canSubmit}>
            {insert.isPending ? "Saving…" : "Save schedule"}
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

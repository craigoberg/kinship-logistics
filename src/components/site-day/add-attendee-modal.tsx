import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserPlus, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import {
  addWalkInAttendee,
  listEligibleAddAttendees,
  type EligibleAttendee,
} from "@/lib/api/client-attendance";
import { useParticipantDirectoryIndicators } from "@/hooks/use-participant-indicators";
import { raiseUnexpectedMedBagIssue } from "@/lib/api/unexpected-med-bag";

interface Props {
  open: boolean;
  sessionId: string;
  onClose: (changed: boolean) => void;
}

export function AddAttendeeModal({ open, sessionId, onClose }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<EligibleAttendee | null>(null);
  const [plannedConfirmed, setPlannedConfirmed] = useState(false);
  const [unexpectedFlagged, setUnexpectedFlagged] = useState(false);

  const eligibleQ = useQuery({
    queryKey: ["attendance-eligible-walkin", sessionId],
    queryFn: () => listEligibleAddAttendees(sessionId),
    enabled: open && !!sessionId,
    staleTime: 30_000,
  });

  const { data: indicators } = useParticipantDirectoryIndicators();
  const expectsMeds = !!(selected && indicators?.get(selected.id)?.meds);

  const addMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a participant first.");
      if (expectsMeds && !plannedConfirmed) {
        throw new Error(
          "Confirm the medication bag handover before adding to roll.",
        );
      }
      const row = await addWalkInAttendee(sessionId, selected.id);
      // Parallel RED escalation — never blocks the check-in.
      if (unexpectedFlagged) {
        await raiseUnexpectedMedBagIssue({
          participantId: selected.id,
          participantName: selected.fullName,
          context: "centre",
          referenceId: sessionId,
        }).catch((e) =>
          console.error("[AddAttendeeModal] unexpected med escalation failed", e),
        );
      }
      return row;
    },
    onSuccess: () => {
      toast.success(`${selected?.fullName} added as walk-in.`, {
        description: unexpectedFlagged
          ? "Checked in. RED unexpected-medication escalation routed to Governance Hub."
          : "Checked in at current time.",
      });
      qc.invalidateQueries({ queryKey: ["attendance-eligible-walkin", sessionId] });
      qc.invalidateQueries({ queryKey: ["client-attendance-roll", sessionId] });
      if (unexpectedFlagged) {
        qc.invalidateQueries({ queryKey: ["site-issues", sessionId] });
        qc.invalidateQueries({ queryKey: ["unified-issues"] });
      }
      setSelected(null);
      setPlannedConfirmed(false);
      setUnexpectedFlagged(false);
      onClose(true);
    },
    onError: (e: Error) => {
      toast.error("Could not add attendee", { description: e.message });
    },
  });

  const items = useMemo(() => eligibleQ.data ?? [], [eligibleQ.data]);

  const handleOpenChange = (o: boolean) => {
    if (addMut.isPending) return;
    if (!o) {
      setSelected(null);
      setPlannedConfirmed(false);
      setUnexpectedFlagged(false);
      onClose(false);
    }
  };

  const submitDisabled =
    !selected ||
    addMut.isPending ||
    (expectsMeds && !plannedConfirmed);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Attendee (Walk-In)</DialogTitle>
          <DialogDescription>
            Active participants not already on today’s roll. Selecting one
            injects a fresh card marked walk-in and checked in at the current
            time.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          <Command>
            <CommandInput placeholder="Search participants…" />
            <CommandList>
              {eligibleQ.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : items.length === 0 ? (
                <CommandEmpty>No eligible participants.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {items.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.fullName}
                      onSelect={() => {
                        setSelected(p);
                        setPlannedConfirmed(false);
                      }}
                      className={
                        selected?.id === p.id
                          ? "bg-primary/10 text-primary"
                          : ""
                      }
                    >
                      {p.fullName}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>

        {selected && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <div>
              Selected: <span className="font-semibold">{selected.fullName}</span>
            </div>

            {expectsMeds && (
              <label className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
                <Checkbox
                  checked={plannedConfirmed}
                  onCheckedChange={(v) => setPlannedConfirmed(v === true)}
                  className="mt-0.5"
                />
                <span className="text-xs text-amber-900 dark:text-amber-200">
                  <span className="font-semibold">Required:</span> Medication Bag
                  Handover Confirmed (from Bus/Carer)
                </span>
              </label>
            )}

            <label className="flex items-start gap-2 rounded-md border border-border bg-background/60 p-2">
              <Checkbox
                checked={unexpectedFlagged}
                onCheckedChange={(v) => setUnexpectedFlagged(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs">
                Unexpected Medication Handed Over
                <span className="ml-1 text-muted-foreground">
                  (raises a RED Governance Hub ticket)
                </span>
              </span>
            </label>

            {unexpectedFlagged && (
              <div className="flex items-start gap-2 rounded-md border border-red-600/50 bg-red-600/10 p-2 text-[11px] text-red-800 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Check-in will proceed. A RED unexpected-medication anomaly
                  will be routed to the Governance Hub for investigation.
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={addMut.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => addMut.mutate()}
            disabled={submitDisabled}
            className="gap-2"
          >
            {addMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Add to Roll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

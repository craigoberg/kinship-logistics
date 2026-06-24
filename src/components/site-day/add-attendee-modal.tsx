import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
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
import {
  addWalkInAttendee,
  listEligibleAddAttendees,
  type EligibleAttendee,
} from "@/lib/api/client-attendance";

interface Props {
  open: boolean;
  sessionId: string;
  onClose: (changed: boolean) => void;
}

export function AddAttendeeModal({ open, sessionId, onClose }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<EligibleAttendee | null>(null);

  const eligibleQ = useQuery({
    queryKey: ["attendance-eligible-walkin", sessionId],
    queryFn: () => listEligibleAddAttendees(sessionId),
    enabled: open && !!sessionId,
    staleTime: 30_000,
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a participant first.");
      return addWalkInAttendee(sessionId, selected.id);
    },
    onSuccess: () => {
      toast.success(`${selected?.fullName} added as walk-in.`, {
        description: "Checked in at current time.",
      });
      qc.invalidateQueries({ queryKey: ["attendance-eligible-walkin", sessionId] });
      setSelected(null);
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
      onClose(false);
    }
  };

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
                      onSelect={() => setSelected(p)}
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
          <div className="rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
            Selected: <span className="font-semibold">{selected.fullName}</span>
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
            disabled={!selected || addMut.isPending}
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

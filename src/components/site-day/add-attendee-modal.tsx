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
import { Label } from "@/components/ui/label";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn } from "@/lib/utils";

import {
  addWalkInAttendee,
  listEligibleAddAttendees,
  type DepartureVector,
  type EligibleAttendee,
} from "@/lib/api/client-attendance";
import { useParticipantDirectoryIndicators } from "@/hooks/use-participant-indicators";
import { raiseUnexpectedMedBagIssue } from "@/lib/api/unexpected-med-bag";
import { useLookupParameters } from "@/hooks/use-supabase-data";
import { LOOKUP_CATEGORIES } from "@/lib/data-store";
import { eventBusRunOptions } from "@/lib/event-bus-runs";
import {
  buildBusSelfPickerOptions,
  floorSelectionKey,
  type FloorTransportSelection,
} from "@/lib/ui/floor-transport-method";

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
  const [home, setHome] = useState<FloorTransportSelection | null>(null);

  const { data: busRunLookups = [] } = useLookupParameters(LOOKUP_CATEGORIES.busRun);
  const homeOptions = useMemo(() => {
    const busOpts = eventBusRunOptions(busRunLookups);
    return [
      ...buildBusSelfPickerOptions(busOpts, "dayCentre", {
        busTitlePrefix: "Home on",
        selfTitle: "Family / carer",
        selfSubtitle: "Collected — not on the centre bus",
      }),
      {
        id: "independent",
        kind: "independent" as const,
        busRunCode: null,
        title: "Independent",
        subtitle: "Left under own arrangement",
        label: "Indep",
      },
    ];
  }, [busRunLookups]);

  const eligibleQ = useQuery({
    queryKey: ["attendance-eligible-walkin", sessionId],
    queryFn: () => listEligibleAddAttendees(sessionId),
    enabled: open && !!sessionId,
    staleTime: 30_000,
  });

  const { data: indicators } = useParticipantDirectoryIndicators();
  const expectsMeds = !!(selected && indicators?.get(selected.id)?.hasMeds);

  const addMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a participant first.");
      if (!home) throw new Error("Pick how they go home.");
      if (home.kind === "bus" && !home.busRunCode) {
        throw new Error("Pick which bus they go home on.");
      }
      if (expectsMeds && !plannedConfirmed) {
        throw new Error(
          "Confirm the medication bag handover before adding to roll.",
        );
      }
      const vector: DepartureVector =
        home.kind === "bus"
          ? "bus"
          : home.kind === "independent"
            ? "independent"
            : "family";
      const result = await addWalkInAttendee(sessionId, selected.id, {
        vector,
        busRunCode: home.kind === "bus" ? home.busRunCode : null,
      });
      // Parallel RED escalation — runs after check-in completes.
      // GUARDRAILS §1.1: failure surfaced to operator, not swallowed.
      if (unexpectedFlagged) {
        await raiseUnexpectedMedBagIssue({
          participantId: selected.id,
          participantName: selected.fullName,
          context: "centre",
          referenceId: sessionId,
        }).catch((e) => {
          console.error("[AddAttendeeModal] unexpected med escalation failed", e);
          toast.error("Unexpected med-bag: escalation failed — manual log required", {
            description: (e as Error).message ?? "Ledger write failed. Contact your coordinator immediately.",
          });
        });
      }
      return result;
    },
    onSuccess: (result) => {
      const homeHint =
        result.lateArrivalHome?.kind === "added_to_live_run"
          ? "Added to the afternoon home run — confirm boarding on Manifest."
          : result.lateArrivalHome?.kind === "will_seed"
            ? "They will appear on the afternoon Manifest when that run starts."
            : result.lateArrivalHome?.kind === "run_already_underway"
              ? "Afternoon bus already left. Check out via family, or call the driver."
              : result.lateArrivalHome?.kind === "not_needed"
                ? "Going home with family / self — not on the afternoon bus."
                : undefined;
      toast.success(`${selected?.fullName} added as walk-in.`, {
        description: unexpectedFlagged
          ? "Checked in. RED unexpected-medication escalation routed to Governance Hub."
          : homeHint ?? "Checked in at current time.",
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
      setHome(null);
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
      setHome(null);
      onClose(false);
    }
  };

  const missing: string[] = [];
  if (!selected) missing.push("Participant");
  if (selected && !home) missing.push("How they go home");
  if (selected && home?.kind === "bus" && !home.busRunCode) {
    missing.push("Which bus home");
  }
  if (selected && expectsMeds && !plannedConfirmed) {
    missing.push("Medication bag handover");
  }

  const submitDisabled = missing.length > 0 || addMut.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Attendee (Walk-In)</DialogTitle>
          <DialogDescription>
            Active participants not already on today’s roll (including someone
            marked Off today who then turns up). Selecting one checks them in
            as a walk-in. You must pick how they go home.
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
                        setHome(null);
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

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How they go home
              </Label>
              <div
                className={cn(
                  "space-y-1.5 rounded-md p-1",
                  requiredFieldOutline(!home),
                )}
              >
                {homeOptions.map((opt) => {
                  const key = floorSelectionKey({
                    kind: opt.kind,
                    busRunCode: opt.busRunCode,
                    label: opt.label,
                  });
                  const selectedKey = home ? floorSelectionKey(home) : "";
                  return (
                    <MobileFieldButton
                      key={opt.id}
                      title={opt.title}
                      subtitle={opt.subtitle}
                      active={key === selectedKey}
                      disabled={addMut.isPending}
                      onClick={() =>
                        setHome({
                          kind: opt.kind,
                          busRunCode: opt.busRunCode,
                          label: opt.label,
                        })
                      }
                    />
                  );
                })}
              </div>
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

        {missing.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Still needed: {missing.join(" · ")}
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Close
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

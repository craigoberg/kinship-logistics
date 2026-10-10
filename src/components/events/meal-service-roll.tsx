/**
 * BL-073 — meal service roll for Programme meal activities.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { ClinicalFlagChips } from "@/components/ui/clinical-flag-chips";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { clinicalFlagsFromParticipant } from "@/lib/clinical-flags";
import {
  listMealServiceRoll,
  seedMealServiceRoll,
  setMealServiceStatus,
  type MealServiceStatus,
} from "@/lib/api/event-meal-service";
import { listParticipants } from "@/lib/data-store";
import { cn } from "@/lib/utils";
import {
  sortByParticipantSurname,
  surnameMapFromParticipants,
} from "@/lib/ui/sort-participants";

type Props = {
  venueStopId: string;
  eventId: string;
  /** Trip day session — meal roll seeds checked-in people only. */
  eventDaySessionId: string;
  editable?: boolean;
};

const STATUS_BTNS: { status: MealServiceStatus; label: string }[] = [
  { status: "served", label: "Served" },
  { status: "modified", label: "Modified" },
  { status: "own_order", label: "Own order" },
  { status: "declined", label: "Declined" },
  { status: "na", label: "N/A" },
  { status: "expected", label: "Reset" },
];

const NOTE_STATUSES: MealServiceStatus[] = ["modified", "own_order"];

export function MealServiceRoll({
  venueStopId,
  eventId,
  eventDaySessionId,
  editable = true,
}: Props) {
  const qc = useQueryClient();
  const key = ["meal-service-roll", venueStopId] as const;
  const [noteTarget, setNoteTarget] = useState<{
    id: string;
    status: MealServiceStatus;
    name: string;
    notes: string;
  } | null>(null);

  useEffect(() => {
    void seedMealServiceRoll(venueStopId, eventId, eventDaySessionId)
      .then(() => qc.invalidateQueries({ queryKey: key }))
      .catch((e) => console.warn("[MealServiceRoll] seed", e));
  }, [venueStopId, eventId, eventDaySessionId, qc]);

  const rollQ = useQuery({
    queryKey: key,
    queryFn: () => listMealServiceRoll(venueStopId),
  });
  const participantsQ = useQuery({
    queryKey: ["participants"],
    queryFn: listParticipants,
    staleTime: 60_000,
  });

  const setMut = useMutation({
    mutationFn: ({
      id,
      status,
      notes,
    }: {
      id: string;
      status: MealServiceStatus;
      notes?: string | null;
    }) => setMealServiceStatus(id, status, notes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      setNoteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const byId = useMemo(
    () => new Map((participantsQ.data ?? []).map((p) => [p.id, p])),
    [participantsQ.data],
  );
  const rows = useMemo(
    () =>
      sortByParticipantSurname(
        rollQ.data ?? [],
        (r) => r.participantId,
        surnameMapFromParticipants(participantsQ.data ?? []),
      ),
    [rollQ.data, participantsQ.data],
  );

  if (rollQ.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const p = byId.get(r.participantId);
          const name = p?.fullName ?? "Participant";
          const chips = clinicalFlagsFromParticipant(p ?? {});
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{name}</span>
                  {chips.length > 0 && (
                    <ClinicalFlagChips chips={chips} personName={name} />
                  )}
                </div>
                <p className="text-[10px] uppercase text-muted-foreground">
                  {r.status.replace(/_/g, " ")}
                  {r.notes ? ` · ${r.notes}` : ""}
                </p>
              </div>
              {editable && (
                <div className="flex flex-wrap gap-1">
                  {STATUS_BTNS.map((b) => (
                    <Button
                      key={b.status}
                      type="button"
                      size="sm"
                      variant={r.status === b.status ? "default" : "outline"}
                      className={cn("h-9 min-h-9 px-2 text-xs")}
                      disabled={setMut.isPending}
                      onClick={() => {
                        if (NOTE_STATUSES.includes(b.status)) {
                          setNoteTarget({
                            id: r.id,
                            status: b.status,
                            name,
                            notes: r.notes ?? "",
                          });
                          return;
                        }
                        setMut.mutate({ id: r.id, status: b.status, notes: null });
                      }}
                    >
                      {b.label}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-xs text-muted-foreground">
            No roster people for this meal yet.
          </li>
        )}
      </ul>

      <BottomSheet
        open={!!noteTarget}
        onOpenChange={(o) => {
          if (!o) setNoteTarget(null);
        }}
        title={
          noteTarget
            ? `${noteTarget.status === "own_order" ? "Own order" : "Modified"} — ${noteTarget.name}`
            : "Note"
        }
        description={
          noteTarget?.status === "own_order"
            ? "What did they order?"
            : "What was different from the group meal?"
        }
      >
        {noteTarget && (
          <div className="space-y-3 pb-2">
            <CharacterCountedTextarea
              label="Note"
              value={noteTarget.notes}
              onValueChange={(next) =>
                setNoteTarget((prev) => (prev ? { ...prev, notes: next } : prev))
              }
              minChars={3}
              maxChars={160}
              rows={3}
              required
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNoteTarget(null)}
              >
                Close
              </Button>
              <Button
                type="button"
                className="h-12 w-full sm:w-auto"
                disabled={
                  setMut.isPending || noteTarget.notes.trim().length < 3
                }
                onClick={() =>
                  setMut.mutate({
                    id: noteTarget.id,
                    status: noteTarget.status,
                    notes: noteTarget.notes.trim(),
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

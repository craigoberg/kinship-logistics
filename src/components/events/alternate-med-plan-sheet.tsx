/**
 * BL-077 — PIN-signed alternate med delivery plan (hospital / other carer).
 * Removes participant from trip med board so the group can proceed.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyNamedStaffPin } from "@/components/auth/pin-verify";
import { listStaffRegistry, type Participant } from "@/lib/data-store";
import {
  listAlternateMedPlans,
  recordAlternateMedPlan,
  clearAlternateMedPlan,
} from "@/lib/api/event-medication-round";
import { Button } from "@/components/ui/button";
import { listEventAttendanceRoll } from "@/lib/api/event-attendance";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventDaySessionId: string;
  participantMap: Map<string, Participant>;
};

export function AlternateMedPlanSheet({
  open,
  onOpenChange,
  eventId,
  eventDaySessionId,
  participantMap,
}: Props) {
  const qc = useQueryClient();
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [staffId, setStaffId] = useState<string | null>(null);

  const staffQ = useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    enabled: open,
    staleTime: 60_000,
  });
  const attendanceQ = useQuery({
    queryKey: ["event-attendance", eventDaySessionId],
    queryFn: () => listEventAttendanceRoll(eventDaySessionId),
    enabled: open,
  });
  const plansQ = useQuery({
    queryKey: ["med-alternate-plans", eventDaySessionId],
    queryFn: () => listAlternateMedPlans(eventDaySessionId),
    enabled: open,
  });

  const candidates = useMemo(() => {
    const planned = new Set((plansQ.data ?? []).map((p) => p.participantId));
    return (attendanceQ.data ?? [])
      .filter((r) => r.status === "checked_in" || r.status === "expected")
      .filter((r) => !planned.has(r.participantId))
      .map((r) => ({
        id: r.participantId,
        name: participantMap.get(r.participantId)?.fullName ?? "Participant",
      }));
  }, [attendanceQ.data, plansQ.data, participantMap]);

  const activeStaff = useMemo(
    () => (staffQ.data ?? []).filter((s) => s.active),
    [staffQ.data],
  );

  const saveMut = useMutation({
    mutationFn: async (pin: string) => {
      if (!participantId || !staffId) throw new Error("Select person and staff.");
      await recordAlternateMedPlan({
        eventDaySessionId,
        eventId,
        participantId,
        planNote: note,
        attestedByStaffId: staffId,
        pin,
      });
    },
    onSuccess: () => {
      toast.success("Alternate med plan recorded — off trip med board.");
      void qc.invalidateQueries({
        queryKey: ["med-alternate-plans", eventDaySessionId],
      });
      void qc.invalidateQueries({
        queryKey: ["trip-med-presence", eventDaySessionId],
      });
      setParticipantId(null);
      setNote("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMut = useMutation({
    mutationFn: (pid: string) => clearAlternateMedPlan(eventDaySessionId, pid),
    onSuccess: () => {
      toast.success("Alternate plan cleared — back on med board.");
      void qc.invalidateQueries({
        queryKey: ["med-alternate-plans", eventDaySessionId],
      });
      void qc.invalidateQueries({
        queryKey: ["trip-med-presence", eventDaySessionId],
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const staffName =
    activeStaff.find((s) => s.id === staffId)?.fullName ?? "Staff";

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Alternate med plan"
      description="PIN-signed cover when someone is already with hospital / another carer — not left alone. They leave the trip medication board."
    >
      <div className="space-y-4 pb-2">
        {(plansQ.data?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active plans
            </p>
            {plansQ.data!.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {participantMap.get(p.participantId)?.fullName ?? "Person"}
                  </div>
                  <p className="text-xs text-muted-foreground">{p.planNote}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-11 shrink-0"
                  disabled={clearMut.isPending}
                  onClick={() => clearMut.mutate(p.participantId)}
                >
                  Clear
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Person covered elsewhere
          </p>
          <div className="max-h-40 space-y-1.5 overflow-y-auto">
            {candidates.map((c) => (
              <MobileFieldButton
                key={c.id}
                title={c.name}
                tone="info"
                active={participantId === c.id}
                onClick={() => setParticipantId(c.id)}
              />
            ))}
            {candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No eligible people (or all already have a plan).
              </p>
            )}
          </div>
        </div>

        <CharacterCountedTextarea
          label="Where / who has them"
          value={note}
          onValueChange={setNote}
          minChars={10}
          maxChars={240}
          rows={3}
          required
          placeholder="e.g. At hospital with Mum — meds managed there (min 10 characters)"
        />

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Attesting staff
          </p>
          <div className="max-h-36 space-y-1.5 overflow-y-auto">
            {activeStaff.map((s) => (
              <MobileFieldButton
                key={s.id}
                title={s.fullName}
                subtitle={s.role ?? "Staff"}
                tone="info"
                active={staffId === s.id}
                onClick={() => setStaffId(s.id)}
              />
            ))}
          </div>
        </div>

        <PinEntryTrigger
          className="w-full"
          label={
            !participantId || !staffId || note.trim().length < 10
              ? "Complete details first"
              : `${staffName} — PIN to seal plan`
          }
          length={4}
          title="Alternate med plan"
          description="Confirm this person has a safe med delivery plan away from the group."
          disabled={
            !participantId ||
            !staffId ||
            note.trim().length < 10 ||
            saveMut.isPending
          }
          onVerify={async (pin) => {
            await verifyNamedStaffPin(staffId!, pin);
          }}
          onSuccess={(pin) => saveMut.mutate(pin)}
        />

        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </BottomSheet>
  );
}

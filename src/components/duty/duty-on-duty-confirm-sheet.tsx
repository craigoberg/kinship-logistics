/**
 * Support Arrived — floor_on_duty gap. Carers (no staff_id) fall through
 * until a carer requirement store exists.
 */
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { DutyRequirementGapPanel } from "@/components/duty/duty-requirement-gap-panel";
import { useDutyFunctionGap } from "@/hooks/use-duty-function-gap";

export type DutyOnDutyPending = {
  staffId: string | null;
  displayName: string;
  onProceed: () => void;
};

type Props = {
  pending: DutyOnDutyPending | null;
  onDismiss: () => void;
};

export function DutyOnDutyConfirmSheet({ pending, onDismiss }: Props) {
  const staffId = pending?.staffId ?? null;
  const canEvaluate = !!staffId;
  const gap = useDutyFunctionGap({
    functionKey: "floor_on_duty",
    staffId,
    subjectLabel: pending?.displayName ?? "Support",
    enabled: !!pending && canEvaluate,
    ledgerCategory: "CENTRE",
  });
  const proceeded = useRef(false);

  useEffect(() => {
    proceeded.current = false;
  }, [pending]);

  useEffect(() => {
    if (!pending || proceeded.current) return;
    if (!canEvaluate || (gap.ready && !gap.needsGap)) {
      proceeded.current = true;
      pending.onProceed();
      onDismiss();
    }
  }, [pending, canEvaluate, gap.ready, gap.needsGap, onDismiss]);

  const showSheet =
    !!pending && canEvaluate && (!gap.ready || gap.needsGap);

  return (
    <BottomSheet
      open={showSheet}
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
      title="On-duty requirements"
      description={`${pending?.displayName ?? "This helper"} is checking in.`}
    >
      <div className="space-y-4">
        {!gap.ready && (
          <p className="text-sm text-muted-foreground">Checking requirements…</p>
        )}
        {gap.ready && gap.needsGap && (
          <>
            <DutyRequirementGapPanel
              actorName={pending?.displayName ?? "Helper"}
              evalResult={gap.evalResult}
              note={gap.note}
              onNoteChange={gap.setNote}
              managerId={gap.managerId}
              onManagerIdChange={gap.setManagerId}
              managerPin={gap.managerPin}
              onManagerPin={gap.setManagerPin}
              managers={gap.managers}
              title="On-duty check-in"
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onDismiss}>
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={!gap.approved}
                onClick={async () => {
                  if (!(await gap.ensureApproved()) || !pending) return;
                  proceeded.current = true;
                  pending.onProceed();
                  onDismiss();
                }}
              >
                Check in
              </Button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

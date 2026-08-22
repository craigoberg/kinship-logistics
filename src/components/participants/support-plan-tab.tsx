import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { ClientSupportPlanFields } from "@/components/onboarding/forms/client-support-plan-fields";
import {
  emptyClientSupport,
  type ClientSupportDraft,
} from "@/lib/onboarding/form-types";
import { type Participant, type ParticipantPatch } from "@/lib/data-store";

interface Props {
  participant: Participant;
  online: boolean;
  saving: boolean;
  onSave: (patch: ParticipantPatch) => Promise<void>;
  onClose: () => void;
}

function supportFromParticipant(p: Participant): ClientSupportDraft {
  return {
    ...emptyClientSupport(),
    goals: p.supportGoals ?? "",
    strengths: p.supportStrengths ?? "",
    needs: p.supportNeeds ?? "",
    preferences: p.supportPreferences ?? "",
    communicationMode: p.communicationMode ?? "",
    communicationStrategies: p.communicationStrategies ?? "",
    riskHazards: p.riskHazards ?? "",
    riskControls: p.riskControls ?? "",
  };
}

export function SupportPlanTab({
  participant,
  online,
  saving,
  onSave,
  onClose,
}: Props) {
  const [support, setSupport] = useState<ClientSupportDraft>(() =>
    supportFromParticipant(participant),
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSupport(supportFromParticipant(participant));
    setDirty(false);
  }, [participant]);

  const save = async () => {
    await onSave({
      supportGoals: support.goals.trim() || null,
      supportStrengths: support.strengths.trim() || null,
      supportNeeds: support.needs.trim() || null,
      supportPreferences: support.preferences.trim() || null,
      communicationMode: support.communicationMode.trim() || null,
      communicationStrategies: support.communicationStrategies.trim() || null,
      riskHazards: support.riskHazards.trim() || null,
      riskControls: support.riskControls.trim() || null,
    });
    setDirty(false);
  };

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto pr-1 pt-4 space-y-3">
        <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          Live office record. Signed paper evidence and Hub review dates come from
          Onboarding <strong className="text-foreground">Review/Update</strong>{" "}
          (print → wet-sign → file), not from saving this tab.
        </p>
        <ClientSupportPlanFields
          value={support}
          onChange={(next) => {
            setSupport(next);
            setDirty(true);
          }}
          required={false}
        />
      </div>
      <DialogFooter className="mt-1 shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => void save()} disabled={!dirty || saving} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : online ? "Save changes" : "Queue offline"}
        </Button>
      </DialogFooter>
    </div>
  );
}

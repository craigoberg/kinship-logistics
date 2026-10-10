/**
 * BL-126 — Manager justification when someone is doing a Duty without
 * current requirements. Same floor pattern as meal SFH (BL-073).
 */
import { AlertTriangle } from "lucide-react";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { MobileFieldButton } from "@/components/manifest/mobile-field-button";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyManagerPin } from "@/components/auth/pin-verify";
import type { StaffMember } from "@/lib/data-store";
import type { DutyRequirementEval } from "@/lib/duty-roles";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
} from "@/lib/ui/caution-callout";
import { cn } from "@/lib/utils";

export function isManagerOnDutyRole(role: string | null | undefined): boolean {
  const r = (role ?? "").toLowerCase();
  return r.includes("manager") || r.includes("coordinator");
}

type Props = {
  actorName: string;
  evalResult: DutyRequirementEval;
  note: string;
  onNoteChange: (next: string) => void;
  managerId: string | null;
  onManagerIdChange: (id: string | null) => void;
  managerPin: string | null;
  onManagerPin: (pin: string | null) => void;
  managers: StaffMember[];
  title?: string;
  disabled?: boolean;
};

export function DutyRequirementGapPanel({
  actorName,
  evalResult,
  note,
  onNoteChange,
  managerId,
  onManagerIdChange,
  managerPin,
  onManagerPin,
  managers,
  title = "Duty requirements",
  disabled = false,
}: Props) {
  const missing = evalResult.missingNames.join(", ");
  const expired = evalResult.expiredNames.join(", ");
  const headline =
    evalResult.overall === "warn_missing"
      ? `${actorName} is missing ${missing || "required items"} on file.`
      : `${actorName} has expired ${expired || "required items"}.`;

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className={cn("space-y-2", CAUTION_CALLOUT_CLASS, "p-3")}>
        <div className="flex items-start gap-2">
          <AlertTriangle
            className={cn("mt-0.5 h-4 w-4", CAUTION_CALLOUT_ICON_CLASS)}
          />
          <p className={cn("text-sm", CAUTION_CALLOUT_BODY_CLASS)}>
            {headline} A Manager must approve before this job can proceed.
          </p>
        </div>
      </div>
      <CharacterCountedTextarea
        label="Manager justification"
        value={note}
        onValueChange={(v) => {
          onNoteChange(v);
          onManagerPin(null);
        }}
        minChars={10}
        maxChars={240}
        rows={3}
        required
        placeholder="Why proceeding without current requirements (min 10 characters)"
      />
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Manager on Duty
        </p>
        <div className="max-h-40 space-y-1.5 overflow-y-auto">
          {managers.map((s) => (
            <MobileFieldButton
              key={s.id}
              title={s.fullName}
              subtitle={s.role ?? "Manager"}
              tone="info"
              active={managerId === s.id}
              onClick={() => {
                onManagerIdChange(s.id);
                onManagerPin(null);
              }}
            />
          ))}
        </div>
      </div>
      <PinEntryTrigger
        className="w-full"
        label={
          note.trim().length < 10 || !managerId
            ? "Justification + Manager first"
            : managerPin
              ? `${title} approved by Manager`
              : `Manager PIN — approve ${title} gap`
        }
        verified={!!managerPin}
        verifiedLabel="Approved — continue"
        length={4}
        title={`Manager ${title} approval`}
        description="Approve proceeding when required certificates or orientations are missing or expired."
        disabled={
          disabled ||
          !managerId ||
          note.trim().length < 10 ||
          !!managerPin
        }
        onVerify={async (pin) => {
          await verifyManagerPin(managerId!, pin);
        }}
        onSuccess={(pin) => {
          onManagerPin(pin);
        }}
      />
    </div>
  );
}

export function dutyGapApproved(
  needsGap: boolean,
  note: string,
  managerId: string | null,
  managerPin: string | null,
): boolean {
  if (!needsGap) return true;
  return !!managerId && !!managerPin && note.trim().length >= 10;
}

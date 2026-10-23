import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import {
  MIN_COMMUNICATION_MODE_CHARS,
  MIN_SUPPORT_PLAN_CHARS,
  type ClientSupportDraft,
} from "@/lib/onboarding/form-types";

interface Props {
  value: ClientSupportDraft;
  onChange: (next: ClientSupportDraft) => void;
  /** Onboarding Confirm requires these; Care Profile save does not. */
  required: boolean;
  languagesAtHome?: string;
  onLanguagesAtHomeChange?: (next: string) => void;
}

/**
 * BL-114 thin organisational support plan — day centre / community / transport.
 * Shared by Client onboarding pack and Care Profile → Support & risk.
 */
export function ClientSupportPlanFields({
  value,
  onChange,
  required,
  languagesAtHome,
  onLanguagesAtHomeChange,
}: Props) {
  const set = <K extends keyof ClientSupportDraft>(key: K, v: ClientSupportDraft[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Organisational support plan for YADA day centre, community access and
        transport (NDIS groups 0136 / 0125 / 0108). This is not a SIL care plan.
        Write <span className="font-medium text-foreground">None identified</span>{" "}
        only where that is true for YADA supports.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Support plan</h3>
        <CharacterCountedTextarea
          label="Goals *"
          hint="What they want from YADA supports"
          value={value.goals}
          onValueChange={(v) => set("goals", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
        <CharacterCountedTextarea
          label="Strengths *"
          hint="What they do well / what helps"
          value={value.strengths}
          onValueChange={(v) => set("strengths", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
        <CharacterCountedTextarea
          label="Support needs *"
          hint="What staff need to put in place"
          value={value.needs}
          onValueChange={(v) => set("needs", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
        <CharacterCountedTextarea
          label="Preferences and wishes *"
          hint="How they like supports delivered"
          value={value.preferences}
          onValueChange={(v) => set("preferences", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Communication</h3>
        <CharacterCountedInput
          label="How they communicate *"
          hint="e.g. speech, Auslan, pictures, iPad"
          value={value.communicationMode}
          onValueChange={(v) => set("communicationMode", v)}
          minChars={MIN_COMMUNICATION_MODE_CHARS}
          maxChars={120}
          required={required}
        />
        {onLanguagesAtHomeChange ? (
          <CharacterCountedInput
            label="Languages at home"
            hint="Optional"
            value={languagesAtHome ?? ""}
            onValueChange={onLanguagesAtHomeChange}
            minChars={1}
            maxChars={120}
            required={false}
          />
        ) : null}
        <CharacterCountedTextarea
          label="Strategies for staff *"
          hint="What to do so they are understood and can be understood"
          value={value.communicationStrategies}
          onValueChange={(v) => set("communicationStrategies", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Risk assessment</h3>
        <p className="text-xs text-muted-foreground">
          Proportionate to centre days, community outings and transport. Do not
          write behaviour support plans. YADA does not implement restrictive
          practices.
        </p>
        <CharacterCountedTextarea
          label="What to watch for *"
          hint="Hazards at centre, on outings, or on the bus — or None identified for YADA supports"
          value={value.riskHazards}
          onValueChange={(v) => set("riskHazards", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
        <CharacterCountedTextarea
          label="What staff do *"
          hint="Controls, who to call, extra attention"
          value={value.riskControls}
          onValueChange={(v) => set("riskControls", v)}
          minChars={MIN_SUPPORT_PLAN_CHARS}
          maxChars={800}
          required={required}
          rows={3}
        />
      </section>
    </div>
  );
}

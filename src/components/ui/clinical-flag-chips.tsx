/**
 * Compact Allergy / Diet / Comms chips; tap opens short detail sheet.
 */
import { useState } from "react";
import { AlertTriangle, MessageSquare, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import type { ClinicalFlagChip } from "@/lib/clinical-flags";

type Props = {
  chips: ClinicalFlagChip[];
  personName: string;
  className?: string;
};

function chipClass(kind: ClinicalFlagChip["kind"]): string {
  if (kind === "allergy") return "border border-amber-600/50 bg-amber-500/15 text-amber-900";
  if (kind === "diet") return "border border-sky-600/50 bg-sky-500/15 text-sky-900";
  return "border border-violet-600/50 bg-violet-500/15 text-violet-900";
}

function chipHeading(kind: ClinicalFlagChip["kind"]): string {
  if (kind === "allergy") return "Allergy / alerts";
  if (kind === "diet") return "Diet / IDDSI";
  return "Communication";
}

function ChipIcon({ kind }: { kind: ClinicalFlagChip["kind"] }) {
  if (kind === "allergy") return <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />;
  if (kind === "diet") return <Utensils className="mr-0.5 inline h-2.5 w-2.5" />;
  return <MessageSquare className="mr-0.5 inline h-2.5 w-2.5" />;
}

export function ClinicalFlagChips({ chips, personName, className }: Props) {
  const [open, setOpen] = useState(false);
  if (chips.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex flex-wrap items-center gap-1 touch-manipulation",
          className,
        )}
        aria-label={`Clinical flags for ${personName}`}
      >
        {chips.map((c) => (
          <Badge
            key={c.kind}
            className={cn("text-[10px] font-semibold uppercase", chipClass(c.kind))}
          >
            <ChipIcon kind={c.kind} />
            {c.label}
          </Badge>
        ))}
      </button>

      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={personName}
        description="Clinical flags (view only on the floor)"
      >
        <div className="space-y-3 pb-4">
          {chips.map((c) => (
            <div
              key={c.kind}
              className="rounded-lg border bg-card px-3 py-2.5 text-sm"
            >
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {chipHeading(c.kind)}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {c.detail.length > 280
                  ? `${c.detail.slice(0, 280)}…`
                  : c.detail}
              </p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Edit clinical notes in the office Care profile — not on the floor.
          </p>
        </div>
      </BottomSheet>
    </>
  );
}

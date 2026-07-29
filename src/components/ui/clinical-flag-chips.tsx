/**
 * BL-076 — compact Allergy / Diet chips; tap opens short detail sheet.
 */
import { useState } from "react";
import { AlertTriangle, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";
import type { ClinicalFlagChip } from "@/lib/clinical-flags";

type Props = {
  chips: ClinicalFlagChip[];
  personName: string;
  className?: string;
};

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
            className={cn(
              "text-[10px] font-semibold uppercase",
              c.kind === "allergy"
                ? "border border-amber-600/50 bg-amber-500/15 text-amber-900"
                : "border border-sky-600/50 bg-sky-500/15 text-sky-900",
            )}
          >
            {c.kind === "allergy" ? (
              <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />
            ) : (
              <Utensils className="mr-0.5 inline h-2.5 w-2.5" />
            )}
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
                {c.kind === "allergy" ? "Allergy / alerts" : "Diet / IDDSI"}
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

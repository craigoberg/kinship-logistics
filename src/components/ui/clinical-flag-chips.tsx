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
  /** `light` when the row is a solid or pale fill, even in dark mode. */
  surface?: "theme" | "light";
};

function chipClass(kind: ClinicalFlagChip["kind"], surface: "theme" | "light"): string {
  if (surface === "light") {
    if (kind === "allergy") return "border-amber-700/60 bg-amber-100 text-amber-950";
    if (kind === "diet") return "border-sky-700/60 bg-sky-100 text-sky-950";
    return "border-violet-700/60 bg-violet-100 text-violet-950";
  }
  if (kind === "allergy") {
    return "border-amber-600/60 bg-amber-500/15 text-amber-950 dark:border-amber-300/80 dark:bg-amber-400/25 dark:text-amber-50";
  }
  if (kind === "diet") {
    return "border-sky-600/60 bg-sky-500/15 text-sky-950 dark:border-sky-300/80 dark:bg-sky-400/25 dark:text-sky-50";
  }
  return "border-violet-600/60 bg-violet-500/15 text-violet-950 dark:border-violet-300/80 dark:bg-violet-400/25 dark:text-violet-50";
}

function chipHeading(kind: ClinicalFlagChip["kind"]): string {
  if (kind === "allergy") return "Allergy / alerts";
  if (kind === "diet") return "Diet / IDDSI";
  return "Communication";
}

function ChipIcon({ kind }: { kind: ClinicalFlagChip["kind"] }) {
  if (kind === "allergy") return <AlertTriangle className="mr-0.5 inline h-3 w-3" />;
  if (kind === "diet") return <Utensils className="mr-0.5 inline h-3 w-3" />;
  return <MessageSquare className="mr-0.5 inline h-3 w-3" />;
}

export function ClinicalFlagChips({
  chips,
  personName,
  className,
  surface = "theme",
}: Props) {
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
            variant="outline"
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide",
              chipClass(c.kind, surface),
            )}
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

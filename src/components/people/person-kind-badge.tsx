import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PersonHat } from "@/lib/person-hats";
import {
  PERSON_KIND_CHIP_CLASS,
  PERSON_KIND_CHIP_ON_LIGHT,
  PERSON_KIND_LABEL,
  PERSON_KIND_TEXT_CLASS,
  PERSON_KIND_TEXT_ON_LIGHT,
  personKindFromHat,
  type PersonKindChip,
} from "@/lib/ui/person-kind-chip";

export function PersonKindBadge({
  kind,
  className,
  label,
  surface = "theme",
}: {
  kind: PersonKindChip;
  className?: string;
  label?: string;
  /** `light` when the row is a forced pale or solid fill, even in dark mode. */
  surface?: "theme" | "light";
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 text-[10px] font-semibold uppercase tracking-wide",
        surface === "light" ? PERSON_KIND_CHIP_ON_LIGHT[kind] : PERSON_KIND_CHIP_CLASS[kind],
        className,
      )}
    >
      {label ?? PERSON_KIND_LABEL[kind]}
    </Badge>
  );
}

export function PersonKindText({
  kind,
  className,
  children,
  surface = "theme",
}: {
  kind: PersonKindChip;
  className?: string;
  children?: ReactNode;
  surface?: "theme" | "light";
}) {
  return (
    <span
      className={cn(
        "font-semibold",
        surface === "light" ? PERSON_KIND_TEXT_ON_LIGHT[kind] : PERSON_KIND_TEXT_CLASS[kind],
        className,
      )}
    >
      {children ?? PERSON_KIND_LABEL[kind]}
    </span>
  );
}

/** Hats on a known-person row. Guest uses the participant sky chip. */
export function KnownPersonKindLine({
  hats,
  guest,
  detail,
}: {
  hats: PersonHat[];
  guest?: boolean;
  detail?: string | null;
}) {
  const kinds: PersonKindChip[] = [];
  for (const hat of hats) {
    const kind = personKindFromHat(hat, guest);
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {kinds.map((kind) => (
        <PersonKindBadge key={kind} kind={kind} />
      ))}
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </span>
  );
}

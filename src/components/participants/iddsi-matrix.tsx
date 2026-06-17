import { useMemo } from "react";
import { IDDSI_LIQUIDS, IDDSI_FOODS, type IddsiTrack } from "@/lib/iddsi";
import { cn } from "@/lib/utils";

interface Props {
  liquids: number;
  foods: number;
  onChange?: (next: { liquids: number; foods: number }) => void;
  readOnly?: boolean;
}

export function IddsiMatrix({ liquids, foods, onChange, readOnly = false }: Props) {
  const update = (track: IddsiTrack, level: number) => {
    if (readOnly || !onChange) return;
    onChange({ liquids: track === "liquids" ? level : liquids, foods: track === "foods" ? level : foods });
  };

  return (
    <div className="space-y-6">
      <Row
        title="Liquids"
        subtitle="Levels 0 – 4"
        levels={IDDSI_LIQUIDS}
        selected={liquids}
        onSelect={(l) => update("liquids", l)}
        readOnly={readOnly}
      />
      <Row
        title="Foods"
        subtitle="Levels 3 – 7"
        levels={IDDSI_FOODS}
        selected={foods}
        onSelect={(l) => update("foods", l)}
        readOnly={readOnly}
      />
    </div>
  );
}

function Row({
  title,
  subtitle,
  levels,
  selected,
  onSelect,
  readOnly,
}: {
  title: string;
  subtitle: string;
  levels: typeof IDDSI_LIQUIDS;
  selected: number;
  onSelect: (l: number) => void;
  readOnly: boolean;
}) {
  const current = useMemo(() => levels.find((l) => l.level === selected), [levels, selected]);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        {current && (
          <div className="text-xs text-muted-foreground">
            Current: <span className="font-medium text-foreground">L{current.level} · {current.name}</span>
          </div>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={`IDDSI ${title.toLowerCase()} level`}
        className="grid grid-cols-5 gap-2"
      >
        {levels.map((l) => {
          const active = l.level === selected;
          return (
            <button
              key={l.level}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={readOnly}
              onClick={() => onSelect(l.level)}
              className={cn(
                "group flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border-2 px-2 py-2 text-center transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-foreground shadow-sm"
                  : "border-border hover:border-foreground/40",
                l.swatch,
                l.text,
                readOnly && "cursor-not-allowed opacity-70",
              )}
            >
              <span className="text-base font-bold leading-none">L{l.level}</span>
              <span className="text-[10px] font-medium uppercase leading-tight tracking-wide">
                {l.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

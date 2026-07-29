/**
 * Floor arrival/departure method selection (embedded chip + big-row confirm).
 * Used by Day Centre and Event Deliver — not Event Manage office.
 * UI Style Guide: "Floor row embedded method override".
 */
import type { EventBusRunOption } from "@/lib/event-bus-runs";

/** `independent` = Day Centre departure vector only (not Event return). */
export type FloorTransportKind = "bus" | "self" | "independent";

/** Day Centre chip uses Admin displayName; Event uses R1/R2 shortLabel. */
export type FloorBusLabelStyle = "dayCentre" | "event";

export type FloorTransportSelection = {
  kind: FloorTransportKind;
  /** Admin bus_runs.code when kind=bus; null = legacy single bus. */
  busRunCode: string | null;
  /** Short label for the embedded chip: Self, R1, Run 1, … */
  label: string;
};

export type FloorMethodPickerOption = {
  id: string;
  kind: FloorTransportKind;
  busRunCode: string | null;
  title: string;
  subtitle?: string;
  label: string;
};

export function floorSelectionKey(s: FloorTransportSelection): string {
  if (s.kind === "self") return "self";
  if (s.kind === "independent") return "independent";
  return `bus:${s.busRunCode ?? ""}`;
}

export function selectionsEqual(
  a: FloorTransportSelection,
  b: FloorTransportSelection,
): boolean {
  return floorSelectionKey(a) === floorSelectionKey(b);
}

export function busChipLabel(
  opt: EventBusRunOption,
  style: FloorBusLabelStyle,
): string {
  return style === "event" ? opt.shortLabel : opt.displayName;
}

export function matchBusRunFromLabel(
  label: string,
  busRunOpts: EventBusRunOption[],
): EventBusRunOption | null {
  const p = label.trim().toLowerCase();
  if (!p) return null;
  return (
    busRunOpts.find(
      (o) =>
        o.code.toLowerCase() === p ||
        o.shortLabel.toLowerCase() === p ||
        o.displayName.toLowerCase() === p,
    ) ?? null
  );
}

/** Planned selection from a schedule transport label (Day Centre). */
export function selectionFromScheduleLabel(
  label: string | null | undefined,
  busRunOpts: EventBusRunOption[],
  style: FloorBusLabelStyle,
  isSelfLabel: (raw: string | null | undefined) => boolean,
): FloorTransportSelection {
  const raw = (label ?? "").trim();
  if (!raw || isSelfLabel(raw)) {
    return { kind: "self", busRunCode: null, label: "Self" };
  }
  const opt = matchBusRunFromLabel(raw, busRunOpts);
  if (opt) {
    return {
      kind: "bus",
      busRunCode: opt.code,
      label: busChipLabel(opt, style),
    };
  }
  return { kind: "bus", busRunCode: null, label: raw || "Bus" };
}

/** Planned selection from event roster mode + run code. */
export function selectionFromEventMode(
  mode: "bus" | "self" | string | null | undefined,
  busRunCode: string | null | undefined,
  busRunOpts: EventBusRunOption[],
): FloorTransportSelection {
  if ((mode ?? "bus") === "self") {
    return { kind: "self", busRunCode: null, label: "Self" };
  }
  const code = (busRunCode ?? "").trim() || null;
  if (!code) {
    if (busRunOpts.length === 1) {
      return {
        kind: "bus",
        busRunCode: busRunOpts[0].code,
        label: busRunOpts[0].shortLabel,
      };
    }
    return { kind: "bus", busRunCode: null, label: "Bus" };
  }
  const opt = busRunOpts.find((o) => o.code === code);
  return {
    kind: "bus",
    busRunCode: code,
    label: opt?.shortLabel ?? code,
  };
}

export function buildBusSelfPickerOptions(
  busRunOpts: EventBusRunOption[],
  style: FloorBusLabelStyle,
  opts?: {
    busTitlePrefix?: string;
    selfTitle?: string;
    selfSubtitle?: string;
  },
): FloorMethodPickerOption[] {
  const busTitlePrefix = opts?.busTitlePrefix ?? "Bus";
  const selfTitle = opts?.selfTitle ?? "Self / family";
  const selfSubtitle = opts?.selfSubtitle ?? "Not on the bus";
  const busOptions: FloorMethodPickerOption[] =
    busRunOpts.length === 0
      ? [
          {
            id: "bus",
            kind: "bus",
            busRunCode: null,
            title: busTitlePrefix,
            subtitle: "Centre / event bus",
            label: "Bus",
          },
        ]
      : busRunOpts.map((opt) => ({
          id: `bus:${opt.code}`,
          kind: "bus" as const,
          busRunCode: opt.code,
          title: `${busTitlePrefix} ${busChipLabel(opt, style)}`,
          subtitle: style === "event" ? opt.displayName : opt.shortLabel,
          label: busChipLabel(opt, style),
        }));

  return [
    ...busOptions,
    {
      id: "self",
      kind: "self",
      busRunCode: null,
      title: selfTitle,
      subtitle: selfSubtitle,
      label: "Self",
    },
  ];
}

/** Start of local calendar day. */
export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function parseISODateLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? startOfDay(d) : null;
}

export function parseExpiryBase(value: string | Date | null | undefined): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return startOfDay(value);
  }
  if (typeof value === "string") {
    const parsed = parseISODateLocal(value);
    if (parsed) return parsed;
  }
  return startOfDay();
}

export type ExpiryPreset = "3m" | "6m" | "1y" | "custom";

export function addMonthsLocal(base: Date, months: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setMonth(d.getMonth() + months);
  return startOfDay(d);
}

export function addYearsLocal(base: Date, years: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setFullYear(d.getFullYear() + years);
  return startOfDay(d);
}

export function computePresetExpiry(base: Date, preset: Exclude<ExpiryPreset, "custom">): Date {
  switch (preset) {
    case "3m":
      return addMonthsLocal(base, 3);
    case "6m":
      return addMonthsLocal(base, 6);
    case "1y":
      return addYearsLocal(base, 1);
  }
}

export function defaultNextExpiry(base: Date): Date {
  return computePresetExpiry(base, "1y");
}

/** Match a date to a preset offset from base, else custom. */
export function detectExpiryPreset(base: Date, value: Date | undefined): ExpiryPreset {
  if (!value) return "1y";
  const iso = toISODate(startOfDay(value));
  for (const preset of ["3m", "6m", "1y"] as const) {
    if (toISODate(computePresetExpiry(base, preset)) === iso) return preset;
  }
  return "custom";
}

export const EXPIRY_PRESET_OPTIONS: Array<{
  value: Exclude<ExpiryPreset, "custom">;
  label: string;
}> = [
  { value: "1y", label: "1 year" },
  { value: "6m", label: "6 months" },
  { value: "3m", label: "3 months" },
];

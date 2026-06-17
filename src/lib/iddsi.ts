// IDDSI (International Dysphagia Diet Standardisation Initiative) reference data.
// Liquids: Level 0 (Thin) → Level 4 (Extremely Thick).
// Foods:   Level 3 (Liquidised) → Level 7 (Regular / Easy to chew).
// Levels 3 and 4 overlap between liquids and foods in the official framework;
// we expose them on the relevant scale only to keep coordinator UI unambiguous.

export type IddsiTrack = "liquids" | "foods";

export interface IddsiLevel {
  level: number;
  name: string;
  short: string;
  // Tailwind class fragments using semantic IDDSI tokens defined in styles.css.
  swatch: string; // background
  text: string; // foreground on swatch
}

export const IDDSI_LIQUIDS: IddsiLevel[] = [
  { level: 0, name: "Thin",             short: "L0", swatch: "bg-iddsi-0", text: "text-iddsi-0-fg" },
  { level: 1, name: "Slightly Thick",   short: "L1", swatch: "bg-iddsi-1", text: "text-iddsi-1-fg" },
  { level: 2, name: "Mildly Thick",     short: "L2", swatch: "bg-iddsi-2", text: "text-iddsi-2-fg" },
  { level: 3, name: "Moderately Thick", short: "L3", swatch: "bg-iddsi-3", text: "text-iddsi-3-fg" },
  { level: 4, name: "Extremely Thick",  short: "L4", swatch: "bg-iddsi-4", text: "text-iddsi-4-fg" },
];

export const IDDSI_FOODS: IddsiLevel[] = [
  { level: 3, name: "Liquidised",       short: "L3", swatch: "bg-iddsi-3", text: "text-iddsi-3-fg" },
  { level: 4, name: "Pureed",           short: "L4", swatch: "bg-iddsi-4", text: "text-iddsi-4-fg" },
  { level: 5, name: "Minced & Moist",   short: "L5", swatch: "bg-iddsi-5", text: "text-iddsi-5-fg" },
  { level: 6, name: "Soft & Bite-Sized",short: "L6", swatch: "bg-iddsi-6", text: "text-iddsi-6-fg" },
  { level: 7, name: "Regular",          short: "L7", swatch: "bg-iddsi-7", text: "text-iddsi-7-fg" },
];

export function iddsiLevel(track: IddsiTrack, level: number): IddsiLevel | undefined {
  const source = track === "liquids" ? IDDSI_LIQUIDS : IDDSI_FOODS;
  return source.find((l) => l.level === level);
}

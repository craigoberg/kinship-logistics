import type { RygeSeverity } from "@/lib/api/site-issues";

/** RYGE severity pill selectors — Log Anomaly, maintenance add, etc. (BL-060) */
export const RYGE_SEVERITY_CHIPS: Array<{
  value: RygeSeverity;
  label: string;
  /** @deprecated Use idleClass / activeClass with explicit cn() — data-state is Radix-only. */
  classes: string;
  /** Classes when this chip is NOT selected. */
  idleClass: string;
  /** Classes when this chip IS selected. */
  activeClass: string;
}> = [
  {
    value: "green",
    label: "Green · No action",
    idleClass:   "border-green-600/50 bg-green-600/10 text-green-500 hover:bg-green-600/20",
    activeClass: "border-green-600   bg-green-600    text-white",
    classes:     "border-green-600/60 bg-green-600/10 text-green-700 data-[state=on]:bg-green-600 data-[state=on]:text-white",
  },
  {
    value: "yellow",
    label: "Yellow · Workaround in place",
    idleClass:   "border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20",
    activeClass: "border-yellow-400   bg-yellow-400    text-black",
    classes:     "border-yellow-500/60 bg-yellow-500/10 text-yellow-700 data-[state=on]:bg-yellow-400 data-[state=on]:text-black",
  },
  {
    value: "red",
    label: "Red · Manager escalation",
    idleClass:   "border-red-600/50 bg-red-600/10 text-red-500 hover:bg-red-600/20",
    activeClass: "border-red-600   bg-red-600    text-white",
    classes:     "border-red-600/60 bg-red-600/10 text-red-700 data-[state=on]:bg-red-600 data-[state=on]:text-white",
  },
];

/** Submit button tailwind by selected severity (Log Anomaly footer). */
export const RYGE_SUBMIT_BUTTON_CLASS: Record<RygeSeverity, string> = {
  green: "bg-green-600 hover:bg-green-700",
  yellow: "bg-yellow-500 hover:bg-yellow-600 text-black",
  red: "bg-red-600 hover:bg-red-700",
};

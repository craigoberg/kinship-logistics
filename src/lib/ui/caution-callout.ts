/**
 * High-contrast caution / warning callouts (office + field).
 * Never use text-amber-900 / text-amber-950 alone — unreadable in dark mode.
 * See UI-STYLE-GUIDE “Caution callout”.
 */

/** Outer banner / panel chrome */
export const CAUTION_CALLOUT_CLASS =
  "rounded-lg border border-amber-500/50 bg-amber-500/15 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100";

/** Icon on a caution callout */
export const CAUTION_CALLOUT_ICON_CLASS =
  "shrink-0 text-amber-700 dark:text-amber-300";

/** Secondary body line inside a caution callout */
export const CAUTION_CALLOUT_BODY_CLASS =
  "text-amber-900/95 dark:text-amber-50/95";

/** Compact inline strip (e.g. under a day header) */
export const CAUTION_STRIP_CLASS =
  "border-b border-amber-500/40 bg-amber-500/15 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/20 dark:text-amber-100";

/** Outline badge — unmet caution (needs action) */
export const CAUTION_BADGE_CLASS =
  "border-amber-600/60 bg-amber-500/20 text-amber-900 dark:border-amber-400/60 dark:bg-amber-500/25 dark:text-amber-100";

/** Outline badge — caution satisfied / success */
export const CAUTION_OK_BADGE_CLASS =
  "border-emerald-600/50 bg-emerald-500/15 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100";

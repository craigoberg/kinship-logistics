/**
 * In-app Help content model (BL-105).
 *
 * v1 ships `howto` only. `policy` / `form` are reserved for BL-092 / BL-065.
 * Soft role filtering uses ACCESS_ROLES keys today; BL-002 hardens later.
 */

export type HelpKind = "howto" | "policy" | "form";

export interface HelpStep {
  heading: string;
  body: string;
}

export interface HelpTopic {
  /** Stable slug, e.g. "manifest-start-run". */
  id: string;
  kind: HelpKind;
  title: string;
  summary: string;
  /** Extra search terms beyond title/summary/steps. */
  keywords: string[];
  /** Align with menu-access matrix keys: manifest, day, governance, … */
  menus: string[];
  /** ACCESS_ROLES keys, or "all". Managers always see every topic. */
  roles: string[] | "all";
  steps: HelpStep[];
  relatedIds?: string[];
  /** Reserved — SharePoint / external policy PDF (BL-092 / BL-051). */
  externalUrl?: string;
  /** Reserved — deep-link into an online form route (BL-065). */
  formRoute?: string;
}

export interface HelpAreaChip {
  key: string;
  label: string;
}

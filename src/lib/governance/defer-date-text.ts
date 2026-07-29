import {
  formatDate,
  isValidRegionalDateText,
  parseRegionalDateText,
} from "@/lib/utils";

/** Display text for defer date inputs — canonical `dd-Mmm-yy`. */
export function formatDeferDateText(date: Date | undefined): string {
  if (!date) return "";
  const text = formatDate(date);
  return text === "—" ? "" : text;
}

export const parseDeferDateText = parseRegionalDateText;
export const isValidDeferDateText = isValidRegionalDateText;

import { resolveStaffDisplayName } from "@/lib/data-store";

/** Automated trip-day / roll Hub copy (legacy + current). */
const AUTOMATED_DESC_RE =
  /\[AUTOMATED_RED\]|\[(?:EVENING|MORNING)\s*ROLL\]|\[CURFEW\]|\[MORNING\]|\[TRIP ABSENT\]/i;

/** Resolve reporter id or free-text to a display name for Hub cards. */
export function hubReporterDisplay(
  reportedBy?: string | null,
  issueDescription?: string | null,
): string | null {
  const raw = String(reportedBy ?? "").trim();
  if (raw) {
    if (/^system$/i.test(raw)) return "System";
    if (/^[0-9a-f-]{36}$/i.test(raw)) {
      const name = resolveStaffDisplayName(raw);
      // Auth UUID that is not a staff row → "Unknown staff"; treat automated as System.
      if (name === "Unknown staff" && issueDescription && AUTOMATED_DESC_RE.test(issueDescription)) {
        return "System";
      }
      return name;
    }
    return raw;
  }
  if (issueDescription && AUTOMATED_DESC_RE.test(issueDescription)) {
    return "System";
  }
  return null;
}

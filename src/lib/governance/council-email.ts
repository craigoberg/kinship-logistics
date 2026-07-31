/** Default Council escalate mailto template (Admin + runtime fallback). */
export const DEFAULT_COUNCIL_EMAIL_TEMPLATE = {
  subject: "Council Maintenance Request — {severity}",
  body:
    "Hello Council Maintenance,\n\n" +
    "We are logging a {severity} maintenance request from the Day Centre.\n\n" +
    "Issue: {description}\n" +
    "Current workaround: {workaround}\n" +
    "Expected resolution by (per contract SLA): {deadline}\n\n" +
    "Please confirm receipt and ETA.\n\nThank you,\nDay Centre Operations",
} as const;

export const COUNCIL_EMAIL_PARAM_KEYS = [
  "site_management.council_email_to",
  "site_management.council_email_from",
  "site_management.council_email_template",
  "site_management.council_sla_hours",
] as const;

/** True when the string looks like a usable email address. */
export function isCouncilEmailAddress(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v.includes("@") && v.length >= 5;
}

/**
 * Effective From for mailto:
 * - Admin shared mailbox when set
 * - otherwise null → open mailto as normal (operator's mail account)
 */
export function resolveCouncilMailtoFrom(
  configuredFrom: string | null | undefined,
): string | null {
  const shared = (configuredFrom ?? "").trim();
  return isCouncilEmailAddress(shared) ? shared : null;
}

/**
 * Plain issue text for Council mailto — strip internal tags like
 * `[AUTOMATED_RED]` and Hub context suffixes. Council only needs the issue body.
 */
export function cleanCouncilIssueText(text: string | null | undefined): string {
  let t = (text ?? "").trim();
  // Leading operational tags (may be stacked).
  while (/^\[[^\]]+\]\s*/.test(t)) {
    t = t.replace(/^\[[^\]]+\]\s*/, "");
  }
  // Trailing `[Event: … · Filed from: …]` (or either part alone).
  const ctx = t.match(
    /\s*\[(?:Event:\s*[^·\]]+?\s*·\s*)?(?:Filed from:\s*[^\]]+?\s*)?\]\s*$/i,
  );
  if (ctx) {
    t = t.slice(0, t.length - ctx[0].length).trim();
  }
  return t.trim();
}

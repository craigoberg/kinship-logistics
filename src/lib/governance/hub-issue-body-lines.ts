/** Structured issue body for Governance Hub list cards (Human + Maintenance). */

export type HubListSeverity = "red" | "yellow" | "green";

export interface HubIssueBodyLines {
  issue: string;
  authorisingManager: string | null;
  plan: string | null;
  workaround: string | null;
  /**
   * Public web voice (and similar): Issue preview only — hide empty
   * Workaround even when the Hub severity is Yellow.
   */
  issueOnly?: boolean;
}

const EMPTY = "—";

function stripDecorativePrefixes(text: string): string {
  return text
    .replace(/^\[VERBAL WORKAROUND\]\s*/i, "")
    .replace(/^\[INCIDENT\]\s*/i, "")
    .replace(/^\[AUTOMATED_RED\]\s*/i, "")
    .replace(/^\[ATTENDANCE\]\s*/i, "")
    .trim();
}

function stripContextSuffix(text: string): string {
  const match = text.match(
    /\s*\[(?:Event:\s*([^·\]]+?)\s*·\s*)?(?:Filed from:\s*([^\]]+?)\s*)?\]$/,
  );
  if (!match) return text;
  const idx = text.lastIndexOf(" [");
  return idx > 0 ? text.slice(0, idx).trim() : text;
}

function cleanPrimary(text: string): string {
  return stripContextSuffix(stripDecorativePrefixes(text)).trim();
}

function parseRedSegments(text: string): {
  issue: string;
  authorisingManager: string | null;
  plan: string | null;
} {
  const t = cleanPrimary(text);

  const authPlan = t.match(
    /^(.+?)\s*—\s*Authorising Manager:\s*(.+?)\.\s*Plan:\s*(.+)$/i,
  );
  if (authPlan) {
    return {
      issue: authPlan[1].trim(),
      authorisingManager: authPlan[2].trim(),
      plan: authPlan[3].trim(),
    };
  }

  const consulted = t.match(
    /^(.+?)\s*—\s*Consulted:\s*(.+?)\.\s*Outcome:\s*(.+?)\.\s*(.*)$/is,
  );
  if (consulted) {
    const tail = consulted[4].trim();
    const plan = tail || consulted[3].trim();
    return {
      issue: consulted[1].trim(),
      authorisingManager: consulted[2].trim(),
      plan: plan || null,
    };
  }

  const parts = t.split(/\s*—\s*/);
  if (parts.length > 1) {
    return {
      issue: parts[0].trim(),
      authorisingManager: null,
      plan: parts.slice(1).join(" — ").trim() || null,
    };
  }

  return { issue: t || EMPTY, authorisingManager: null, plan: null };
}

export interface ParseHubIssueBodyArgs {
  severity: HubListSeverity | null;
  /** Full description or combined text. */
  primaryText: string;
  /** Short title when distinct from description (maintenance). */
  titleText?: string | null;
  /** DB workaround_plan when available (site_issues_register). */
  workaroundPlan?: string | null;
}

/**
 * Severity-driven body lines for Hub list cards:
 *   Green  → Issue only
 *   Yellow → Issue + Workaround
 *   Red    → Issue + Authorising manager + Plan (always three lines; empty → "—")
 */
export function parseHubIssueBody(args: ParseHubIssueBodyArgs): HubIssueBodyLines {
  const sev = args.severity ?? "green";
  const title = (args.titleText ?? "").trim();
  const primary = (args.primaryText ?? "").trim();
  const workaroundFromDb = (args.workaroundPlan ?? "").trim() || null;

  if (sev === "red") {
    const source = primary || title;
    const parsed = parseRedSegments(source);
    return {
      issue: parsed.issue || title || EMPTY,
      authorisingManager: parsed.authorisingManager,
      plan: parsed.plan,
      workaround: null,
    };
  }

  if (sev === "yellow") {
    const cleaned = cleanPrimary(primary || title);
    const issue = title && title !== primary ? title : cleaned.split(/\n/)[0]?.trim() || cleaned;
    const workaround =
      workaroundFromDb ||
      (title && primary && primary !== title ? cleanPrimary(primary) : null) ||
      null;
    return {
      issue: issue || EMPTY,
      authorisingManager: null,
      plan: null,
      workaround,
    };
  }

  // Green — issue line only (Human + Maintenance)
  const issue = title || cleanPrimary(primary) || EMPTY;
  return {
    issue,
    authorisingManager: null,
    plan: null,
    workaround: null,
  };
}

/** Display value — never blank on RED rows. */
export function hubBodyDisplay(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : EMPTY;
}

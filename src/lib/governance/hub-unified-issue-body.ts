import type { UnifiedIssue } from "@/lib/api/unified-issues";
import {
  parseHubIssueBody,
  type HubIssueBodyLines,
} from "@/lib/governance/hub-issue-body-lines";

export function unifiedIssueBodyLines(issue: UnifiedIssue): HubIssueBodyLines {
  const raw = (issue.raw ?? {}) as Record<string, unknown>;
  const workaroundPlan =
    typeof raw.workaround_plan === "string" ? raw.workaround_plan : null;

  return parseHubIssueBody({
    severity: issue.severity,
    primaryText: issue.description || issue.title,
    workaroundPlan,
  });
}

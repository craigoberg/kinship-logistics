import { IssueRegisterCard } from "@/components/issue-engine/issue-register-card";
import type { SiteIssue } from "@/lib/api/site-issues";

/** Day Centre site issue, drawn with the shared register card. */
export function IssuesRegisterCard({ issue }: { issue: SiteIssue }) {
  return (
    <IssueRegisterCard
      issue={{
        severity: issue.severity,
        occurredAt: issue.occurredAt,
        loggedAt: issue.createdAt,
        description: issue.issueDescription,
        workaroundPlan: issue.workaroundPlan,
        councilOwned: issue.owner === "council",
        councilNotified: issue.emailDispatchedToCouncil,
        resolved: issue.status === "resolved",
        workaroundAccepted: issue.status === "workaround_accepted",
        workaroundAcceptedAt: issue.workaroundAcceptedAt,
        resolvedAt: issue.resolvedAt,
      }}
    />
  );
}

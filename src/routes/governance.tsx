import { createFileRoute } from "@tanstack/react-router";
import {
  GovernanceHubWorkspace,
  type HubTab,
} from "@/components/admin/governance-hub-workspace";

const HUB_TABS: HubTab[] = ["issues", "maintenance", "assets", "app_tickets"];

export const Route = createFileRoute("/governance")({
  validateSearch: (s: Record<string, unknown>) => ({
    issue: typeof s.issue === "string" && s.issue.length > 0 ? s.issue : undefined,
    tab:
      typeof s.tab === "string" && HUB_TABS.includes(s.tab as HubTab)
        ? (s.tab as HubTab)
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Governance Hub — Yada Connect" },
      { name: "description", content: "Review human incidents, maintenance, compliance, and app tickets." },
    ],
  }),
  component: GovernancePage,
});

function GovernancePage() {
  const { issue, tab } = Route.useSearch();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Governance Hub
        </h1>
        <p className="text-sm text-muted-foreground">
          Review human incidents, track maintenance &amp; repairs, manage compliance renewals, and close app tickets.
        </p>
      </header>
      <GovernanceHubWorkspace openIssueId={issue} initialTab={tab} />
    </div>
  );
}

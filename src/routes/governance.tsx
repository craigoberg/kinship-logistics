import { createFileRoute } from "@tanstack/react-router";
import { GovernanceHubWorkspace } from "@/components/admin/governance-hub-workspace";

export const Route = createFileRoute("/governance")({
  validateSearch: (s: Record<string, unknown>) => ({
    issue: typeof s.issue === "string" && s.issue.length > 0 ? s.issue : undefined,
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
  const { issue } = Route.useSearch();
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
      <GovernanceHubWorkspace openIssueId={issue} />
    </div>
  );
}

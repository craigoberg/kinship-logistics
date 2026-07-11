import { createFileRoute } from "@tanstack/react-router";
import { GovernanceHubWorkspace } from "@/components/admin/governance-hub-workspace";

export const Route = createFileRoute("/governance")({
  head: () => ({
    meta: [
      { title: "Governance Hub — Yada Connect" },
      { name: "description", content: "Review human incidents, track maintenance & repairs, and manage compliance renewals." },
    ],
  }),
  component: GovernancePage,
});

function GovernancePage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Governance Hub
        </h1>
        <p className="text-sm text-muted-foreground">
          Review human incidents, track maintenance &amp; repairs, and manage compliance renewals across fleet, venues, and staff.
        </p>
      </header>
      <GovernanceHubWorkspace />
    </div>
  );
}

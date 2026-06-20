import { createFileRoute } from "@tanstack/react-router";
import { GovernanceHubWorkspace } from "@/components/admin/governance-hub-workspace";

export const Route = createFileRoute("/governance")({
  head: () => ({
    meta: [
      { title: "Governance Hub — Yada Connect" },
      { name: "description", content: "Manage the Compliance Governance registry: assets, renewals, and exception thresholds." },
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
          Manage the Compliance Governance registry powering the dashboard.
        </p>
      </header>
      <GovernanceHubWorkspace />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AdminLookupWorkspace } from "@/components/admin/admin-lookup-workspace";
import { SystemParameterWorkspace } from "@/components/admin/system-parameter-workspace";
import { GovernanceHubWorkspace } from "@/components/admin/governance-hub-workspace";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type AdminTab = "lookups" | "parameters" | "governance";

function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("lookups");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage lookup parameters, tunable system thresholds, and the
          Compliance Governance registry powering the dashboard.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="lookups">Lookups</TabsTrigger>
          <TabsTrigger value="parameters">System Parameters</TabsTrigger>
          <TabsTrigger value="governance">Governance Hub</TabsTrigger>
        </TabsList>
        <TabsContent value="lookups">
          <AdminLookupWorkspace />
        </TabsContent>
        <TabsContent value="parameters">
          <SystemParameterWorkspace />
        </TabsContent>
        <TabsContent value="governance">
          <GovernanceHubWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  );
}

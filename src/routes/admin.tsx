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

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const [tab, setTab] = useState<"lookups" | "parameters">("lookups");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage lookup parameters and tunable system thresholds powering the
          dashboard and operational hooks.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="lookups">Lookups</TabsTrigger>
          <TabsTrigger value="parameters">System Parameters</TabsTrigger>
        </TabsList>
        <TabsContent value="lookups">
          <AdminLookupWorkspace />
        </TabsContent>
        <TabsContent value="parameters">
          <SystemParameterWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  );
}

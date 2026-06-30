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
import { MenuAccessMatrix } from "@/components/admin/menu-access-matrix";
import { CentreOperatingHoursWorkspace } from "@/components/admin/centre-operating-hours-workspace";
import { FleetRegisterWorkspace } from "@/components/admin/fleet-register-workspace";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type AdminTab = "lookups" | "fleet" | "parameters" | "hours" | "access";

function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("lookups");
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage fleet vehicles, lookup parameters, tunable system thresholds, and role access.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="lookups">Lookups</TabsTrigger>
          <TabsTrigger value="fleet">Fleet Register</TabsTrigger>
          <TabsTrigger value="parameters">System Parameters</TabsTrigger>
          <TabsTrigger value="hours">Centre Operating Hours</TabsTrigger>
          <TabsTrigger value="access">Menu Access</TabsTrigger>
        </TabsList>
        <TabsContent value="lookups">
          <AdminLookupWorkspace />
        </TabsContent>
        <TabsContent value="fleet">
          <FleetRegisterWorkspace />
        </TabsContent>
        <TabsContent value="parameters">
          <SystemParameterWorkspace />
        </TabsContent>
        <TabsContent value="hours">
          <CentreOperatingHoursWorkspace />
        </TabsContent>
        <TabsContent value="access">
          <MenuAccessMatrix />
        </TabsContent>
      </Tabs>
    </div>
  );
}


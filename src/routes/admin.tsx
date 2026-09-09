import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMenuAccess } from "@/hooks/use-menu-access";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AdminLookupWorkspace } from "@/components/admin/admin-lookup-workspace";
import { SystemParameterWorkspace } from "@/components/admin/system-parameter-workspace";
import { MenuAccessMatrix } from "@/components/admin/menu-access-matrix";
import { FleetRegisterWorkspace } from "@/components/admin/fleet-register-workspace";
import { VenuesWorkspace } from "@/components/admin/venues-workspace";
import { VendorsWorkspace } from "@/components/admin/vendors-workspace";
import { BackupRestoreWorkspace } from "@/components/admin/backup-restore-workspace";
import { PublicWebsiteWorkspace } from "@/components/admin/public-website-workspace";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminPage,
});

type AdminTab =
  | "lookups"
  | "fleet"
  | "venues"
  | "vendors"
  | "parameters"
  | "website"
  | "access"
  | "backup";

function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("lookups");
  const { canOpen, canEditMatrix } = useMenuAccess();
  const showWebsite = canOpen("public_website");
  const showAccess = canEditMatrix;

  useEffect(() => {
    if (tab === "website" && !showWebsite) setTab("lookups");
    if (tab === "access" && !showAccess) setTab("lookups");
  }, [tab, showWebsite, showAccess]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Configuration
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage fleet, venues, vendors, public website (yada.org.au), lookups, thresholds, role access, and backups.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="lookups">Lookups</TabsTrigger>
          <TabsTrigger value="fleet">Fleet Register</TabsTrigger>
          <TabsTrigger value="venues">Venues</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          {showWebsite ? (
            <TabsTrigger value="website">Public website</TabsTrigger>
          ) : null}
          <TabsTrigger value="parameters">System Parameters</TabsTrigger>
          {showAccess ? (
            <TabsTrigger value="access">Menu Access</TabsTrigger>
          ) : null}
          <TabsTrigger value="backup">Backup &amp; Restore</TabsTrigger>
        </TabsList>
        <TabsContent value="lookups">
          <AdminLookupWorkspace />
        </TabsContent>
        <TabsContent value="fleet">
          <FleetRegisterWorkspace />
        </TabsContent>
        <TabsContent value="venues">
          <VenuesWorkspace />
        </TabsContent>
        <TabsContent value="vendors">
          <VendorsWorkspace />
        </TabsContent>
        {showWebsite ? (
          <TabsContent value="website">
            <PublicWebsiteWorkspace />
          </TabsContent>
        ) : null}
        <TabsContent value="parameters">
          <SystemParameterWorkspace />
        </TabsContent>
        {showAccess ? (
          <TabsContent value="access">
            <MenuAccessMatrix />
          </TabsContent>
        ) : null}
        <TabsContent value="backup">
          <BackupRestoreWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  );
}


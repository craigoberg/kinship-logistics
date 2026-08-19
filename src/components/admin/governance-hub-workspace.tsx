import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnifiedIssuesPanel } from "./unified-issues-panel";
import { ComplianceAssetsPanel } from "./compliance-assets-panel";
import { MaintenancePanel } from "./maintenance-panel";
import { AppTicketsPanel } from "./app-tickets-panel";

type HubTab = "issues" | "maintenance" | "assets" | "app_tickets";

export function GovernanceHubWorkspace(props: {
  openIssueId?: string | null;
}) {
  const { openIssueId } = props;
  const [hubTab, setHubTab] = useState<HubTab>("issues");
  const [manageAssetId, setManageAssetId] = useState<string | null>(null);

  return (
    <Tabs
      value={hubTab}
      onValueChange={(v) => setHubTab(v as HubTab)}
      className="space-y-4"
    >
      <TabsList className="flex h-auto flex-wrap">
        <TabsTrigger value="issues">Human Incidents</TabsTrigger>
        <TabsTrigger value="maintenance">Maintenance &amp; Repairs</TabsTrigger>
        <TabsTrigger value="assets">Compliance &amp; Renewals</TabsTrigger>
        <TabsTrigger value="app_tickets">App tickets</TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className="space-y-4">
        <UnifiedIssuesPanel
          openIssueId={openIssueId}
          onManageRenewal={(assetId) => {
            setManageAssetId(assetId);
            setHubTab("assets");
          }}
        />
      </TabsContent>

      <TabsContent value="maintenance" className="space-y-4">
        <MaintenancePanel />
      </TabsContent>

      <TabsContent value="assets" className="space-y-4">
        <ComplianceAssetsPanel
          externalManageAssetId={manageAssetId}
          onExternalManageHandled={() => setManageAssetId(null)}
        />
      </TabsContent>

      <TabsContent value="app_tickets" className="space-y-4">
        <AppTicketsPanel />
      </TabsContent>
    </Tabs>
  );
}

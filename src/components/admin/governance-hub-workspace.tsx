import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnifiedIssuesPanel } from "./unified-issues-panel";
import { ComplianceAssetsPanel } from "./compliance-assets-panel";
import { MaintenancePanel } from "./maintenance-panel";

type HubTab = "issues" | "maintenance" | "assets";

export function GovernanceHubWorkspace() {
  const [hubTab, setHubTab] = useState<HubTab>("issues");
  const [manageAssetId, setManageAssetId] = useState<string | null>(null);

  return (
    <Tabs
      value={hubTab}
      onValueChange={(v) => setHubTab(v as HubTab)}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="issues">Human Incidents</TabsTrigger>
        <TabsTrigger value="maintenance">Maintenance &amp; Repairs</TabsTrigger>
        <TabsTrigger value="assets">Compliance &amp; Renewals</TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className="space-y-4">
        <UnifiedIssuesPanel
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
    </Tabs>
  );
}

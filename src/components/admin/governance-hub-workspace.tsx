import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnifiedIssuesPanel } from "./unified-issues-panel";
import { ComplianceAssetsPanel } from "./compliance-assets-panel";

export function GovernanceHubWorkspace() {
  const [hubTab, setHubTab] = useState<"issues" | "assets">("issues");
  const [manageAssetId, setManageAssetId] = useState<string | null>(null);

  return (
    <Tabs
      value={hubTab}
      onValueChange={(v) => setHubTab(v as "issues" | "assets")}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="issues">Open Issues</TabsTrigger>
        <TabsTrigger value="assets">Compliance Assets</TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className="space-y-4">
        <UnifiedIssuesPanel
          onManageRenewal={(assetId) => {
            setManageAssetId(assetId);
            setHubTab("assets");
          }}
        />
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

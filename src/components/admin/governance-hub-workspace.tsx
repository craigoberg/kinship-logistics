import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnifiedIssuesPanel } from "./unified-issues-panel";
import { ComplianceAssetsPanel } from "./compliance-assets-panel";
import { MaintenancePanel } from "./maintenance-panel";
import { AppTicketsPanel } from "./app-tickets-panel";
import { OnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";

export type HubTab = "issues" | "maintenance" | "assets" | "app_tickets" | "onboarding";

export function GovernanceHubWorkspace(props: {
  openIssueId?: string | null;
  initialTab?: HubTab;
}) {
  const { openIssueId, initialTab } = props;
  const [hubTab, setHubTab] = useState<HubTab>(() => {
    if (openIssueId) return "issues";
    return initialTab ?? "issues";
  });
  const [manageAssetId, setManageAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (openIssueId) {
      setHubTab("issues");
      return;
    }
    if (initialTab) setHubTab(initialTab);
  }, [openIssueId, initialTab]);

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
        <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
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

      <TabsContent value="onboarding" className="space-y-4">
        <OnboardingWorkspace />
      </TabsContent>

      <TabsContent value="app_tickets" className="space-y-4">
        <AppTicketsPanel />
      </TabsContent>
    </Tabs>
  );
}

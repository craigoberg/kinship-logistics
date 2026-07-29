import type { MaintenanceItem } from "@/lib/api/maintenance";
import {
  parseHubIssueBody,
  type HubIssueBodyLines,
} from "@/lib/governance/hub-issue-body-lines";

/** Maintenance list cards follow the same Green / Yellow / Red line rules as Human. */
export function maintenanceItemBodyLines(item: MaintenanceItem): HubIssueBodyLines {
  return parseHubIssueBody({
    severity: item.severity,
    primaryText: item.description,
    titleText: item.title,
  });
}

import type { UnifiedIssue } from "@/lib/api/unified-issues";
import { hubReporterDisplay } from "@/lib/governance/hub-reporter-display";
import {
  parsePublicFormHubText,
  publicFormLocationLabel,
} from "@/lib/governance/public-form-hub";

export interface HubIssueContextMeta {
  location: string | null;
  reporter: string | null;
  reference?: string | null;
}

/** Who / where for Human Incidents — shared by list cards and manage dialog. */
export function hubIssueContextMeta(issue: UnifiedIssue): HubIssueContextMeta {
  const raw = (issue.raw ?? {}) as Record<string, unknown>;
  const desc = String(raw.issue_description ?? issue.description ?? "");
  const reporter = hubReporterDisplay(String(raw.reported_by ?? ""), desc);

  const publicForm = parsePublicFormHubText(desc);
  if (publicForm) {
    return {
      location: publicFormLocationLabel(publicForm.channel),
      reporter: publicForm.from || reporter,
      reference: publicForm.referenceCode,
    };
  }

  if (issue.source === "incident") {
    const eventMatch = desc.match(/\[Event:\s*([^·\]]+)/);
    const filedMatch = desc.match(/Filed from:\s*([^\]]+)/);
    const eventName = eventMatch?.[1]?.trim() ?? null;
    const filedFrom = filedMatch?.[1]?.trim() ?? null;
    return {
      location: eventName ? `Event: ${eventName}` : filedFrom,
      reporter,
    };
  }

  if (issue.source === "escalation") {
    return {
      location: String(raw.vehicle_info ?? issue.subCategory ?? "").trim() || null,
      reporter: String(raw.driver_name ?? "").trim() || reporter,
    };
  }

  if (issue.source === "event") {
    // Badge may already be "Trip Day · Multi 1"
    const fromLabel = issue.sourceLabel?.replace(/^Trip Day\s*·\s*/i, "").trim();
    const fromDesc = desc.match(
      /\[(?:AUTOMATED_RED|CURFEW|EVENING ROLL|MORNING ROLL)\]\s*([^:]+?):/i,
    )?.[1]?.trim();
    const tripName = (fromLabel && fromLabel !== "Trip Day" ? fromLabel : null) || fromDesc;
    return {
      location: tripName ? `Trip Day · ${tripName}` : "Trip Day",
      reporter,
    };
  }

  if (issue.source === "day_centre") {
    return { location: "Day Centre", reporter };
  }

  return { location: null, reporter };
}

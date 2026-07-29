import type { HubIssueBodyLines, HubListSeverity } from "@/lib/governance/hub-issue-body-lines";
import { hubBodyDisplay } from "@/lib/governance/hub-issue-body-lines";

interface HubListCardBodyProps {
  lines: HubIssueBodyLines;
  severity: HubListSeverity | null;
}

function Label({ children }: { children: string }) {
  return <span className="font-medium text-foreground/80">{children}</span>;
}

/** Severity-structured issue body — shared Human Incidents + Maintenance cards. */
export function HubListCardBody({ lines, severity }: HubListCardBodyProps) {
  const sev = severity ?? "green";

  return (
    <div className="space-y-0.5 text-sm leading-snug">
      <p className="line-clamp-3">
        <Label>Issue:</Label> {hubBodyDisplay(lines.issue)}
      </p>
      {sev === "red" && (
        <>
          <p className="line-clamp-2">
            <Label>Authorising manager:</Label>{" "}
            {hubBodyDisplay(lines.authorisingManager)}
          </p>
          <p className="line-clamp-3">
            <Label>Plan:</Label> {hubBodyDisplay(lines.plan)}
          </p>
        </>
      )}
      {sev === "yellow" && (
        <p className="line-clamp-3">
          <Label>Workaround:</Label> {hubBodyDisplay(lines.workaround)}
        </p>
      )}
    </div>
  );
}

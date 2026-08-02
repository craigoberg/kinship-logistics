import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManageIssueDialog } from "@/components/admin/resolve-issue-dialog";
import type { UnifiedIssue } from "@/lib/api/unified-issues";

/** Minimal shape from site_issues_register / Day Centre blocking rows. */
export type DayCentreManageableIssue = {
  id: string;
  severity: string;
  status: string | null;
  issueDescription?: string | null;
  issue_description?: string | null;
  createdAt?: string;
  created_at?: string;
  eventId?: string | null;
  event_id?: string | null;
};

function toUnifiedIssue(row: DayCentreManageableIssue): UnifiedIssue {
  const desc = (
    row.issueDescription ??
    row.issue_description ??
    ""
  ).trim();
  const createdAt =
    row.createdAt ?? row.created_at ?? new Date().toISOString();
  const eventId = row.eventId ?? row.event_id ?? null;
  const sev = (row.severity ?? "").toLowerCase();
  const severity =
    sev === "red" || sev === "yellow" || sev === "green" ? sev : "red";
  return {
    key: `day_centre:${row.id}`,
    source: "day_centre",
    sourceLabel: "Day Centre",
    category: severity.toUpperCase(),
    subCategory: null,
    severity,
    title: (desc || "Day Centre anomaly").slice(0, 120),
    description: desc,
    status: row.status ?? "open",
    createdAt,
    occurredAt: createdAt,
    sourceRowId: row.id,
    eventId,
    raw: row,
    lastActivityAt: null,
    deferredUntil: null,
  };
}

interface Props {
  issue: DayCentreManageableIssue;
}

/** Opens the same Hub manage dialog used on Governance Hub — resolve / defer in place. */
export function DayCentreBlockingRedResolveButton({ issue }: Props) {
  const [open, setOpen] = useState(false);
  const unified = toUnifiedIssue(issue);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="mr-1 h-3.5 w-3.5" />
        Resolve
      </Button>

      <ManageIssueDialog
        key={unified.key}
        issue={unified}
        open={open}
        onOpenChange={setOpen}
        autoStartReview
      />
    </>
  );
}

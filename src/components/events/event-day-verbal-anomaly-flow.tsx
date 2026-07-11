/**
 * Event-day LogAnomalyModal + VerbalConsultationDialog (GUARDRAILS §3 / §12.6).
 *
 * RED hands off to remote verbal consultation (manager by name, operator PIN only),
 * then writes a `[VERBAL WORKAROUND]` row to site_issues_register for the event day.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { LogAnomalyModal } from "@/components/site-day/log-anomaly-modal";
import {
  VerbalConsultationDialog,
  formatVerbalWorkaroundDescription,
} from "@/components/issue-engine/verbal-consultation-dialog";
import { createIssue, type ResponsibilityOwner } from "@/lib/api/site-issues";
import { createMaintenanceItem, MAINTENANCE_ITEMS_KEY } from "@/lib/api/maintenance";
import { getStaffId, resolveStaffIdWithFallback, resolveStaffDisplayName } from "@/lib/data-store";

interface Props {
  eventId: string;
  eventTitle: string;
  eventDaySessionId: string;
  sessionDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventDayVerbalAnomalyFlow({
  eventId,
  eventTitle,
  eventDaySessionId,
  sessionDate,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const [verbalPending, setVerbalPending] = useState<{
    description: string;
    owner: ResponsibilityOwner;
  } | null>(null);

  const subjectLabel = `${eventTitle} · ${sessionDate}`;

  return (
    <>
      <LogAnomalyModal
        open={open}
        onOpenChange={onOpenChange}
        context={{
          kind: "event-day",
          eventId,
          eventDaySessionId,
          locationLabel: subjectLabel,
          onRedRequested: (description, owner) => {
            setVerbalPending({ description, owner });
          },
        }}
      />

      <VerbalConsultationDialog
        open={!!verbalPending}
        onOpenChange={(next) => {
          if (!next) setVerbalPending(null);
        }}
        ledgerCategory="TRIP"
        subjectLabel={subjectLabel}
        sourceId={eventDaySessionId}
        actionType="RED_VERBAL_CONSULTATION"
        titleOverride="RED Verbal Consultation & Log"
        descriptionOverride="A RED trip-day anomaly was identified. Select the manager you contacted (or attempted to reach), record the outcome, and sign with your operator PIN. The ticket lands in the Governance Hub immediately; the manager confirms later whether they were on-site or not."
        onAccepted={async (payload) => {
          // Snapshot pending before any async work — React may re-render and
          // clear verbalPending before the await resolves.
          const pending = verbalPending;
          if (!pending) return;

          const prefixed = formatVerbalWorkaroundDescription(pending.description, payload);

          try {
            const issue = await createIssue({
              sessionId: null,
              severity: "red",
              issueDescription: prefixed,
              workaroundPlan: payload.notes,
              owner: pending.owner,
              eventId,
              eventDaySessionId,
            });

            // RED venue issues also land in Maintenance & Repairs (§14.2).
            (async () => {
              try {
                const staffId = getStaffId() || (await resolveStaffIdWithFallback());
                const reporterName = resolveStaffDisplayName(staffId);
                await createMaintenanceItem({
                  title: pending.description.slice(0, 120),
                  description: pending.description,
                  severity: "red",
                  source: "venue_issue",
                  sourceRefId: issue.id,
                  eventId,
                  locationLabel: subjectLabel,
                  reportedBy: reporterName,
                });
                qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
              } catch (err) {
                console.error("[EventDayVerbalAnomalyFlow] maintenance_items mirror failed", err);
              }
            })();

            // Invalidate event-level issues cache (used by EventIssuesCard).
            qc.invalidateQueries({ queryKey: ["event-all-issues", eventId] });
            // Legacy session-scoped key — kept for any stale subscribers.
            qc.invalidateQueries({ queryKey: ["event-day-issues", eventDaySessionId] });
            // Also clear the blocking-RED gate and governance feeds.
            qc.invalidateQueries({ queryKey: ["event-day-issues-red-check", eventDaySessionId] });
            qc.invalidateQueries({ queryKey: ["governance-unified-issues"] });
            // Invalidate trip report so the issues section refreshes too.
            qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === "trip-report" });

            toast.success("RED verbal consultation logged on trip day.");
          } catch (err) {
            console.error("[EventDayVerbalAnomalyFlow] issue insert failed", err);
            toast.error("Verbal consultation logged to ledger, but Hub sync failed", {
              description: (err as Error).message,
            });
          }

          setVerbalPending(null);
        }}
      />
    </>
  );
}

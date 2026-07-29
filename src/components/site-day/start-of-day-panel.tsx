import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  DoorClosed,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { ManagerOpsChip } from "@/components/ui/manager-ops-chip";
import { SiteOpsDeclareSheet } from "@/components/ops/site-ops-declare-sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PinEntryTrigger } from "@/components/auth/pin-entry-dialog";
import { verifyOperatorPin } from "@/components/auth/pin-verify";
import { MandatedChecksList } from "./mandated-checks-list";
import { LogAnomalyModal } from "./log-anomaly-modal";
import { IssuesRegisterCard } from "./issues-register-card";
import {
  VerbalConsultationDialog,
  formatVerbalWorkaroundDescription,
} from "@/components/issue-engine/verbal-consultation-dialog";
import {
  openSession,
  countActiveSchedulesForToday,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { useMandatedChecks } from "@/hooks/use-system-parameters";
import { useActiveSiteIssues } from "@/hooks/use-site-issues";
import { useQuery } from "@tanstack/react-query";
import {
  fetchApprovedRedWorkarounds,
  isDayCentreScopedIssue,
  redHasAcceptedWorkaround,
} from "@/lib/site-day/red-workaround";
import { createMaintenanceItem, MAINTENANCE_ITEMS_KEY } from "@/lib/api/maintenance";
import {
  getStaffId,
  isActiveUserManager,
  resolveStaffIdWithFallback,
  resolveStaffDisplayName,
} from "@/lib/data-store";
import { sortSiteIssuesByRygeNewestFirst } from "@/lib/governance-sort";

interface Props {
  sessionId: string;
  reportedBy?: string;
}

function formatServerError(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === "string" && o.message) parts.push(o.message);
    if (typeof o.code === "string" && o.code) parts.push(`code: ${o.code}`);
    if (typeof o.details === "string" && o.details) parts.push(`details: ${o.details}`);
    if (typeof o.hint === "string" && o.hint) parts.push(`hint: ${o.hint}`);
    if (parts.length) return parts.join(" · ");
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function StartOfDayPanel({ sessionId }: Props) {
  if (!sessionId) {
    throw new Error("StartOfDayPanel requires a non-empty sessionId");
  }


  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openerPinVerified, setOpenerPinVerified] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [doNotOpenSheet, setDoNotOpenSheet] = useState(false);
  const [verbalOverrideOpen, setVerbalOverrideOpen] = useState(false);
  const isManager = isActiveUserManager();
  // Pending RED draft from LogAnomalyModal → opens the canonical Verbal dialog.
  const [verbalPending, setVerbalPending] = useState<{
    description: string;
    owner: "internal" | "council";
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const mandatedItems = useMandatedChecks();
  const allChecked =
    mandatedItems.length === 0 || ticked.size >= mandatedItems.length;

  // Same Day Centre feed as Active Day: today + prior open/workaround carry-over
  // so the opener sees what is already broken and any agreed plans.
  const issuesQ = useActiveSiteIssues(sessionId);
  const issues = issuesQ.data ?? [];
  const openIssues = issues.filter((i) => i.status !== "resolved");
  const dayScopedOpen = openIssues.filter(isDayCentreScopedIssue);

  // Pull manager-approved escalation workarounds as a fallback source of
  // truth when the issue row itself wasn't updated by the acceptance flow.
  const redIds = dayScopedOpen.filter((i) => i.severity === "red").map((i) => i.id);
  const redIdsKey = redIds.join(",");
  const escMapQ = useQuery({
    queryKey: ["site-day-red-escalation-workarounds", redIdsKey],
    queryFn: () => fetchApprovedRedWorkarounds(redIds),
    enabled: redIds.length > 0,
    staleTime: 5_000,
  });
  const escMap = escMapQ.data ?? null;
  const blockingIssues = dayScopedOpen.filter(
    (i) =>
      (i.severity === "red" && !redHasAcceptedWorkaround(i, escMap)) ||
      (i.severity === "yellow" && !i.workaroundPlan?.trim()),
  );
  const hasBlocking = blockingIssues.length > 0;
  const blockingHasRed = blockingIssues.some((i) => i.severity === "red");
  const registerIssues = sortSiteIssuesByRygeNewestFirst(dayScopedOpen);

  // Empty-Day Opening Shield — if no participants are rostered for today's
  // Sydney weekday code, the centre is not expected to open. The Open Centre
  // button still works (manager may run an administrative day), but the panel
  // renders a passive "no roster" notice instead of pretending there's a
  // missed-open anomaly.
  const rosterCountQ = useQuery({
    queryKey: ["centre-empty-day-shield", new Date().toDateString()],
    queryFn: () => countActiveSchedulesForToday(),
    staleTime: 60_000,
  });
  const isEmptyDay = (rosterCountQ.data ?? null) === 0;



  // PIN success opens immediately — do not gate on openerPinVerified state
  // (setState is async; mutate in the same tick would see a stale false).
  const openMut = useMutation({
    mutationFn: () => openSession(""),
    onSuccess: (next: SiteDaySession) => {
      setErrorMessage(null);
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      toast.success("Day Centre opened", {
        description: "Site declared safe & compliant.",
      });
      setConfirmOpen(false);
      setOpenerPinVerified(false);
    },
    onError: (e: unknown) => {
      const msg = formatServerError(e);
      setConfirmOpen(false);
      setOpenerPinVerified(false);
      setErrorMessage(msg);
      toast.error("Could not open the day", { description: msg });
    },
  });

  return (
    <section className="space-y-5">
      {/* Heading */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Start of Day Site Declaration
        </h2>
        <p className="text-sm text-muted-foreground">
          As an authorized Check Leader, please complete your physical
          walkthrough as per your signed Competency Onboarding guidelines
          (ensuring general safety, lock verification, and hazard checks are
          cleared). Affirm compliance below, or record specific anomalies to
          our Issues Register.
        </p>
      </div>

      {/* Empty-Day Opening Shield — passive notice, no anomaly raised. */}
      {isEmptyDay && (
        <div className="flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-blue-900 dark:text-blue-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <p>
            <span className="font-semibold">No participants rostered today.</span>{" "}
            The centre is not expected to open — no missed-open anomaly will be
            raised. Open below only if running an unscheduled administrative day.
          </p>
        </div>
      )}

      {/* MandatedChecksList */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <MandatedChecksList ticked={ticked} onTickedChange={setTicked} />
      </div>

      {/* Unticked hint */}
      {mandatedItems.length > 0 && !allChecked && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/60 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p>
            Tick each confirmation above. If any item is{" "}
            <span className="font-semibold">not</span> OK, use{" "}
            <span className="font-semibold">Log Anomalies</span> to raise a
            Yellow workaround or a Red escalation for Manager approval.
          </p>
        </div>
      )}

      {hasBlocking && (
        <Card className="space-y-3 border-2 border-red-600/60 bg-red-600/10 p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="space-y-1">
              <div className="text-base font-bold text-red-800 dark:text-red-200">
                Cannot open — {blockingIssues.length} issue
                {blockingIssues.length === 1 ? "" : "s"} still need a workaround
              </div>
              <p className="text-sm text-muted-foreground">
                See the register below. RED needs a Manager-agreed workaround in
                the Hub; YELLOW needs a workaround via Log Anomalies.
              </p>
            </div>
          </div>
          {blockingHasRed && (
            <Button asChild size="sm" className="bg-red-600 hover:bg-red-700">
              <Link to="/governance">
                Open Governance Hub
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          )}
        </Card>
      )}

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <p className="font-semibold">Could not open the day</p>
            <p className="whitespace-pre-wrap break-words font-mono text-xs">
              {errorMessage}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setErrorMessage(null);
                  setOpenerPinVerified(false);
                  setConfirmOpen(true);
                }}
                disabled={openMut.isPending}
              >
                Retry now
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setErrorMessage(null)}
                disabled={openMut.isPending}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Single RYG register — Red → Yellow → Green, newest first within each */}
      <Card className="space-y-3 border-2 border-yellow-500/60 bg-yellow-500/10 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
            <div className="space-y-1">
              <div className="text-base font-bold text-yellow-800 dark:text-yellow-200">
                Walkthrough Issues Register
                {registerIssues.length > 0 ? ` (${registerIssues.length})` : ""}
              </div>
              <p className="text-sm text-muted-foreground">
                All open Day Centre issues and workarounds (including prior days)
                — do not re-report what is already known. Sorted Red → Yellow →
                Green, newest first. Trip/event issues stay in the Hub only.
              </p>
            </div>
          </div>
          {issuesQ.isFetching && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>

        {issuesQ.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Could not load issues: {(issuesQ.error as Error).message}
          </div>
        )}

        {!issuesQ.isError && issuesQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading issues…
          </div>
        )}

        {!issuesQ.isError && !issuesQ.isLoading && registerIssues.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No open Day Centre issues. Use{" "}
            <span className="font-semibold">Log Anomalies / Action Needed</span>{" "}
            below to flag something new during the walkthrough.
          </p>
        )}

        {registerIssues.length > 0 && (
          <ul className="space-y-2">
            {registerIssues.map((i) => (
              <li key={i.id}>
                <IssuesRegisterCard issue={i} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Primary open action — full-width, turns green only when all checks confirmed */}
      <div className="space-y-3">
        <FieldActionButton
          variant={allChecked && !hasBlocking ? "success" : "secondary"}
          onClick={() => setConfirmOpen(true)}
          disabled={openMut.isPending || !allChecked || hasBlocking}
        >
          <span className="flex items-center justify-center gap-3">
            <ShieldCheck className="h-6 w-6 shrink-0" />
            Declare Site Safe &amp; Open Day Centre
          </span>
        </FieldActionButton>

        <FieldActionButton
          variant="caution"
          size="sm"
          onClick={() => setAnomalyOpen(true)}
        >
          <span className="flex items-center justify-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            Log Anomalies / Action Needed
            <span className="text-xs font-normal opacity-70">
              (Green note · Yellow workaround · Red escalation)
            </span>
          </span>
        </FieldActionButton>

        {isManager && (
          <ManagerOpsChip
            tone="caution"
            layout="stack"
            onClick={() => setDoNotOpenSheet(true)}
          >
            <DoorClosed className="h-4 w-4" />
            Do not open centre today
          </ManagerOpsChip>
        )}

        {/* High-trust escape hatch when a Manager is unreachable digitally.
            Writes an immutable VERBAL_AUTH_OVERRIDE ledger receipt. */}
        {hasBlocking && (
          <Button
            size="sm"
            variant="ghost"
            className="h-10 w-full justify-center gap-2 text-xs text-amber-700 hover:bg-amber-500/10 hover:text-amber-800"
            onClick={() => setVerbalOverrideOpen(true)}
          >
            ☎ Manager unreachable? Record verbal consultation
          </Button>
        )}
      </div>

      {/* PIN = declare safe & open — no second Confirm tap (field UX) */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (openMut.isPending) return;
          setConfirmOpen(open);
          if (!open) setOpenerPinVerified(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open the Day Centre?</AlertDialogTitle>
            <AlertDialogDescription>
              Enter your Check Leader PIN to declare the site safe and open for
              the day. That sign-off is the confirmation — identity and timestamp
              go to the operational ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Check Leader PIN <span className="text-rose-600">*</span>
            </Label>
            <PinEntryTrigger
              label="Tap to enter PIN and open"
              verified={openerPinVerified || openMut.isPending}
              verifiedLabel={openMut.isPending ? "Opening…" : "Check Leader PIN verified"}
              length={4}
              title="Declare site safe"
              description="PIN confirms the walkthrough is complete and opens the centre."
              required
              disabled={openMut.isPending}
              onVerify={verifyOperatorPin}
              onSuccess={() => {
                setOpenerPinVerified(true);
                openMut.mutate();
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={openMut.isPending}>
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* LogAnomalyModal */}
      <LogAnomalyModal
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
        context={{
          kind: "site-day",
          sessionId,
          onRedRequested: (description, owner) => {
            setVerbalPending({ description, owner });
          },
        }}
        defaultSeverity={
          mandatedItems.length > 0 && !allChecked ? "red" : "yellow"
        }
      />

      {/* Canonical RED path — remote verbal consultation */}
      <VerbalConsultationDialog
        open={!!verbalPending}
        onOpenChange={(o) => {
          if (!o) setVerbalPending(null);
        }}
        ledgerCategory="CENTRE"
        subjectLabel={`Day Centre · Session ${sessionId.slice(0, 8)}`}
        sourceId={sessionId}
        actionType="RED_VERBAL_CONSULTATION"
        titleOverride="RED Verbal Consultation & Log"
        descriptionOverride="A RED Day Centre anomaly was identified. Select the manager you contacted (or attempted to reach), record the outcome, and sign with your operator PIN. The ticket lands in the Governance Hub immediately; the manager confirms later."
        onAccepted={async (payload) => {
          if (!verbalPending) return;
          const prefixed = formatVerbalWorkaroundDescription(
            verbalPending.description,
            payload,
          );
          try {
            const { createIssue } = await import("@/lib/api/site-issues");
            const issue = await createIssue({
              sessionId,
              severity: "red",
              issueDescription: prefixed,
              workaroundPlan: payload.notes,
              owner: verbalPending.owner,
            });
            queryClient.invalidateQueries({ queryKey: ["site-issues", sessionId] });
            queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });

            // RED Day Centre walkround issues also land in Maintenance (§14.2).
            (async () => {
              try {
                const staffId = getStaffId() || (await resolveStaffIdWithFallback());
                const reporterName = resolveStaffDisplayName(staffId);
                await createMaintenanceItem({
                  title: verbalPending.description.slice(0, 120),
                  description: prefixed,
                  severity: "red",
                  source: "centre_issue",
                  sourceRefId: issue.id,
                  locationLabel: `Day Centre — Session ${sessionId.slice(0, 8)}`,
                  reportedBy: reporterName,
                });
                queryClient.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
              } catch (maintErr) {
                console.error("[StartOfDayPanel] maintenance_items mirror failed", maintErr);
              }
            })();
          } catch (err) {
            console.error("[StartOfDayPanel] verbal-workaround issue insert failed", err);
            toast.error("Verbal workaround logged to ledger, but Hub sync failed", {
              description: (err as Error).message,
            });
          }
          setVerbalPending(null);
        }}
      />

      {/* Open day despite blockers — remote verbal consultation receipt */}
      <VerbalConsultationDialog
        open={verbalOverrideOpen}
        onOpenChange={setVerbalOverrideOpen}
        ledgerCategory="CENTRE"
        subjectLabel={`Day Centre · Session ${sessionId.slice(0, 8)}`}
        sourceId={sessionId}
        actionType="VERBAL_AUTH_OVERRIDE"
        titleOverride="Verbal Consultation — Open Despite Blockers"
        descriptionOverride="Blocking issues remain. Select the manager you contacted (or attempted to reach), record the outcome, and sign with your operator PIN. The manager confirms in the Governance Hub later."
        onAccepted={() => {
          setConfirmOpen(true);
        }}
      />

      <SiteOpsDeclareSheet
        open={doNotOpenSheet}
        onOpenChange={setDoNotOpenSheet}
        kind="do_not_open"
        siteDaySessionId={sessionId}
      />
    </section>
  );
}

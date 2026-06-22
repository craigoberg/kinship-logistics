import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { ClientTime } from "@/components/ui/client-time";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MandatedChecksList } from "./mandated-checks-list";
import { LogAnomalyModal } from "./log-anomaly-modal";
import { IssuesRegisterCard } from "./issues-register-card";
import { VerbalAuthOverrideDialog } from "@/components/issue-engine/verbal-auth-override-dialog";
import {
  openSession,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { useMandatedChecks } from "@/hooks/use-system-parameters";
import { useSiteIssues } from "@/hooks/use-site-issues";
import { useQuery } from "@tanstack/react-query";
import {
  fetchApprovedRedWorkarounds,
  redHasAcceptedWorkaround,
  effectiveWorkaroundText,
} from "@/lib/site-day/red-workaround";

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
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [verbalOverrideOpen, setVerbalOverrideOpen] = useState(false);
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

  const issuesQ = useSiteIssues(sessionId);
  const issues = issuesQ.data ?? [];
  const openIssues = issues.filter((i) => i.status !== "resolved");

  // Pull manager-approved escalation workarounds as a fallback source of
  // truth when the issue row itself wasn't updated by the acceptance flow.
  const redIds = openIssues.filter((i) => i.severity === "red").map((i) => i.id);
  const redIdsKey = redIds.join(",");
  const escMapQ = useQuery({
    queryKey: ["site-day-red-escalation-workarounds", redIdsKey],
    queryFn: () => fetchApprovedRedWorkarounds(redIds),
    enabled: redIds.length > 0,
    staleTime: 5_000,
  });
  const escMap = escMapQ.data ?? null;

  const blockingIssues = openIssues.filter(
    (i) =>
      (i.severity === "red" && !redHasAcceptedWorkaround(i, escMap)) ||
      (i.severity === "yellow" && !i.workaroundPlan?.trim()),
  );
  const carriedIssues = openIssues.filter(
    (i) =>
      (i.severity === "red" && redHasAcceptedWorkaround(i, escMap)) ||
      (i.severity === "yellow" && !!i.workaroundPlan?.trim()),
  );
  const hasBlocking = blockingIssues.length > 0;
  const blockingHasRed = blockingIssues.some((i) => i.severity === "red");



  const openMut = useMutation({
    mutationFn: () => openSession(""),
    onSuccess: (next: SiteDaySession) => {
      setErrorMessage(null);
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      toast.success("Day Centre opened", {
        description: "Site declared safe & compliant.",
      });
      setConfirmOpen(false);
    },
    onError: (e: unknown) => {
      const msg = formatServerError(e);
      setConfirmOpen(false);
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
                Cannot open the Day Centre — unresolved issue
                {blockingIssues.length === 1 ? "" : "s"} without an agreed
                workaround
              </div>
              <p className="text-sm text-muted-foreground">
                RED items require a Manager-agreed workaround (or full
                resolution) via the Governance Hub. YELLOW items require a
                workaround recorded by the opener via Log Anomalies. Once every
                blocking item below has an accepted workaround or is resolved,
                the Open Centre workflow becomes available.
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {blockingIssues.map((i) => {
              const isRed = i.severity === "red";
              return (
                <li
                  key={i.id}
                  className={`flex items-start gap-2 rounded-md border bg-background/60 p-3 text-sm ${
                    isRed ? "border-red-600/40" : "border-yellow-500/50"
                  }`}
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                      isRed ? "bg-red-600" : "bg-yellow-600"
                    }`}
                  >
                    {isRed ? "RED" : "YELLOW"}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="break-words font-medium text-foreground">
                      {i.issueDescription || "(no description)"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Logged <ClientTime iso={i.createdAt} />
                      {i.status && i.status !== "open"
                        ? ` · status: ${i.status}`
                        : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

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

      {carriedIssues.length > 0 && (
        <Card className="space-y-3 border-2 border-yellow-500/60 bg-yellow-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
            <div className="space-y-1">
              <div className="text-base font-bold text-yellow-800 dark:text-yellow-200">
                Open issue{carriedIssues.length === 1 ? "" : "s"} carried with
                agreed workaround{carriedIssues.length === 1 ? "" : "s"}
              </div>
              <p className="text-sm text-muted-foreground">
                These items remain open but have an accepted workaround in
                place, so the Open Centre workflow may proceed. Each will stay
                visible in the Issues Register until fully resolved.
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {carriedIssues.map((i) => {
              const isRed = i.severity === "red";
              return (
                <li
                  key={i.id}
                  className={`flex items-start gap-2 rounded-md border bg-background/60 p-3 text-sm ${
                    isRed ? "border-red-600/40" : "border-yellow-500/50"
                  }`}
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                      isRed ? "bg-red-600" : "bg-yellow-600"
                    }`}
                  >
                    {isRed ? "RED" : "YELLOW"}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="break-words font-medium text-foreground">
                      {i.issueDescription || "(no description)"}
                    </div>
                    {effectiveWorkaroundText(i, escMap) && (
                      <div className="text-xs text-muted-foreground">
                        Workaround: {effectiveWorkaroundText(i, escMap)}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      Logged <ClientTime iso={i.createdAt} />
                      {i.status && i.status !== "open"
                        ? ` · status: ${i.status}`
                        : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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
                  openMut.mutate();
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

      {/* Walkthrough Issues Register */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Walkthrough Issues Register{" "}
            {openIssues.length > 0 && `(${openIssues.length} open)`}
          </h3>
          {issuesQ.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {issuesQ.isError && (
          <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                <div className="font-medium">
                  Could not load issues register.
                </div>
                <div className="text-xs">
                  {(issuesQ.error as Error).message}
                </div>
              </div>
            </div>
          </Card>
        )}

        {!issuesQ.isError && issuesQ.isLoading && (
          <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
            Loading walkthrough entries…
          </Card>
        )}

        {!issuesQ.isError && !issuesQ.isLoading && issues.length === 0 && (
          <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            No issues or notes logged yet. Use{" "}
            <span className="font-semibold">Log Anomalies / Action Needed</span>{" "}
            below to flag something during the walkthrough.
          </Card>
        )}

        <div className="space-y-2">
          {issues.map((i) => (
            <IssuesRegisterCard key={i.id} issue={i} />
          ))}
        </div>
      </div>

      {/* Primary open action — full-width, turns green only when all checks confirmed */}
      <div className="space-y-3">
        <Button
          size="lg"
          className={`h-16 w-full justify-center gap-3 text-base font-semibold transition-colors ${
            allChecked && !hasBlocking
              ? "bg-green-600 text-white hover:bg-green-700"
              : "bg-muted text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => setConfirmOpen(true)}
          disabled={openMut.isPending || !allChecked || hasBlocking}
        >
          <ShieldCheck className="h-6 w-6 shrink-0" />
          Declare Site Safe & Open Day Centre
        </Button>

        <Button
          size="lg"
          variant="outline"
          className="h-12 w-full justify-center gap-3 border-yellow-500/60 bg-yellow-500/5 text-sm hover:bg-yellow-500/10"
          onClick={() => setAnomalyOpen(true)}
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600" />
          Log Anomalies / Action Needed
          <span className="text-xs font-normal text-muted-foreground">
            (Green note · Yellow workaround · Red escalation)
          </span>
        </Button>

        {/* High-trust escape hatch when a Manager is unreachable digitally.
            Writes an immutable VERBAL_AUTH_OVERRIDE ledger receipt. */}
        {hasBlocking && (
          <Button
            size="sm"
            variant="ghost"
            className="h-10 w-full justify-center gap-2 text-xs text-amber-700 hover:bg-amber-500/10 hover:text-amber-800"
            onClick={() => setVerbalOverrideOpen(true)}
          >
            ☎ Manager unreachable? Record a Verbal Authorization Override
          </Button>
        )}
      </div>

      {/* Confirm AlertDialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open the Day Centre?</AlertDialogTitle>
            <AlertDialogDescription>
              You are declaring the site safe and compliant for the day. Your
              identity and timestamp will be appended to the operational
              ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={openMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                openMut.mutate();
              }}
              disabled={openMut.isPending}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {openMut.isPending ? "Opening…" : "Confirm & Open"}
            </AlertDialogAction>
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

      {/* Canonical RED path — Verbal Consultation & Log */}
      <VerbalAuthOverrideDialog
        open={!!verbalPending}
        onOpenChange={(o) => {
          if (!o) setVerbalPending(null);
        }}
        ledgerCategory="CENTRE"
        subjectLabel={`Day Centre · Session ${sessionId.slice(0, 8)}`}
        sourceId={sessionId}
        actionType="RED_VERBAL_WORKAROUND"
        titleOverride="RED Verbal Consultation & Log"
        descriptionOverride="A RED Day Centre anomaly was identified. Document the manager you spoke with offline, the agreed safety workaround, and sign with your operator PIN. The ticket lands in the Governance Hub immediately as 'Open — Operating via Verbal Workaround' and the session unblocks."
        onAccepted={async ({ managerName, reason }) => {
          if (!verbalPending) return;
          const prefixed = `[VERBAL WORKAROUND] ${verbalPending.description} — Authorising Manager: ${managerName}. Plan: ${reason}`;
          try {
            const { createIssue } = await import("@/lib/api/site-issues");
            await createIssue({
              sessionId,
              severity: "red",
              issueDescription: prefixed,
              workaroundPlan: reason,
              owner: verbalPending.owner,
            });
            queryClient.invalidateQueries({ queryKey: ["site-issues", sessionId] });
            queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });
          } catch (err) {
            console.error("[StartOfDayPanel] verbal-workaround issue insert failed", err);
            toast.error("Verbal workaround logged to ledger, but Hub sync failed", {
              description: (err as Error).message,
            });
          }
          setVerbalPending(null);
        }}
      />

      {/* Verbal Authorization Override — legacy "open day despite blockers" escape hatch. */}
      <VerbalAuthOverrideDialog
        open={verbalOverrideOpen}
        onOpenChange={setVerbalOverrideOpen}
        ledgerCategory="CENTRE"
        subjectLabel={`Day Centre · Session ${sessionId.slice(0, 8)}`}
        sourceId={sessionId}
        onAccepted={() => {
          setConfirmOpen(true);
        }}
      />
    </section>
  );
}

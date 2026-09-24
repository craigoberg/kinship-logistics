import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ClipboardCheck,
  Loader2,
  LogIn,
  LogOut,
  PlusCircle,
  RotateCcw,
  UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ClientTime } from "@/components/ui/client-time";
import { useActiveSiteIssues } from "@/hooks/use-site-issues";
import { closeSession, resetStartOfDay, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { TestOnly } from "@/components/dev/test-only";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { finalizeTodaysBilling } from "@/lib/api/myob-export";
import { IssuesRegisterCard } from "./issues-register-card";
import { LogAnomalyModal } from "./log-anomaly-modal";
import {
  VerbalConsultationDialog,
  formatVerbalWorkaroundDescription,
} from "@/components/issue-engine/verbal-consultation-dialog";
import { createIssue, type ResponsibilityOwner } from "@/lib/api/site-issues";
import { activeSiteIssuesKey, siteIssuesKey } from "@/hooks/use-site-issues";
import { isAuthError } from "@/lib/api/auth-errors";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { useAuthReady } from "@/hooks/use-auth-ready";
import { getActiveUserProfile, isActiveUserManager } from "@/lib/data-store";
import { sortSiteIssuesByRygeNewestFirst } from "@/lib/governance-sort";
import {
  AttendanceOverdueSweepHost,
  AttendanceRollPanel,
} from "./attendance-roll-panel";
import { DayCentreActivitiesPanel } from "./day-centre-activities-panel";
import { DayCentreClosureModal } from "./day-centre-closure-modal";
import { ManagerOpsChip } from "@/components/ui/manager-ops-chip";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { useQuery } from "@tanstack/react-query";
import {
  clearCentreLockdown,
  getCentreLockdown,
} from "@/lib/api/operational-emergency";

interface Props {
  session: SiteDaySession;
}

export function ActiveDayPanel({ session }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const isSignedIn = !!user || !!getActiveUserProfile();
  const issuesQ = useActiveSiteIssues(session.id);
  const reauthRetryRef = useRef(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const isManager = isActiveUserManager();
  const lockdownQ = useQuery({
    queryKey: ["site-lockdown", session.id],
    queryFn: () => getCentreLockdown(session.id),
    refetchInterval: 30_000,
  });
  const [authRecoveryMessage, setAuthRecoveryMessage] = useState<string | null>(null);
  // Pending RED draft awaiting verbal-consultation log.
  const [verbalPending, setVerbalPending] = useState<{
    description: string;
    owner: ResponsibilityOwner;
    occurredAt: string;
  } | null>(null);


  const resetMut = useMutation({
    mutationFn: () => resetStartOfDay("test: rewind to start of day"),
    onSuccess: (next) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
      queryClient.invalidateQueries({
        predicate: (q) => q.queryKey?.[0] === "site-day-activities",
      });
      toast.success("Session reset to Start of Day", {
        description:
          "Activities delivery rewound. Issues, escalations, attendance and billing are preserved.",
      });
    },
    onError: (e: Error) => {
      toast.error("Reset failed", { description: e.message });
    },
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const finalized = await finalizeTodaysBilling().catch(() => 0);
      const next = await closeSession("");
      return { next, finalized };
    },
    onSuccess: ({ next, finalized }) => {
      reauthRetryRef.current = false;
      setAuthRecoveryMessage(null);
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      toast.success("Day closed orderly.", {
        description: `${finalized} attendance row${finalized === 1 ? "" : "s"} flipped to billing-ready.`,
      });
      setCloseOpen(false);
    },
    onError: (e: Error) => {
      if (isAuthError(e)) {
        setCloseOpen(false);
        if (reauthRetryRef.current) {
          reauthRetryRef.current = false;
          setReauthOpen(false);
          setAuthRecoveryMessage(
            "Your PIN was accepted, but the Day Centre close request is still being rejected. Use Retry now for an immediate retry, or re-enter PIN again if a different authorised operator needs to take over.",
          );
          toast.error("Close still blocked after PIN re-entry", {
            description: "Retry now, or re-enter an authorised PIN and try again.",
          });
          return;
        }
        setAuthRecoveryMessage(null);
        setReauthOpen(true);
        toast.message("Authorisation check required — please re-enter your PIN.");
        return;
      }
      toast.error("Could not close the day", { description: e.message });
    },
  });

  const issues = issuesQ.data ?? [];
  const openIssues = sortSiteIssuesByRygeNewestFirst(
    issues.filter((i) => i.status !== "resolved"),
  );

  return (
    <section className="space-y-5">
      <AttendanceOverdueSweepHost sessionId={session.id} />
      {lockdownQ.data?.active ? (
        <div className="rounded-lg border border-amber-600/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-bold uppercase tracking-wide text-[11px]">
            Lockdown / early close
          </p>
          <p className="font-semibold">{lockdownQ.data.reason}</p>
          <p className="text-xs opacity-80">
            New arrivals blocked. Complete orderly close when everyone is
            accounted for.
          </p>
          {isManager ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-9"
              onClick={async () => {
                try {
                  const staffId = getActiveUserProfile()?.staffId ?? "";
                  await clearCentreLockdown({
                    siteDaySessionId: session.id,
                    managerStaffId: staffId,
                  });
                  void queryClient.invalidateQueries({
                    queryKey: ["site-lockdown", session.id],
                  });
                  toast.success("Lockdown cleared");
                } catch (e) {
                  toast.error("Could not clear lockdown", {
                    description: (e as Error).message,
                  });
                }
              }}
            >
              Clear lockdown flag
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Day Centre — Active
          </h2>
          {session.openDeclaredAt && (
            <p className="text-xs text-muted-foreground">
              Opened <ClientTime iso={session.openDeclaredAt} />
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <ManagerOpsChip tone="neutral" onClick={() => setAnomalyOpen(true)}>
            <PlusCircle className="h-4 w-4" /> Log anomaly
          </ManagerOpsChip>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11"
            onClick={() => {
              document
                .getElementById("day-centre-end-of-day-report")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            End of Day Report
          </Button>
          <FieldActionButton
            variant="primary"
            size="sm"
            fullWidth={false}
            onClick={() => setCloseOpen(true)}
          >
            <ClipboardCheck className="h-4 w-4" /> Initiate Day Centre Closure
          </FieldActionButton>

          <TestOnly>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-dashed border-amber-500/60 text-amber-700 hover:bg-amber-500/10"
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
              title="TEST ONLY — rewind today's session to Start of Day. Issues, attendance and billing are preserved."
            >
              {resetMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Reset Start of Day
              <span className="ml-1 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                Test
              </span>
            </Button>
          </TestOnly>
        </div>
      </div>

      {authRecoveryMessage && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">Authorisation still required</p>
              <p>{authRecoveryMessage}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAuthRecoveryMessage(null);
                    closeMut.mutate();
                  }}
                  disabled={closeMut.isPending}
                >
                  Retry now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setAuthRecoveryMessage(null);
                    setReauthOpen(true);
                  }}
                  disabled={closeMut.isPending}
                >
                  Re-enter PIN
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="check_in" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1">
          <TabsTrigger value="check_in" className="min-h-11 gap-1.5 text-xs sm:text-sm">
            <LogIn className="h-3.5 w-3.5 shrink-0" />
            Check-In
          </TabsTrigger>
          <TabsTrigger value="activities" className="min-h-11 gap-1.5 text-xs sm:text-sm">
            <UtensilsCrossed className="h-3.5 w-3.5 shrink-0" />
            Activities
          </TabsTrigger>
          <TabsTrigger value="check_out" className="min-h-11 gap-1.5 text-xs sm:text-sm">
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            Check-Out
          </TabsTrigger>
          <TabsTrigger value="issues" className="min-h-11 gap-1.5 text-xs sm:text-sm">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Issues
            {openIssues.length > 0 ? ` (${openIssues.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="check_in" className="mt-3 space-y-3">
          <AttendanceRollPanel sessionId={session.id} mode="check_in" />
        </TabsContent>
        <TabsContent value="activities" className="mt-3 space-y-3">
          <DayCentreActivitiesPanel sessionId={session.id} />
        </TabsContent>
        <TabsContent value="check_out" className="mt-3 space-y-3">
          <AttendanceRollPanel sessionId={session.id} mode="check_out" />
        </TabsContent>
        <TabsContent value="issues" className="mt-3 space-y-3">
      <div className="space-y-3">

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Issues Register {openIssues.length > 0 && `(${openIssues.length} open)`}
          </h3>
          {issuesQ.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Sorted Red → Yellow → Green, newest first within each. Trip/event
          issues stay in the Hub only.
        </p>

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

        {!issuesQ.isError && openIssues.length === 0 && (
          <Card className="border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            No active Day Centre issues. Use{" "}
            <span className="font-semibold">Log anomaly</span> above when
            something needs flagging. Prior-day Day Centre issues may carry
            over here — trip/event issues stay in the Hub only.
          </Card>
        )}

        <div className="space-y-2">
          {openIssues.map((i) => (
            <IssuesRegisterCard key={i.id} issue={i} />
          ))}
        </div>
      </div>
        </TabsContent>
      </Tabs>

      <DayCentreClosureModal
        open={closeOpen}
        onOpenChange={setCloseOpen}
        sessionId={session.id}
      />


      {isSignedIn && (
        <LogAnomalyModal
          open={anomalyOpen}
          onOpenChange={setAnomalyOpen}
          context={{
            kind: "site-day",
            sessionId: session.id,
            onRedRequested: (description, owner, meta) => {
              setVerbalPending({ description, owner, occurredAt: meta.occurredAt });
            },
          }}
        />
      )}

      <VerbalConsultationDialog
        open={!!verbalPending}
        onOpenChange={(o) => {
          if (!o) setVerbalPending(null);
        }}
        ledgerCategory="CENTRE"
        subjectLabel={`Day Centre · Session ${session.id.slice(0, 8)}`}
        sourceId={session.id}
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
            await createIssue({
              sessionId: session.id,
              severity: "red",
              issueDescription: prefixed,
              workaroundPlan: payload.notes,
              owner: verbalPending.owner,
              occurredAt: verbalPending.occurredAt,
            });
            queryClient.invalidateQueries({ queryKey: siteIssuesKey(session.id) });
            queryClient.invalidateQueries({ queryKey: activeSiteIssuesKey(session.id) });
            queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });
          } catch (err) {
            console.error("[ActiveDayPanel] verbal-workaround issue insert failed", err);
            toast.error("Verbal workaround logged to ledger, but Hub sync failed", {
              description: (err as Error).message,
            });
          }
          setVerbalPending(null);
        }}
      />

      <PinReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        reason="Re-authenticate to close the Day Centre."
        onAuthenticated={() => {
          reauthRetryRef.current = true;
          setAuthRecoveryMessage(null);
          setReauthOpen(false);
          closeMut.mutate();
        }}
      />
    </section>
  );
}

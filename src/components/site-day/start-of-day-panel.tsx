import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
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
import {
  ensureTodaySession,
  openSession,
  type SiteDaySession,
} from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { useMandatedChecks } from "@/hooks/use-system-parameters";
import { useSiteIssues } from "@/hooks/use-site-issues";
import { canManageSystemParameters } from "@/lib/api/system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";

interface Props {
  sessionId: string;
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
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const mandatedItems = useMandatedChecks();
  const allChecked =
    mandatedItems.length === 0 || ticked.size >= mandatedItems.length;

  const issuesQ = useSiteIssues(sessionId);
  const issues = issuesQ.data ?? [];
  const openIssues = issues.filter((i) => i.status !== "resolved");
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["site-day", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canManage = permissionQ.data === true;

  const openMut = useMutation({
    mutationFn: async () => {
      console.info("[StartOfDay] click → ensureTodaySession");
      const ensured = await ensureTodaySession();
      console.info("[StartOfDay] ensured row", ensured.id, ensured.phase);
      const next = await openSession("");
      console.info("[StartOfDay] openSession → phase", next.phase);
      return next;
    },
    onSuccess: (next: SiteDaySession) => {
      setErrorMessage(null);
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      toast.success("Day Centre opened", {
        description: "Site declared safe & compliant.",
      });
      setConfirmOpen(false);
    },
    onError: (e: unknown) => {
      console.error("[StartOfDay] openMut error", e);
      const msg = formatServerError(e);
      setConfirmOpen(false);
      setErrorMessage(msg);
      toast.error("Could not open the day", { description: msg });
    },
  });





  return (
    <section className="space-y-5">
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

      <div className="rounded-lg border border-border bg-card/40 p-4">
        <MandatedChecksList ticked={ticked} onTickedChange={setTicked} />
      </div>

      {mandatedItems.length > 0 && !allChecked && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/60 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <p>
            One or more mandated checks remain unticked — the site cannot be
            declared compliant. If a check has failed, tap{" "}
            <span className="font-semibold">Log Anomalies / Action Needed</span>{" "}
            below, select <span className="font-semibold">Red severity</span>,
            and a Manager will be paged for the Dual-PIN review.
          </p>
        </div>
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


      <div className="grid gap-3 md:grid-cols-2">
        <Button
          size="lg"
          className="h-auto justify-start gap-3 bg-green-600 px-5 py-4 text-left text-white hover:bg-green-700 disabled:bg-green-600/40"
          onClick={() => setConfirmOpen(true)}
          disabled={openMut.isPending || !allChecked}
        >
          <ShieldCheck className="h-6 w-6 shrink-0" />
          <span className="flex flex-col items-start">
            <span className="text-base font-semibold leading-tight">
              Declare Site Safe & Compliant
            </span>
            <span className="text-xs font-normal opacity-90">
              Green · Opens the Day Centre for clients
            </span>
          </span>
        </Button>

        <Button
          size="lg"
          variant="outline"
          className="h-auto justify-start gap-3 border-yellow-500/60 bg-yellow-500/5 px-5 py-4 text-left hover:bg-yellow-500/10"
          onClick={() => setAnomalyOpen(true)}
        >
          <AlertTriangle className="h-6 w-6 shrink-0 text-yellow-600" />
          <span className="flex flex-col items-start">
            <span className="text-base font-semibold leading-tight">
              Log Anomalies / Action Needed
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Yellow / Red · Workaround or escalation required
            </span>
          </span>
        </Button>
      </div>

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

      <LogAnomalyModal
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
        sessionId={sessionId}
        defaultSeverity={
          mandatedItems.length > 0 && !allChecked ? "red" : "yellow"
        }
      />

    </section>

  );
}

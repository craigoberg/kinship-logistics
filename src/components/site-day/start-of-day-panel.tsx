import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { openSession, type SiteDaySession } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

interface Props {
  sessionId: string;
}

export function StartOfDayPanel({ sessionId }: Props) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);

  const openMut = useMutation({
    mutationFn: () => openSession(""),
    onSuccess: (next: SiteDaySession) => {
      queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
      toast.success("Day Centre opened", {
        description: "Site declared safe & compliant.",
      });
      setConfirmOpen(false);
    },
    onError: (e: Error) => {
      toast.error("Could not open the day", { description: e.message });
    },
  });

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Start of Day Site Declaration
        </h2>
        <p className="text-sm text-muted-foreground">
          As the Check Leader, complete your physical walkthrough, then
          declare site status below. Anomalies route to the Issues Register
          for follow-up.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-4">
        <MandatedChecksList />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Button
          size="lg"
          className="h-auto justify-start gap-3 bg-green-600 px-5 py-4 text-left text-white hover:bg-green-700"
          onClick={() => setConfirmOpen(true)}
          disabled={openMut.isPending}
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
          disabled={openMut.isPending}
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
      />
    </section>
  );
}

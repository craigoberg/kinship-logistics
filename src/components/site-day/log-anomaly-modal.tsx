import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { usePersistedForm } from "@/hooks/use-persisted-form";
import {
  createIssue,
  type NewSiteIssue,
  type ResponsibilityOwner,
  type RygeSeverity,
} from "@/lib/api/site-issues";
import { siteIssuesKey } from "@/hooks/use-site-issues";
import { setPhase, ensureTodaySession } from "@/lib/api/site-day-sessions";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  defaultSeverity?: RygeSeverity;
}

interface AnomalyDraft {
  severity: RygeSeverity;
  description: string;
  workaround: string;
  owner: ResponsibilityOwner;
}

const makeInitial = (severity: RygeSeverity): AnomalyDraft => ({
  severity,
  description: "",
  workaround: "",
  owner: "internal",
});

const SEVERITY_CHIPS: Array<{
  value: RygeSeverity;
  label: string;
  classes: string;
}> = [
  {
    value: "green",
    label: "Green · No action",
    classes:
      "border-green-600/60 bg-green-600/10 text-green-700 data-[state=on]:bg-green-600 data-[state=on]:text-white",
  },
  {
    value: "yellow",
    label: "Yellow · Workaround in place",
    classes:
      "border-yellow-500/60 bg-yellow-500/10 text-yellow-700 data-[state=on]:bg-yellow-400 data-[state=on]:text-black",
  },
  {
    value: "red",
    label: "Red · Manager escalation",
    classes:
      "border-red-600/60 bg-red-600/10 text-red-700 data-[state=on]:bg-red-600 data-[state=on]:text-white",
  },
];

/**
 * Best-effort manager escalation notification. Frontend-only — the global
 * escalation interceptor + realtime channel on site_day_sessions handles
 * delivery. Kept as a small hook so we can swap to a notification router
 * later without touching the modal.
 */
function triggerEscalation(payload: {
  kind: "site_session";
  sessionId: string;
  issueId: string;
  description: string;
}) {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent("yada:escalation", { detail: payload }),
      );
    } catch {
      // ignore — informational broadcast only
    }
  }
}

export function LogAnomalyModal({
  open,
  onOpenChange,
  sessionId,
  defaultSeverity,
}: Props) {
  const queryClient = useQueryClient();
  const form = usePersistedForm<AnomalyDraft>(
    `site-day-anomaly:${sessionId || "bootstrap"}`,
    makeInitial(defaultSeverity ?? "yellow"),
  );
  const { values, setValues, reset, hasDraft, resumeDraft, discardDraft } =
    form;

  const requiresWorkaround =
    values.severity === "yellow" || values.severity === "red";
  const descriptionOk = values.description.trim().length > 0;
  const workaroundOk = !requiresWorkaround || values.workaround.trim().length > 0;

  const blockingErrors = useMemo(() => {
    const errs: string[] = [];
    if (!descriptionOk) errs.push("Issue Description is required.");
    if (!workaroundOk)
      errs.push(
        `${values.severity === "red" ? "Red" : "Yellow"} severity requires a Workaround Plan.`,
      );
    return errs;
  }, [descriptionOk, workaroundOk, values.severity]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: NewSiteIssue = {
        sessionId,
        severity: values.severity,
        issueDescription: values.description.trim(),
        workaroundPlan: values.workaround.trim() || null,
        owner: values.owner,
      };
      const issue = await createIssue(payload);
      if (values.severity === "red") {
        const next = await setPhase(sessionId, "escalated_lock");
        queryClient.setQueryData(SITE_SESSION_QUERY_KEY, next);
        triggerEscalation({
          kind: "site_session",
          sessionId,
          issueId: issue.id,
          description: issue.issueDescription,
        });
      }
      return issue;
    },
    onSuccess: (issue) => {
      queryClient.invalidateQueries({ queryKey: siteIssuesKey(sessionId) });
      reset();
      onOpenChange(false);
      if (issue.severity === "red") {
        toast.error("Red anomaly logged — site escalated for Manager review.", {
          description:
            "Manager must complete the dual-PIN handshake before the centre can open.",
        });
      } else if (issue.severity === "yellow") {
        toast.warning("Yellow anomaly logged.", {
          description: "Workaround captured in the Issues Register.",
        });
      } else {
        toast.success("Note added to the Issues Register.");
      }
    },
    onError: (e: Error) => {
      toast.error("Could not save the anomaly", { description: e.message });
    },
  });

  const canSubmit =
    descriptionOk && workaroundOk && !mutation.isPending;

  const handleClose = (next: boolean) => {
    if (mutation.isPending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Log Anomaly
          </DialogTitle>
          <DialogDescription>
            Capture an issue caught during the site walkthrough. Yellow and Red
            severities require a workaround. Red triggers a manager escalation.
          </DialogDescription>
        </DialogHeader>

        {hasDraft && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">Resume draft?</span> Unsaved entries
              were detected from a previous session.
            </span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={discardDraft}>
                Discard
              </Button>
              <Button size="sm" onClick={resumeDraft}>
                Resume
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Severity
            </Label>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_CHIPS.map((chip) => {
                const active = values.severity === chip.value;
                return (
                  <button
                    key={chip.value}
                    type="button"
                    data-state={active ? "on" : "off"}
                    onClick={() => setValues({ severity: chip.value })}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      chip.classes,
                    )}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="anomaly-desc"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Issue Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="anomaly-desc"
              rows={3}
              placeholder="e.g. Toilet 3 inoperable, locked out of service."
              value={values.description}
              onChange={(e) => setValues({ description: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="anomaly-work"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Workaround Plan{" "}
              {requiresWorkaround && (
                <span className="text-destructive">*</span>
              )}
            </Label>
            <Textarea
              id="anomaly-work"
              rows={3}
              placeholder={
                requiresWorkaround
                  ? "Required — e.g. Door locked, Toilets 1 & 2 in use, maintenance ticket #4421 raised."
                  : "Optional follow-up note."
              }
              value={values.workaround}
              onChange={(e) => setValues({ workaround: e.target.value })}
              className={cn(
                requiresWorkaround &&
                  !workaroundOk &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {requiresWorkaround && !workaroundOk && (
              <p className="text-xs text-destructive">
                A workaround is mandatory for Yellow and Red anomalies.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Owner
            </Label>
            <RadioGroup
              value={values.owner}
              onValueChange={(v) =>
                setValues({ owner: v as ResponsibilityOwner })
              }
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="internal" id="owner-int" />
                Internal team
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="council" id="owner-cnc" />
                Council maintenance
              </label>
            </RadioGroup>
          </div>

          {blockingErrors.length > 0 && (
            <ul className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {blockingErrors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className={cn(
              values.severity === "red" && "bg-red-600 hover:bg-red-700",
              values.severity === "yellow" &&
                "bg-yellow-500 text-black hover:bg-yellow-400",
            )}
          >
            {mutation.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            {values.severity === "red"
              ? "Log Red & Escalate"
              : values.severity === "yellow"
                ? "Log Yellow"
                : "Log Note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

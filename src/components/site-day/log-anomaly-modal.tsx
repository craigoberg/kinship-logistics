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
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
// OWNER selection removed — ground-level anomalies always default to
// `internal`. Council routing now happens in the Governance Hub.
import { cn } from "@/lib/utils";
import { usePersistedForm } from "@/hooks/use-persisted-form";
import {
  createIssue,
  type NewSiteIssue,
  type ResponsibilityOwner,
  type RygeSeverity,
} from "@/lib/api/site-issues";
import { siteIssuesKey, activeSiteIssuesKey } from "@/hooks/use-site-issues";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
// `raiseOperationalEscalation` + `setPhase` removed: RED no longer triggers a
// multi-device handshake. The local operator now opens a VerbalAuthOverrideDialog
// directly via the `onRedRequested` callback below.

/**
 * Reentrant Issue/Escalation modal — `context` selects the pipeline.
 *
 *   kind: "site-day"  → writes to site_issues_register, flips the session
 *                       phase to escalated_lock on Red, raises a
 *                       site_day_red escalation linked to the new row.
 *   kind: "pre-trip"  → no site_session in scope. Green/Yellow emit a
 *                       draft back to the caller for accumulation into
 *                       asset_clearance_items at commit time. Red raises a
 *                       bus_walkaround escalation immediately (classified
 *                       "pre_trip_red" in the ledger receipt) and lifts
 *                       the escalation id via onEscalated.
 *
 * Legacy `sessionId`-only call sites continue to work unchanged.
 */
export type AnomalyContext =
  | {
      kind: "site-day";
      sessionId: string;
      /**
       * Site-day RED: invoked instead of writing a site_issues_register row.
       * The parent panel opens VerbalAuthOverrideDialog and, on acceptance,
       * writes the `[VERBAL WORKAROUND]` open ticket itself.
       */
      onRedRequested?: (description: string, owner: ResponsibilityOwner) => void;
    }
  | {
      kind: "pre-trip";
      asset: { id: string; name: string; regoPlate: string };
      driverName: string;
      dateStr: string;
      onLogged?: (draft: {
        severity: RygeSeverity;
        description: string;
        workaround: string | null;
        owner: ResponsibilityOwner;
      }) => void;
      /** Pre-trip RED — parent opens VerbalAuthOverrideDialog. */
      onRedRequested?: (description: string, owner: ResponsibilityOwner) => void;
    }
  | {
      /**
       * Event-day coordinator context (§12.6).
       * Issues are written to site_issues_register with event_id and
       * event_day_session_id set. RED hands off to VerbalAuthOverrideDialog
       * via onRedRequested, same as site-day.
       */
      kind: "event-day";
      eventId: string;
      eventDaySessionId: string;
      onRedRequested?: (description: string, owner: ResponsibilityOwner) => void;
    };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Legacy shorthand for `{ kind: "site-day", sessionId }`. */
  sessionId?: string;
  context?: AnomalyContext;
  defaultSeverity?: RygeSeverity;
}

interface AnomalyDraft {
  severity: RygeSeverity;
  description: string;
  workaround: string;
}

// All floor-logged anomalies are owned by the internal team. Council
// routing is performed downstream from the Governance Hub.
const DEFAULT_OWNER: ResponsibilityOwner = "internal";

const makeInitial = (severity: RygeSeverity): AnomalyDraft => ({
  severity,
  description: "",
  workaround: "",
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

// `triggerEscalation` event broadcaster removed — RED now opens the local
// VerbalAuthOverrideDialog instead of dispatching a multi-device alert.

export function LogAnomalyModal({
  open,
  onOpenChange,
  sessionId,
  context: ctxProp,
  defaultSeverity,
}: Props) {
  // Resolve effective context. Default to site-day for backward compat.
  const context: AnomalyContext = ctxProp
    ? ctxProp
    : sessionId
      ? { kind: "site-day", sessionId }
      : (() => {
          throw new Error(
            "LogAnomalyModal requires either `context` or `sessionId`.",
          );
        })();

  const queryClient = useQueryClient();
  const storageKey =
    context.kind === "site-day"
      ? `site-day-anomaly:${context.sessionId}`
      : context.kind === "event-day"
        ? `event-day-anomaly:${context.eventDaySessionId}`
        : `pre-trip-anomaly:${context.asset.id}:${context.dateStr}`;
  const form = usePersistedForm<AnomalyDraft>(
    storageKey,
    makeInitial(defaultSeverity ?? "yellow"),
  );
  const { values, setValues, reset, hasDraft, resumeDraft, discardDraft } =
    form;

  // Workaround is mandatory only for Yellow. Red issues are escalated and the
  // Manager supplies the workaround / NO-GO reason during the handshake.
  // MASTER_GUARDRAILS §4.2 — 20-character minimum on operational text.
  const MIN_CHARS = 20;
  const requiresWorkaround = values.severity === "yellow";
  const showWorkaround = requiresWorkaround;
  const descriptionOk = values.description.trim().length >= MIN_CHARS;
  const workaroundOk =
    !requiresWorkaround || values.workaround.trim().length >= MIN_CHARS;

  const blockingErrors = useMemo(() => {
    const errs: string[] = [];
    if (!descriptionOk)
      errs.push(`Issue Description must be at least ${MIN_CHARS} characters.`);
    if (!workaroundOk)
      errs.push(`Yellow workaround must be at least ${MIN_CHARS} characters.`);
    return errs;
  }, [descriptionOk, workaroundOk]);

  const mutation = useMutation({
    mutationFn: async () => {
      const workaroundPlan =
        values.severity === "yellow" ? values.workaround.trim() : null;

      // ---------- Pre-trip context: no site_session in scope ----------
      if (context.kind === "pre-trip") {
        if (values.severity === "red") {
          // Single-user verbal flow: hand off to the parent to open the
          // VerbalAuthOverrideDialog. No DB writes here.
          context.onRedRequested?.(values.description.trim(), DEFAULT_OWNER);
          return { kind: "pre-trip", severity: "red" as RygeSeverity } as const;
        }

        context.onLogged?.({
          severity: values.severity,
          description: values.description.trim(),
          workaround: workaroundPlan,
          owner: DEFAULT_OWNER,
        });
        return { kind: "pre-trip", severity: values.severity } as const;
      }

      // ---------- Event-day context (§12.6) ----------
      if (context.kind === "event-day") {
        if (values.severity === "red") {
          context.onRedRequested?.(values.description.trim(), DEFAULT_OWNER);
          return { kind: "event-day-red" as const };
        }
        const issue = await createIssue({
          sessionId: null,
          severity: values.severity,
          issueDescription: values.description.trim(),
          workaroundPlan,
          owner: DEFAULT_OWNER,
          eventId: context.eventId,
          eventDaySessionId: context.eventDaySessionId,
        });
        return { kind: "event-day" as const, issue, eventDaySessionId: context.eventDaySessionId };
      }

      // ---------- Site-day context (default / legacy) ----------
      const sId = context.sessionId;

      if (values.severity === "red") {
        // Single-user verbal flow: parent opens VerbalAuthOverrideDialog and,
        // on acceptance, writes the `[VERBAL WORKAROUND]` site_issues_register
        // ticket. The session phase is NOT flipped to `escalated_lock`.
        context.onRedRequested?.(values.description.trim(), DEFAULT_OWNER);
        return { kind: "site-day-red" as const };
      }

      const payload: NewSiteIssue = {
        sessionId: sId,
        severity: values.severity,
        issueDescription: values.description.trim(),
        workaroundPlan,
        owner: DEFAULT_OWNER,
      };
      const issue = await createIssue(payload);
      return { kind: "site-day" as const, issue };
    },
    onSuccess: (result) => {
      if (result.kind === "site-day-red" || result.kind === "event-day-red") {
        // Parent opens VerbalAuthOverrideDialog; just close the modal.
        reset();
        onOpenChange(false);
        return;
      }
      if (result.kind === "event-day") {
        queryClient.invalidateQueries({ queryKey: ["event-day-issues", result.eventDaySessionId] });
        queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });
        toast.success(`${result.issue.severity.toUpperCase()} issue logged on event day.`);
        reset();
        onOpenChange(false);
        return;
      }
      if (result.kind === "site-day") {
        const issue = result.issue;
        const sId = (context as Extract<AnomalyContext, { kind: "site-day" }>).sessionId;
        queryClient.invalidateQueries({ queryKey: siteIssuesKey(sId) });
        queryClient.invalidateQueries({ queryKey: activeSiteIssuesKey(sId) });
        queryClient.invalidateQueries({ queryKey: ["site-issues", sId] });
        queryClient.invalidateQueries({ queryKey: ["site-issues"] });
        queryClient.invalidateQueries({ queryKey: ["site-issues-active"] });
        queryClient.invalidateQueries({ queryKey: ["site-day-anomalies"] });
        queryClient.invalidateQueries({ queryKey: ["governance-unified-issues"] });
        queryClient.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
        queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return (
              typeof k === "string" &&
              (k.startsWith("site-issues") || k.startsWith("site-day"))
            );
          },
        });
        queryClient.refetchQueries({ queryKey: siteIssuesKey(sId) });
        reset();
        onOpenChange(false);
        if (issue.severity === "yellow") {
          toast.warning("Yellow anomaly logged.", {
            description: "Workaround captured in the Issues Register.",
          });
        } else {
          toast.success("Note added to the Issues Register.");
        }
      } else {
        // pre-trip
        reset();
        onOpenChange(false);
        if (result.severity === "red") {
          toast.warning("Red pre-trip issue — verbal consultation required.", {
            description:
              "Document the manager's verbal workaround and sign it with your operator PIN.",
          });
        } else if (result.severity === "yellow") {
          toast.warning("Yellow pre-trip issue captured.", {
            description: "Workaround will be filed with the clearance record.",
          });
        } else {
          toast.success("Pre-trip note captured.");
        }
      }
    },
    onError: (e: Error) => {
      toast.error("Could not save the anomaly", { description: e.message });
    },
  });


  const canSubmit = descriptionOk && workaroundOk && !mutation.isPending;

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
                    onClick={() => {
                      if (chip.value === "yellow") {
                        setValues({ severity: "yellow" });
                      } else {
                        // Green and Red both clear any stale workaround draft.
                        setValues({ severity: chip.value, workaround: "" });
                      }
                    }}
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

          <CharacterCountedTextarea
            label="Issue Description"
            value={values.description}
            onValueChange={(v) => setValues({ description: v })}
            placeholder="e.g. Toilet 3 inoperable, locked out of service."
            rows={3}
            minChars={MIN_CHARS}
            required
          />

          {showWorkaround && (
            <CharacterCountedTextarea
              label="Workaround Plan"
              value={values.workaround}
              onValueChange={(v) => setValues({ workaround: v })}
              placeholder="Required — e.g. Door locked, Toilets 1 & 2 in use, maintenance ticket #4421 raised."
              rows={3}
              minChars={MIN_CHARS}
              required
              hint="Mandatory for Yellow anomalies"
            />
          )}

          {values.severity === "red" && (
            <div className="rounded-md border border-red-600/40 bg-red-600/5 p-3 text-xs text-red-700 dark:text-red-300">
              Red issues are escalated to a Manager. They will propose the
              workaround or NO-GO reason during the handshake — you don't need
              to fill one in here.
            </div>
          )}

          {/* OWNER selection removed. All ground-level anomalies are owned
              by the internal team; Council routing happens from the
              Governance Hub via "Escalate to Council". */}

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
            onClick={() => {
              mutation.mutate();
            }}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationToasts } from "@/lib/ui/operation-toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  appendUpdateNote,
  COUNCIL_SEVERITY_OPTIONS,
  deferUnifiedIssue,
  escalateUnifiedIssueToCouncil,
  forceAckEscalation,
  listIssueNotes,
  renderNoteLine,
  resolveUnifiedIssue,
  startUnifiedIssueReview,
  type CouncilSeverity,
  type UnifiedIssue,
} from "@/lib/api/unified-issues";
import {
  dispatchCouncilEmail,
  openCouncilMailto,
  type CouncilSlaCategory,
} from "@/lib/api/site-issues";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { HubContextMetaGrid } from "@/components/governance/hub-context-meta-grid";
import { ManageItemShell } from "@/components/governance/manage-item-shell";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
import { hubIssueContextMeta } from "@/lib/governance/hub-issue-context";
import {
  findHubReviewStartedNote,
  formatHubWaitDuration,
  isHubReviewStarted,
} from "@/lib/governance/hub-review-started";
import { isManagerProfile } from "@/lib/governance/is-manager";
import {
  deriveIssueWorkflowStatus,
  HUB_WORKFLOW_STATUS_BADGE,
  HUB_WORKFLOW_STATUS_LABEL,
} from "@/lib/governance/hub-workflow-status";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";
import { getExclusionByHubIssueId, type InfectiousExclusion } from "@/lib/api/infectious-exclusion";
import { InfectiousClearanceSheet } from "@/components/site-day/infectious-clearance-sheet";
import { isActiveUserManager } from "@/lib/data-store";
import {
  useCouncilEmailFrom,
  useCouncilEmailTemplate,
  useCouncilEmailTo,
  useCouncilSlaHours,
} from "@/hooks/use-system-parameters";
import { resolveCouncilMailtoFrom, cleanCouncilIssueText } from "@/lib/governance/council-email";
import { formatDate, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";

// ── Helpers for clean display ──────────────────────────────────────────────

/** Strip decorative prefixes that are meaningful in DB but noisy in the UI. */
function stripPrefixes(text: string): string {
  return text
    .replace(/^\[VERBAL WORKAROUND\]\s*/i, "")
    .replace(/^\[INCIDENT\]\s*/i, "")
    .replace(/^\[AUTOMATED_RED\]\s*/i, "")
    .replace(/^\[ATTENDANCE\]\s*/i, "")
    .replace(/^\[HEALTH & SAFETY\]\s*/i, "")
    .replace(/^\[INFECTIOUS EXCLUSION\]\s*/i, "")
    .trim();
}

/**
 * Parse the `[Event: X · Filed from: Y]` context suffix appended by
 * IncidentIntakeDialog. Returns the clean body text plus structured metadata.
 */
function parseContextSuffix(text: string): {
  cleanText: string;
  eventName: string | null;
  filedFrom: string | null;
} {
  // Match trailing [...] block containing Filed from or Event
  const match = text.match(
    /\s*\[(?:Event:\s*([^·\]]+?)\s*·\s*)?(?:Filed from:\s*([^\]]+?)\s*)?\]$/,
  );
  if (!match) return { cleanText: text, eventName: null, filedFrom: null };
  const idx = text.lastIndexOf(" [");
  return {
    cleanText: idx > 0 ? text.slice(0, idx).trim() : text,
    eventName: match[1]?.trim() || null,
    filedFrom: match[2]?.trim() || null,
  };
}

const SEV_BADGE: Record<string, string> = {
  red:    "bg-red-600 text-white",
  yellow: "bg-yellow-400 text-black",
  green:  "bg-emerald-600 text-white",
};

const SOURCE_LABEL_CLEAN: Record<string, string> = {
  incident:    "Human Incident",
  day_centre:  "Day Centre",
  event:       "Trip Day",
  escalation:  "Escalation",
  renewal:     "Renewal",
};

interface Props {
  issue: UnifiedIssue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, opening the dialog starts office review (Open → In Progress). */
  autoStartReview?: boolean;
}

function substituteCouncilTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => tokens[k] ?? `{${k}}`);
}

export function ManageIssueDialog({ issue, open, onOpenChange, autoStartReview = false }: Props) {
  const qc = useQueryClient();
  const councilEmailTo = useCouncilEmailTo();
  const councilEmailFrom = useCouncilEmailFrom();
  const councilTemplate = useCouncilEmailTemplate();
  const councilSlaHours = useCouncilSlaHours();
  const [note, setNote] = useState("");
  const [deferOn, setDeferOn] = useState(false);
  const [escalateOn, setEscalateOn] = useState(false);
  const [deferAt, setDeferAt] = useState<string>(defaultDeferIso());
  const [deferDatetimeValid, setDeferDatetimeValid] = useState(true);
  const [councilSev, setCouncilSev] = useState<CouncilSeverity>("Sev 2");
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"resolve" | "forceAck">("resolve");
  const [clearanceOpen, setClearanceOpen] = useState(false);
  const [activeExclusion, setActiveExclusion] = useState<InfectiousExclusion | null>(null);

  useEffect(() => {
    if (open) {
      setNote("");
      setDeferOn(false);
      setEscalateOn(false);
      setDeferAt(defaultDeferIso());
      setDeferDatetimeValid(true);
      setCouncilSev("Sev 2");
      setPinOpen(false);
      setClearanceOpen(false);
      setActiveExclusion(null);
    }
  }, [open]);

  const exclusionQuery = useQuery({
    queryKey: ["infectious-exclusion-by-hub", issue.sourceRowId],
    enabled:
      open &&
      (issue.source === "day_centre" || issue.source === "event") &&
      (issue.subCategory === "Health & Safety" ||
        issue.description.includes("[INFECTIOUS EXCLUSION]")),
    queryFn: () => getExclusionByHubIssueId(issue.sourceRowId),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (exclusionQuery.data?.status === "active") {
      setActiveExclusion(exclusionQuery.data);
    } else {
      setActiveExclusion(null);
    }
  }, [exclusionQuery.data]);

  const timelineQuery = useQuery({
    queryKey: ["hub-issue-timeline", issue.source, issue.sourceRowId],
    enabled: open,
    refetchInterval: 8_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => listIssueNotes(issue.source, issue.sourceRowId),
  });

  const trimmed = note.trim().length;
  const noteOk = trimmed >= MIN_TIMELINE_NOTE;
  const deferValid = !deferOn || deferDatetimeValid;

  const invalidateAll = () => {
    invalidateIssueCaches(qc, {
      source: issue.source,
      sourceRowId: issue.sourceRowId,
    });
  };

  const logMut = useMutation({
    mutationFn: async () => {
      if (deferOn) {
        const iso = new Date(deferAt).toISOString();
        await deferUnifiedIssue(issue, { untilIso: iso, note });
        return "defer" as const;
      }
      if (escalateOn) {
        await escalateUnifiedIssueToCouncil(issue, {
          councilSeverity: councilSev,
          note,
        });
        // BL-062 — mailto handoff (production stance). Hub notes + stale RYG after.
        if (
          (issue.source === "day_centre" || issue.source === "event") &&
          councilEmailTo.trim().includes("@")
        ) {
          const slaCategory: CouncilSlaCategory =
            councilSev === "Sev 4" ? "Sev 3" : (councilSev as CouncilSlaCategory);
          const hoursKey =
            slaCategory === "Sev 1"
              ? "Sev_1"
              : slaCategory === "Sev 2"
                ? "Sev_2"
                : "Sev_3";
          const hours = councilSlaHours[hoursKey] ?? 24;
          const deadlineIso = new Date(
            Date.now() + hours * 3600 * 1000,
          ).toISOString();
          const tokens = {
            severity: councilSev,
            deadline: formatDateTime(deadlineIso),
            description: cleanCouncilIssueText(issue.description || issue.title),
            workaround: note.trim(),
            date: formatDate(new Date().toISOString().slice(0, 10)),
          };
          const res = await dispatchCouncilEmail({
            issueId: issue.sourceRowId,
            to: councilEmailTo.trim(),
            from: resolveCouncilMailtoFrom(councilEmailFrom),
            subject: substituteCouncilTokens(councilTemplate.subject, tokens),
            body: substituteCouncilTokens(councilTemplate.body, tokens),
            category: slaCategory,
            deadlineIso,
          });
          openCouncilMailto(res.mailto);
          return "escalate_mailto" as const;
        }
        return "escalate" as const;
      }
      await appendUpdateNote(issue, note);
      return "append" as const;
    },
    onSuccess: (kind) => {
      invalidateAll();
      setNote("");
      setDeferOn(false);
      setEscalateOn(false);
      if (kind === "append") {
        operationToasts.noteLogged();
      } else if (kind === "defer") {
        operationToasts.issueDeferred();
      } else if (kind === "escalate_mailto") {
        operationToasts.councilEscalatedMailto();
      } else {
        operationToasts.councilEscalated();
        if (
          (issue.source === "day_centre" || issue.source === "event") &&
          !councilEmailTo.trim().includes("@")
        ) {
          toast.message("Council escalated in Hub", {
            description:
              "Set Council email To under Admin → System Parameters to open a pre-filled mail next time.",
          });
        }
      }
      // Dialog stays open — user can add more notes or close manually.
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const resolveMut = useMutation({
    mutationFn: async () => {
      await resolveUnifiedIssue(issue, note);
    },
    onSuccess: () => {
      invalidateAll();
      setNote("");
      operationToasts.issueResolved();
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.resolutionFailed(e.message),
  });

  const forceAckMut = useMutation({
    mutationFn: async () => {
      await forceAckEscalation(issue, { reason: note });
    },
    onSuccess: () => {
      invalidateAll();
      setNote("");
      operationToasts.escalationAcknowledged();
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const startMut = useMutation({
    mutationFn: () => startUnifiedIssueReview(issue),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["hub-review-started-keys"] });
      const waitLabel = formatHubWaitDuration(issue.createdAt, new Date().toISOString());
      operationToasts.reviewStarted(waitLabel);
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const autoStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      autoStartRef.current = null;
      return;
    }
    if (!autoStartReview) return;
    const sessionKey = `${issue.source}:${issue.sourceRowId}`;
    if (autoStartRef.current === sessionKey) return;
    autoStartRef.current = sessionKey;
    startMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per open session
  }, [open, autoStartReview, issue.source, issue.sourceRowId]);

  // startMut runs in the background (Open → In Progress transition) — exclude from busy
  // so it doesn't lock the UI while the status change completes.
  const busy = logMut.isPending || resolveMut.isPending || forceAckMut.isPending;
  const canLog = noteOk && deferValid && !busy;
  const canResolve = noteOk && !busy && !deferOn && !escalateOn;

  const raw = (issue.raw ?? {}) as Record<string, unknown>;
  const isAwaitingOperatorAck =
    issue.source === "escalation" &&
    raw.status === "resolved_approved" &&
    raw.operator_acknowledged_at == null;
  const canForceAck = isAwaitingOperatorAck && isManagerProfile() && noteOk && !busy;

  const timelineLines = useMemo(() => {
    return (timelineQuery.data ?? []).map(renderNoteLine);
  }, [timelineQuery.data]);

  const handleLogClick = () => {
    if (!canLog) return;
    logMut.mutate();
  };

  const handleResolveClick = () => {
    if (!canResolve) return;
    setPendingAction("resolve");
    setPinOpen(true);
  };

  const handlePinAuthenticated = () => {
    if (!isManagerProfile()) {
      operationToasts.managerPinRequired();
      setPinOpen(false);
      return;
    }
    setPinOpen(false);
    if (pendingAction === "forceAck") {
      forceAckMut.mutate();
    } else {
      resolveMut.mutate();
    }
  };

  const handleForceAckClick = () => {
    if (!canForceAck) return;
    setPendingAction("forceAck");
    setPinOpen(true);
  };

  // Parse event context suffix embedded by IncidentIntakeDialog
  const { cleanText } = parseContextSuffix(issue.description ?? "");
  const cleanTitle = stripPrefixes(cleanText || issue.title);

  // Only show the extended description when it's meaningfully longer (truncation occurred)
  const extendedDesc =
    cleanText.length > (issue.title.length + 10) ? cleanText : null;

  // Detect prefix tags for display badge
  const hasVerbalWorkaround = /^\[VERBAL WORKAROUND\]/i.test(issue.description ?? "");
  const hasIncidentTag = /^\[INCIDENT\]/i.test(issue.description ?? "");
  const isHealthSafety =
    issue.subCategory === "Health & Safety" ||
    /\[HEALTH & SAFETY\]/i.test(issue.description ?? "");
  const showClearance =
    !!activeExclusion &&
    activeExclusion.status === "active" &&
    isActiveUserManager();

  const { location, reporter } = hubIssueContextMeta(issue);
  const notes = timelineQuery.data ?? [];
  const reviewStartedNote = findHubReviewStartedNote(notes);
  const reviewStarted = isHubReviewStarted(notes);
  const workflow = reviewStarted
    ? ("in_progress" as const)
    : deriveIssueWorkflowStatus(issue, new Set());
  const waitLabel = reviewStartedNote
    ? formatHubWaitDuration(issue.createdAt, reviewStartedNote.stampedAt)
    : formatHubWaitDuration(issue.createdAt, new Date().toISOString());

  const contextCard = (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {issue.severity && SEV_BADGE[issue.severity] && (
          <Badge className={SEV_BADGE[issue.severity]}>
            {issue.severity.toUpperCase()}
          </Badge>
        )}
        <Badge variant="secondary">
          {isHealthSafety
            ? "Health & Safety"
            : (SOURCE_LABEL_CLEAN[issue.source] ?? issue.sourceLabel)}
        </Badge>
        <Badge className={HUB_WORKFLOW_STATUS_BADGE[workflow]}>
          {HUB_WORKFLOW_STATUS_LABEL[workflow]}
        </Badge>
        {hasVerbalWorkaround && (
          <Badge className="bg-amber-500 text-white text-[10px]">Verbal Workaround</Badge>
        )}
        {hasIncidentTag && (
          <Badge className="bg-orange-600 text-white text-[10px]">Incident</Badge>
        )}
        {activeExclusion?.status === "active" && (
          <Badge className="bg-amber-600 text-white text-[10px]">Infectious exclusion</Badge>
        )}
        <span className="text-xs text-muted-foreground capitalize">
          {issue.category?.replace(/_/g, " ")}
        </span>
      </div>

      <p className="font-medium leading-snug">{cleanTitle}</p>

      {extendedDesc && extendedDesc !== cleanTitle && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{extendedDesc}</p>
      )}

      <HubContextMetaGrid
        rows={[
          { label: "Location", value: location },
          { label: "Reported by", value: reporter ?? "Unknown staff" },
          { label: "Logged", value: <FormattedDateTime value={issue.createdAt} /> },
          reviewStarted
            ? {
                label: "Review started",
                value: (
                  <>
                    <FormattedDateTime value={reviewStartedNote!.stampedAt} />
                    {waitLabel ? ` (${waitLabel} after logged)` : ""}
                  </>
                ),
              }
            : { label: "Waiting", value: `${waitLabel} since logged` },
        ]}
      />
    </div>
  );

  return (
    <>
      <ManageItemShell
        open={open}
        onOpenChange={(o) => {
          if (!o) setNote("");
          onOpenChange(o);
        }}
        busy={busy}
        title="Manage issue"
        description="Log a note, defer, or escalate. Resolve when the issue is closed. Defer and resolve are mutually exclusive. Manager PIN required."
        contextCard={contextCard}
        timelineLines={timelineLines}
        timelineLoading={timelineQuery.isFetching && !timelineQuery.data}
        note={note}
        onNoteChange={setNote}
        deferOn={deferOn}
        onDeferOnChange={setDeferOn}
        deferAt={deferAt}
        onDeferAtChange={setDeferAt}
        onDeferDatetimeValidChange={setDeferDatetimeValid}
        escalateOn={escalateOn}
        onEscalateOnChange={setEscalateOn}
        councilSev={councilSev}
        onCouncilSevChange={(v) => setCouncilSev(v as CouncilSeverity)}
        councilOptions={COUNCIL_SEVERITY_OPTIONS}
        showEscalate={issue.source === "day_centre" && !isHealthSafety}
        extraFooterStart={
          showClearance ? (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setClearanceOpen(true)}
            >
              Clear to return
            </Button>
          ) : isAwaitingOperatorAck ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleForceAckClick}
              disabled={!canForceAck}
            >
              Force-ack (Manager)
            </Button>
          ) : undefined
        }
        onLogUpdate={handleLogClick}
        logUpdateLabel="Log Note"
        canLog={canLog}
        onResolveClose={handleResolveClick}
        resolveCloseLabel="Resolve"
        canResolve={canResolve && !showClearance}
      />

      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Manager PIN required to save issue changes."
        onAuthenticated={handlePinAuthenticated}
      />

      <InfectiousClearanceSheet
        open={clearanceOpen}
        onOpenChange={setClearanceOpen}
        exclusion={activeExclusion}
        onCleared={() => {
          void qc.invalidateQueries({
            queryKey: ["infectious-exclusion-by-hub", issue.sourceRowId],
          });
          onOpenChange(false);
        }}
      />
    </>
  );
}

export const ResolveIssueDialog = ManageIssueDialog;

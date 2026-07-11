import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  type CouncilSeverity,
  type UnifiedIssue,
} from "@/lib/api/unified-issues";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { ManageItemShell } from "@/components/governance/manage-item-shell";
import { FormattedDateTime } from "@/components/ui/formatted-time";
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
import { isManagerProfile } from "@/lib/governance/is-manager";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";

// ── Helpers for clean display ──────────────────────────────────────────────

/** Strip decorative prefixes that are meaningful in DB but noisy in the UI. */
function stripPrefixes(text: string): string {
  return text
    .replace(/^\[VERBAL WORKAROUND\]\s*/i, "")
    .replace(/^\[INCIDENT\]\s*/i, "")
    .replace(/^\[AUTOMATED_RED\]\s*/i, "")
    .replace(/^\[ATTENDANCE\]\s*/i, "")
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
}

export function ManageIssueDialog({ issue, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [deferOn, setDeferOn] = useState(false);
  const [escalateOn, setEscalateOn] = useState(false);
  const [deferAt, setDeferAt] = useState<string>(defaultDeferIso());
  const [councilSev, setCouncilSev] = useState<CouncilSeverity>("Sev 2");
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"log" | "resolve" | "forceAck">("log");

  useEffect(() => {
    if (open) {
      setNote("");
      setDeferOn(false);
      setEscalateOn(false);
      setDeferAt(defaultDeferIso());
      setCouncilSev("Sev 2");
      setPinOpen(false);
      setPendingAction("log");
    }
  }, [open]);

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
  const deferValid =
    !deferOn || (deferAt.length > 0 && !Number.isNaN(Date.parse(deferAt)));

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
        return "escalate" as const;
      }
      await appendUpdateNote(issue, note);
      return "append" as const;
    },
    onSuccess: (kind) => {
      invalidateAll();
      setNote("");
      if (kind === "append") {
        toast.success("Update appended to the timeline.");
      } else if (kind === "defer") {
        toast.success("Issue deferred. Moved to the Awaiting tab.");
      } else {
        toast.success("Escalated to Council. Moved to the Awaiting tab.");
      }
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Action failed", { description: e.message }),
  });

  const resolveMut = useMutation({
    mutationFn: async () => {
      await resolveUnifiedIssue(issue, note);
    },
    onSuccess: () => {
      invalidateAll();
      setNote("");
      toast.success("Issue resolved", {
        description: "Receipt appended to the operational ledger (NDIS).",
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Resolution failed", { description: e.message }),
  });

  const forceAckMut = useMutation({
    mutationFn: async () => {
      await forceAckEscalation(issue, { reason: note });
    },
    onSuccess: () => {
      invalidateAll();
      setNote("");
      toast.success("Escalation force-acknowledged", {
        description: "Removed from the awaiting list. Receipt logged.",
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error("Force-ack failed", { description: e.message }),
  });

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
    setPendingAction("log");
    setPinOpen(true);
  };

  const handleResolveClick = () => {
    if (!canResolve) return;
    setPendingAction("resolve");
    setPinOpen(true);
  };

  const handlePinAuthenticated = () => {
    if (!isManagerProfile()) {
      toast.error("Manager PIN required", {
        description:
          "Only manager-level operators can save issue changes. Action blocked.",
      });
      setPinOpen(false);
      return;
    }
    setPinOpen(false);
    if (pendingAction === "resolve") {
      resolveMut.mutate();
    } else if (pendingAction === "forceAck") {
      forceAckMut.mutate();
    } else {
      logMut.mutate();
    }
  };

  const handleForceAckClick = () => {
    if (!canForceAck) return;
    setPendingAction("forceAck");
    setPinOpen(true);
  };

  // Parse event context suffix embedded by IncidentIntakeDialog
  const { cleanText, eventName, filedFrom } = parseContextSuffix(issue.description ?? "");
  const cleanTitle = stripPrefixes(cleanText || issue.title);

  // Only show the extended description when it's meaningfully longer (truncation occurred)
  const extendedDesc =
    cleanText.length > (issue.title.length + 10) ? cleanText : null;

  // Detect prefix tags for display badge
  const hasVerbalWorkaround = /^\[VERBAL WORKAROUND\]/i.test(issue.description ?? "");
  const hasIncidentTag = /^\[INCIDENT\]/i.test(issue.description ?? "");

  // Reporter name — stored as a string on operational_incidents, may be UUID on site issues
  const reportedBy = (raw.reported_by as string | null) ?? null;
  const reportedByDisplay =
    reportedBy && !reportedBy.match(/^[0-9a-f-]{36}$/i) ? reportedBy : null;

  const contextCard = (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {issue.severity && SEV_BADGE[issue.severity] && (
          <Badge className={SEV_BADGE[issue.severity]}>
            {issue.severity.toUpperCase()}
          </Badge>
        )}
        <Badge variant="secondary">
          {SOURCE_LABEL_CLEAN[issue.source] ?? issue.sourceLabel}
        </Badge>
        {hasVerbalWorkaround && (
          <Badge className="bg-amber-500 text-white text-[10px]">Verbal Workaround</Badge>
        )}
        {hasIncidentTag && (
          <Badge className="bg-orange-600 text-white text-[10px]">Incident</Badge>
        )}
        <span className="text-xs text-muted-foreground capitalize">
          {issue.category?.replace(/_/g, " ")}
        </span>
      </div>

      <p className="font-medium leading-snug">{cleanTitle}</p>

      {extendedDesc && extendedDesc !== cleanTitle && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{extendedDesc}</p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {eventName && (
          <>
            <span className="font-medium text-foreground/70">Event</span>
            <span>{eventName}</span>
          </>
        )}
        {filedFrom && (
          <>
            <span className="font-medium text-foreground/70">Filed from</span>
            <span>{filedFrom}</span>
          </>
        )}
        {reportedByDisplay && (
          <>
            <span className="font-medium text-foreground/70">Reported by</span>
            <span>{reportedByDisplay}</span>
          </>
        )}
        <span className="font-medium text-foreground/70">Status</span>
        <span className="capitalize">{String(raw.status ?? issue.status ?? "open")}</span>
        <span className="font-medium text-foreground/70">Logged</span>
        <span><FormattedDateTime value={issue.createdAt} /></span>
      </div>
    </div>
  );

  return (
    <>
      <ManageItemShell
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
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
        escalateOn={escalateOn}
        onEscalateOnChange={setEscalateOn}
        councilSev={councilSev}
        onCouncilSevChange={(v) => setCouncilSev(v as CouncilSeverity)}
        councilOptions={COUNCIL_SEVERITY_OPTIONS}
        showEscalate={issue.source === "day_centre"}
        extraFooterStart={
          isAwaitingOperatorAck ? (
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
        canResolve={canResolve}
      />

      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Manager PIN required to save issue changes."
        onAuthenticated={handlePinAuthenticated}
      />
    </>
  );
}

export const ResolveIssueDialog = ManageIssueDialog;

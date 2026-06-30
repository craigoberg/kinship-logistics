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
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
import { isManagerProfile } from "@/lib/governance/is-manager";
import { MIN_TIMELINE_NOTE } from "@/lib/governance/constants";

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

  const contextCard = (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{issue.sourceLabel}</Badge>
        <span className="font-mono text-xs">{issue.category}</span>
        {issue.subCategory && (
          <span className="text-xs text-muted-foreground">· {issue.subCategory}</span>
        )}
      </div>
      <div className="font-medium">{issue.title}</div>
      {issue.description && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {issue.description}
        </p>
      )}
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

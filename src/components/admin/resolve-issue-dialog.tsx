import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  appendUpdateNote,
  COUNCIL_SEVERITY_OPTIONS,
  deferUnifiedIssue,
  escalateUnifiedIssueToCouncil,
  listIssueNotes,
  renderNoteLine,
  resolveUnifiedIssue,
  type CouncilSeverity,
  type UnifiedIssue,
} from "@/lib/api/unified-issues";
import { unifiedIssuesKey } from "@/hooks/use-unified-issues";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { getActiveUserProfile } from "@/lib/data-store";


interface Props {
  issue: UnifiedIssue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function defaultDeferIso(): string {
  // tomorrow 09:00 local, formatted for <input type="datetime-local">
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isManagerProfile(): boolean {
  const profile = getActiveUserProfile();
  if (!profile) return false;
  const raw = (profile.staffRole ?? "").toLowerCase();
  return raw.includes("manager");
}

export function ManageIssueDialog({ issue, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [deferOn, setDeferOn] = useState(false);
  const [escalateOn, setEscalateOn] = useState(false);
  const [deferAt, setDeferAt] = useState<string>(defaultDeferIso());
  const [councilSev, setCouncilSev] = useState<CouncilSeverity>("Sev 2");
  const [pinOpen, setPinOpen] = useState(false);

  const isDayCentre = issue.source === "day_centre";

  // Reset toggles whenever a fresh issue opens.
  useEffect(() => {
    if (open) {
      setNote("");
      setDeferOn(false);
      setEscalateOn(false);
      setDeferAt(defaultDeferIso());
      setCouncilSev("Sev 2");
      setPinOpen(false);
    }
  }, [open, issue.sourceRowId]);

  // Live-poll the central Hub timeline for ANY source.
  const timelineQuery = useQuery({
    queryKey: ["hub-issue-timeline", issue.source, issue.sourceRowId],
    enabled: open,
    refetchInterval: 8_000,
    refetchOnWindowFocus: false,
    queryFn: () => listIssueNotes(issue.source, issue.sourceRowId),
  });


  const trimmed = note.trim().length;
  const noteOk = trimmed >= 10;
  const deferValid =
    !deferOn ||
    (deferAt.length > 0 && !Number.isNaN(Date.parse(deferAt)));

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: unifiedIssuesKey });
    qc.invalidateQueries({
      queryKey: ["hub-issue-timeline", issue.source, issue.sourceRowId],
    });
    qc.invalidateQueries({ queryKey: ["site-issues"] });
    qc.invalidateQueries({ queryKey: ["site-issues-active"] });
    qc.invalidateQueries({ queryKey: SITE_SESSION_QUERY_KEY });
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return (
          typeof k === "string" &&
          (k.startsWith("site-issues") ||
            k.startsWith("site-day") ||
            k.startsWith("governance"))
        );
      },
    });
  };


  // Log Note & Update — append + (optionally) defer / escalate. No PIN.
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

  // Resolve & Close — manager-gated. Append note atomically then resolve.
  const resolveMut = useMutation({
    mutationFn: async () => {
      if (isDayCentre) {
        try {
          await appendUpdateNote(issue, note);
        } catch {
          // Resolution receipt itself captures the note in the ledger.
        }
      }
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

  const busy = logMut.isPending || resolveMut.isPending;
  const canLog = noteOk && deferValid && !busy;
  const canResolve = noteOk && !busy;

  const timeline = useMemo(() => {
    const raw = String(
      timelineQuery.data ??
        (issue.raw as { update_log?: string | null } | null)?.update_log ??
        "",
    );
    return raw.trim();
  }, [timelineQuery.data, issue.raw]);

  const handleResolveClick = () => {
    if (!canResolve) return;
    setPinOpen(true);
  };

  const handlePinAuthenticated = () => {
    if (!isManagerProfile()) {
      toast.error("Manager PIN required", {
        description:
          "Only manager-level operators can close issues. Resolution blocked.",
      });
      setPinOpen(false);
      return;
    }
    setPinOpen(false);
    resolveMut.mutate();
  };

  const noteLabel = deferOn
    ? "Defer reason / next action"
    : escalateOn
      ? "Council escalation note"
      : "Update note";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          if (!o) setNote("");
          onOpenChange(o);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage issue</DialogTitle>
            <DialogDescription>
              Append timeline updates, resolve, defer, or escalate to Council.
              Every action writes an NDIS-reportable receipt to the operational
              ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{issue.sourceLabel}</Badge>
              <span className="font-mono text-xs">{issue.category}</span>
              {issue.subCategory && (
                <span className="text-xs text-muted-foreground">
                  · {issue.subCategory}
                </span>
              )}
            </div>
            <div className="font-medium">{issue.title}</div>
            {issue.description && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {issue.description}
              </p>
            )}
          </div>

          {isDayCentre && (
            <div className="space-y-1">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Timeline
              </Label>
              <div
                className="max-h-48 overflow-y-auto rounded-md border bg-muted/20 p-3 text-xs font-mono whitespace-pre-wrap text-muted-foreground"
                aria-readonly
              >
                {timeline.length === 0 ? (
                  <span className="italic">No prior updates.</span>
                ) : (
                  timeline
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="resolution-note">
              {noteLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="resolution-note"
              rows={4}
              placeholder="Min 10 chars — appended to the immutable timeline."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div
              className={`text-xs ${
                trimmed < 10 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {trimmed}/10 minimum
            </div>
          </div>

          {/* Timeline Adjustments — optional progressive toggles */}
          <div className="space-y-3 rounded-md border border-dashed bg-muted/10 p-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Timeline Adjustments (optional)
            </Label>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={deferOn}
                  onCheckedChange={(v) => {
                    const next = v === true;
                    setDeferOn(next);
                    if (next) setEscalateOn(false);
                  }}
                />
                Defer / Set next action date
              </label>
              {deferOn && (
                <div className="pl-6 space-y-1">
                  <Label htmlFor="defer-at" className="text-xs">
                    Next action date
                  </Label>
                  <Input
                    id="defer-at"
                    type="datetime-local"
                    value={deferAt}
                    onChange={(e) => setDeferAt(e.target.value)}
                    className="[color-scheme:dark]"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={escalateOn}
                  onCheckedChange={(v) => {
                    const next = v === true;
                    setEscalateOn(next);
                    if (next) setDeferOn(false);
                  }}
                />
                Escalate to Council
              </label>
              {escalateOn && (
                <div className="pl-6 space-y-1">
                  <Label className="text-xs">Council severity</Label>
                  <Select
                    value={councilSev}
                    onValueChange={(v) => setCouncilSev(v as CouncilSeverity)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNCIL_SEVERITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="secondary"
              onClick={() => logMut.mutate()}
              disabled={!canLog}
            >
              {logMut.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Log Note &amp; Update
            </Button>
            <Button
              onClick={handleResolveClick}
              disabled={!canResolve}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {resolveMut.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Resolve &amp; Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Manager authorization required to close this issue."
        onAuthenticated={handlePinAuthenticated}
      />
    </>
  );
}

// Back-compat alias: older imports continue to work.
export const ResolveIssueDialog = ManageIssueDialog;

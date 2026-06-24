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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import {
  appendUpdateNote,
  COUNCIL_SEVERITY_OPTIONS,
  deferUnifiedIssue,
  escalateUnifiedIssueToCouncil,
  resolveUnifiedIssue,
  type CouncilSeverity,
  type UnifiedIssue,
} from "@/lib/api/unified-issues";
import { unifiedIssuesKey } from "@/hooks/use-unified-issues";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

interface Props {
  issue: UnifiedIssue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Action = "append" | "resolve" | "defer" | "escalate";

function defaultDeferIso(): string {
  // tomorrow 09:00 local, formatted for <input type="datetime-local">
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ManageIssueDialog({ issue, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [action, setAction] = useState<Action>("append");
  const [deferAt, setDeferAt] = useState<string>(defaultDeferIso());
  const [councilSev, setCouncilSev] = useState<CouncilSeverity>("Sev 2");

  const isDayCentre = issue.source === "day_centre";

  // Live-poll the timeline for this row so concurrent operators see appends
  // without manual reload. Cheap targeted read; only enabled while the
  // dialog is open and the row is a day_centre issue.
  const timelineQuery = useQuery({
    queryKey: ["site-issue-timeline", issue.sourceRowId],
    enabled: open && isDayCentre,
    refetchInterval: 8_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_issues_register")
        .select("update_log")
        .eq("id", issue.sourceRowId)
        .single();
      if (error) throw error;
      return String(
        (data as { update_log: string | null } | null)?.update_log ?? "",
      );
    },
  });

  // Reset action when the source changes (escalation/incident → only resolve).
  useEffect(() => {
    if (!isDayCentre) setAction("resolve");
  }, [isDayCentre]);

  const trimmed = note.trim().length;
  const noteOk = trimmed >= 10;
  const deferOk =
    action !== "defer" ||
    (deferAt.length > 0 && !Number.isNaN(Date.parse(deferAt)));

  const mut = useMutation({
    mutationFn: async () => {
      if (action === "append") {
        await appendUpdateNote(issue, note);
        return { kind: "append" as const };
      }
      if (action === "defer") {
        const iso = new Date(deferAt).toISOString();
        await deferUnifiedIssue(issue, { untilIso: iso, note });
        return { kind: "defer" as const };
      }
      if (action === "escalate") {
        await escalateUnifiedIssueToCouncil(issue, {
          councilSeverity: councilSev,
          note,
        });
        return { kind: "escalate" as const };
      }
      // Resolve. For day_centre issues, append the note to the timeline
      // first so the history remains the source of truth — then close.
      if (isDayCentre) {
        try {
          await appendUpdateNote(issue, note);
        } catch {
          // If append fails (e.g. concurrency), fall through to resolve;
          // the resolution receipt itself captures the note in the ledger.
        }
      }
      await resolveUnifiedIssue(issue, note);
      return { kind: "resolve" as const };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: unifiedIssuesKey });
      qc.invalidateQueries({ queryKey: ["site-issue-timeline", issue.sourceRowId] });
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
      setNote("");
      if (r.kind === "append") {
        toast.success("Update appended to the timeline.");
        // Stay open so operators can keep adding updates.
        return;
      }
      if (r.kind === "defer") {
        toast.success("Issue deferred. Moved to the Awaiting tab.");
      } else if (r.kind === "escalate") {
        toast.success("Escalated to Council. Moved to the Awaiting tab.");
      } else {
        toast.success("Issue resolved", {
          description: "Receipt appended to the operational ledger (NDIS).",
        });
      }
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Action failed", { description: e.message }),
  });

  const canSubmit =
    noteOk && deferOk && !mut.isPending && (isDayCentre || action === "resolve");

  const timeline = useMemo(() => {
    const raw = String(
      timelineQuery.data ??
        (issue.raw as { update_log?: string | null } | null)?.update_log ??
        "",
    );
    return raw.trim();
  }, [timelineQuery.data, issue.raw]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (mut.isPending) return;
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

        {isDayCentre && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Action
            </Label>
            <RadioGroup
              value={action}
              onValueChange={(v) => setAction(v as Action)}
              className="grid grid-cols-2 gap-2 text-sm"
            >
              <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <RadioGroupItem value="append" id="act-append" />
                Append note only
              </label>
              <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <RadioGroupItem value="resolve" id="act-resolve" />
                Resolve &amp; close
              </label>
              <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <RadioGroupItem value="defer" id="act-defer" />
                Defer / Next action
              </label>
              <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                <RadioGroupItem value="escalate" id="act-escalate" />
                Escalate to Council
              </label>
            </RadioGroup>
          </div>
        )}

        {action === "defer" && (
          <div className="space-y-1">
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

        {action === "escalate" && (
          <div className="space-y-1">
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

        <div className="space-y-2">
          <Label htmlFor="resolution-note">
            {action === "append"
              ? "New update"
              : action === "resolve"
                ? "Resolution notes"
                : action === "defer"
                  ? "Defer reason / next action"
                  : "Council escalation note"}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="resolution-note"
            rows={4}
            placeholder="Min 10 chars — appended to the immutable timeline."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div
            className={`text-xs ${trimmed < 10 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {trimmed}/10 minimum
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mut.isPending}
          >
            Close
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {action === "append"
              ? "Append update"
              : action === "resolve"
                ? "Resolve & log"
                : action === "defer"
                  ? "Defer issue"
                  : "Escalate to Council"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Back-compat alias: older imports continue to work.
export const ResolveIssueDialog = ManageIssueDialog;

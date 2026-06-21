import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { resolveUnifiedIssue, type UnifiedIssue } from "@/lib/api/unified-issues";
import { unifiedIssuesKey } from "@/hooks/use-unified-issues";
import { SITE_SESSION_QUERY_KEY } from "@/hooks/use-site-session";

interface Props {
  issue: UnifiedIssue;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResolveIssueDialog({ issue, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: () => resolveUnifiedIssue(issue, note),
    onSuccess: () => {
      toast.success("Issue resolved", {
        description: "Receipt appended to the operational ledger (NDIS).",
      });
      qc.invalidateQueries({ queryKey: unifiedIssuesKey });
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
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Resolve failed", { description: e.message }),
  });

  const trimmed = note.trim().length;
  const canSubmit = trimmed >= 10 && !mut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (mut.isPending) return;
        if (!o) setNote("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve issue</DialogTitle>
          <DialogDescription>
            Resolution text is appended to the operational ledger as an
            immutable NDIS-reportable receipt.
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

        <div className="space-y-2">
          <Label htmlFor="resolution-note">
            Resolution notes <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="resolution-note"
            rows={4}
            placeholder="What action was taken? (min 10 chars — recorded in the NDIS ledger)"
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
            Cancel
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Resolve & log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

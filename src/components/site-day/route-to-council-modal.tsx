import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Loader2, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientTime } from "@/components/ui/client-time";
import { usePersistedForm } from "@/hooks/use-persisted-form";
import {
  dispatchCouncilEmail,
  routeToCouncilLocal,
  type CouncilSlaCategory,
  type SiteIssue,
} from "@/lib/api/site-issues";
import { siteIssuesKey } from "@/hooks/use-site-issues";
import {
  useCouncilEmailTemplate,
  useCouncilEmailTo,
  useCouncilSlaHours,
} from "@/hooks/use-system-parameters";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: SiteIssue;
}

interface CouncilDraft {
  to: string;
  subject: string;
  body: string;
  category: CouncilSlaCategory;
}

function substituteTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => tokens[k] ?? `{${k}}`);
}

const SEV_OPTIONS: CouncilSlaCategory[] = ["Sev 1", "Sev 2", "Sev 3"];

export function RouteToCouncilModal({ open, onOpenChange, issue }: Props) {
  const queryClient = useQueryClient();
  const hoursMap = useCouncilSlaHours();
  const defaultTo = useCouncilEmailTo();
  const template = useCouncilEmailTemplate();

  // Recompute the suggested SLA tier + deadline from issue severity + owner.
  const suggested = useMemo(
    () =>
      routeToCouncilLocal(
        { severity: issue.severity, owner: issue.owner },
        {
          Sev_1: hoursMap.Sev_1,
          Sev_2: hoursMap.Sev_2,
          Sev_3: hoursMap.Sev_3,
        },
      ),
    [issue.severity, issue.owner, hoursMap.Sev_1, hoursMap.Sev_2, hoursMap.Sev_3],
  );

  const initialTokens = useMemo(
    () => ({
      severity: suggested.category,
      deadline: new Date(suggested.deadlineIso).toLocaleString(),
      description: issue.issueDescription,
      workaround: issue.workaroundPlan ?? "—",
      date: new Date().toLocaleDateString(),
    }),
    [suggested.category, suggested.deadlineIso, issue.issueDescription, issue.workaroundPlan],
  );

  const draftInitial: CouncilDraft = useMemo(
    () => ({
      to: defaultTo,
      subject: substituteTokens(template.subject, initialTokens),
      body: substituteTokens(template.body, initialTokens),
      category: suggested.category,
    }),
    [defaultTo, template.subject, template.body, initialTokens, suggested.category],
  );

  const form = usePersistedForm<CouncilDraft>(
    `council-email:${issue.id}`,
    draftInitial,
  );

  // Recompute the deadline for whichever category the manager actually picked.
  const [deadlineIso, setDeadlineIso] = useState<string>(suggested.deadlineIso);
  useEffect(() => {
    const key: keyof typeof hoursMap =
      form.values.category === "Sev 1"
        ? "Sev_1"
        : form.values.category === "Sev 2"
          ? "Sev_2"
          : "Sev_3";
    const hours = hoursMap[key];
    setDeadlineIso(new Date(Date.now() + hours * 3600 * 1000).toISOString());
  }, [form.values.category, hoursMap]);

  const recipientOk = form.values.to.trim().length > 3 && form.values.to.includes("@");
  const subjectOk = form.values.subject.trim().length > 3;
  const bodyOk = form.values.body.trim().length > 10;

  const mutation = useMutation({
    mutationFn: async () => {
      return dispatchCouncilEmail({
        issueId: issue.id,
        to: form.values.to.trim(),
        subject: form.values.subject.trim(),
        body: form.values.body.trim(),
        category: form.values.category,
        deadlineIso,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({
        queryKey: siteIssuesKey(issue.sessionId),
      });
      form.reset();
      if (res.mode === "mailto" && res.mailto && typeof window !== "undefined") {
        toast.message("Opening your mail client…", {
          description: "Server email route not configured — using mailto fallback.",
        });
        window.location.href = res.mailto;
      } else {
        toast.success("Council notified.", {
          description: "Issue flagged as dispatched.",
        });
      }
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast.error("Could not dispatch email", { description: e.message }),
  });

  const canSubmit =
    recipientOk && subjectOk && bodyOk && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => (mutation.isPending ? null : onOpenChange(o))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Route to Council Maintenance
          </DialogTitle>
          <DialogDescription>
            Pre-filled from your council email template. Review, edit, and send
            — we'll flag the issue as dispatched and record the SLA deadline.
          </DialogDescription>
        </DialogHeader>

        {form.hasDraft && (
          <div className="flex items-start justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">Resume draft?</span> Unsaved email
              edits were detected.
            </span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={form.discardDraft}>
                Discard
              </Button>
              <Button size="sm" onClick={form.resumeDraft}>
                Resume
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              SLA Tier
            </Label>
            <Select
              value={form.values.category}
              onValueChange={(v) =>
                form.setValues({ category: v as CouncilSlaCategory })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEV_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Deadline (auto)
            </Label>
            <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm">
              <ClientTime iso={deadlineIso} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="cc-to"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Recipient
          </Label>
          <Input
            id="cc-to"
            type="email"
            value={form.values.to}
            onChange={(e) => form.setValues({ to: e.target.value })}
            placeholder="maintenance@council.gov.au"
          />
          {!defaultTo && (
            <p className="text-xs text-yellow-700">
              No default council recipient is set. Configure{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                site_management.council_email_to
              </code>{" "}
              in Admin → System Parameters.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="cc-subj"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Subject
          </Label>
          <Input
            id="cc-subj"
            value={form.values.subject}
            onChange={(e) => form.setValues({ subject: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="cc-body"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Body
          </Label>
          <Textarea
            id="cc-body"
            rows={8}
            value={form.values.body}
            onChange={(e) => form.setValues({ body: e.target.value })}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || !recipientOk}
            title={!recipientOk ? "Set a valid recipient first." : undefined}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-1.5 h-4 w-4" />
            )}
            Send to Council
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

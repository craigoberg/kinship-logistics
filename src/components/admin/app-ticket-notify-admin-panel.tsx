import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useAppTicketNotifyFrom,
  useAppTicketNotifyTo,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  APP_TICKET_NOTIFY_PARAM_KEYS,
  looksLikeEmail,
  parseNotifyEmailList,
} from "@/lib/app-tickets/notify-params";
import { formatUnknownError } from "@/lib/utils";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

/**
 * Admin → System Parameters — App ticket notify To / From (server Postmark).
 */
export function AppTicketNotifyAdminPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;

  const savedTo = useAppTicketNotifyTo();
  const savedFrom = useAppTicketNotifyFrom();

  const [to, setTo] = useState(savedTo);
  const [from, setFrom] = useState(savedFrom);
  const [justification, setJustification] = useState("");

  useEffect(() => setTo(savedTo), [savedTo]);
  useEffect(() => setFrom(savedFrom), [savedFrom]);

  const toTrim = to.trim();
  const fromTrim = from.trim();
  const parsedTo = parseNotifyEmailList(toTrim);
  const toInvalid =
    toTrim.length > 0 &&
    (parsedTo.length === 0 ||
      toTrim.split(/[,;]+/).some((part) => part.trim().length > 0 && !looksLikeEmail(part)));
  const fromInvalid = fromTrim.length > 0 && !looksLikeEmail(fromTrim);

  const dirty = toTrim !== savedTo.trim() || fromTrim !== savedFrom.trim();

  const missing: string[] = [];
  if (toInvalid) missing.push("To must be comma-separated emails (or left blank)");
  if (fromInvalid) missing.push("From must be a valid email (or left blank)");

  const save = useMutation({
    mutationFn: async () => {
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : "Updated App ticket notify settings from Admin.";

      const updates: Array<{ key: string; value: string }> = [];
      if (toTrim !== savedTo.trim()) {
        updates.push({ key: "app_tickets.notify_to", value: toTrim });
      }
      if (fromTrim !== savedFrom.trim()) {
        updates.push({ key: "app_tickets.notify_from", value: fromTrim });
      }

      for (const u of updates) {
        await updateSystemParameter({
          key: u.key,
          newValue: u.value,
          justification: reason,
        });
      }
      return updates.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: SYSTEM_PARAMETERS_QUERY_KEY });
      setJustification("");
      toast.success(
        count === 0 ? "No changes to save" : "App ticket notify settings saved",
        {
          description:
            count === 0
              ? "Values match what is already saved."
              : parsedTo.length === 0
                ? "To is blank — new tickets stay on the Dashboard tile only."
                : `New tickets will email ${parsedTo.join(", ")}.`,
        },
      );
    },
    onError: (e: unknown) =>
      toast.error("Could not save App ticket notify settings", {
        description: formatUnknownError(e).includes("Unknown system parameter")
          ? `${formatUnknownError(e)} — run docs/sql/2026-08-19_app_ticket_notify.sql in Supabase first.`
          : formatUnknownError(e),
      }),
  });

  const canSave = canEdit && dirty && missing.length === 0 && !save.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Mail className="h-4 w-4 text-primary" />
            App ticket notify (email)
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            When someone files a green Raise ticket, the office inbox is pinged from
            the server via <strong>Postmark</strong>. <strong>To</strong> is who gets
            the mail; it does not send by itself. This host also needs{" "}
            <code className="rounded bg-muted px-1 text-xs">POSTMARK_SERVER_TOKEN</code>{" "}
            in server env (never <code className="rounded bg-muted px-1 text-xs">VITE_</code>
            ). <strong>From</strong> must be a Postmark Sender Signature (or set{" "}
            <code className="rounded bg-muted px-1 text-xs">POSTMARK_FROM</code>). Empty To =
            Dashboard tile only. This is not Council mailto.
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="app-ticket-notify-to">To (office inbox)</Label>
          <Input
            id="app-ticket-notify-to"
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={!canEdit}
            placeholder="you@yada.org.au, ops@yada.org.au"
            className={requiredFieldOutline(toInvalid)}
          />
          <p className="text-[11px] text-muted-foreground">
            Comma-separated. Leave blank to skip email.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app-ticket-notify-from">From (optional)</Label>
          <Input
            id="app-ticket-notify-from"
            type="email"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={!canEdit}
            placeholder="Leave blank = POSTMARK_FROM env"
            className={requiredFieldOutline(fromInvalid)}
          />
          <p className="text-[11px] text-muted-foreground">
            Must match a Postmark Sender Signature / verified domain (e.g. connect@yada.org.au).
          </p>
        </div>
      </div>

      {canEdit && dirty && missing.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Fix before save: {missing.join(" · ")}
        </div>
      ) : null}

      {canEdit && dirty && (
        <div className="space-y-1.5">
          <Label htmlFor="app-ticket-notify-justification" className="text-xs">
            Change reason (optional — auto-filled if left blank)
          </Label>
          <Input
            id="app-ticket-notify-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. TEST To set to office inbox"
          />
        </div>
      )}

      {canEdit && (
        <Button
          onClick={() => save.mutate()}
          disabled={!canSave}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving…" : "Save App ticket notify"}
        </Button>
      )}
    </div>
  );
}

export { APP_TICKET_NOTIFY_PARAM_KEYS };

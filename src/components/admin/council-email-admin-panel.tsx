import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  canManageSystemParameters,
  updateSystemParameter,
} from "@/lib/api/system-parameters";
import {
  SYSTEM_PARAMETERS_QUERY_KEY,
  useCouncilEmailFrom,
  useCouncilEmailTemplate,
  useCouncilEmailTo,
} from "@/hooks/use-system-parameters";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  COUNCIL_EMAIL_PARAM_KEYS,
  DEFAULT_COUNCIL_EMAIL_TEMPLATE,
  isCouncilEmailAddress,
} from "@/lib/governance/council-email";

function isManagerRole(staffRole: string | null | undefined): boolean {
  return (staffRole ?? "").toLowerCase().includes("manager");
}

/**
 * Admin → System Parameters — Council escalate mailto To / From / template.
 * Edited here (not as raw JSON). Keys listed in COUNCIL_EMAIL_PARAM_KEYS.
 */
export function CouncilEmailAdminPanel() {
  const qc = useQueryClient();
  const profile = useMemo(() => getActiveUserProfile(), []);
  const permissionQ = useQuery({
    queryKey: ["system-parameters", "can-manage", profile?.staffId ?? "auth-user"],
    queryFn: () => canManageSystemParameters(profile?.staffId),
    staleTime: 60_000,
  });
  const canEdit = isManagerRole(profile?.staffRole) || permissionQ.data === true;

  const savedTo = useCouncilEmailTo();
  const savedFrom = useCouncilEmailFrom();
  const savedTemplate = useCouncilEmailTemplate();

  const [to, setTo] = useState(savedTo);
  const [from, setFrom] = useState(savedFrom);
  const [subject, setSubject] = useState(savedTemplate.subject);
  const [body, setBody] = useState(savedTemplate.body);
  const [justification, setJustification] = useState("");

  useEffect(() => setTo(savedTo), [savedTo]);
  useEffect(() => setFrom(savedFrom), [savedFrom]);
  useEffect(() => setSubject(savedTemplate.subject), [savedTemplate.subject]);
  useEffect(() => setBody(savedTemplate.body), [savedTemplate.body]);

  const toTrim = to.trim();
  const fromTrim = from.trim();
  const subjectTrim = subject.trim();
  const bodyTrim = body.trim();

  const toInvalid = toTrim.length > 0 && !isCouncilEmailAddress(toTrim);
  const fromInvalid = fromTrim.length > 0 && !isCouncilEmailAddress(fromTrim);
  const subjectInvalid = subjectTrim.length < 5;
  const bodyInvalid = bodyTrim.length < 20;

  const dirty =
    toTrim !== savedTo.trim() ||
    fromTrim !== savedFrom.trim() ||
    subjectTrim !== savedTemplate.subject.trim() ||
    bodyTrim !== savedTemplate.body.trim();

  const missing: string[] = [];
  if (toInvalid) missing.push("To must be a valid email (or left blank)");
  if (fromInvalid) missing.push("From must be a valid email (or left blank)");
  if (subjectInvalid) missing.push("Subject (min 5 characters)");
  if (bodyInvalid) missing.push("Body (min 20 characters)");

  const save = useMutation({
    mutationFn: async () => {
      const reason =
        justification.trim().length >= 10
          ? justification.trim()
          : "Updated Council email settings from Admin.";

      const updates: Array<{ key: string; value: string | Record<string, string> }> =
        [];
      if (toTrim !== savedTo.trim()) {
        updates.push({ key: "site_management.council_email_to", value: toTrim });
      }
      if (fromTrim !== savedFrom.trim()) {
        updates.push({
          key: "site_management.council_email_from",
          value: fromTrim,
        });
      }
      if (
        subjectTrim !== savedTemplate.subject.trim() ||
        bodyTrim !== savedTemplate.body.trim()
      ) {
        updates.push({
          key: "site_management.council_email_template",
          value: { subject: subjectTrim, body: bodyTrim },
        });
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
        count === 0 ? "No changes to save" : "Council email settings saved",
        {
          description:
            count === 0
              ? "Values match what is already saved."
              : "Escalate to Council will use these for the mailto popup.",
        },
      );
    },
    onError: (e: Error) =>
      toast.error("Could not save Council email settings", {
        description:
          e.message.includes("Unknown system parameter")
            ? `${e.message} — run docs/sql/2026-07-30_council_email_params.sql in Supabase first.`
            : e.message,
      }),
  });

  const canSave =
    canEdit && dirty && missing.length === 0 && !save.isPending;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Mail className="h-4 w-4 text-primary" />
            Council email (mailto)
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Escalate to Council opens the operator&apos;s mail app with a pre-filled
            message. Set <strong>To</strong> for DEV/TEST (internal) or PROD (council).
            Optional <strong>From</strong> = shared mailbox; leave blank to send as the
            signed-in user. Template tokens:{" "}
            <code className="rounded bg-muted px-1 text-xs">
              {"{severity} {description} {workaround} {deadline} {date}"}
            </code>
          </p>
        </div>
        {!canEdit && <Badge variant="secondary">Read-only · Managers can edit</Badge>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="council-email-to">To (recipient)</Label>
          <Input
            id="council-email-to"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={!canEdit}
            placeholder="ops-test@yourorg.org.au"
            className={requiredFieldOutline(toInvalid)}
          />
          <p className="text-[11px] text-muted-foreground">
            Required for the mail popup. Empty = Hub escalate logs without opening mail.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="council-email-from">From (shared mailbox, optional)</Label>
          <Input
            id="council-email-from"
            type="email"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={!canEdit}
            placeholder="Leave blank = operator account"
            className={requiredFieldOutline(fromInvalid)}
          />
          <p className="text-[11px] text-muted-foreground">
            When set, mailto includes From. Mail clients may still send from the logged-in
            account — use Send As / shared mailbox if needed.
          </p>
        </div>
      </div>

      <CharacterCountedInput
        id="council-email-subject"
        label="Subject template"
        value={subject}
        onValueChange={setSubject}
        minChars={5}
        maxChars={200}
        counterMode="minimum"
        disabled={!canEdit}
        placeholder={DEFAULT_COUNCIL_EMAIL_TEMPLATE.subject}
      />

      <CharacterCountedTextarea
        id="council-email-body"
        label="Body template"
        rows={8}
        value={body}
        onValueChange={setBody}
        minChars={20}
        maxChars={4000}
        counterMode="minimum"
        disabled={!canEdit}
        placeholder={DEFAULT_COUNCIL_EMAIL_TEMPLATE.body}
      />

      {canEdit && dirty && missing.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Fix before save: {missing.join(" · ")}
        </div>
      ) : null}

      {canEdit && dirty && (
        <div className="space-y-1.5">
          <Label htmlFor="council-email-justification" className="text-xs">
            Change reason (optional — auto-filled if left blank)
          </Label>
          <Input
            id="council-email-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="e.g. DEV To set to ops test inbox"
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
          {save.isPending ? "Saving…" : "Save Council email settings"}
        </Button>
      )}
    </div>
  );
}

export { COUNCIL_EMAIL_PARAM_KEYS };

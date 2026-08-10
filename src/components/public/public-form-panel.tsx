import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn } from "@/lib/utils";
import {
  submitPublicForm,
  type PublicFormDefinition,
} from "@/lib/api/public-forms";

interface Props {
  definition: PublicFormDefinition;
  channel: "public" | "connect";
  /** Link to complaints policy (public path). */
  policyHref?: string;
}

export function PublicFormPanel({
  definition,
  channel,
  policyHref = "/public/policies",
}: Props) {
  // Public site runs under light theme; Connect rights-voice stays on dark html.
  const light = channel === "public";
  const fieldClass = light
    ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"
    : undefined;
  const labelClass = light ? "text-slate-800" : undefined;
  const [anonymous, setAnonymous] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);

  const anon = definition.allowAnonymous && anonymous;
  const nameMissing = !anon && !name.trim();
  const messageOk = message.trim().length >= 20;
  const canSubmit = !busy && !nameMissing && messageOk;

  const missing: string[] = [];
  if (nameMissing) missing.push("Name");
  if (!messageOk) missing.push("Message (20+ characters)");

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await submitPublicForm({
        formKey: definition.formKey,
        channel,
        isAnonymous: anon,
        submitterName: name,
        submitterEmail: email,
        submitterPhone: phone,
        submitterRole: role,
        message,
      });
      setRefCode(result.referenceCode);
      toast.success("Submitted — Hub ticket created", {
        description: result.referenceCode,
      });
    } catch (e) {
      toast.error("Could not submit", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (refCode) {
    return (
      <div
        className={cn(
          "space-y-3 rounded-lg border p-4",
          light
            ? "border-emerald-600/40 bg-emerald-50 text-slate-900"
            : "border-emerald-600/40 bg-emerald-500/10",
        )}
      >
        <h3 className="text-lg font-semibold">Thank you</h3>
        <p className={cn("text-sm", light && "text-slate-700")}>
          Your submission was received. Please keep this reference number:
        </p>
        <p
          className={cn(
            "font-mono text-base font-semibold tracking-wide",
            light && "text-[#0077a8]",
          )}
        >
          {refCode}
        </p>
        <p className={cn("text-xs", light ? "text-slate-600" : "text-muted-foreground")}>
          Office staff will triage this in the Governance Hub.{" "}
          {definition.formKey === "complaint" ? (
            <>
              Read our{" "}
              <a
                href={policyHref}
                className={cn("underline", light && "text-[#0077a8]")}
              >
                Complaints policy
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", light && "text-slate-900")}>
      <div>
        <h2
          className={cn(
            "text-xl font-semibold tracking-tight",
            light && "text-slate-900",
          )}
        >
          {definition.title}
        </h2>
        {definition.introHtml ? (
          <div
            className={cn(
              "prose prose-sm mt-2 max-w-none",
              light
                ? "prose-slate text-slate-600"
                : "text-muted-foreground dark:prose-invert",
            )}
            dangerouslySetInnerHTML={{ __html: definition.introHtml }}
          />
        ) : null}
        {definition.formKey === "complaint" ? (
          <p className="mt-2 text-xs">
            <a
              href={policyHref}
              className={cn(
                "underline underline-offset-2",
                light && "text-[#0077a8]",
              )}
            >
              Complaints policy
            </a>
          </p>
        ) : null}
      </div>

      {definition.allowAnonymous ? (
        <label
          className={cn(
            "flex items-center gap-2 text-sm",
            light && "text-slate-800",
          )}
        >
          <Checkbox
            checked={anonymous}
            onCheckedChange={(c) => setAnonymous(!!c)}
          />
          Submit anonymously (no name or contact stored)
        </label>
      ) : null}

      {!anon ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className={labelClass}>Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(fieldClass, requiredFieldOutline(nameMissing))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={labelClass}>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={labelClass}>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className={labelClass}>I am a…</Label>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Client / Family / Carer / Staff / Volunteer / Public"
              className={fieldClass}
            />
          </div>
        </div>
      ) : null}

      <CharacterCountedTextarea
        label="Your message *"
        value={message}
        onValueChange={setMessage}
        minChars={20}
        required
        className={fieldClass}
      />

      {missing.length > 0 ? (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            light
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          Required: {missing.join(" · ")}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={
            light
              ? "bg-[#00a3e0] text-white hover:bg-[#0077a8] disabled:opacity-50"
              : undefined
          }
        >
          {busy ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}

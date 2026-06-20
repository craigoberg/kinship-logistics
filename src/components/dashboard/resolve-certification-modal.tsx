import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CalendarIcon, Loader2, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import {
  resolveCertification,
  type CertResolutionType,
} from "@/lib/api/ledger";

const MIN_NOTES = 20;
const MIN_EVIDENCE = 6;
const MAX_DEFER_DAYS = 30;

export interface ResolveCertSubject {
  staffId: string;
  staffName: string;
  certName: string;
  expiry: string | null;
}

interface Props {
  subject: ResolveCertSubject | null;
  onClose: () => void;
  onResolved?: () => void;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function ResolveCertificationModal({ subject, onClose, onResolved }: Props) {
  const [resType, setResType] = useState<CertResolutionType>("renewed");
  const [newExpiry, setNewExpiry] = useState<Date | undefined>(undefined);
  const [deferredUntil, setDeferredUntil] = useState<Date | undefined>(undefined);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!subject) {
      setResType("renewed");
      setNewExpiry(undefined);
      setDeferredUntil(undefined);
      setEvidenceRef("");
      setNotes("");
    }
  }, [subject]);

  const today = startOfToday();
  const maxDefer = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + MAX_DEFER_DAYS);
    return d;
  }, [today]);

  const trimmedNotes = notes.trim();
  const trimmedEvidence = evidenceRef.trim();
  const notesTooShort = trimmedNotes.length < MIN_NOTES;
  const evidenceRequired = resType === "renewed";
  const evidenceTooShort = trimmedEvidence.length < MIN_EVIDENCE;
  const dateMissing =
    (resType === "renewed" && !newExpiry) ||
    (resType === "deferred" && !deferredUntil);
  const dateInvalid =
    (resType === "renewed" && newExpiry && newExpiry.getTime() <= today.getTime()) ||
    (resType === "deferred" &&
      deferredUntil &&
      (deferredUntil.getTime() <= today.getTime() ||
        deferredUntil.getTime() > maxDefer.getTime()));

  const canSubmit =
    !submitting &&
    !notesTooShort &&
    !(evidenceRequired && evidenceTooShort) &&
    !dateMissing &&
    !dateInvalid;

  // Clear evidence when switching away from "renewed" so stale input isn't
  // silently carried into a defer/revoke receipt.
  useEffect(() => {
    if (resType !== "renewed" && evidenceRef !== "") {
      setEvidenceRef("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resType]);

  const progress = Math.min(100, Math.round((trimmedNotes.length / MIN_NOTES) * 100));

  const submit = async () => {
    if (!subject || !canSubmit) return;
    setSubmitting(true);
    try {
      await resolveCertification({
        staffId: subject.staffId,
        staffName: subject.staffName,
        certName: subject.certName,
        previousExpiry: subject.expiry,
        resolutionType: resType,
        newExpiry: resType === "renewed" && newExpiry ? toISODate(newExpiry) : null,
        deferredUntil:
          resType === "deferred" && deferredUntil ? toISODate(deferredUntil) : null,
        evidenceRef: evidenceRequired ? trimmedEvidence : null,
        justification: trimmedNotes,
      });
      toast.success("Certification resolved", {
        description: `${subject.staffName} · ${subject.certName} · ${resType}`,
      });
      onResolved?.();
      onClose();
    } catch (err) {
      toast.error("Could not resolve certification", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const open = !!subject;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md gap-3 p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Resolve Certification
          </DialogTitle>
          <DialogDescription className="text-xs">
            Manager action. Permanently logged to the operational ledger for
            NDIS compliance.
          </DialogDescription>
        </DialogHeader>

        {subject && (
          <div className="space-y-3">
            <div className="grid gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <Row label="Staff" value={subject.staffName} />
              <Row label="Cert" value={subject.certName} />
              <Row label="Expired" value={subject.expiry ?? "—"} />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-sm font-semibold">Resolution Type</Label>
              <RadioGroup
                value={resType}
                onValueChange={(v) => setResType(v as CertResolutionType)}
                className="grid grid-cols-3 gap-2"
              >
                {(
                  [
                    { v: "renewed", label: "Renewed" },
                    { v: "deferred", label: "Defer" },
                    { v: "revoked", label: "Revoke" },
                  ] as { v: CertResolutionType; label: string }[]
                ).map((opt) => (
                  <label
                    key={opt.v}
                    htmlFor={`rt-${opt.v}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                      resType === opt.v
                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                        : "border-border",
                    )}
                  >
                    <RadioGroupItem id={`rt-${opt.v}`} value={opt.v} />
                    {opt.label}
                  </label>
                ))}
              </RadioGroup>
            </div>

            {resType === "renewed" && (
              <div className="grid gap-1">
                <DateField
                  label="New Expiry Date"
                  value={newExpiry}
                  onChange={setNewExpiry}
                  helper="Back-dating allowed for evidence entry, but the resulting expiry must be after today."
                />
                {newExpiry && newExpiry.getTime() <= today.getTime() && (
                  <span className="text-[11px] font-medium text-destructive">
                    Expiry must be after today — renewals with an already-expired date cannot resolve the flag.
                  </span>
                )}
              </div>
            )}

            {resType === "deferred" && (
              <DateField
                label="Defer Until"
                value={deferredUntil}
                onChange={setDeferredUntil}
                helper={`Max ${MAX_DEFER_DAYS} days from today.`}
                disabledFn={(d) =>
                  d.getTime() <= today.getTime() || d.getTime() > maxDefer.getTime()
                }
              />
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="evidence" className="flex items-center gap-1.5 text-sm font-semibold">
                Evidence Reference
                <span
                  className={cn(
                    "text-[10px] font-medium uppercase tracking-wide",
                    evidenceRequired ? "text-rose-600" : "text-muted-foreground",
                  )}
                >
                  {evidenceRequired ? "Required" : "Optional"}
                </span>
              </Label>
              <Input
                id="evidence"
                value={evidenceRef}
                onChange={(e) => setEvidenceRef(e.target.value)}
                placeholder={
                  evidenceRequired
                    ? "Doc ID, SharePoint link, ticket #…"
                    : "Not required for defer/revoke"
                }
                className="text-sm"
              />
              {evidenceRequired && evidenceTooShort && (
                <span className="text-[11px] text-muted-foreground">
                  {MIN_EVIDENCE - trimmedEvidence.length} more chars required.
                </span>
              )}
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="cert-notes" className="text-sm font-semibold">
                  Manager Justification
                </Label>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    notesTooShort ? "text-muted-foreground" : "text-emerald-600",
                  )}
                >
                  {notesTooShort
                    ? `${MIN_NOTES - trimmedNotes.length} more`
                    : "Ready"}
                </span>
              </div>
              <Textarea
                id="cert-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why this resolution? What was verified? Who signed off?"
                className="resize-none text-sm"
              />
              <Progress
                value={progress}
                className={cn("h-1", !notesTooShort && "[&>div]:bg-emerald-600")}
                aria-label={`Justification ${trimmedNotes.length} of ${MIN_NOTES} minimum characters`}
              />
            </div>

            <Button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="h-11 w-full bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                  Append Resolution Receipt
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DateField({
  label,
  value,
  onChange,
  helper,
  disabledFn,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  helper: string;
  disabledFn: (d: Date) => boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-9 w-full justify-start text-left text-sm font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "dd/MM/yyyy") : "Select a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            disabled={disabledFn}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <span className="text-[11px] text-muted-foreground">{helper}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

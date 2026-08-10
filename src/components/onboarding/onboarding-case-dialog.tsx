import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Printer, Save, CheckCircle2, FileCheck } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  confirmOnboardingCase,
  fileOnboardingCase,
  saveOnboardingDraft,
  type OnboardingCase,
} from "@/lib/api/onboarding";
import {
  missingFieldsForPayload,
  ONBOARDING_PACK_LABELS,
  type ClientFormPayload,
  type OnboardingFormPayload,
  type StaffFormPayload,
  type VolunteerFormPayload,
  type AccompanyingFormPayload,
} from "@/lib/onboarding/form-types";
import { ClientOnboardingForm } from "@/components/onboarding/forms/client-onboarding-form";
import { WorkforceOnboardingForm } from "@/components/onboarding/forms/workforce-onboarding-form";
import { AccompanyingOnboardingForm } from "@/components/onboarding/forms/accompanying-onboarding-form";
import { OnboardingPrintView } from "@/components/onboarding/onboarding-print-view";
import { useParticipants } from "@/hooks/use-supabase-data";
import { parseIsoDateLocal, toIsoDateString, cn } from "@/lib/utils";
import { requiredFieldOutline } from "@/lib/ui/required-field";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseRow: OnboardingCase | null;
  onSaved: (c: OnboardingCase) => void;
}

type Step = "form" | "confirm" | "print" | "file";

export function OnboardingCaseDialog({
  open,
  onOpenChange,
  caseRow,
  onSaved,
}: Props) {
  const [payload, setPayload] = useState<OnboardingFormPayload | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [printBlank, setPrintBlank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [officeAck, setOfficeAck] = useState(false);
  const [filingLocation, setFilingLocation] = useState("");
  const [signeeName, setSigneeName] = useState("");
  const [signeeRelationship, setSigneeRelationship] = useState("");
  const [signedAt, setSignedAt] = useState(() => toIsoDateString(new Date()));
  const { data: participants = [] } = useParticipants();

  useEffect(() => {
    if (open && caseRow) {
      setPayload(caseRow.formPayload);
      setStep(
        caseRow.status === "office_confirmed"
          ? "print"
          : caseRow.status === "signed_filed"
            ? "file"
            : "form",
      );
      setPrintBlank(false);
      setOfficeAck(false);
      setFilingLocation(caseRow.filingLocation ?? "");
      setSigneeName(caseRow.signeeName ?? "");
      setSigneeRelationship(caseRow.signeeRelationship ?? "");
      setSignedAt(
        caseRow.signedAt
          ? caseRow.signedAt.slice(0, 10)
          : toIsoDateString(new Date()),
      );
    }
  }, [open, caseRow]);

  const confirmMissing = useMemo(
    () => (payload ? missingFieldsForPayload(payload, "confirm") : []),
    [payload],
  );
  const draftMissing = useMemo(
    () => (payload ? missingFieldsForPayload(payload, "draft_save") : []),
    [payload],
  );

  if (!caseRow || !payload) return null;

  const title = `${ONBOARDING_PACK_LABELS[caseRow.packType]} — ${caseRow.displayName ?? "Draft"}`;

  const persistDraft = async () => {
    setBusy(true);
    try {
      const saved = await saveOnboardingDraft(caseRow.id, payload);
      onSaved(saved);
      toast.success("Draft saved");
    } catch (e) {
      toast.error("Could not save draft", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (confirmMissing.length || !officeAck) return;
    setBusy(true);
    try {
      const saved = await confirmOnboardingCase(caseRow.id, payload);
      onSaved(saved);
      toast.success("Fields confirmed — operational record updated");
      setStep("print");
    } catch (e) {
      toast.error("Confirm failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const runPrint = (blank: boolean) => {
    setPrintBlank(blank);
    setStep("print");
    // Allow paint then print
    window.setTimeout(() => window.print(), 250);
  };

  const runFile = async () => {
    if (filingLocation.trim().length < 6 || !signeeName.trim() || !signedAt) {
      return;
    }
    setBusy(true);
    try {
      const saved = await fileOnboardingCase(caseRow.id, {
        payload,
        filingLocation,
        signedAt,
        signeeName,
        signeeRelationship,
      });
      onSaved(saved);
      toast.success("Signed & filed — Hub review dates set (+12 months)");
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not file", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92vh] max-w-3xl flex-col gap-0 p-0 print:max-h-none print:max-w-none print:border-0 print:shadow-none",
        )}
      >
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            [data-onboarding-print], [data-onboarding-print] * { visibility: visible !important; }
            [data-onboarding-print] {
              position: absolute !important;
              left: 0; top: 0; width: 100%;
            }
            [data-onboarding-chrome] { display: none !important; }
          }
        `}</style>

        <div data-onboarding-chrome className="border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Status: {caseRow.status.replace("_", " ")} · Step: {step}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(
              [
                ["form", "1. Form"],
                ["confirm", "2. Confirm"],
                ["print", "3. Print"],
                ["file", "4. File"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={cn(
                  "rounded-full border px-2.5 py-1",
                  step === k
                    ? "border-primary bg-primary/10 font-medium"
                    : "text-muted-foreground",
                )}
                onClick={() => setStep(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          {step === "form" || step === "confirm" ? (
            <div className="pr-2">
              {payload.pack === "client" ? (
                <ClientOnboardingForm
                  value={payload}
                  onChange={(p) => setPayload(p)}
                />
              ) : null}
              {payload.pack === "staff" || payload.pack === "volunteer" ? (
                <WorkforceOnboardingForm
                  value={payload as StaffFormPayload | VolunteerFormPayload}
                  onChange={(p) => setPayload(p)}
                />
              ) : null}
              {payload.pack === "accompanying" ? (
                <AccompanyingOnboardingForm
                  value={payload as AccompanyingFormPayload}
                  onChange={(p) => setPayload(p)}
                  participants={participants}
                />
              ) : null}

              {step === "confirm" ? (
                <div className="mt-6 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                  <p className="text-sm font-semibold">Office confirm fields</p>
                  <p className="text-xs text-muted-foreground">
                    Check that answers match the interview / paper notes, then
                    confirm to write the operational record (participant, staff,
                    carer, schedules).
                  </p>
                  {confirmMissing.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      Missing: {confirmMissing.join(" · ")}
                    </div>
                  ) : null}
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={officeAck}
                      onCheckedChange={(c) => setOfficeAck(!!c)}
                      className="mt-0.5"
                    />
                    I confirm these fields are accurate for ALPHA filing.
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "print" ? (
            <div>
              <div
                data-onboarding-chrome
                className="mb-4 flex flex-wrap gap-2"
              >
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => runPrint(false)}
                >
                  <Printer className="h-4 w-4" />
                  Print filled
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => runPrint(true)}
                >
                  <Printer className="h-4 w-4" />
                  Print blank
                </Button>
              </div>
              <OnboardingPrintView
                payload={
                  printBlank && payload.pack === "client"
                    ? ({
                        ...payload,
                        firstName: "",
                        lastName: "",
                      } as ClientFormPayload)
                    : payload
                }
                blank={printBlank}
                filingLocation={filingLocation}
                signeeName={signeeName}
                signeeRelationship={signeeRelationship}
                signedAt={signedAt}
              />
            </div>
          ) : null}

          {step === "file" ? (
            <div className="space-y-4 pr-2">
              <p className="text-sm text-muted-foreground">
                After wet-sign, record where the paper pack is filed. Hub review
                assets reset to +12 months from the signed date.
              </p>
              <CharacterCountedInput
                label="Filing location *"
                value={filingLocation}
                onValueChange={setFilingLocation}
                minChars={6}
                maxChars={200}
                hint="e.g. Filing cabinet A / Client Smith / Intake 2026-08"
              />
              <div className="space-y-1.5">
                <Label>Signed date *</Label>
                <DatePicker
                  value={parseIsoDateLocal(signedAt)}
                  onChange={(d) => setSignedAt(d ? toIsoDateString(d) : "")}
                  className={cn(
                    "h-10 w-full",
                    requiredFieldOutline(!signedAt.trim()),
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Signee name *</Label>
                <Input
                  value={signeeName}
                  onChange={(e) => setSigneeName(e.target.value)}
                  className={requiredFieldOutline(!signeeName.trim())}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Relationship to person</Label>
                <Input
                  value={signeeRelationship}
                  onChange={(e) => setSigneeRelationship(e.target.value)}
                  placeholder="Self / Parent / Guardian / …"
                />
              </div>
            </div>
          ) : null}
        </ScrollArea>

        <DialogFooter
          data-onboarding-chrome
          className="flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:justify-between"
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            {step === "form" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy || draftMissing.length > 0}
                  onClick={persistDraft}
                >
                  <Save className="h-4 w-4" />
                  Save draft
                </Button>
                <Button
                  type="button"
                  disabled={busy || draftMissing.length > 0}
                  onClick={() => setStep("confirm")}
                >
                  Continue to confirm
                </Button>
              </>
            ) : null}
            {step === "confirm" ? (
              <Button
                type="button"
                className="gap-1.5"
                disabled={busy || confirmMissing.length > 0 || !officeAck}
                onClick={runConfirm}
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirm fields
              </Button>
            ) : null}
            {step === "print" ? (
              <Button type="button" onClick={() => setStep("file")}>
                Continue to file
              </Button>
            ) : null}
            {step === "file" ? (
              <Button
                type="button"
                className="gap-1.5"
                disabled={
                  busy ||
                  filingLocation.trim().length < 6 ||
                  !signeeName.trim() ||
                  !signedAt.trim()
                }
                onClick={runFile}
              >
                <FileCheck className="h-4 w-4" />
                Mark signed &amp; filed
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

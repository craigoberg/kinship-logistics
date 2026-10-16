import { useEffect, useMemo, useRef, useState } from "react";
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
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PinEntryDialog } from "@/components/auth/pin-entry-dialog";
import {
  resolveOperatorStaffIdFromPin,
  verifyManagerPin,
} from "@/components/auth/pin-verify";
import {
  confirmOnboardingCase,
  fileOnboardingCase,
  priorOnboardingReviewDueAt,
  upsertOnboardingDraft,
  type OnboardingCase,
} from "@/lib/api/onboarding";
import {
  hydrateOnboardingPayload,
  missingFieldsForPayload,
  ONBOARDING_PACK_LABELS,
  type ClientFormPayload,
  type OnboardingFormPayload,
  type OnboardingPackType,
  type StaffFormPayload,
  type VolunteerFormPayload,
  type AccompanyingFormPayload,
} from "@/lib/onboarding/form-types";
import { ClientOnboardingForm } from "@/components/onboarding/forms/client-onboarding-form";
import { WorkforceOnboardingForm } from "@/components/onboarding/forms/workforce-onboarding-form";
import { AccompanyingOnboardingForm } from "@/components/onboarding/forms/accompanying-onboarding-form";
import {
  OnboardingPrintPortal,
  OnboardingPrintView,
} from "@/components/onboarding/onboarding-print-view";
import { useParticipants } from "@/hooks/use-supabase-data";
import { cn, parseIsoDateLocal, todayLocalIso, toIsoDateString } from "@/lib/utils";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { daysUntilIsoDate } from "@/lib/onboarding/review-urgency";
import { useOperationalTodayIso } from "@/lib/operational-clock";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseRow: OnboardingCase | null;
  /** Required when opening a new pack that has not been saved yet. */
  packType?: OnboardingPackType;
  seedPayload?: Partial<OnboardingFormPayload>;
  subjectTable?: string | null;
  subjectId?: string | null;
  onSaved: (c: OnboardingCase) => void;
}

type Step = "form" | "confirm" | "print" | "file";

export function OnboardingCaseDialog({
  open,
  onOpenChange,
  caseRow,
  packType,
  seedPayload,
  subjectTable,
  subjectId,
  onSaved,
}: Props) {
  const [payload, setPayload] = useState<OnboardingFormPayload | null>(null);
  const [persistedId, setPersistedId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [printBlank, setPrintBlank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [officeAck, setOfficeAck] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [lateReason, setLateReason] = useState("");
  const [priorDue, setPriorDue] = useState<string | null>(null);
  const [filingLocation, setFilingLocation] = useState("");
  const [signeeName, setSigneeName] = useState("");
  const [signeeRelationship, setSigneeRelationship] = useState("");
  const [signedAt, setSignedAt] = useState(() => todayLocalIso());
  const { data: participants = [] } = useParticipants();
  const todayIso = useOperationalTodayIso();
  const scrollRootRef = useRef<HTMLDivElement>(null);

  const resolvedPack = caseRow?.packType ?? packType ?? null;
  const status = caseRow?.status ?? "draft";

  useEffect(() => {
    if (!open) return;
    const pack = caseRow?.packType ?? packType;
    if (!pack) return;
    if (caseRow) {
      setPayload(caseRow.formPayload);
      setPersistedId(caseRow.id);
      setStep(
        caseRow.status === "office_confirmed"
          ? "print"
          : caseRow.status === "signed_filed"
            ? "file"
            : "form",
      );
      setFilingLocation(caseRow.filingLocation ?? "");
      setSigneeName(caseRow.signeeName ?? "");
      setSigneeRelationship(caseRow.signeeRelationship ?? "");
      setSignedAt(
        caseRow.signedAt ? caseRow.signedAt.slice(0, 10) : todayLocalIso(),
      );
    } else {
      setPayload(hydrateOnboardingPayload(pack, seedPayload));
      setPersistedId(null);
      setStep("form");
      setFilingLocation("");
      setSigneeName("");
      setSigneeRelationship("");
      setSignedAt(todayLocalIso());
    }
    setPrintBlank(false);
    setOfficeAck(false);
    setLateReason("");
    setPinOpen(false);
    // Snapshot once when the dialog opens. Do not re-hydrate after Save draft
    // assigns an id — that would reset the step (form/confirm/file).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const table = subjectTable ?? caseRow?.subjectTable ?? null;
    const id = subjectId ?? caseRow?.subjectId ?? null;
    if (!table || !id) {
      setPriorDue(null);
      return;
    }
    void priorOnboardingReviewDueAt({
      excludeId: caseRow?.id ?? persistedId,
      subjectTable: table,
      subjectId: id,
    })
      .then(setPriorDue)
      .catch(() => setPriorDue(null));
  }, [
    open,
    subjectTable,
    subjectId,
    caseRow?.id,
    caseRow?.subjectTable,
    caseRow?.subjectId,
    persistedId,
  ]);

  useEffect(() => {
    if (step !== "confirm") return;
    const vp = scrollRootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    vp?.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const confirmMissing = useMemo(
    () => (payload ? missingFieldsForPayload(payload, "confirm") : []),
    [payload],
  );
  const draftMissing = useMemo(
    () => (payload ? missingFieldsForPayload(payload, "draft_save") : []),
    [payload],
  );

  if (!open || !resolvedPack || !payload) return null;

  const title = `${ONBOARDING_PACK_LABELS[resolvedPack]} — ${
    caseRow?.displayName ?? "New pack"
  }`;

  const printPayload: OnboardingFormPayload =
    printBlank && payload.pack === "client"
      ? ({
          ...payload,
          firstName: "",
          lastName: "",
        } as ClientFormPayload)
      : payload;

  const printNode = (
    <OnboardingPrintView
      payload={printPayload}
      blank={printBlank}
      filingLocation={filingLocation}
      signeeName={signeeName}
      signeeRelationship={signeeRelationship}
      signedAt={signedAt}
    />
  );

  const daysLate = priorDue ? daysUntilIsoDate(priorDue, todayIso) : null;
  const reviewOverdue = daysLate !== null && daysLate < 0;
  const lateReasonOk = !reviewOverdue || lateReason.trim().length >= 20;
  const fileReady =
    filingLocation.trim().length >= 6 &&
    !!signeeName.trim() &&
    !!signedAt.trim() &&
    lateReasonOk;

  const persistDraftRow = async (): Promise<OnboardingCase> => {
    const saved = await upsertOnboardingDraft({
      id: persistedId ?? caseRow?.id,
      packType: resolvedPack,
      payload,
      subjectTable: subjectTable ?? caseRow?.subjectTable,
      subjectId: subjectId ?? caseRow?.subjectId,
    });
    setPersistedId(saved.id);
    onSaved(saved);
    return saved;
  };

  const persistDraft = async () => {
    setBusy(true);
    try {
      await persistDraftRow();
      toast.success("Draft saved");
    } catch (e) {
      toast.error("Could not save draft", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = () => {
    if (confirmMissing.length || !officeAck) return;
    setPinOpen(true);
  };

  const verifyConfirmPin = async (pin: string) => {
    const staffId = await resolveOperatorStaffIdFromPin(pin);
    if (payload.pack === "staff" || payload.pack === "volunteer") {
      await verifyManagerPin(staffId, pin);
    }
    const draft = await persistDraftRow();
    const saved = await confirmOnboardingCase(draft.id, payload, {
      confirmedByStaffId: staffId,
    });
    onSaved(saved);
    setStep("print");
  };

  const runPrint = (blank: boolean) => {
    setPrintBlank(blank);
    if (!blank) setStep("print");
    window.setTimeout(() => window.print(), 400);
  };

  const runFile = async () => {
    if (!fileReady) return;
    if (status === "draft" && !caseRow?.subjectId) {
      toast.error("Confirm fields first", {
        description: "Office PIN confirm writes the live record before filing.",
      });
      setStep("confirm");
      return;
    }
    setBusy(true);
    try {
      const draft = await persistDraftRow();
      const saved = await fileOnboardingCase(draft.id, {
        payload,
        filingLocation,
        signedAt,
        signeeName,
        signeeRelationship,
        lateReason: reviewOverdue ? lateReason : undefined,
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(92dvh,900px)] max-h-[92dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0",
        )}
      >
        <div data-onboarding-chrome className="border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Status: {status.replace("_", " ")} · Step: {step}. Print blank
              anytime — no fields required. Transcribe later, then confirm and
              print filled.
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

        <div ref={scrollRootRef} className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          {step === "form" || step === "confirm" ? (
            <div className="pr-2">
              {step === "form" ? (
                <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  Paper first? Use <span className="font-medium">Print blank</span>{" "}
                  in the footer — no name or answers needed. Fill by hand, type
                  it in here, then Confirm and print the filled pack to wet-sign.
                </div>
              ) : null}
              {step === "confirm" ? (
                <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  Scan the answers from the top. The office tick and PIN stay in
                  the footer — you do not need to scroll to the end of the form.
                </div>
              ) : null}
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
            </div>
          ) : null}

          {step === "print" ? (
            <div className="print:hidden">
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
              {printNode}
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
              {reviewOverdue ? (
                <CharacterCountedTextarea
                  label="Why was this review late? *"
                  value={lateReason}
                  onValueChange={setLateReason}
                  minChars={20}
                  maxChars={500}
                  hint={`Due ${priorDue} · ${Math.abs(daysLate ?? 0)} day${Math.abs(daysLate ?? 0) === 1 ? "" : "s"} overdue. Not a Human Incident — this stays on the pack trail.`}
                />
              ) : null}
            </div>
          ) : null}
        </ScrollArea>
        </div>

        <DialogFooter
          data-onboarding-chrome
          className="flex-col gap-2 border-t px-6 py-4 sm:flex-col"
        >
          {step === "form" && confirmMissing.length > 0 ? (
            <div className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Scroll the form — still needed before Confirm:{" "}
              {confirmMissing.join(" · ")}
            </div>
          ) : null}
          {step === "confirm" ? (
            <div className="w-full space-y-3">
              {confirmMissing.length > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Still needed: {confirmMissing.join(" · ")}
                </div>
              ) : (
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    !officeAck
                      ? "border-destructive bg-destructive/10"
                      : "border-amber-500/40 bg-amber-500/5",
                  )}
                >
                  <label className="flex items-start gap-2">
                    <Checkbox
                      checked={officeAck}
                      onCheckedChange={(c) => setOfficeAck(!!c)}
                      className={cn("mt-0.5", requiredFieldOutline(!officeAck))}
                    />
                    <span>
                      I confirm these fields match the interview / paper notes
                      and can be written to the live record.
                    </span>
                  </label>
                  {!officeAck ? (
                    <p className="mt-2 text-xs text-destructive">
                      Tick this box, then Confirm fields. Your PIN records who
                      entered the information.
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Next: Confirm fields opens the PIN pad.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}
          {step === "file" && !fileReady ? (
            <div className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Still needed:{" "}
              {[
                filingLocation.trim().length < 6 ? "Filing location" : null,
                !signedAt.trim() ? "Signed date" : null,
                !signeeName.trim() ? "Signee name" : null,
                reviewOverdue && !lateReasonOk ? "Why the review was late" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-between">
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
                  disabled={busy}
                  onClick={() => runPrint(true)}
                >
                  <Printer className="h-4 w-4" />
                  Print blank
                </Button>
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
                  disabled={busy || confirmMissing.length > 0}
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
                Confirm fields — PIN
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
                disabled={busy || !fileReady}
                onClick={runFile}
              >
                <FileCheck className="h-4 w-4" />
                Mark signed &amp; filed
              </Button>
            ) : null}
          </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <PinEntryDialog
      open={pinOpen}
      onOpenChange={setPinOpen}
      title="Confirm onboarding fields"
      description={
        payload.pack === "staff" || payload.pack === "volunteer"
          ? "Manager PIN writes the live staff record and records who entered the pack."
          : "Office PIN writes the live record and records who entered this information."
      }
      length={4}
      onVerify={verifyConfirmPin}
      onSuccess={() => {
        setPinOpen(false);
        toast.success("Fields confirmed — operational record updated");
      }}
    />
    <OnboardingPrintPortal
      payload={printPayload}
      blank={printBlank}
      filingLocation={filingLocation}
      signeeName={signeeName}
      signeeRelationship={signeeRelationship}
      signedAt={signedAt}
    />
    </>
  );
}

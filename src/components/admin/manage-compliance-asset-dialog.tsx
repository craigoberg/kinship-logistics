import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { operationToasts } from "@/lib/ui/operation-toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  appendComplianceAssetNote,
  computeRyge,
  deferComplianceAsset,
  listComplianceAssetNotes,
  renderComplianceNoteLine,
  saveComplianceAssetRenewal,
  startComplianceAssetReview,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import { executeComplianceResolution } from "@/lib/api/compliance-resolution";
import { useComplianceWarningDays } from "@/hooks/use-system-parameters";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { FormattedDate, FormattedDateTime } from "@/components/ui/formatted-time";
import { HubContextMetaGrid } from "@/components/governance/hub-context-meta-grid";
import { ManageItemShell } from "@/components/governance/manage-item-shell";
import { NextExpiryDateField } from "@/components/governance/next-expiry-date-field";
import {
  ComplianceResolutionPanel,
  type ComplianceResolutionPanelHandle,
} from "@/components/governance/compliance-resolution-panel";
import { useComplianceResolutionContext } from "@/hooks/use-compliance-resolution-context";
import { defaultDeferIso } from "@/lib/governance/default-defer-iso";
import { NextActionDateTimeField } from "@/components/governance/next-action-datetime-field";
import { isManagerProfile } from "@/lib/governance/is-manager";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import { MIN_EVIDENCE, MIN_TIMELINE_NOTE } from "@/lib/governance/constants";
import {
  findHubReviewStartedNote,
  formatHubWaitDuration,
  isHubReviewStarted,
} from "@/lib/governance/hub-review-started";
import { parseExpiryBase, startOfDay, toISODate } from "@/lib/governance/next-expiry";

interface Props {
  asset: ComplianceAsset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function rygeBadge(
  asset: ComplianceAsset,
  params: { default: number; shortCycle: number },
) {
  const r = computeRyge(asset, params);
  if (r === "red")
    return <Badge className="bg-destructive text-destructive-foreground">RED</Badge>;
  if (r === "yellow") return <Badge className="bg-yellow-500 text-black">YELLOW</Badge>;
  return <Badge className="bg-emerald-600 text-white">GREEN</Badge>;
}

function needsGenericRenewalEvidence(asset: ComplianceAsset): boolean {
  return (
    asset.action_module === "insurance_renewal" ||
    asset.action_module === "generic_resolve"
  );
}

function needsDomainFields(asset: ComplianceAsset): boolean {
  return (
    asset.action_module === "vehicle_rego" ||
    asset.action_module === "vehicle_service" ||
    asset.action_module === "formal_audit" ||
    asset.action_module === "staff_cert"
  );
}

type PendingAction = "resolve";

export function ManageComplianceAssetDialog({
  asset,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const warningDays = useComplianceWarningDays();
  const domainRef = useRef<ComplianceResolutionPanelHandle>(null);
  const resolutionContext = useComplianceResolutionContext(open ? asset : null);

  const [note, setNote] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [nextExpiry, setNextExpiry] = useState<Date | undefined>(undefined);
  const [deferOn, setDeferOn] = useState(false);
  const [deferAt, setDeferAt] = useState(defaultDeferIso());
  const [deferDatetimeValid, setDeferDatetimeValid] = useState(true);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>("resolve");
  const [domainFieldsValid, setDomainFieldsValid] = useState(true);

  const showDomainFields = needsDomainFields(asset);
  const showGenericEvidence = needsGenericRenewalEvidence(asset);
  const expiryBase = asset.expiry_date ?? null;

  const renewalMin = useMemo(() => {
    const base = parseExpiryBase(expiryBase);
    return startOfDay(new Date(Math.max(Date.now(), base.getTime())));
  }, [expiryBase]);

  useEffect(() => {
    if (open) {
      setNote("");
      setEvidenceRef("");
      setNextExpiry(undefined);
      setDeferOn(false);
      setDeferAt(defaultDeferIso());
      setDeferDatetimeValid(true);
      setPinOpen(false);
      setPendingAction("resolve");
      setDomainFieldsValid(!needsDomainFields(asset));
    }
  }, [open]);

  const timelineQuery = useQuery({
    queryKey: ["compliance-asset-timeline", asset.id],
    enabled: open,
    refetchInterval: 8_000,
    queryFn: () => listComplianceAssetNotes(asset.id),
  });

  const trimmed = note.trim().length;
  const noteOk = trimmed >= MIN_TIMELINE_NOTE;
  const deferValid = !deferOn || deferDatetimeValid;

  const nextExpiryIso = nextExpiry ? toISODate(nextExpiry) : "";
  const expiryOk =
    !!nextExpiry && nextExpiry.getTime() > renewalMin.getTime();

  const resolveEvidenceOk =
    !showGenericEvidence || evidenceRef.trim().length >= MIN_EVIDENCE;

  const domainOk = !showDomainFields || domainFieldsValid;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["compliance-assets"] });
    qc.invalidateQueries({ queryKey: ["compliance-asset-timeline", asset.id] });
    qc.invalidateQueries({ queryKey: ["fleet"] });
    qc.invalidateQueries({ queryKey: ["staff-registry", "all"] });
    invalidateIssueCaches(qc, { source: "renewal", sourceRowId: asset.id });
  };

  const logMut = useMutation({
    mutationFn: async () => {
      if (deferOn) {
        await deferComplianceAsset(asset.id, {
          untilIso: new Date(deferAt).toISOString(),
          note,
        });
        return "defer" as const;
      }
      const optionalEvidence = evidenceRef.trim();
      await appendComplianceAssetNote(asset.id, note, {
        evidenceRef: optionalEvidence.length > 0 ? optionalEvidence : undefined,
      });
      return "append" as const;
    },
    onSuccess: (kind) => {
      invalidateAll();
      setNote("");
      setEvidenceRef("");
      setDeferOn(false);
      if (kind === "defer") {
        operationToasts.complianceDeferred();
      } else {
        operationToasts.complianceNoteLogged();
      }
      // Dialog stays open — user can add more notes or close manually.
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const startMut = useMutation({
    mutationFn: () => startComplianceAssetReview(asset.id),
    onSuccess: () => {
      invalidateAll();
      const waitLabel = formatHubWaitDuration(asset.created_at, new Date().toISOString());
      operationToasts.reviewStarted(waitLabel);
    },
    onError: (e: Error) => operationToasts.actionFailed(e.message),
  });

  const resolveMut = useMutation({
    mutationFn: async () => {
      if (deferOn) {
        throw new Error("Cannot resolve while defer is selected. Use Log Note instead.");
      }

      if (!nextExpiryIso) throw new Error("Next expiry date is required.");

      if (showDomainFields) {
        const panel = domainRef.current;
        if (!panel?.validate(nextExpiryIso)) {
          throw new Error("Complete all required fields.");
        }
        const payload = panel.getPayload(nextExpiryIso);
        if (!payload) throw new Error("Invalid resolution payload.");
        await executeComplianceResolution({
          asset,
          context: resolutionContext,
          timelineNote: note,
          payload,
        });
        return;
      }

      await saveComplianceAssetRenewal(asset.id, {
        note,
        newExpiry: nextExpiryIso,
        evidenceRef: evidenceRef.trim(),
      });
    },
    onSuccess: () => {
      invalidateAll();
      setNote("");
      setEvidenceRef("");
      operationToasts.complianceResolved();
      onOpenChange(false);
    },
    onError: (e: Error) => operationToasts.resolutionFailed(e.message),
  });

  // startMut runs in the background (Open → In Progress transition) — exclude from busy
  // so it doesn't lock the UI while the status change completes.
  const busy = logMut.isPending || resolveMut.isPending;

  const canLog = noteOk && deferValid && !busy;
  const canResolve =
    noteOk &&
    !deferOn &&
    expiryOk &&
    domainOk &&
    resolveEvidenceOk &&
    !busy &&
    !resolutionContext.loading;

  const handleLogClick = () => {
    if (!canLog) return;
    logMut.mutate();
  };

  const openPin = (action: PendingAction) => {
    if (action === "resolve" && !canResolve) return;
    setPendingAction(action);
    const panel = domainRef.current;
    if (
      action === "resolve" &&
      showDomainFields &&
      panel?.usesEmbeddedPin
    ) {
      resolveMut.mutate();
      return;
    }
    setPinOpen(true);
  };

  const handlePinAuthenticated = () => {
    if (!isManagerProfile()) {
      operationToasts.managerPinRequired();
      setPinOpen(false);
      return;
    }
    setPinOpen(false);
    resolveMut.mutate();
  };

  const timelineLines = useMemo(
    () => (timelineQuery.data ?? []).map(renderComplianceNoteLine),
    [timelineQuery.data],
  );

  const complianceNotesForReview = useMemo(
    () =>
      (timelineQuery.data ?? []).map((n) => ({
        note: n.note,
        stampedAt: n.stampedAt,
        metadata: n.metadata,
      })),
    [timelineQuery.data],
  );
  const reviewStartedNote = useMemo(
    () => findHubReviewStartedNote(complianceNotesForReview),
    [complianceNotesForReview],
  );
  const reviewStarted = isHubReviewStarted(complianceNotesForReview);
  const hubAppearedAt = asset.created_at;
  const waitLabel = reviewStartedNote
    ? formatHubWaitDuration(hubAppearedAt, reviewStartedNote.stampedAt)
    : formatHubWaitDuration(hubAppearedAt, new Date().toISOString());

  const renewalSection = (
    <>
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Next expiry / renewal date {!deferOn && <span className="text-destructive">*</span>}
      </Label>
      {!deferOn && (
        <NextExpiryDateField
          baseDate={expiryBase}
          resetKey={asset.id}
          value={nextExpiry}
          onChange={setNextExpiry}
          minDate={renewalMin}
          label=""
          applyDefaultFromBase
        />
      )}
      {showDomainFields && !deferOn && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Additional details
          </Label>
          <ComplianceResolutionPanel
            ref={domainRef}
            asset={asset}
            context={resolutionContext}
            hideExpiryFields
            externalExpiryIso={nextExpiryIso}
            onValidityChange={setDomainFieldsValid}
          />
        </div>
      )}
      {showGenericEvidence && (
        <div className="border-t border-border/60 pt-3">
          <CharacterCountedInput
            label="Evidence reference"
            value={evidenceRef}
            onValueChange={setEvidenceRef}
            minChars={MIN_EVIDENCE}
            placeholder="Policy #, invoice ref, SharePoint link…"
            required={!deferOn}
            hint={deferOn ? "Optional when logging a note" : "Required to resolve"}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={deferOn}
            onCheckedChange={(v) => setDeferOn(v === true)}
            disabled={busy}
          />
          Defer / set next action date (instead of renewal)
        </label>
      </div>
      {deferOn && (
        <div className="pl-1">
          <NextActionDateTimeField
            id="compliance-defer-at"
            value={deferAt}
            onChange={setDeferAt}
            onValidChange={setDeferDatetimeValid}
          />
        </div>
      )}
    </>
  );

  const contextCard = (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {rygeBadge(asset, warningDays)}
        <Badge variant="secondary">{asset.category}</Badge>
        {reviewStarted && (
          <Badge className="bg-sky-600 text-white text-[10px]">In Review</Badge>
        )}
        <span className="font-mono text-xs text-muted-foreground">{asset.type}</span>
      </div>
      <p className="font-medium leading-snug">{asset.name}</p>
      {asset.description && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {asset.description}
        </p>
      )}
      <HubContextMetaGrid
        rows={[
          { label: "Expires", value: asset.expiry_date ? <FormattedDate value={asset.expiry_date} /> : null },
          {
            label: "Entity",
            value: (asset as Record<string, unknown>).associated_entity_name
              ? String((asset as Record<string, unknown>).associated_entity_name)
              : null,
          },
          { label: "In Hub since", value: <FormattedDateTime value={hubAppearedAt} /> },
          reviewStarted && reviewStartedNote
            ? {
                label: "Review started",
                value: (
                  <>
                    <FormattedDateTime value={reviewStartedNote.stampedAt} />
                    {waitLabel ? ` (${waitLabel} after in Hub)` : ""}
                  </>
                ),
              }
            : { label: "Waiting", value: `${waitLabel} since in Hub` },
        ]}
      />
    </div>
  );

  return (
    <>
      <ManageItemShell
        open={open}
        onOpenChange={(o) => {
          if (!o) setNote("");
          onOpenChange(o);
        }}
        busy={busy}
        title="Manage compliance asset"
        description="Log a note or defer the next action. Resolve when the renewal is complete — updates expiry, archives the asset, and logs to NDIS. Cannot resolve while deferred."
        contextCard={contextCard}
        timelineLines={timelineLines}
        timelineLoading={timelineQuery.isFetching && !timelineQuery.data}
        note={note}
        onNoteChange={setNote}
        renewalSection={renewalSection}
        showDefer={false}
        onLogUpdate={handleLogClick}
        logUpdateLabel="Log Note"
        canLog={canLog}
        onResolveClose={() => openPin("resolve")}
        resolveCloseLabel="Resolve"
        canResolve={canResolve}
        extraFooterStart={
          !reviewStarted ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => startMut.mutate()}
            >
              {startMut.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Start Review
            </Button>
          ) : undefined
        }
      />

      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Manager PIN required to save compliance asset changes."
        onAuthenticated={handlePinAuthenticated}
      />
    </>
  );
}

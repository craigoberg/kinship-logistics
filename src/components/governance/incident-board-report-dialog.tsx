import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IncidentBoardPrintPortal } from "@/components/governance/incident-board-print";
import { invalidateIssueCaches } from "@/lib/query/invalidation";
import { MAINTENANCE_ITEMS_KEY } from "@/lib/api/maintenance";
import {
  boardOfficeSqlHint,
  emptyBoardOffice,
  loadIncidentBoard,
  saveIncidentBoardOffice,
  toBoardPrintModel,
  type BoardActionRequired,
  type BoardHubSource,
  type BoardOffice,
  type IncidentBoardFacts,
  type NdisReportType,
} from "@/lib/incident-board-report";
import { parseIsoDateLocal, toIsoDateString } from "@/lib/utils";

interface Props {
  hubSource: BoardHubSource;
  hubRowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true ? true : null)}
          />
          Yes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === false}
            onCheckedChange={(checked) => onChange(checked === true ? false : null)}
          />
          No
        </label>
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <DatePicker
          value={parseIsoDateLocal(value)}
          onChange={(d) => onChange(d ? toIsoDateString(d) : "")}
          placeholder="Date"
        />
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ShortField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function IncidentBoardReportDialog({ hubSource, hubRowId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const sourceRef = useRef({ hubSource, hubRowId });
  sourceRef.current = { hubSource, hubRowId };
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [facts, setFacts] = useState<IncidentBoardFacts | null>(null);
  const [draft, setDraft] = useState<BoardOffice>(emptyBoardOffice);
  const [baseline, setBaseline] = useState("");
  const [printArmed, setPrintArmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setPrintArmed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFacts(null);
    const current = sourceRef.current;
    void loadIncidentBoard(current)
      .then((loaded) => {
        if (cancelled) return;
        setFacts(loaded.facts);
        setDraft(loaded.office);
        setBaseline(JSON.stringify(loaded.office));
        if (current.hubSource === "maintenance") {
          qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
        } else {
          invalidateIssueCaches(qc, {
            source: current.hubSource === "incident" ? "incident" : current.hubSource,
            sourceRowId: current.hubRowId,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const schema = boardOfficeSqlHint(
          err && typeof err === "object" ? (err as { code?: string; message?: string }) : null,
        );
        toast.error(
          schema
            ? "Board report needs the incident-number SQL loaded first."
            : "Could not open the board report.",
        );
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, hubRowId, onOpenChange, qc]);

  useEffect(() => {
    if (!printArmed) return;
    const t = window.setTimeout(() => {
      window.print();
      setPrintArmed(false);
    }, 400);
    return () => window.clearTimeout(t);
  }, [printArmed]);

  const dirty = JSON.stringify(draft) !== baseline;
  const printModel = useMemo(
    () => (facts ? toBoardPrintModel(facts, draft) : null),
    [facts, draft],
  );

  function patch(partial: Partial<BoardOffice>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  async function handleSave() {
    if (!facts || !dirty) return;
    setSaving(true);
    try {
      const before = JSON.parse(baseline) as BoardOffice;
      await saveIncidentBoardOffice(facts.incidentId, facts.incidentNumber, before, draft);
      setBaseline(JSON.stringify(draft));
      if (hubSource === "maintenance") {
        qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
      } else {
        invalidateIssueCaches(qc, {
          source: hubSource === "incident" ? "incident" : hubSource,
          sourceRowId: hubRowId,
        });
      }
      toast.success(`Saved board report ${facts.incidentNumber}`);
    } catch (err) {
      console.error("[incident-board] save failed", err);
      toast.error("Could not save the board report.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Incident report{facts ? ` · ${facts.incidentNumber}` : ""}
            </DialogTitle>
            <DialogDescription>
              Same layout as the board pack. Who, when, and the account come from the Hub
              ticket. Fill the office fields, save, then print.
            </DialogDescription>
          </DialogHeader>

          {loading || !facts || !printModel ? (
            <p className="text-sm text-muted-foreground">Loading incident…</p>
          ) : (
            <div className="space-y-4 text-sm">
              <section className="space-y-1 rounded-md border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Who this incident refers to
                </p>
                <p>Participant: {printModel.participantLine || "—"}</p>
                <p>Worker / volunteer: {printModel.workerLine || "—"}</p>
                <ShortField
                  label="Other (state whom)"
                  value={draft.otherWhom}
                  onChange={(otherWhom) => patch({ otherWhom })}
                />
                <p className="text-xs text-muted-foreground">
                  Date of incident {facts.incidentDate || "—"} · Date of report {facts.reportDate || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reported by {facts.reporterName}
                  {facts.reporterPhone ? ` · ${facts.reporterPhone}` : ""}
                  {facts.reporterEmail ? ` · ${facts.reporterEmail}` : ""}
                </p>
              </section>

              <section className="space-y-2">
                <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">
                  {facts.description || "No description filed."}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <YesNo
                    label="Injury report"
                    value={draft.injuryReport}
                    onChange={(injuryReport) => patch({ injuryReport })}
                  />
                  <ShortField
                    label="Injured person's name"
                    value={draft.injuredName}
                    onChange={(injuredName) => patch({ injuredName })}
                  />
                  <ShortField
                    label="Incident location"
                    value={draft.location}
                    onChange={(location) => patch({ location })}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Witness
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ShortField
                    label="Name of witness"
                    value={draft.witnessName}
                    onChange={(witnessName) => patch({ witnessName })}
                  />
                  <ShortField
                    label="Phone"
                    value={draft.witnessPhone}
                    onChange={(witnessPhone) => patch({ witnessPhone })}
                  />
                  <ShortField
                    label="Email"
                    value={draft.witnessEmail}
                    onChange={(witnessEmail) => patch({ witnessEmail })}
                  />
                </div>
                <CharacterCountedTextarea
                  label="Witness description"
                  value={draft.witnessAccount}
                  onValueChange={(witnessAccount) => patch({ witnessAccount })}
                  required={false}
                  minChars={20}
                  maxChars={2000}
                  rows={3}
                  hint="Optional"
                />
              </section>

              <CharacterCountedTextarea
                label="Injuries or impact"
                value={draft.injuriesImpact}
                onValueChange={(injuriesImpact) => patch({ injuriesImpact })}
                required={false}
                minChars={20}
                maxChars={2000}
                rows={3}
                hint="Optional"
              />
              <CharacterCountedTextarea
                label="Actions taken"
                value={draft.actionsTaken}
                onValueChange={(actionsTaken) => patch({ actionsTaken })}
                required={false}
                minChars={20}
                maxChars={2000}
                rows={3}
                hint="Optional"
              />

              <section className="space-y-3 rounded-md border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Office use only
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ShortField
                    label="Report received by"
                    value={draft.receivedBy}
                    onChange={(receivedBy) => patch({ receivedBy })}
                  />
                  <DateField
                    label="Date received"
                    value={draft.receivedOn}
                    onChange={(receivedOn) => patch({ receivedOn })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Action required</Label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.actionRequired === "investigation"}
                        onCheckedChange={(checked) =>
                          patch({
                            actionRequired:
                              checked === true ? "investigation" : null,
                          })
                        }
                      />
                      Investigation
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.actionRequired === "continuous_improvement"}
                        onCheckedChange={(checked) =>
                          patch({
                            actionRequired:
                              checked === true
                                ? ("continuous_improvement" as BoardActionRequired)
                                : null,
                          })
                        }
                      />
                      Continuous improvement review
                    </label>
                  </div>
                </div>
                <CharacterCountedTextarea
                  label="Investigation outcome"
                  value={draft.investigationOutcome}
                  onValueChange={(investigationOutcome) => patch({ investigationOutcome })}
                  required={false}
                  minChars={20}
                  maxChars={2000}
                  rows={3}
                  hint="Optional"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <YesNo
                    label="Reportable incident"
                    value={draft.reportable}
                    onChange={(reportable) => patch({ reportable })}
                  />
                  <DateField
                    label="Date advised"
                    value={draft.reportableOn}
                    onChange={(reportableOn) => patch({ reportableOn })}
                  />
                  <YesNo
                    label="NDIS Commission advised"
                    value={draft.ndisAdvised}
                    onChange={(ndisAdvised) => patch({ ndisAdvised })}
                  />
                  <DateField
                    label="NDIS date advised"
                    value={draft.ndisAdvisedOn}
                    onChange={(ndisAdvisedOn) => patch({ ndisAdvisedOn })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Report type</Label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.ndisReportType === "5_day"}
                        onCheckedChange={(checked) =>
                          patch({
                            ndisReportType: checked === true ? "5_day" : null,
                          })
                        }
                      />
                      5-day report
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.ndisReportType === "24_hour"}
                        onCheckedChange={(checked) =>
                          patch({
                            ndisReportType:
                              checked === true ? ("24_hour" as NdisReportType) : null,
                          })
                        }
                      />
                      24-hour report
                    </label>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ShortField
                    label="Report escalated to"
                    value={draft.escalatedTo}
                    onChange={(escalatedTo) => patch({ escalatedTo })}
                  />
                  <DateField
                    label="Date report escalated"
                    value={draft.escalatedOn}
                    onChange={(escalatedOn) => patch({ escalatedOn })}
                  />
                </div>
                <CharacterCountedTextarea
                  label="Other information"
                  value={draft.other}
                  onValueChange={(other) => patch({ other })}
                  required={false}
                  minChars={20}
                  maxChars={2000}
                  rows={3}
                  hint="Optional"
                />
              </section>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!printModel || loading}
                onClick={() => setPrintArmed(true)}
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Print
              </Button>
              <Button type="button" disabled={!dirty || saving || loading} onClick={() => void handleSave()}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {printArmed && printModel ? <IncidentBoardPrintPortal model={printModel} /> : null}
    </>
  );
}

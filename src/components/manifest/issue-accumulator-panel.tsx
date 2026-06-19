import { useMemo, useState } from "react";
import { ClipboardCheck, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type {
  AssetCheckpoint,
  AssetDailyClearance,
  ClearanceIssueSeverity,
  NewClearanceItemInput,
  TransportAsset,
} from "@/lib/data-store";
import {
  DEFAULT_STAFF_UUID,
  getStaffId,
  insertAssetClearanceWithItems,
  submitDriverAuthorization,
} from "@/lib/data-store";
import { triggerInspectionAlert, toSeverity } from "@/hooks/use-notification-router";
import { RedHandshakeWaitingPanel } from "./red-handshake-waiting-panel";

const COMFORT_DECLARATION_TEXT =
  "I confirm that all issues have been cleanly recorded, appropriate workarounds are deployed, and I am personally comfortable, oriented, and acting in accordance with my signed Organization Onboarding Guidelines to operate safely today.";

interface DraftIssue {
  id: string;
  severity: ClearanceIssueSeverity;
  text: string;
}

function freshId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function severityChip(s: ClearanceIssueSeverity): {
  label: string;
  tone: string;
  emoji: string;
} {
  if (s === "red")
    return {
      label: "RED",
      tone: "bg-red-600 text-white",
      emoji: "🛑",
    };
  if (s === "yellow")
    return {
      label: "YELLOW",
      tone: "bg-yellow-400 text-black",
      emoji: "🟡",
    };
  return {
    label: "GREEN",
    tone: "bg-green-600 text-white",
    emoji: "🟢",
  };
}

interface Props {
  asset: TransportAsset;
  startOdometer: number;
  dateStr: string;
  /** Hint library — used to label severity for the notification router only. */
  checkpoints: AssetCheckpoint[];
  driverName: string;
  onCleared: () => void;
  onBack: () => void;
}

export function IssueAccumulatorPanel({
  asset,
  startOdometer,
  dateStr,
  checkpoints,
  driverName,
  onCleared,
  onBack,
}: Props) {
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  const [draftSeverity, setDraftSeverity] =
    useState<ClearanceIssueSeverity>("green");
  const [draftText, setDraftText] = useState("");
  const [addingOpen, setAddingOpen] = useState(false);

  const [comfortDeclared, setComfortDeclared] = useState(false);
  const [driverPin, setDriverPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Once the driver hits "Submit & request joint review" on a RED build, the
  // clearance row has been persisted and we hand off to the waiting panel.
  const [redClearance, setRedClearance] =
    useState<AssetDailyClearance | null>(null);

  const hasRed = useMemo(() => issues.some((i) => i.severity === "red"), [issues]);

  if (redClearance) {
    return (
      <RedHandshakeWaitingPanel
        asset={asset}
        clearance={redClearance}
        issues={issues}
        driverName={driverName}
        onAuthorized={onCleared}
        onBack={onBack}
      />
    );
  }

  const addDraft = () => {
    if (!draftText.trim()) {
      toast.error("Describe the fault/workaround first.");
      return;
    }
    setIssues((p) => [
      ...p,
      { id: freshId(), severity: draftSeverity, text: draftText.trim() },
    ]);
    setDraftText("");
    setDraftSeverity("green");
    setAddingOpen(false);
  };

  const removeIssue = (id: string) =>
    setIssues((p) => p.filter((i) => i.id !== id));

  const buildAccumulatedBlob = (list: DraftIssue[]): string =>
    list
      .map((i, idx) => {
        const c = severityChip(i.severity);
        return `${idx + 1}. ${c.emoji} ${c.label} — ${i.text}`;
      })
      .join("\n");

  const submit = async () => {
    if (submitting) return;
    const driverStaffId = getStaffId() || DEFAULT_STAFF_UUID;

    // For non-RED paths, enforce the comfort declaration + 4-digit PIN.
    if (!hasRed) {
      if (!comfortDeclared) {
        toast.error("Please tick the comfort declaration to continue.");
        return;
      }
      if (!/^\d{4}$/.test(driverPin)) {
        toast.error("Enter your 4-digit onboarding PIN.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const items: NewClearanceItemInput[] = issues.map((i) => ({
        checkpointId: null,
        checkpointLabel: i.text.slice(0, 80),
        passed: i.severity === "green",
        isMandatory: i.severity === "red",
        notes: i.text,
        severity: i.severity,
        workaroundText: i.text,
      }));

      const bundle = await insertAssetClearanceWithItems({
        assetId: asset.id,
        clearanceDate: dateStr,
        driverStaffId,
        startOdometer: Math.round(startOdometer),
        items,
        accumulatedIssues: buildAccumulatedBlob(issues),
        driverComfortDeclared: !hasRed && comfortDeclared,
      });

      // Fire the dev notification router for every non-green issue so the
      // existing simulator overlays still trigger.
      issues.forEach((i) => {
        if (i.severity === "green") return;
        const cpHint = checkpoints.find((c) =>
          i.text.toLowerCase().includes(c.label.toLowerCase().slice(0, 12)),
        );
        triggerInspectionAlert(
          asset.name,
          driverName,
          i.text,
          i.severity === "red"
            ? "critical_no_go"
            : cpHint
              ? toSeverity(cpHint.impactLevel)
              : "conditional_warning",
          i.text,
        );
      });

      if (hasRed) {
        setRedClearance(bundle.clearance);
        toast.warning("Awaiting manager joint review", {
          description:
            "A RED issue was logged. The Operations Manager has been notified.",
        });
      } else {
        await submitDriverAuthorization(
          bundle.clearance.id,
          driverStaffId,
          driverPin,
        );
        toast.success("Declaration locked in", {
          description: `${asset.name} cleared for service.`,
        });
        onCleared();
      }
    } catch (err) {
      toast.error("Could not save clearance", {
        description: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-extrabold">
          Daily Walkaround — {asset.name}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {asset.regoPlate} · Log every fault or workaround you noticed on your
        walkaround. Tag each one Green, Yellow, or RED.
      </p>

      {/* ---------------- Accumulated issues stack ---------------- */}
      <div className="mt-5 space-y-2">
        {issues.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            No issues logged yet. Add one below, or jump straight to the
            comfort declaration if the vehicle is fully clean.
          </div>
        )}
        {issues.map((i, idx) => {
          const c = severityChip(i.severity);
          return (
            <div
              key={i.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                i.severity === "red"
                  ? "border-red-600/70 bg-red-600/10"
                  : i.severity === "yellow"
                    ? "border-yellow-500/70 bg-yellow-400/10"
                    : "border-green-600/40 bg-green-600/5",
              )}
            >
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[10px] font-extrabold tracking-wide",
                  c.tone,
                )}
              >
                #{idx + 1} · {c.label}
              </span>
              <div className="min-w-0 flex-1 text-sm">{i.text}</div>
              <button
                type="button"
                onClick={() => removeIssue(i.id)}
                className="rounded p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove issue"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ---------------- Add-issue drawer ---------------- */}
      {addingOpen ? (
        <div className="mt-3 rounded-lg border-2 border-blue-600/40 bg-blue-600/5 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            New issue
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["green", "yellow", "red"] as ClearanceIssueSeverity[]).map(
              (s) => {
                const c = severityChip(s);
                const selected = draftSeverity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraftSeverity(s)}
                    className={cn(
                      "h-12 rounded-md border-2 text-sm font-bold transition",
                      selected
                        ? `${c.tone} border-transparent`
                        : "border-border bg-background text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    {c.emoji} {c.label}
                  </button>
                );
              },
            )}
          </div>
          <Label htmlFor="draft-text" className="mt-3 block text-xs">
            Fault &amp; workaround description
          </Label>
          <Textarea
            id="draft-text"
            rows={3}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="e.g. Rear brake light intermittent — confirmed working at 0815, will revisit at depot."
            className="mt-1"
          />
          {draftSeverity === "red" && (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-red-600/60 bg-red-600/10 p-2 text-[11px] text-red-700 dark:text-red-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                A RED tag will pause the run and trigger a dual-PIN joint
                review with the Operations Manager before dispatch.
              </span>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setAddingOpen(false);
                setDraftText("");
                setDraftSeverity("green");
              }}
            >
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={addDraft}>
              Add to today's summary
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingOpen(true)}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-600/50 bg-blue-600/5 text-sm font-bold text-blue-700 transition hover:bg-blue-600/10 dark:text-blue-300"
        >
          <Plus className="h-4 w-4" /> Add An Issue
        </button>
      )}

      {/* ---------------- Comfort declaration & PIN ---------------- */}
      {!hasRed && (
        <div className="mt-6 rounded-lg border-2 border-green-600/40 bg-green-600/5 p-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="comfort"
              checked={comfortDeclared}
              onCheckedChange={(v) => setComfortDeclared(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="comfort"
              className="cursor-pointer text-sm font-medium leading-snug"
            >
              {COMFORT_DECLARATION_TEXT}
            </Label>
          </div>

          <div className="mt-4 grid gap-1.5">
            <Label htmlFor="driver-pin" className="text-xs uppercase tracking-wide text-muted-foreground">
              Driver Onboarding PIN
            </Label>
            <Input
              id="driver-pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              value={driverPin}
              onChange={(e) =>
                setDriverPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="••••"
              className="h-12 max-w-[180px] text-center text-lg tracking-[0.6em] tabular-nums"
            />
          </div>
        </div>
      )}

      {/* ---------------- Action row ---------------- */}
      <button
        type="button"
        disabled={submitting}
        onClick={submit}
        className={cn(
          "mt-5 h-14 w-full rounded-xl font-bold text-white shadow transition",
          hasRed
            ? "bg-red-600 hover:bg-red-700"
            : "bg-blue-600 hover:bg-blue-700",
          submitting && "opacity-60 cursor-not-allowed",
        )}
      >
        {submitting
          ? "Saving…"
          : hasRed
            ? "🛑 Submit & Request Joint Review"
            : "Lock In Declaration & Roll"}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 h-10 w-full rounded-xl text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        ← Change vehicle
      </button>
    </Card>
  );
}

export { COMFORT_DECLARATION_TEXT };
export type { DraftIssue };

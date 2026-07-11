/**
 * IncidentIntakeDialog — GUARDRAILS §13
 *
 * Flow (both lanes):
 *   1. Lane chooser  — Human/Operational OR Equipment & Asset Fault
 *   2. RYGE severity — description (+ workaround for YELLOW)
 *   3. RED only      — VerbalConsultationDialog (manager by name, operator PIN)
 *   4. Submit        — writes to operational_incidents (HUB always) +
 *                      site_issues_register (when event + day session in context)
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HeartPulse, Wrench } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { cn } from "@/lib/utils";
import { raiseOperationalIncident } from "@/lib/incidents";
import { resolveStaffIdWithFallback, getStaffId, resolveStaffDisplayName } from "@/lib/data-store";
import { createIssue, type RygeSeverity } from "@/lib/api/site-issues";
import { createMaintenanceItem, MAINTENANCE_ITEMS_KEY } from "@/lib/api/maintenance";
import {
  VerbalConsultationDialog,
  formatVerbalWorkaroundDescription,
} from "@/components/issue-engine/verbal-consultation-dialog";
import type { LedgerCategory } from "@/lib/api/ledger";

// ── Types ─────────────────────────────────────────────────────────────────────

type Lane = "choose" | "human" | "asset";
type RygeSev = "red" | "yellow" | "green";

const SEV_TO_HUB = { red: "sev1", yellow: "sev2", green: "sev3" } as const;
const SEV_TO_RYGE: Record<RygeSev, RygeSeverity> = {
  red: "red",
  yellow: "yellow",
  green: "green",
};

export interface IncidentIntakeContext {
  pathLabel: string;
  vehicleId?: string;
  eventId?: string;
  eventTitle?: string;
  /** When set, incident is also mirrored to site_issues_register for this day session. */
  eventDaySessionId?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: IncidentIntakeContext;
  /** Called after a successful submission — use for cache invalidation. */
  onFiled?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IncidentIntakeDialog({ open, onOpenChange, context, onFiled }: Props) {
  const qc = useQueryClient();
  const [lane, setLane] = useState<Lane>("choose");
  const [severity, setSeverity] = useState<RygeSev | null>(null);
  const [description, setDescription] = useState("");
  const [workaround, setWorkaround] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);

  // Pending payload while waiting for verbal consultation on RED
  const [pendingVerbal, setPendingVerbal] = useState<{
    lane: Lane;
    description: string;
    workaround: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setLane("choose");
      setSeverity(null);
      setDescription("");
      setWorkaround("");
      setSubmitting(false);
      setVerbalOpen(false);
      setPendingVerbal(null);
    }
  }, [open]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const laneLabel = lane === "human" ? "Human / Operational" : "Equipment & Asset Fault";

  const ledgerCategory: LedgerCategory = context.eventId
    ? "TRIP"
    : lane === "human"
      ? "CENTRE"
      : "VEHICLE";

  const subjectLabel = context.eventTitle
    ? `${laneLabel} — ${context.eventTitle}`
    : `${laneLabel} — ${context.pathLabel}`;

  const MIN_DESC = 20;
  const descOk = description.trim().length >= MIN_DESC;
  const workaroundOk = severity !== "yellow" || workaround.trim().length >= MIN_DESC;
  const canProceed = !!severity && descOk && workaroundOk;

  // ── Submission ────────────────────────────────────────────────────────────

  async function commitWrite(
    finalLane: Lane,
    finalSev: RygeSev,
    finalDesc: string,
    finalWorkaround: string,
  ) {
    setSubmitting(true);
    try {
      const reporterId = getStaffId() || (await resolveStaffIdWithFallback());
      const reporterName = resolveStaffDisplayName(reporterId);

      const contextSuffix = [
        context.eventTitle ? `Event: ${context.eventTitle}` : null,
        `Filed from: ${context.pathLabel}`,
      ]
        .filter(Boolean)
        .join(" · ");

      const hubDescription = `${finalDesc}${contextSuffix ? ` [${contextSuffix}]` : ""}`;

      const incident = await raiseOperationalIncident({
        incidentType: finalLane === "human" ? "human_operational" : "mechanical",
        severity: SEV_TO_HUB[finalSev],
        description: hubDescription,
        vehicleId: context.vehicleId,
        eventId: context.eventId,
        reportedBy: reporterName,
      });

      // Equipment & Asset lane → also write to maintenance_items (§14.3)
      if (finalLane === "asset") {
        try {
          await createMaintenanceItem({
            title: finalDesc.slice(0, 120),
            description: finalDesc,
            severity: SEV_TO_RYGE[finalSev],
            source: "incident_fault",
            sourceRefId: incident?.id ?? null,
            eventId: context.eventId ?? null,
            locationLabel: context.eventTitle
              ? `Event: ${context.eventTitle}`
              : context.pathLabel,
            reportedBy: reporterName,
          });
          qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
        } catch (maintErr) {
          console.error("[IncidentIntakeDialog] maintenance_items write failed", maintErr);
        }
      }

      // Mirror to site_issues_register when in event + day-session context (§13.5)
      if (context.eventId && context.eventDaySessionId) {
        try {
          await createIssue({
            sessionId: null,
            severity: SEV_TO_RYGE[finalSev],
            issueDescription: `[INCIDENT] ${finalDesc}`,
            workaroundPlan: finalWorkaround.trim() || null,
            owner: "internal",
            eventId: context.eventId,
            eventDaySessionId: context.eventDaySessionId,
          });
        } catch (mirrorErr) {
          console.error("[IncidentIntakeDialog] site_issues_register mirror failed", mirrorErr);
        }
      }

      if (finalSev === "red") {
        toast.error("🚨 RED incident filed — verbal consultation recorded in ledger.", {
          duration: 6000,
        });
      } else if (finalSev === "yellow") {
        toast.warning("YELLOW incident filed — workaround captured.");
      } else {
        toast.success("GREEN note filed.");
      }

      onFiled?.();
      onOpenChange(false);
    } catch (err) {
      console.error("[IncidentIntakeDialog] commit failed", err);
      toast.error("Could not file incident. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRygeSubmit() {
    if (!severity || !canProceed) return;
    if (severity === "red") {
      // Snapshot before opening verbal dialog (closure safety)
      setPendingVerbal({ lane, description: description.trim(), workaround: workaround.trim() });
      setVerbalOpen(true);
      return;
    }
    void commitWrite(lane, severity, description.trim(), workaround.trim());
  }

  // ── Verbal consultation accepted callback ─────────────────────────────────

  function handleVerbalAccepted(payload: {
    managerName: string;
    contactOutcome: "manager_reached" | "unable_to_contact";
    notes: string;
  }) {
    if (!pendingVerbal) return;
    const prefixed = formatVerbalWorkaroundDescription(pendingVerbal.description, payload);
    void commitWrite(pendingVerbal.lane, "red", prefixed, pendingVerbal.workaround);
    setPendingVerbal(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const contextLine = [
    context.eventTitle ?? context.pathLabel,
    context.vehicleId ? `Vehicle ${context.vehicleId.slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Incident &amp; Fault Utility</DialogTitle>
            <DialogDescription>Context: {contextLine}</DialogDescription>
          </DialogHeader>

          {/* ── Step 1: Lane chooser ── */}
          {lane === "choose" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setLane("human")}
                className="flex flex-col items-start gap-2 rounded-xl border-2 border-rose-500/60 bg-rose-500/10 p-5 text-left transition hover:bg-rose-500/20"
              >
                <HeartPulse className="h-7 w-7 text-rose-300" />
                <div className="text-base font-semibold text-rose-100">
                  🚑 Human / Operational
                </div>
                <p className="text-xs text-rose-200/80">
                  Injury, welfare concern, dispute, near-miss — involves a person.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setLane("asset")}
                className="flex flex-col items-start gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-5 text-left transition hover:bg-amber-500/20"
              >
                <Wrench className="h-7 w-7 text-amber-300" />
                <div className="text-base font-semibold text-amber-100">
                  🔧 Equipment &amp; Asset Fault
                </div>
                <p className="text-xs text-amber-200/80">
                  Bus, iPad, trolley, venue equipment — any non-human asset failure.
                </p>
              </button>
            </div>
          )}

          {/* ── Step 2: RYGE severity + description ── */}
          {(lane === "human" || lane === "asset") && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    lane === "human"
                      ? "bg-rose-500/20 text-rose-200"
                      : "bg-amber-500/20 text-amber-200",
                  )}
                >
                  {lane === "human" ? "🚑 Human / Operational" : "🔧 Equipment & Asset"}
                </span>
                <button
                  type="button"
                  className="text-xs underline text-muted-foreground hover:text-foreground"
                  onClick={() => { setLane("choose"); setSeverity(null); setDescription(""); setWorkaround(""); }}
                >
                  Change
                </button>
              </div>

              {/* Severity chips */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Severity
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["red", "yellow", "green"] as RygeSev[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverity(s)}
                      className={cn(
                        "rounded-full border px-4 py-1.5 text-xs font-bold transition",
                        s === "red" &&
                          "border-red-600/60 bg-red-600/10 text-red-300 data-[active=true]:bg-red-600 data-[active=true]:text-white",
                        s === "yellow" &&
                          "border-yellow-500/60 bg-yellow-500/10 text-yellow-300 data-[active=true]:bg-yellow-400 data-[active=true]:text-black",
                        s === "green" &&
                          "border-green-600/60 bg-green-600/10 text-green-300 data-[active=true]:bg-green-600 data-[active=true]:text-white",
                      )}
                      data-active={severity === s}
                    >
                      {s === "red" ? "🔴 RED — Critical" : s === "yellow" ? "🟡 YELLOW — Workaround" : "🟢 GREEN — Note"}
                    </button>
                  ))}
                </div>
              </div>

              <CharacterCountedTextarea
                label="What happened"
                value={description}
                onValueChange={setDescription}
                placeholder="Describe the incident — what occurred, who was involved, where."
                rows={3}
                minChars={MIN_DESC}
                required
              />

              {severity === "yellow" && (
                <CharacterCountedTextarea
                  label="Workaround / immediate action taken"
                  value={workaround}
                  onValueChange={setWorkaround}
                  placeholder="What was done on the spot to address this?"
                  rows={3}
                  minChars={MIN_DESC}
                  required
                  hint="Required for YELLOW — describe what was done immediately"
                />
              )}

              {severity === "red" && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
                  RED requires a verbal manager consultation. You will be asked to select
                  the manager you contacted and attest with your operator PIN.
                </div>
              )}

              <div className="flex justify-between gap-2">
                <Button variant="ghost" onClick={() => { setLane("choose"); setSeverity(null); setDescription(""); setWorkaround(""); }}>
                  ← Back
                </Button>
                <Button
                  onClick={handleRygeSubmit}
                  disabled={!canProceed || submitting}
                  className={cn(
                    severity === "red" && "bg-red-600 text-white hover:bg-red-700",
                    severity === "yellow" && "bg-yellow-500 text-black hover:bg-yellow-400",
                  )}
                >
                  {submitting
                    ? "Filing…"
                    : severity === "red"
                      ? "Proceed to verbal consultation →"
                      : "File incident"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Step 3: RED verbal consultation — mounted outside parent Dialog to avoid z-index nesting */}
      <VerbalConsultationDialog
        open={verbalOpen}
        onOpenChange={(next) => {
          if (!next) {
            setVerbalOpen(false);
            setPendingVerbal(null);
          }
        }}
        ledgerCategory={ledgerCategory}
        subjectLabel={subjectLabel}
        actionType="INCIDENT_RED_VERBAL"
        titleOverride="RED Incident — Verbal Consultation"
        descriptionOverride="A RED incident has been raised. Select the manager you contacted (or attempted to reach), record the outcome, and sign with your operator PIN. The manager confirms in the Hub later."
        onAccepted={handleVerbalAccepted}
      />
    </>
  );
}

/**
 * IncidentIntakeDialog — GUARDRAILS §13 + BL-106
 *
 * Flow:
 *   1. Lane chooser — Human / Asset / Health & Safety
 *      Health & Safety closes this dialog and opens GlobalHealthSafetyFlow (no INCIDENT write).
 *   2. Human/Asset — Occurred at, RYGE, description (+ Human: who)
 *   3. RED only — VerbalConsultationDialog (manager by name, operator PIN)
 *   4. Submit — operational_incidents (+ site_issues_register / maintenance mirrors)
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HeartPulse, ShieldAlert, Wrench } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { FieldActionButton } from "@/components/ui/field-action-button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { raiseOperationalIncident } from "@/lib/incidents";
import {
  listParticipants,
  listStaffRegistry,
  resolveStaffIdWithFallback,
  getStaffId,
  resolveStaffDisplayName,
} from "@/lib/data-store";
import { createIssue, type RygeSeverity } from "@/lib/api/site-issues";
import { createMaintenanceItem, MAINTENANCE_ITEMS_KEY } from "@/lib/api/maintenance";
import {
  VerbalConsultationDialog,
  formatVerbalWorkaroundDescription,
} from "@/components/issue-engine/verbal-consultation-dialog";
import { OccurredAtFields } from "@/components/issue-engine/occurred-at-fields";
import {
  defaultOccurredAtParts,
  isOccurredAtPartsValid,
  occurredAtPartsToIso,
  type OccurredAtParts,
} from "@/lib/ui/occurred-at";
import { requiredFieldOutline } from "@/lib/ui/required-field";
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
  siteDaySessionId?: string;
  siteDayPhase?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: IncidentIntakeContext;
  /** Called after a successful submission — use for cache invalidation. */
  onFiled?: () => void;
  /**
   * Third lane — opens Health & Safety manager flow (emergency / site hold / infectious).
   * Must not write an INCIDENT row.
   */
  onHealthSafety?: () => void;
}

type PendingVerbal = {
  lane: Lane;
  description: string;
  workaround: string;
  occurredAt: string;
  affectedParticipantIds: string[];
  assistingStaffIds: string[];
  noParticipantInvolved: boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function IncidentIntakeDialog({
  open,
  onOpenChange,
  context,
  onFiled,
  onHealthSafety,
}: Props) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [lane, setLane] = useState<Lane>("choose");
  const [severity, setSeverity] = useState<RygeSev | null>(null);
  const [description, setDescription] = useState("");
  const [workaround, setWorkaround] = useState("");
  const [occurredParts, setOccurredParts] = useState<OccurredAtParts>(() =>
    defaultOccurredAtParts(),
  );
  const [affectedIds, setAffectedIds] = useState<string[]>([]);
  /** True until the first client is ticked; returns true again if all unticked. */
  const [noParticipant, setNoParticipant] = useState(true);
  const [assistingStaffIds, setAssistingStaffIds] = useState<string[]>([]);
  const [participantFilter, setParticipantFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [pendingVerbal, setPendingVerbal] = useState<PendingVerbal | null>(null);

  // Prefetch while dialog is open (Human lane needs both lists).
  const participantsQ = useQuery({
    queryKey: ["participants", "all-for-incident"],
    queryFn: listParticipants,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const staffQ = useQuery({
    queryKey: ["staff-registry", "incident-assist"],
    queryFn: listStaffRegistry,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const activeParticipants = useMemo(() => {
    return (participantsQ.data ?? [])
      .map((p) => ({ id: p.id, fullName: p.fullName?.trim() || "Unnamed" }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [participantsQ.data]);

  const activeStaff = useMemo(() => {
    return (staffQ.data ?? [])
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, fullName: s.fullName?.trim() || "Staff" }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [staffQ.data]);

  const filteredParticipants = useMemo(() => {
    const q = participantFilter.trim().toLowerCase();
    if (!q) return activeParticipants;
    return activeParticipants.filter((p) => p.fullName.toLowerCase().includes(q));
  }, [activeParticipants, participantFilter]);

  const filteredStaff = useMemo(() => {
    const q = staffFilter.trim().toLowerCase();
    if (!q) return activeStaff;
    return activeStaff.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [activeStaff, staffFilter]);

  const affectedClientNames = useMemo(
    () =>
      affectedIds.map(
        (id) =>
          activeParticipants.find((p) => p.id === id)?.fullName ?? id.slice(0, 8),
      ),
    [affectedIds, activeParticipants],
  );

  const assistingStaffNames = useMemo(
    () =>
      assistingStaffIds.map(
        (id) =>
          activeStaff.find((s) => s.id === id)?.fullName ?? id.slice(0, 8),
      ),
    [assistingStaffIds, activeStaff],
  );

  useEffect(() => {
    if (!open) return;
    setLane("choose");
    setSeverity(null);
    setDescription("");
    setWorkaround("");
    setOccurredParts(defaultOccurredAtParts());
    setAffectedIds([]);
    setNoParticipant(true);
    setAssistingStaffIds([]);
    setParticipantFilter("");
    setStaffFilter("");
    setSubmitting(false);
    setVerbalOpen(false);
    setPendingVerbal(null);
  }, [open]);

  useEffect(() => {
    if (lane !== "human") return;
    if (assistingStaffIds.length > 0) return;
    const sid = getStaffId();
    if (!sid) return;
    if (!staffQ.isSuccess) return;
    if (activeStaff.some((s) => s.id === sid)) {
      setAssistingStaffIds([sid]);
    }
  }, [lane, assistingStaffIds.length, staffQ.isSuccess, activeStaff]);

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
  const occurredOk = isOccurredAtPartsValid(occurredParts);
  const humanWhoOk =
    lane !== "human" ||
    (assistingStaffIds.length > 0 &&
      (noParticipant || affectedIds.length > 0));

  const missingFields = useMemo(() => {
    const miss: string[] = [];
    if (!severity) miss.push("Severity");
    if (!occurredOk) miss.push("Occurred at");
    if (!descOk) miss.push("What happened (≥20 characters)");
    if (!workaroundOk) miss.push("Workaround (≥20 characters)");
    if (lane === "human" && assistingStaffIds.length === 0) {
      miss.push("Staff who assisted / involved");
    }
    if (lane === "human" && !noParticipant && affectedIds.length === 0) {
      miss.push("Affected client(s)");
    }
    return miss;
  }, [
    severity,
    occurredOk,
    descOk,
    workaroundOk,
    lane,
    assistingStaffIds.length,
    noParticipant,
    affectedIds.length,
  ]);

  const canProceed =
    !!severity && descOk && workaroundOk && occurredOk && humanWhoOk;

  function resetLaneForm() {
    setSeverity(null);
    setDescription("");
    setWorkaround("");
    setOccurredParts(defaultOccurredAtParts());
    setAffectedIds([]);
    setNoParticipant(true);
    setAssistingStaffIds([]);
    setParticipantFilter("");
    setStaffFilter("");
  }

  function toggleParticipant(id: string) {
    setAffectedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      setNoParticipant(next.length === 0);
      return next;
    });
  }

  function toggleAssistingStaff(id: string) {
    setAssistingStaffIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function buildHumanWhoSuffix(
    participantIds: string[],
    staffIds: string[],
    none: boolean,
  ): string {
    const names = participantIds
      .map((id) => activeParticipants.find((p) => p.id === id)?.fullName ?? id.slice(0, 8))
      .join(", ");
    const staffNames = staffIds
      .map(
        (id) =>
          activeStaff.find((s) => s.id === id)?.fullName ||
          resolveStaffDisplayName(id) ||
          id.slice(0, 8),
      )
      .join(", ");
    const clients = none ? "No client involved" : names || "—";
    return ` [Occurred clients: ${clients} · Assisted/involved: ${staffNames || "—"}]`;
  }

  // ── Submission ────────────────────────────────────────────────────────────

  async function commitWrite(args: PendingVerbal & { finalSev: RygeSev }) {
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

      const whoSuffix =
        args.lane === "human"
          ? buildHumanWhoSuffix(
              args.affectedParticipantIds,
              args.assistingStaffIds,
              args.noParticipantInvolved,
            )
          : "";

      const hubDescription = `${args.description}${whoSuffix}${
        contextSuffix ? ` [${contextSuffix}]` : ""
      }`;

      const incident = await raiseOperationalIncident({
        incidentType: args.lane === "human" ? "human_operational" : "mechanical",
        severity: SEV_TO_HUB[args.finalSev],
        description: hubDescription,
        vehicleId: context.vehicleId,
        eventId: context.eventId,
        reportedBy: reporterName,
        occurredAt: args.occurredAt,
        affectedParticipantIds:
          args.lane === "human" ? args.affectedParticipantIds : [],
        assistingStaffIds:
          args.lane === "human" ? args.assistingStaffIds : [],
        noParticipantInvolved:
          args.lane === "human" ? args.noParticipantInvolved : false,
      });

      if (args.lane === "asset") {
        try {
          await createMaintenanceItem({
            title: args.description.slice(0, 120),
            description: args.description,
            severity: SEV_TO_RYGE[args.finalSev],
            source: "incident_fault",
            sourceRefId: incident?.id ?? null,
            eventId: context.eventId ?? null,
            locationLabel: context.eventTitle
              ? `Event: ${context.eventTitle}`
              : context.pathLabel,
            reportedBy: reporterName,
            occurredAt: args.occurredAt,
          });
          qc.invalidateQueries({ queryKey: MAINTENANCE_ITEMS_KEY });
        } catch (maintErr) {
          console.error("[IncidentIntakeDialog] maintenance_items write failed", maintErr);
        }
      }

      if (context.eventId && context.eventDaySessionId) {
        try {
          await createIssue({
            sessionId: null,
            severity: SEV_TO_RYGE[args.finalSev],
            issueDescription: `[INCIDENT] ${args.description}${whoSuffix}`,
            workaroundPlan: args.workaround.trim() || null,
            owner: "internal",
            eventId: context.eventId,
            eventDaySessionId: context.eventDaySessionId,
            occurredAt: args.occurredAt,
          });
        } catch (mirrorErr) {
          console.error("[IncidentIntakeDialog] site_issues_register mirror failed", mirrorErr);
        }
      }

      if (args.finalSev === "red") {
        toast.error("🚨 RED incident filed — verbal consultation recorded in ledger.", {
          duration: 6000,
        });
      } else if (args.finalSev === "yellow") {
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

  function snapshotPending(): PendingVerbal | null {
    const occurredAt = occurredAtPartsToIso(occurredParts);
    if (!occurredAt || !severity || !canProceed) return null;
    return {
      lane,
      description: description.trim(),
      workaround: workaround.trim(),
      occurredAt,
      affectedParticipantIds: noParticipant ? [] : affectedIds,
      assistingStaffIds: lane === "human" ? assistingStaffIds : [],
      noParticipantInvolved: lane === "human" ? noParticipant : false,
    };
  }

  function handleRygeSubmit() {
    const snap = snapshotPending();
    if (!snap || !severity) return;
    if (severity === "red") {
      setPendingVerbal(snap);
      setVerbalOpen(true);
      return;
    }
    void commitWrite({ ...snap, finalSev: severity });
  }

  function handleVerbalAccepted(payload: {
    managerName: string;
    contactOutcome: "manager_reached" | "unable_to_contact";
    notes: string;
  }) {
    if (!pendingVerbal) return;
    const prefixed = formatVerbalWorkaroundDescription(
      pendingVerbal.description,
      payload,
    );
    void commitWrite({
      ...pendingVerbal,
      description: prefixed,
      finalSev: "red",
    });
    setPendingVerbal(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const contextLine = [
    context.eventTitle ?? context.pathLabel,
    context.vehicleId ? `Vehicle ${context.vehicleId.slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const listRowClass =
    "flex min-h-14 w-full touch-manipulation items-center rounded-md px-3 text-left text-sm transition hover:bg-muted/60";

  const primaryVariant =
    severity === "red"
      ? "destructive"
      : severity === "yellow"
        ? "caution"
        : severity === "green"
          ? "success"
          : "primary";

  const primaryLabel = submitting
    ? "Filing…"
    : severity === "red"
      ? "Proceed to verbal consultation →"
      : "File incident";

  const scrollBody = (
    <>
      {lane === "choose" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setLane("human")}
            className="flex min-h-[4.5rem] touch-manipulation flex-col items-start gap-2 rounded-xl border-2 border-rose-500/60 bg-rose-500/10 p-5 text-left transition hover:bg-rose-500/20"
          >
            <HeartPulse className="h-7 w-7 text-rose-300" />
            <div className="text-base font-semibold text-rose-100">
              Human / Operational
            </div>
            <p className="text-xs text-rose-200/80">
              Injury, welfare, medical assist (e.g. EpiPen), dispute, near-miss.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setLane("asset")}
            className="flex min-h-[4.5rem] touch-manipulation flex-col items-start gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-5 text-left transition hover:bg-amber-500/20"
          >
            <Wrench className="h-7 w-7 text-amber-300" />
            <div className="text-base font-semibold text-amber-100">
              Equipment &amp; Asset Fault
            </div>
            <p className="text-xs text-amber-200/80">
              Bus, iPad, trolley, venue equipment — any non-human asset failure.
            </p>
          </button>

          <button
            type="button"
            onClick={() => onHealthSafety?.()}
            className="flex min-h-[4.5rem] touch-manipulation flex-col items-start gap-2 rounded-xl border-2 border-red-600/70 bg-red-600/15 p-5 text-left transition hover:bg-red-600/25"
          >
            <ShieldAlert className="h-7 w-7 text-red-300" />
            <div className="text-base font-semibold text-red-100">
              Health &amp; Safety
            </div>
            <p className="text-xs text-red-200/80">
              Emergency / drill, lockdown or suspend, infectious exclusion —
              manager declare. Not an INCIDENT log.
            </p>
          </button>
        </div>
      )}

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
              {lane === "human" ? "Human / Operational" : "Equipment & Asset"}
            </span>
            <button
              type="button"
              className="min-h-11 touch-manipulation px-1 text-xs underline text-muted-foreground hover:text-foreground"
              onClick={() => {
                setLane("choose");
                resetLaneForm();
              }}
            >
              Change
            </button>
          </div>

          <OccurredAtFields
            value={occurredParts}
            onChange={setOccurredParts}
            disabled={submitting}
          />

          {lane === "human" && (
            <>
              <div className="space-y-1.5">
                <Label>Affected client(s)</Label>
                <p className="text-xs text-muted-foreground">
                  Starts as no client involved. Tick clients below — names appear
                  here as you select them.
                </p>
                <div
                  className={cn(
                    "mb-2 rounded-md border px-3 py-2 text-sm",
                    affectedIds.length > 0
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {affectedIds.length > 0 ? (
                    <>
                      <span className="font-medium text-foreground">
                        {affectedIds.length === 1
                          ? "1 client selected"
                          : `${affectedIds.length} clients selected`}
                      </span>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {affectedClientNames.join(", ")}
                      </p>
                    </>
                  ) : (
                    <span className="font-medium">No client involved</span>
                  )}
                </div>
                <Input
                  value={participantFilter}
                  onChange={(e) => setParticipantFilter(e.target.value)}
                  placeholder="Filter clients…"
                  className="mb-2 h-12"
                  disabled={submitting || participantsQ.isLoading}
                />
                <div className="max-h-[40dvh] space-y-1 overflow-y-auto rounded-md border p-1 sm:max-h-48">
                  {participantsQ.isLoading ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      Loading…
                    </p>
                  ) : filteredParticipants.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      No matching clients.
                    </p>
                  ) : (
                    filteredParticipants.map((p) => {
                      const selected = affectedIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={submitting}
                          onClick={() => toggleParticipant(p.id)}
                          className={cn(
                            listRowClass,
                            selected &&
                              "border border-primary bg-primary font-medium text-primary-foreground",
                          )}
                        >
                          {selected ? "✓ " : ""}
                          {p.fullName}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Staff who assisted / involved</Label>
                <p className="text-xs text-muted-foreground">
                  Tick everyone involved — names appear here as you select them.
                  May differ from who is filing this report.
                </p>
                <div
                  className={cn(
                    "mb-2 rounded-md border px-3 py-2 text-sm",
                    assistingStaffIds.length > 0
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : cn(
                          requiredFieldOutline(true),
                          "text-muted-foreground",
                        ),
                  )}
                >
                  {assistingStaffIds.length > 0 ? (
                    <>
                      <span className="font-medium text-foreground">
                        {assistingStaffIds.length === 1
                          ? "1 staff selected"
                          : `${assistingStaffIds.length} staff selected`}
                      </span>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {assistingStaffNames.join(", ")}
                      </p>
                    </>
                  ) : (
                    <span>No staff selected yet — tick below</span>
                  )}
                </div>
                <Input
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  placeholder="Filter staff…"
                  className="mb-2 h-12"
                  disabled={submitting || staffQ.isLoading}
                />
                <div
                  className={cn(
                    "max-h-[40dvh] space-y-1 overflow-y-auto rounded-md border p-1 sm:max-h-48",
                    requiredFieldOutline(assistingStaffIds.length === 0),
                  )}
                >
                  {staffQ.isLoading ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      Loading staff…
                    </p>
                  ) : filteredStaff.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-destructive">
                      No active staff found.
                    </p>
                  ) : (
                    filteredStaff.map((s) => {
                      const selected = assistingStaffIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={submitting}
                          onClick={() => toggleAssistingStaff(s.id)}
                          className={cn(
                            listRowClass,
                            selected &&
                              "border border-primary bg-primary font-medium text-primary-foreground",
                          )}
                        >
                          {selected ? "✓ " : ""}
                          {s.fullName}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Severity
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {(["red", "yellow", "green"] as RygeSev[]).map((s) => {
                const active = severity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(s)}
                    className={cn(
                      "min-h-12 w-full touch-manipulation rounded-xl border-2 px-4 text-sm font-bold transition sm:w-auto sm:flex-1",
                      s === "red" &&
                        (active
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-red-600/60 bg-red-600/10 text-red-300"),
                      s === "yellow" &&
                        (active
                          ? "border-yellow-400 bg-yellow-400 text-black"
                          : "border-yellow-500/60 bg-yellow-500/10 text-yellow-300"),
                      s === "green" &&
                        (active
                          ? "border-green-600 bg-green-600 text-white"
                          : "border-green-600/60 bg-green-600/10 text-green-300"),
                    )}
                  >
                    {s === "red"
                      ? "🔴 RED — Critical"
                      : s === "yellow"
                        ? "🟡 YELLOW — Workaround"
                        : "🟢 GREEN — Note"}
                  </button>
                );
              })}
            </div>
          </div>

          <CharacterCountedTextarea
            label="What happened"
            value={description}
            onValueChange={setDescription}
            placeholder={
              lane === "human"
                ? "Describe the incident — medical assist, injury, welfare concern…"
                : "Describe the fault — what failed, where, impact."
            }
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
              RED requires a verbal manager consultation. You will be asked to
              select the manager you contacted and attest with your operator PIN.
            </div>
          )}

          {!canProceed && missingFields.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <p className="font-semibold">Still needed:</p>
              <ul className="mt-1 list-disc pl-4">
                {missingFields.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );

  const stickyFooter = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
        {lane !== "choose" && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={() => {
              setLane("choose");
              resetLaneForm();
            }}
          >
            ← Back
          </Button>
        )}
      </div>
      {lane !== "choose" && (
        <FieldActionButton
          variant={primaryVariant}
          size="sm"
          fullWidth={isMobile}
          disabled={!canProceed || submitting}
          onClick={handleRygeSubmit}
          className={cn(!isMobile && "min-w-[12rem] px-4")}
        >
          {primaryLabel}
        </FieldActionButton>
      )}
    </div>
  );

  const verbal = (
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
  );

  if (isMobile) {
    return (
      <>
        <BottomSheet
          open={open}
          onOpenChange={onOpenChange}
          hideTicket
          title="Incident & Fault Utility"
          description={`Context: ${contextLine}`}
          className="flex flex-col gap-0 overflow-hidden"
        >
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {scrollBody}
          </div>
          <div className="shrink-0 border-t pt-3">
            {stickyFooter}
          </div>
        </BottomSheet>
        {verbal}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent hideTicket className="flex max-h-[92dvh] max-w-2xl flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>Incident &amp; Fault Utility</DialogTitle>
            <DialogDescription>Context: {contextLine}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {scrollBody}
          </div>
          <div className="shrink-0 border-t px-6 py-3">
            {stickyFooter}
          </div>
        </DialogContent>
      </Dialog>
      {verbal}
    </>
  );
}

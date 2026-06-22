import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertOctagon } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  DEFAULT_STAFF_UUID,
  claimOperationalEscalation,
  getActiveUserProfile,
  getStaffId,
  isOperationalEscalationClaimable,
  listClaimableEscalations,
  subscribeToEscalationPool,
  type OperationalEscalation,
} from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";
import { prettyGateLabel } from "@/lib/operational-forms";
import { writeToLedger, tryGetGps } from "@/lib/api/ledger";

import { EscalationConsultationModal } from "./escalation-consultation-modal";

/**
 * Returns escalations already claimed by the given manager that still need
 * a proposal (manager hasn't sent GO/NO-GO yet). Used to rehydrate the
 * consultation modal after a refresh.
 */
async function listMyClaimedAwaitingProposal(
  staffId: string,
): Promise<OperationalEscalation[]> {
  const { data, error } = await supabase
    .from("operational_escalations")
    .select("*")
    .eq("status", "claimed")
    .eq("claimed_by", staffId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[listMyClaimedAwaitingProposal]", error);
    return [];
  }
  // For site_day rows, only rehydrate when the manager has NOT yet
  // submitted a proposal (manager_plan_text is null on the session).
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const results: OperationalEscalation[] = [];
  for (const raw of rows) {
    const escalation = {
      id: raw.id as string,
      clearanceId: (raw.clearance_id as string | null) ?? null,
      driverName: (raw.driver_name as string) ?? "",
      vehicleInfo: (raw.vehicle_info as string) ?? "",
      gateId: (raw.gate_id as string) ?? "",
      status: raw.status as OperationalEscalation["status"],
      claimedBy: (raw.claimed_by as string | null) ?? null,
      claimedAt: (raw.claimed_at as string | null) ?? null,
      createdAt: raw.created_at as string,
      updatedAt: raw.updated_at as string,
      resolutionNotes: (raw.resolution_notes as string | null) ?? null,
      resolvedBy: (raw.resolved_by as string | null) ?? null,
      resolvedAt: (raw.resolved_at as string | null) ?? null,
      sourceKind:
        (raw.source_kind as OperationalEscalation["sourceKind"]) ??
        "bus_walkaround",
      sourceIssueId: (raw.source_issue_id as string | null) ?? null,
      raisedBy: (raw.raised_by as string | null) ?? null,
    } as OperationalEscalation;

    if (escalation.sourceKind === "site_day_red" && escalation.sourceIssueId) {
      const sess = await supabase
        .from("site_issues")
        .select("session_id")
        .eq("id", escalation.sourceIssueId)
        .maybeSingle();
      const sessionId = (sess.data as { session_id?: string } | null)?.session_id;
      if (!sessionId) continue;
      const sd = await supabase
        .from("site_day_sessions")
        .select("manager_decision, manager_plan_text")
        .eq("id", sessionId)
        .maybeSingle();
      const row = sd.data as
        | { manager_decision: string | null; manager_plan_text: string | null }
        | null;
      if (row?.manager_decision || row?.manager_plan_text) continue;
    }
    results.push(escalation);
  }
  return results;
}

const HIDDEN_ROUTES = new Set<string>(["/manifest", "/auth"]);

function getCurrentTerminalStaffId(): string | null {
  const profileStaffId = getActiveUserProfile()?.staffId ?? null;
  if (profileStaffId && profileStaffId !== DEFAULT_STAFF_UUID) return profileStaffId;

  const localStaffId = getStaffId();
  return localStaffId && localStaffId !== DEFAULT_STAFF_UUID ? localStaffId : null;
}

function relativeAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "just now";
  const secs = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function GlobalEscalationInterceptor() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hidden = HIDDEN_ROUTES.has(pathname);

  const [queue, setQueue] = useState<OperationalEscalation[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [consultTarget, setConsultTarget] = useState<OperationalEscalation | null>(null);
  const [tick, setTick] = useState(0);

  // Current staff id — used to suppress the Claim popup for the user who
  // actually raised the incident (no self-claim).
  const currentStaffQ = useQuery({
    queryKey: ["current-staff-id"],
    queryFn: async () => getCurrentTerminalStaffId(),
    refetchInterval: 1_000,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
  const currentStaffId = currentStaffQ.data ?? null;

  const isOwnEscalation = (e: OperationalEscalation): boolean =>
    !!currentStaffId && e.raisedBy === currentStaffId;

  // Baseline post-login fetch.
  const baseline = useQuery({
    queryKey: ["claimable-escalations", currentStaffId ?? "unknown"],
    queryFn: listClaimableEscalations,
    enabled: !!currentStaffId,
    staleTime: 30_000,
  });

  // Rehydration: any escalation already claimed by me where I still owe a
  // proposal — re-open the consultation modal on every mount/refresh.
  const myClaimed = useQuery({
    queryKey: ["my-claimed-awaiting-proposal", currentStaffId ?? "unknown"],
    queryFn: () =>
      currentStaffId
        ? listMyClaimedAwaitingProposal(currentStaffId)
        : Promise.resolve([]),
    enabled: !!currentStaffId,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!consultTarget && myClaimed.data && myClaimed.data.length > 0) {
      setConsultTarget(myClaimed.data[0]);
    }
  }, [myClaimed.data, consultTarget]);

  useEffect(() => {
    if (baseline.data) {
      setQueue((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const additions = baseline.data.filter((e) => !seen.has(e.id) && !isOwnEscalation(e));
        return additions.length ? [...prev, ...additions] : prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline.data, currentStaffId]);

  // If the current user is identified after the queue was seeded, drop any
  // already-queued escalations that they raised themselves.
  useEffect(() => {
    if (!currentStaffId) return;
    setQueue((prev) => prev.filter((e) => e.raisedBy !== currentStaffId));
  }, [currentStaffId]);


  // Realtime escalation pool.
  useEffect(() => {
    const off = subscribeToEscalationPool(({ type, row }) => {
      if (type === "INSERT") {
        if (row.status !== "pending") return;
        if (isOwnEscalation(row)) return;
        void isOperationalEscalationClaimable(row).then((claimable) => {
          if (!claimable) return;
          setQueue((prev) => (prev.some((e) => e.id === row.id) ? prev : [...prev, row]));
        });
      } else if (type === "UPDATE") {
        if (row.status !== "pending") {
          setQueue((prev) => prev.filter((e) => e.id !== row.id));
          return;
        }

        if (isOwnEscalation(row)) {
          setQueue((prev) => prev.filter((e) => e.id !== row.id));
          return;
        }

        void isOperationalEscalationClaimable(row).then((claimable) => {
          setQueue((prev) => {
            const without = prev.filter((e) => e.id !== row.id);
            return claimable ? [...without, row] : without;
          });
        });
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStaffId]);

  // Tick to refresh "12s ago" label every second while modal is open.
  const visibleQueue = useMemo(
    () => (currentStaffId ? queue.filter((e) => !isOwnEscalation(e)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, currentStaffId],
  );
  const active = visibleQueue[0] ?? null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const ageLabel = useMemo(
    () => (active ? relativeAge(active.createdAt) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, tick],
  );

  const handleClaim = async () => {
    if (!active || claiming) return;
    setClaiming(true);
    const target = active;
    // Optimistically pop the active item so the UI feels instant.
    setQueue((prev) => prev.filter((e) => e.id !== target.id));
    try {
      const claimable = await isOperationalEscalationClaimable(target);
      if (!claimable) {
        toast.info("This escalation is no longer awaiting claim.");
        return;
      }

      const staffId = currentStaffId;
      if (!staffId) throw new Error("No current staff identity is active.");
      const result = await claimOperationalEscalation(target.id, staffId);
      if (result.success) {
        // NDIS-grade audit receipt: every Claim writes to the ledger.
        const gps = await tryGetGps();
        void writeToLedger({
          staff_id: staffId,
          category: target.sourceKind === "site_day_red" ? "CENTRE" : "VEHICLE",
          severity: "RED",
          action_type: "governance.escalation_claimed",
          gps_lat: gps?.lat ?? null,
          gps_lng: gps?.lng ?? null,
          metadata: {
            escalation_id: target.id,
            source_kind: target.sourceKind ?? "bus_walkaround",
            source_issue_id: target.sourceIssueId,
            checker_name: target.driverName,
            gate_id: target.gateId,
            manager_staff_id: staffId,
          },
        });
        setConsultTarget(result.escalation ?? target);
      } else {
        toast.info(
          `This incident has already been claimed by ${result.claimedByName ?? "another coordinator"}. Check the Exception Hub for active status updates.`,
        );
      }
    } catch (err) {
      // Re-queue on outright failure so we don't lose the alert.
      setQueue((prev) => (prev.some((e) => e.id === target.id) ? prev : [target, ...prev]));
      toast.error("Could not claim escalation", {
        description: (err as Error).message,
      });
    } finally {
      setClaiming(false);
    }
  };

  const showModal = !hidden && !!currentStaffId && !!active;

  return (
    <>
      <Dialog open={showModal}>
        {/* Non-dismissible: no onOpenChange handler, escape/outside ignored. */}
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="border-2 border-amber-500/70 bg-slate-950 p-0 text-slate-100 sm:max-w-lg"
        >
          {active && (
            <>
              <DialogHeader className="rounded-t-lg border-b border-amber-500/40 bg-amber-500/15 px-6 py-4">
                <DialogTitle className="flex items-center gap-3 text-amber-400">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
                  </span>
                  <AlertOctagon className="h-5 w-5" />
                  <span className="text-base font-extrabold uppercase tracking-wide">
                    🚨 Critical Sev 1 Escalation
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 px-6 py-5">
                <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900 p-4">
                  {active.sourceKind === "site_day_red" ? (
                    <>
                      <ContextRow label="Reported by" value={active.driverName} />
                      <ContextRow label="Site" value={active.vehicleInfo} />
                      <ContextRow
                        label="Trigger"
                        value={prettyGateLabel(active.gateId)}
                        valueClass="text-amber-300"
                      />
                      <ContextRow label="Raised" value={ageLabel} />
                    </>
                  ) : (
                    <>
                      <ContextRow label="Driver" value={active.driverName} />
                      <ContextRow label="Vehicle" value={active.vehicleInfo} />
                      <ContextRow
                        label="Failed Gate"
                        value={prettyGateLabel(active.gateId)}
                        valueClass="text-amber-300"
                      />
                      <ContextRow label="Raised" value={ageLabel} />
                    </>
                  )}
                </div>

                {visibleQueue.length > 1 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    {visibleQueue.length - 1} more pending escalation
                    {visibleQueue.length - 1 === 1 ? "" : "s"} queued behind this one.
                  </div>
                )}

                <button
                  type="button"
                  disabled={claiming}
                  onClick={handleClaim}
                  className={cn(
                    "h-16 w-full rounded-xl bg-blue-600 text-lg font-bold text-white shadow-lg transition hover:bg-blue-700",
                    claiming && "cursor-not-allowed opacity-60",
                  )}
                >
                  {claiming ? "Claiming…" : "👉 CLAIM INCIDENT & OPEN CONSULTATION"}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <EscalationConsultationModal
        escalation={consultTarget}
        onClose={() => setConsultTarget(null)}
      />
    </>
  );
}

function ContextRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className={cn("text-sm font-medium text-slate-100", valueClass)}>{value}</span>
    </div>
  );
}

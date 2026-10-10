/**
 * Shared Duty-role gate: empty / unbound function = allow.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listRequirementsForFunction,
  recordDutyGapApproval,
} from "@/lib/api/duty-roles";
import { listStaffRegistry } from "@/lib/data-store";
import {
  evaluateRequirementHolds,
  dutyGapSummary,
  type DutyFunctionKey,
} from "@/lib/duty-roles";
import {
  dutyGapApproved,
  isManagerOnDutyRole,
} from "@/components/duty/duty-requirement-gap-panel";
import type { LedgerCategory } from "@/lib/api/ledger";

export function useDutyFunctionGap(opts: {
  functionKey: DutyFunctionKey;
  staffId: string | null | undefined;
  subjectLabel: string;
  enabled?: boolean;
  ledgerCategory?: LedgerCategory;
}) {
  const { functionKey, staffId, subjectLabel, enabled = true, ledgerCategory } =
    opts;
  const [note, setNote] = useState("");
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setManagerId(null);
    setManagerPin(null);
  }, [functionKey, staffId]);

  const staffQ = useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
    enabled,
  });
  const reqsQ = useQuery({
    queryKey: ["duty-roles", "function", functionKey],
    queryFn: () => listRequirementsForFunction(functionKey),
    staleTime: 30_000,
    enabled,
  });

  const actor = useMemo(
    () => (staffQ.data ?? []).find((s) => s.id === staffId) ?? null,
    [staffQ.data, staffId],
  );
  const managers = useMemo(
    () => (staffQ.data ?? []).filter((s) => s.active && isManagerOnDutyRole(s.role)),
    [staffQ.data],
  );
  const requirements = enabled ? (reqsQ.data ?? []) : [];
  const evalResult = evaluateRequirementHolds(actor, requirements);
  const ready = !enabled || (!staffQ.isLoading && !reqsQ.isLoading);
  const needsGap = enabled && requirements.length > 0 && evalResult.overall !== "ok";
  const approved = dutyGapApproved(needsGap, note, managerId, managerPin);

  async function ensureApproved(): Promise<boolean> {
    if (!needsGap) return true;
    if (!approved) {
      toast.error("Manager must approve the duty requirement gap first.");
      return false;
    }
    await recordDutyGapApproval({
      functionKey,
      staffId: actor?.id ?? staffId ?? "",
      staffName: actor?.fullName ?? subjectLabel,
      managerStaffId: managerId!,
      note,
      subjectLabel,
      missingSummary: dutyGapSummary(evalResult),
      ledgerCategory,
    });
    return true;
  }

  return {
    ready,
    needsGap,
    approved,
    evalResult,
    actor,
    managers,
    note,
    setNote,
    managerId,
    setManagerId,
    managerPin,
    setManagerPin,
    ensureApproved,
  };
}

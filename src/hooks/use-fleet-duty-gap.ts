/**
 * BL-126 — Driver vs fleet Duty-role requirements at Start Run.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { listRequirementsForFleetAsset, recordDutyGapApproval } from "@/lib/api/duty-roles";
import { getStaffId, listStaffRegistry } from "@/lib/data-store";
import { evaluateRequirementHolds, dutyGapSummary } from "@/lib/duty-roles";
import { dutyGapApproved, isManagerOnDutyRole } from "@/components/duty/duty-requirement-gap-panel";

export function useFleetDutyGap(
  asset: { id: string; name: string; vehicleCategory: string | null } | null,
) {
  const [note, setNote] = useState("");
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managerPin, setManagerPin] = useState<string | null>(null);

  const staffQ = useQuery({
    queryKey: ["staff_registry"],
    queryFn: listStaffRegistry,
    staleTime: 60_000,
    enabled: !!asset,
  });
  const reqsQ = useQuery({
    queryKey: ["duty-roles", "fleet", asset?.id, asset?.vehicleCategory],
    queryFn: () => listRequirementsForFleetAsset(asset!),
    staleTime: 30_000,
    enabled: !!asset,
  });

  const driverId = getStaffId();
  const driver = useMemo(
    () => (staffQ.data ?? []).find((s) => s.id === driverId) ?? null,
    [staffQ.data, driverId],
  );
  const managers = useMemo(
    () => (staffQ.data ?? []).filter((s) => s.active && isManagerOnDutyRole(s.role)),
    [staffQ.data],
  );
  const requirements = reqsQ.data ?? [];
  const evalResult = evaluateRequirementHolds(driver, requirements);
  const needsGap = requirements.length > 0 && evalResult.overall !== "ok";
  const approved = dutyGapApproved(needsGap, note, managerId, managerPin);

  async function ensureApproved(): Promise<boolean> {
    if (!needsGap || !asset) return true;
    if (!approved) {
      toast.error("Manager must approve the licence / duty gap first.");
      return false;
    }
    await recordDutyGapApproval({
      functionKey: "fleet_drive",
      staffId: driver?.id ?? driverId,
      staffName: driver?.fullName ?? "Driver",
      managerStaffId: managerId!,
      note,
      subjectLabel: asset.name,
      missingSummary: dutyGapSummary(evalResult),
      ledgerCategory: "VEHICLE",
    });
    return true;
  }

  return {
    needsGap,
    approved,
    evalResult,
    driver,
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

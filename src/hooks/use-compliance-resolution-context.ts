import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComplianceAsset } from "@/lib/api/compliance-assets";
import { listFleet } from "@/lib/api/fleet";
import { listStaffRegistry } from "@/lib/data-store";
import type { ResolveVehicleSubject } from "@/components/dashboard/resolve-vehicle-maintenance-modal";
import type { ResolveCertSubject } from "@/components/dashboard/resolve-certification-modal";

export interface ComplianceResolutionContext {
  vehicleSubject: ResolveVehicleSubject | null;
  certSubject: ResolveCertSubject | null;
  /** True when action_module expects a fleet/staff link but none was found. */
  subjectMissing: boolean;
  subjectMissingLabel: string | null;
  loading: boolean;
}

export function useComplianceResolutionContext(
  asset: ComplianceAsset | null,
): ComplianceResolutionContext {
  const needsFleet =
    !!asset &&
    (asset.action_module === "vehicle_rego" ||
      asset.action_module === "vehicle_service" ||
      asset.action_module === "formal_audit");

  const needsStaff = !!asset && asset.action_module === "staff_cert";

  const fleetQ = useQuery({
    queryKey: ["fleet", "active"],
    queryFn: () => listFleet(),
    enabled: needsFleet,
    staleTime: 60_000,
  });

  const staffQ = useQuery({
    queryKey: ["staff-registry", "all"],
    queryFn: () => listStaffRegistry(),
    enabled: needsStaff,
    staleTime: 60_000,
  });

  const vehicleSubject = useMemo<ResolveVehicleSubject | null>(() => {
    if (!asset || !needsFleet) return null;
    const vehicle = (fleetQ.data ?? []).find((v) => v.id === asset.subject_id);
    if (!vehicle) return null;
    const flagKind =
      asset.action_module === "vehicle_service" ? "service" : "rego";
    return {
      assetId: vehicle.id,
      assetName: vehicle.name,
      regoPlate: vehicle.regoPlate,
      flagKind,
      previousValue:
        flagKind === "rego" ? vehicle.registrationExpiry : vehicle.lastServiceOdo,
      latestOdo: null,
    };
  }, [asset, needsFleet, fleetQ.data]);

  const certSubject = useMemo<ResolveCertSubject | null>(() => {
    if (!asset || !needsStaff) return null;
    const member = (staffQ.data ?? []).find((s) => s.id === asset.subject_id);
    if (!member) return null;
    const certName =
      (asset.config?.cert_name as string | undefined) ?? asset.name;
    return {
      staffId: member.id,
      staffName: member.fullName,
      certName,
      expiry: asset.expiry_date,
    };
  }, [asset, needsStaff, staffQ.data]);

  const subjectMissing = useMemo(() => {
    if (!asset) return false;
    if (needsFleet && !vehicleSubject) return true;
    if (needsStaff && !certSubject) return true;
    return false;
  }, [asset, needsFleet, needsStaff, vehicleSubject, certSubject]);

  const subjectMissingLabel = useMemo(() => {
    if (!subjectMissing || !asset) return null;
    if (needsFleet) {
      return `Linked vehicle not found (subject_id: ${asset.subject_id ?? "—"}). Edit the registry or use generic resolve.`;
    }
    if (needsStaff) {
      return `Linked staff member not found (subject_id: ${asset.subject_id ?? "—"}). Edit the registry or use generic resolve.`;
    }
    return null;
  }, [subjectMissing, asset, needsFleet, needsStaff]);

  return {
    vehicleSubject,
    certSubject,
    subjectMissing,
    subjectMissingLabel,
    loading: (needsFleet && fleetQ.isLoading) || (needsStaff && staffQ.isLoading),
  };
}

/** Whether completing this asset requires domain-specific fields before close. */
export function complianceAssetNeedsResolutionFields(
  asset: ComplianceAsset,
): boolean {
  return (
    asset.action_module === "vehicle_rego" ||
    asset.action_module === "vehicle_service" ||
    asset.action_module === "formal_audit" ||
    asset.action_module === "staff_cert" ||
    asset.action_module === "insurance_renewal" ||
    asset.action_module === "generic_resolve"
  );
}

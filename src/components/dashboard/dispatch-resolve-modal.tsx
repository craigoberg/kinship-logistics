import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComplianceAsset } from "@/lib/api/compliance-assets";
import { listFleet, type TransportAsset } from "@/lib/api/fleet";
import { listStaffRegistry, type StaffMember } from "@/lib/data-store";
import {
  ResolveVehicleMaintenanceModal,
  type ResolveVehicleSubject,
} from "./resolve-vehicle-maintenance-modal";
import {
  ResolveCertificationModal,
  type ResolveCertSubject,
} from "./resolve-certification-modal";
import { ResolveComplianceAssetModal } from "./resolve-compliance-asset-modal";

interface Props {
  asset: ComplianceAsset | null;
  onClose: () => void;
  onResolved?: () => void;
}

/**
 * Dispatches a "Resolve" click on a compliance_assets row to the correct modal
 * based on `action_module`. Falls back to the generic modal when a subject
 * link is missing (e.g. a vehicle was deleted but the registry row wasn't).
 */
export function ResolveDispatcher({ asset, onClose, onResolved }: Props) {
  const needsFleet =
    !!asset &&
    (asset.action_module === "vehicle_rego" ||
      asset.action_module === "vehicle_service" ||
      asset.action_module === "formal_audit");

  const needsStaff = !!asset && asset.action_module === "staff_cert";

  const fleetQ = useQuery<TransportAsset[]>({
    queryKey: ["fleet", "active"],
    queryFn: () => listFleet(),
    enabled: needsFleet,
    staleTime: 60_000,
  });
  const staffQ = useQuery<StaffMember[]>({
    queryKey: ["staff-registry", "all"],
    queryFn: () => listStaffRegistry(),
    enabled: needsStaff,
    staleTime: 60_000,
  });

  const vehicleSubject = useMemo<ResolveVehicleSubject | null>(() => {
    if (!asset || !needsFleet) return null;
    const fleet = fleetQ.data ?? [];
    const vehicle = fleet.find((v) => v.id === asset.subject_id);
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
    const all = staffQ.data ?? [];
    const member = all.find((s) => s.id === asset.subject_id);
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

  if (!asset) return null;

  // Vehicle rego / service
  if (asset.action_module === "vehicle_rego" || asset.action_module === "vehicle_service") {
    return (
      <ResolveVehicleMaintenanceModal
        subject={vehicleSubject}
        onClose={onClose}
        onResolved={onResolved}
      />
    );
  }

  // Formal audit (re-use vehicle modal in audit mode)
  if (asset.action_module === "formal_audit") {
    return (
      <ResolveVehicleMaintenanceModal
        subject={vehicleSubject}
        onClose={onClose}
        onResolved={onResolved}
      />
    );
  }

  // Staff certification
  if (asset.action_module === "staff_cert") {
    return (
      <ResolveCertificationModal
        subject={certSubject}
        onClose={onClose}
        onResolved={onResolved}
      />
    );
  }

  // insurance_renewal / generic_resolve — and any unmapped module
  return (
    <ResolveComplianceAssetModal
      asset={asset}
      onClose={onClose}
      onResolved={onResolved}
    />
  );
}

import {
  resolveCertification,
  resolveVehicleMaintenance,
  type CertResolutionType,
  type VehicleResolutionType,
} from "@/lib/api/ledger";
import {
  resolveComplianceAsset,
  archiveComplianceAsset,
  appendComplianceAssetResolveNote,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import { syncComplianceAssetsForVehicle } from "@/lib/api/fleet";
import type { ComplianceResolutionPayload } from "@/components/governance/compliance-resolution-panel";
import type { ComplianceResolutionContext } from "@/hooks/use-compliance-resolution-context";

export type { CertResolutionType, VehicleResolutionType };

export interface ExecuteComplianceResolutionArgs {
  asset: ComplianceAsset;
  context: ComplianceResolutionContext;
  timelineNote: string;
  payload: ComplianceResolutionPayload;
}

/**
 * Run domain-specific resolution, sync registry rows, and append a Hub
 * timeline `[RESOLVED]` note.
 */
export async function executeComplianceResolution(
  args: ExecuteComplianceResolutionArgs,
): Promise<void> {
  const { asset, context, timelineNote, payload } = args;
  const note = timelineNote.trim();
  if (note.length < 10) {
    throw new Error("Timeline note must be at least 10 characters.");
  }

  let resolutionSummary = "";

  if (payload.kind === "vehicle") {
    const subject = context.vehicleSubject;
    if (!subject) throw new Error("Vehicle subject not found.");
    await resolveVehicleMaintenance({
      assetId: subject.assetId,
      assetName: subject.assetName,
      regoPlate: subject.regoPlate,
      flagKind: subject.flagKind,
      resolutionType: payload.resolutionType,
      newRegistrationExpiry: payload.newRegistrationExpiry,
      newServiceOdo: payload.newServiceOdo,
      newServiceDate: payload.newServiceDate,
      deferredUntil: null,
      actionDate: payload.actionDate,
      previousValue: subject.previousValue,
      evidenceRef: payload.evidenceRef,
      justification: note,
      auditorStaffId: payload.auditorStaffId,
      auditorPin: payload.auditorPin,
      witnessStaffId: payload.witnessStaffId,
      witnessPin: payload.witnessPin,
      checklistCategory:
        payload.resolutionType === "formal_audit" ? "VEHICLE_FORMAL_AUDIT" : null,
      checklistResponses: payload.checklistResponses,
    });
    await syncComplianceAssetsForVehicle(subject.assetId);
    if (payload.resolutionType === "serviced" && payload.nextServiceDue) {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase
        .from("compliance_assets")
        .update({
          expiry_date: payload.nextServiceDue,
          next_action_at: null,
        })
        .eq("id", asset.id);
    }
    resolutionSummary = `vehicle · ${payload.resolutionType}`;
  } else if (payload.kind === "cert") {
    const subject = context.certSubject;
    if (!subject) throw new Error("Staff certification subject not found.");
    await resolveCertification({
      staffId: subject.staffId,
      staffName: subject.staffName,
      certName: subject.certName,
      previousExpiry: subject.expiry,
      resolutionType: payload.resolutionType,
      newExpiry: payload.newExpiry,
      deferredUntil: null,
      actionDate: payload.actionDate,
      evidenceRef: payload.evidenceRef,
      justification: note,
    });
    resolutionSummary = `cert · ${payload.resolutionType}`;
  } else if (payload.kind === "generic") {
    await resolveComplianceAsset({
      assetId: asset.id,
      newExpiry: payload.newExpiry,
      actionDate: payload.actionDate,
      evidenceRef: payload.evidenceRef,
      justification: note,
      managerStaffId: payload.managerStaffId,
      managerPin: payload.managerPin,
      witnessStaffId: payload.witnessStaffId,
      witnessPin: payload.witnessPin,
    });
    resolutionSummary = "generic resolve";
  } else if (payload.kind === "generic_fallback") {
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase
      .from("compliance_assets")
      .update({
        expiry_date: payload.newExpiry,
        next_action_at: null,
      })
      .eq("id", asset.id);
    if (error) throw error;
    resolutionSummary = "generic fallback (subject unlinked)";
  }

  await appendComplianceAssetResolveNote(asset.id, {
    note,
    resolutionSummary,
    evidenceRef:
      payload.kind === "generic" || payload.kind === "generic_fallback"
        ? payload.evidenceRef
        : payload.kind === "vehicle"
          ? payload.evidenceRef ?? undefined
          : payload.kind === "cert"
            ? payload.evidenceRef ?? undefined
            : undefined,
    metadata: { payload_kind: payload.kind, archived: true },
    skipLedger: payload.kind === "generic" || payload.kind === "vehicle" || payload.kind === "cert",
  });

  await archiveComplianceAsset(asset.id, note);
}

import { supabase } from "@/integrations/supabase/client";
import {
  listStaffRegistry,
  resolveStaffIdWithFallback,
  updateStaffMember,
  verifyStaffPin,
  type StaffCertification,
} from "@/lib/data-store";
import { updateFleetAsset } from "@/lib/api/fleet";
import {
  insertChecklistResponses,
  type ChecklistResponseRow,
} from "@/lib/api/checklists";

export type LedgerCategory = "VEHICLE" | "CENTRE" | "CLIENT" | "TRIP";
export type LedgerSeverity = "RED" | "YELLOW" | "GREEN" | "INFO";

export interface LedgerEntry {
  id: string;
  created_at: string;
  staff_id: string;
  category: LedgerCategory;
  severity: LedgerSeverity;
  action_type: string;
  gps_lat: number | null;
  gps_lng: number | null;
  metadata: Record<string, unknown> | null;
}

export type LedgerInsert = Omit<LedgerEntry, "id" | "created_at">;

/**
 * Append a row to the operational_ledger. Best-effort: failures are logged
 * but never thrown, so compliance logging cannot break the calling flow.
 */
export async function writeToLedger(payload: LedgerInsert): Promise<void> {
  try {
    const { error } = await supabase
      .from("operational_ledger")
      .insert(payload);
    if (error) {
      console.error("[ledger] write failed", error);
    }
  } catch (err) {
    console.error("[ledger] write threw", err);
  }
}

/**
 * Best-effort browser geolocation grab. Resolves to null on:
 *  - SSR / no navigator
 *  - permission denied
 *  - timeout (3s)
 *  - any positioning error
 * Never throws.
 */
export function tryGetGps(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: { lat: number; lng: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timer = setTimeout(() => done(null), 3000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          done({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          clearTimeout(timer);
          done(null);
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 3000 },
      );
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}



// ---------------------------------------------------------------------------
// Certification resolution — Manager-only "Resolve" action on the dashboard
// Staff Certifications tile. Appends an immutable receipt to operational_ledger
// AND mirrors the resolution back to staff_registry.certifications JSONB so
// the next dashboard scan reflects the new state.
// ---------------------------------------------------------------------------

export type CertResolutionType = "renewed" | "deferred" | "revoked";

export interface ResolveCertificationInput {
  staffId: string;
  staffName: string;
  certName: string;
  previousExpiry: string | null;
  resolutionType: CertResolutionType;
  /** Required when resolutionType === 'renewed' — ISO yyyy-mm-dd, future-dated. */
  newExpiry?: string | null;
  /** Required when resolutionType === 'deferred' — ISO yyyy-mm-dd, max +30 days. */
  deferredUntil?: string | null;
  /** When the renewal actually occurred — ISO yyyy-mm-dd, past or today. Required when resolutionType === 'renewed'. */
  actionDate?: string | null;
  /** Evidence reference (doc id, link, ticket #). Required (min 6 chars) only when resolutionType === 'renewed'; null otherwise. */
  evidenceRef: string | null;
  /** Manager justification notes. Min 20 chars. */
  justification: string;
}


export interface ResolveCertificationResult {
  staffId: string;
  certName: string;
  ledgerWritten: boolean;
  staffMirrored: boolean;
}

/**
 * Append a CERTIFICATION_RESOLVED receipt to operational_ledger and mirror
 * the new cert state back to staff_registry. Append-only: no UPDATE/DELETE
 * on prior ledger rows. Double-flag collapse is implicit — the next dashboard
 * scan reads the mirrored JSONB and the previous RED row disappears from view,
 * while the ledger preserves the full history.
 */
export async function resolveCertification(
  input: ResolveCertificationInput,
): Promise<ResolveCertificationResult> {
  const {
    staffId,
    staffName,
    certName,
    previousExpiry,
    resolutionType,
    newExpiry,
    deferredUntil,
    actionDate,
    evidenceRef,
    justification,
  } = input;


  // 1) Mirror back to staff_registry JSONB so the dashboard reflects it.
  let staffMirrored = false;
  try {
    const all = await listStaffRegistry();
    const target = all.find((s) => s.id === staffId);
    if (!target) throw new Error(`Staff ${staffId} not found`);

    const nameKey = certName.trim().toLowerCase();
    const matchIdx = target.certifications.findIndex(
      (c) => (c.name ?? "").trim().toLowerCase() === nameKey,
    );

    let nextCerts: StaffCertification[];
    if (matchIdx === -1) {
      nextCerts = target.certifications.slice();
    } else if (resolutionType === "revoked") {
      nextCerts = target.certifications.filter((_, i) => i !== matchIdx);
    } else {
      nextCerts = target.certifications.map((c, i) => {
        if (i !== matchIdx) return c;
        if (resolutionType === "renewed") {
          return { ...c, expiry: newExpiry ?? c.expiry, deferredUntil: null };
        }
        // deferred
        return { ...c, deferredUntil: deferredUntil ?? null };
      });
    }

    await updateStaffMember(staffId, {
      fullName: target.fullName,
      role: target.role,
      personnelType: target.personnelType,
      phone: target.phone,
      email: target.email,
      streetAddress: target.streetAddress,
      active: target.active,
      notes: target.notes,
      certifications: nextCerts,
    });
    staffMirrored = true;
  } catch (err) {
    console.error("[resolveCertification] mirror to staff_registry failed", err);
    throw err;
  }

  // 2) Append immutable ledger receipt.
  const gps = await tryGetGps();
  const actorId = await resolveStaffIdWithFallback();
  const severityAfter =
    resolutionType === "renewed"
      ? "GREEN"
      : resolutionType === "deferred"
        ? "YELLOW"
        : "INFO";
  const subjectId = `${staffId}:${certName.trim()}`;

  let ledgerWritten = false;
  try {
    const { error } = await supabase.from("operational_ledger").insert({
      staff_id: actorId,
      category: "CENTRE",
      severity: severityAfter,
      action_type: "CERTIFICATION_RESOLVED",
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      metadata: {
        subject_type: "staff_certification",
        subject_id: subjectId,
        staff_id: staffId,
        staff_name: staffName,
        cert_name: certName,
        previous_expiry: previousExpiry,
        resolution_type: resolutionType,
        new_expiry: newExpiry ?? null,
        new_expiry_date: newExpiry ?? null,
        action_date: actionDate ?? null,

        deferred_until: deferredUntil ?? null,
        evidence_ref: evidenceRef ?? null,
        justification,
        gps_attempted: true,
        gps_captured: !!gps,
        source: "resolve_certification_modal",
      },
    });
    if (error) throw error;
    ledgerWritten = true;
  } catch (err) {
    console.error("[resolveCertification] ledger write failed", err);
    throw err;
  }

  return { staffId, certName, ledgerWritten, staffMirrored };
}

// ---------------------------------------------------------------------------
// Vehicle maintenance resolution — Manager-only "Resolve" action on the
// dashboard Vehicle Compliance tile. Mirrors the certification pattern:
// appends an immutable receipt to operational_ledger AND mirrors the new
// state back to transport_assets (registration_expiry / last_service_* /
// deferred_until) so the next dashboard scan reflects it.
// ---------------------------------------------------------------------------

export type VehicleResolutionType =
  | "renewed" // rego renewed → new registration_expiry
  | "serviced" // vehicle serviced → new last_service_odo + last_service_date
  | "deferred" // snooze the YELLOW flag → deferred_until (max +30 days, UI-enforced)
  | "decommissioned" // retire from fleet → is_active=false
  | "formal_audit"; // Two-Man formal safety audit (checklist + dual-PIN)

export type VehicleFlagKind = "rego" | "service" | "vin_missing";

export interface ResolveVehicleMaintenanceInput {
  assetId: string;
  assetName: string;
  regoPlate: string;
  flagKind: VehicleFlagKind;
  resolutionType: VehicleResolutionType;
  /** Required when resolutionType === 'renewed' — ISO yyyy-mm-dd. */
  newRegistrationExpiry?: string | null;
  /** Required when resolutionType === 'serviced' — odometer at service. */
  newServiceOdo?: number | null;
  /** Defaults to today when resolutionType === 'serviced'. */
  newServiceDate?: string | null;
  /** Required when resolutionType === 'deferred' — ISO yyyy-mm-dd, max +30d. */
  deferredUntil?: string | null;
  /** When the renewal/service actually occurred — ISO yyyy-mm-dd, past or today. Required for renewed/serviced. */
  actionDate?: string | null;

  /** Previous value for audit. */
  previousValue?: string | number | null;
  /** Evidence reference. Required (min 6 chars) only for renewed/serviced. */
  evidenceRef: string | null;
  /** Manager justification. Always required, min 20 chars. */
  justification: string;

  // ----- Formal Audit only (resolutionType === 'formal_audit') -----
  /** Auditor staff id (PIN-verified). */
  auditorStaffId?: string | null;
  /** Auditor 4-digit PIN — server-verified via verify_staff_pin RPC. */
  auditorPin?: string | null;
  /** Witness staff id (PIN-verified, must differ from auditor). */
  witnessStaffId?: string | null;
  /** Witness 4-digit PIN. */
  witnessPin?: string | null;
  /** Full checklist snapshot — embedded in ledger metadata + mirrored to checklist_responses. */
  checklistCategory?: string | null;
  checklistResponses?: ChecklistResponseRow[];
}

export interface ResolveVehicleMaintenanceResult {
  assetId: string;
  flagKind: VehicleFlagKind;
  ledgerWritten: boolean;
  assetMirrored: boolean;
}

export async function resolveVehicleMaintenance(
  input: ResolveVehicleMaintenanceInput,
): Promise<ResolveVehicleMaintenanceResult> {
  const {
    assetId,
    assetName,
    regoPlate,
    flagKind,
    resolutionType,
    newRegistrationExpiry,
    newServiceOdo,
    newServiceDate,
    deferredUntil,
    actionDate,
    previousValue,
    evidenceRef,
    justification,
    auditorStaffId,
    auditorPin,
    witnessStaffId,
    witnessPin,
    checklistCategory,
    checklistResponses,
  } = input;

  const isFormalAudit = resolutionType === "formal_audit";

  // 0) Formal Audit: validate the two PINs server-side before touching anything.
  if (isFormalAudit) {
    if (!auditorStaffId || !witnessStaffId) {
      throw new Error("Auditor and Witness must both be selected.");
    }
    if (auditorStaffId === witnessStaffId) {
      throw new Error("Auditor and Witness must be different staff members.");
    }
    if (!auditorPin || !witnessPin) {
      throw new Error("Both Auditor and Witness PINs are required.");
    }
    if (!checklistResponses || checklistResponses.length === 0) {
      throw new Error("Checklist is empty — cannot submit a formal audit.");
    }
    const missing = checklistResponses.filter((r) => !r.status);
    if (missing.length > 0) {
      throw new Error("Every checklist item must be marked before submission.");
    }
    const [auditorOk, witnessOk] = await Promise.all([
      verifyStaffPin(auditorStaffId, auditorPin),
      verifyStaffPin(witnessStaffId, witnessPin),
    ]);
    if (!auditorOk) throw new Error("Invalid Auditor PIN.");
    if (!witnessOk) throw new Error("Invalid Witness PIN.");
  }

  // 1) Mirror back to transport_assets (skip for formal_audit — periodic review,
  //    not a flag clear).
  let assetMirrored = false;
  try {
    if (resolutionType === "renewed") {
      await updateFleetAsset(assetId, {
        registrationExpiry: newRegistrationExpiry ?? null,
        deferredUntil: null,
      });
    } else if (resolutionType === "serviced") {
      await updateFleetAsset(assetId, {
        lastServiceOdo: newServiceOdo ?? null,
        lastServiceDate:
          actionDate ?? newServiceDate ?? new Date().toISOString().slice(0, 10),
        deferredUntil: null,
      });
    } else if (resolutionType === "deferred") {
      await updateFleetAsset(assetId, { deferredUntil: deferredUntil ?? null });
    } else if (resolutionType === "decommissioned") {
      await updateFleetAsset(assetId, { isActive: false });
    }
    assetMirrored = true;
  } catch (err) {
    console.error("[resolveVehicleMaintenance] mirror to transport_assets failed", err);
    throw err;
  }

  // 2) Append immutable ledger receipt.
  const gps = await tryGetGps();
  const actorId = await resolveStaffIdWithFallback();

  const anyFail =
    isFormalAudit &&
    !!checklistResponses?.some((r) => r.status === "fail");
  const severityAfter: LedgerSeverity = isFormalAudit
    ? anyFail
      ? "YELLOW"
      : "GREEN"
    : resolutionType === "renewed" || resolutionType === "serviced"
      ? "GREEN"
      : resolutionType === "deferred"
        ? "YELLOW"
        : "INFO";

  const actionType = isFormalAudit
    ? "VEHICLE_FORMAL_AUDIT"
    : "VEHICLE_MAINTENANCE_RESOLVED";
  const subjectId = isFormalAudit
    ? `${assetId}:formal_audit`
    : `${assetId}:${flagKind}`;

  let ledgerWritten = false;
  let ledgerId: string | null = null;
  try {
    const { data, error } = await supabase
      .from("operational_ledger")
      .insert({
        staff_id: actorId,
        category: "VEHICLE",
        severity: severityAfter,
        action_type: actionType,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        metadata: {
          subject_type: "transport_asset",
          subject_id: subjectId,
          asset_id: assetId,
          asset_name: assetName,
          rego_plate: regoPlate,
          flag_kind: flagKind,
          resolution_type: resolutionType,
          previous_value: previousValue ?? null,
          new_value:
            resolutionType === "renewed"
              ? (newRegistrationExpiry ?? null)
              : resolutionType === "serviced"
                ? (newServiceOdo ?? null)
                : null,
          new_expiry_date:
            resolutionType === "renewed" ? (newRegistrationExpiry ?? null) : null,
          action_date: actionDate ?? null,
          deferred_until: deferredUntil ?? null,

          evidence_ref: evidenceRef ?? null,
          justification,
          gps_attempted: true,
          gps_captured: !!gps,
          source: "resolve_vehicle_maintenance_modal",

          // Formal Audit payload (null on non-audit rows).
          auditor_staff_id: isFormalAudit ? auditorStaffId : null,
          witness_staff_id: isFormalAudit ? witnessStaffId : null,
          checklist_category: isFormalAudit ? (checklistCategory ?? null) : null,
          checklist_responses: isFormalAudit ? (checklistResponses ?? []) : null,
          checklist_any_fail: isFormalAudit ? anyFail : null,
        },
      })
      .select("id")
      .single();
    if (error) throw error;
    ledgerWritten = true;
    ledgerId = (data?.id as string) ?? null;
  } catch (err) {
    console.error("[resolveVehicleMaintenance] ledger write failed", err);
    throw err;
  }

  // 3) Formal Audit: mirror checklist responses into the normalized table.
  if (isFormalAudit && ledgerId && checklistResponses?.length) {
    try {
      await insertChecklistResponses(ledgerId, checklistResponses);
    } catch (err) {
      console.error(
        "[resolveVehicleMaintenance] checklist_responses insert failed",
        err,
      );
      // Ledger row is the source of truth; don't roll back the audit if the
      // mirror fails — metadata still contains the full snapshot.
    }
  }

  return { assetId, flagKind, ledgerWritten, assetMirrored };
}

import { supabase } from "@/integrations/supabase/client";
import {
  listTransportAssets,
  type TransportAsset,
} from "@/lib/data-store";

export type { TransportAsset };

/** Active fleet only — what the dashboard scans. */
export async function listFleet(): Promise<TransportAsset[]> {
  const all = await listTransportAssets();
  return all.filter((a) => a.isActive);
}

/**
 * Latest known odometer reading for an asset, derived from
 * asset_daily_clearance.start_odometer (highest value wins). Returns null
 * if no clearance has ever been recorded.
 */
export async function getLatestOdometer(assetId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .select("start_odometer")
    .eq("asset_id", assetId)
    .order("start_odometer", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[getLatestOdometer] failed", error);
    return null;
  }
  if (!data) return null;
  const v = (data as { start_odometer: number | string }).start_odometer;
  return v == null ? null : Number(v);
}

/** Batched latest-odo lookup for every asset in `ids`. */
export async function getLatestOdometers(
  ids: string[],
): Promise<Record<string, number | null>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from("asset_daily_clearance")
    .select("asset_id, start_odometer")
    .in("asset_id", ids);
  if (error) {
    console.error("[getLatestOdometers] failed", error);
    return {};
  }
  const out: Record<string, number | null> = {};
  for (const id of ids) out[id] = null;
  for (const r of (data ?? []) as { asset_id: string; start_odometer: number | string }[]) {
    const v = Number(r.start_odometer);
    if (!Number.isFinite(v)) continue;
    const prev = out[r.asset_id];
    if (prev == null || v > prev) out[r.asset_id] = v;
  }
  return out;
}

export interface FleetAssetPatch {
  name?: string;
  makeModel?: string | null;
  regoPlate?: string;
  passengerCapacity?: number;
  vehicleCategory?: string | null;
  vin?: string | null;
  registrationExpiry?: string | null;
  serviceIntervalKm?: number | null;
  lastServiceOdo?: number | null;
  lastServiceDate?: string | null;
  deferredUntil?: string | null;
  hasWheelchairHoist?: boolean;
  isActive?: boolean;
}

export interface FleetAssetInput {
  name: string;
  makeModel?: string | null;
  regoPlate: string;
  passengerCapacity: number;
  vehicleCategory?: string | null;
  vin?: string | null;
  registrationExpiry?: string | null;
  serviceIntervalKm?: number | null;
  lastServiceOdo?: number | null;
  lastServiceDate?: string | null;
  hasWheelchairHoist?: boolean;
  isActive?: boolean;
}

export async function updateFleetAsset(
  assetId: string,
  patch: FleetAssetPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.makeModel !== undefined) row.make_model = patch.makeModel?.trim() || null;
  if (patch.regoPlate !== undefined) row.rego_plate = patch.regoPlate.trim();
  if (patch.passengerCapacity !== undefined) row.passenger_capacity = patch.passengerCapacity;
  if (patch.vehicleCategory !== undefined) row.vehicle_category = patch.vehicleCategory?.trim() || null;
  if (patch.vin !== undefined) row.vin = patch.vin?.trim() || null;
  if (patch.registrationExpiry !== undefined)
    row.registration_expiry = patch.registrationExpiry;
  if (patch.lastServiceOdo !== undefined) row.last_service_odo = patch.lastServiceOdo;
  if (patch.lastServiceDate !== undefined) row.last_service_date = patch.lastServiceDate;
  if (patch.deferredUntil !== undefined) row.deferred_until = patch.deferredUntil;
  if (patch.hasWheelchairHoist !== undefined) row.has_wheelchair_hoist = patch.hasWheelchairHoist;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;

  const { error } = await supabase.from("transport_assets").update(row).eq("id", assetId);
  if (error) {
    console.error("[updateFleetAsset] failed", error);
    throw error;
  }
  await syncComplianceAssetsForVehicle(assetId);
}

export async function insertFleetAsset(input: FleetAssetInput): Promise<string> {
  const { data, error } = await supabase
    .from("transport_assets")
    .insert({
      name: input.name.trim(),
      make_model: input.makeModel?.trim() || null,
      rego_plate: input.regoPlate.trim(),
      passenger_capacity: input.passengerCapacity,
      vehicle_category: input.vehicleCategory?.trim() || "bus",
      vin: input.vin?.trim() || null,
      registration_expiry: input.registrationExpiry ?? null,
      service_interval_km: input.serviceIntervalKm ?? null,
      last_service_odo: input.lastServiceOdo ?? null,
      last_service_date: input.lastServiceDate ?? null,
      has_wheelchair_hoist: input.hasWheelchairHoist ?? false,
      is_active: input.isActive ?? true,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[insertFleetAsset] failed", error);
    throw error;
  }
  const id = (data as { id: string }).id;
  await syncComplianceAssetsForVehicle(id);
  return id;
}

async function fetchRegoYellowDays(): Promise<number> {
  const { data } = await supabase
    .from("system_parameters")
    .select("value")
    .eq("key", "rego_threshold_days")
    .maybeSingle();
  if (!data) return 30;
  const v = (data as { value: unknown }).value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 30;
}

function addDaysISO(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Mirrors docs/sql/2026-07-07_compliance_assets_backfill.sql for a single vehicle.
 * Keeps Governance Hub rego/service rows aligned with transport_assets edits.
 */
export async function syncComplianceAssetsForVehicle(assetId: string): Promise<void> {
  const { data: asset, error } = await supabase
    .from("transport_assets")
    .select(
      "id, name, rego_plate, is_active, registration_expiry, last_service_date, service_interval_km",
    )
    .eq("id", assetId)
    .maybeSingle();
  if (error || !asset) return;

  const a = asset as {
    id: string;
    name: string;
    rego_plate: string | null;
    is_active: boolean;
    registration_expiry: string | null;
    last_service_date: string | null;
    service_interval_km: number | null;
  };

  if (!a.is_active) {
    await supabase
      .from("compliance_assets")
      .update({ status: "archived" })
      .eq("subject_table", "transport_assets")
      .eq("subject_id", assetId);
    return;
  }

  const regoYellow = await fetchRegoYellowDays();
  const regoName = `${a.name} (${a.rego_plate ?? "—"}) — Registration`;

  if (a.registration_expiry) {
    const { data: existing } = await supabase
      .from("compliance_assets")
      .select("id")
      .eq("subject_table", "transport_assets")
      .eq("subject_id", assetId)
      .eq("type", "rego")
      .maybeSingle();

    const regoPayload = {
      category: "VEHICLE",
      type: "rego",
      name: regoName,
      description: "Vehicle registration renewal — auto-synced from Fleet Register.",
      subject_table: "transport_assets",
      subject_id: assetId,
      expiry_date: a.registration_expiry,
      action_module: "vehicle_rego",
      config: {
        yellow_days: regoYellow,
        red_days: 7,
        handshake: "single",
        fleet_synced: true,
      },
      status: "active" as const,
    };

    if (existing) {
      await supabase
        .from("compliance_assets")
        .update({ ...regoPayload, updated_at: new Date().toISOString() })
        .eq("id", (existing as { id: string }).id);
    } else {
      await supabase.from("compliance_assets").insert(regoPayload);
    }
  }

  if (a.last_service_date) {
    const serviceExpiry = addDaysISO(a.last_service_date, 365);
    const serviceName = `${a.name} (${a.rego_plate ?? "—"}) — Scheduled Service`;

    const { data: existingSvc } = await supabase
      .from("compliance_assets")
      .select("id")
      .eq("subject_table", "transport_assets")
      .eq("subject_id", assetId)
      .eq("type", "service")
      .maybeSingle();

    const svcPayload = {
      category: "VEHICLE",
      type: "service",
      name: serviceName,
      description: "Scheduled vehicle service — auto-synced from Fleet Register.",
      subject_table: "transport_assets",
      subject_id: assetId,
      expiry_date: serviceExpiry,
      action_module: "vehicle_service",
      config: {
        yellow_days: 30,
        red_days: 7,
        handshake: "single",
        fleet_synced: true,
        service_interval_km: a.service_interval_km,
      },
      status: "active" as const,
    };

    if (existingSvc) {
      await supabase
        .from("compliance_assets")
        .update({ ...svcPayload, updated_at: new Date().toISOString() })
        .eq("id", (existingSvc as { id: string }).id);
    } else {
      await supabase.from("compliance_assets").insert(svcPayload);
    }
  }
}

export const FLEET_VEHICLE_CATEGORIES = [
  { value: "bus", label: "Bus (general)" },
  { value: "hiace", label: "HiAce" },
  { value: "coaster", label: "Coaster" },
] as const;

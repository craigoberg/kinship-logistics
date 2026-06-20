import { supabase } from "@/integrations/supabase/client";
import { listTransportAssets, type TransportAsset } from "@/lib/data-store";

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
  registrationExpiry?: string | null;
  lastServiceOdo?: number | null;
  lastServiceDate?: string | null;
  deferredUntil?: string | null;
  isActive?: boolean;
}

export async function updateFleetAsset(
  assetId: string,
  patch: FleetAssetPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.registrationExpiry !== undefined)
    row.registration_expiry = patch.registrationExpiry;
  if (patch.lastServiceOdo !== undefined) row.last_service_odo = patch.lastServiceOdo;
  if (patch.lastServiceDate !== undefined) row.last_service_date = patch.lastServiceDate;
  if (patch.deferredUntil !== undefined) row.deferred_until = patch.deferredUntil;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;

  const { error } = await supabase
    .from("transport_assets")
    .update(row)
    .eq("id", assetId);
  if (error) {
    console.error("[updateFleetAsset] failed", error);
    throw error;
  }
}

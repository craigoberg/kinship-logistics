/**
 * Buses and today's walkaround rows, saved when a trip is opened.
 * The first leave of the day asks which bus. That list has to already be on the tablet.
 */
import {
  getClearanceForAssetOnDate,
  insertAssetClearanceWithItems,
  listClearancesForDate,
  listTransportAssets,
  markQueuedDriverAuthorization,
  type AssetDailyClearance,
  type NewClearanceItemInput,
  type TransportAsset,
} from "@/lib/data-store";
import { isNetworkError } from "@/lib/manifest-offline";
import { isAppOnline } from "@/lib/simulated-offline";
import { operationalNowIso } from "@/lib/operational-clock";
import { idbDelete, idbGet, idbGetAll, idbPut, STORE_CACHE } from "./idb";

const ASSETS_KEY = "fleet:assets";

type AssetCache = {
  key: typeof ASSETS_KEY;
  savedAt: string;
  assets: TransportAsset[];
};

type ClearanceCache = {
  key: string;
  savedAt: string;
  date: string;
  rows: AssetDailyClearance[];
};

function clearanceKey(date: string): string {
  return `fleet:clearances:${date.slice(0, 10)}`;
}

async function loadAssets(): Promise<TransportAsset[]> {
  return (await idbGet<AssetCache>(STORE_CACHE, ASSETS_KEY))?.assets ?? [];
}

async function loadClearances(date: string): Promise<AssetDailyClearance[]> {
  return (await idbGet<ClearanceCache>(STORE_CACHE, clearanceKey(date)))?.rows ?? [];
}

export async function resolveClearancesForDate(
  sessionDate: string,
): Promise<AssetDailyClearance[]> {
  const date = sessionDate.slice(0, 10);
  if (!isAppOnline()) return loadClearances(date);
  const live = await listClearancesForDate(date);
  if (!isAppOnline()) return loadClearances(date);
  await idbPut(STORE_CACHE, {
    key: clearanceKey(date),
    savedAt: operationalNowIso(),
    date,
    rows: live,
  } satisfies ClearanceCache);
  return live;
}

/** Save the fleet and this day's clearances. No-op when the link is down. */
export async function rememberTripFleet(sessionDate: string): Promise<void> {
  if (!isAppOnline()) return;
  const date = sessionDate.slice(0, 10);
  const [assets, rows] = await Promise.all([
    listTransportAssets(),
    resolveClearancesForDate(date),
  ]);
  if (!isAppOnline()) return;
  if (assets.length > 0) {
    await idbPut(STORE_CACHE, {
      key: ASSETS_KEY,
      savedAt: operationalNowIso(),
      assets,
    } satisfies AssetCache);
  }
  await idbPut(STORE_CACHE, {
    key: clearanceKey(date),
    savedAt: operationalNowIso(),
    date,
    rows,
  } satisfies ClearanceCache);
}

export async function resolveTransportAssets(): Promise<TransportAsset[]> {
  if (!isAppOnline()) return loadAssets();
  const live = await listTransportAssets();
  if (!isAppOnline()) return loadAssets();
  if (live.length > 0) {
    await idbPut(STORE_CACHE, {
      key: ASSETS_KEY,
      savedAt: operationalNowIso(),
      assets: live,
    } satisfies AssetCache);
    return live;
  }
  const cached = await loadAssets();
  return cached.length > 0 ? cached : live;
}

export async function resolveClearanceForAsset(
  assetId: string,
  sessionDate: string,
): Promise<AssetDailyClearance | null> {
  const date = sessionDate.slice(0, 10);
  if (!isAppOnline()) {
    const rows = await loadClearances(date);
    return rows.find((row) => row.assetId === assetId) ?? null;
  }
  const live = await getClearanceForAssetOnDate(assetId, date);
  if (!isAppOnline()) {
    const rows = await loadClearances(date);
    return rows.find((row) => row.assetId === assetId) ?? live;
  }
  return live;
}

type QueuedBusClearance = {
  key: string;
  assetId: string;
  clearanceDate: string;
  driverStaffId: string;
  startOdometer: number;
  items: NewClearanceItemInput[];
  accumulatedIssues: string | null;
  driverComfortDeclared: boolean;
  /** When the driver PIN was accepted on this tablet. The PIN is not stored. */
  verifiedAt: string;
};

function queueKey(assetId: string, date: string): string {
  return `fleet:clearance-queue:${assetId}:${date.slice(0, 10)}`;
}

/** Keep the walkaround on this tablet and upload it when the link returns. */
export async function queueBusClearance(input: {
  assetId: string;
  clearanceDate: string;
  driverStaffId: string;
  startOdometer: number;
  items: NewClearanceItemInput[];
  accumulatedIssues: string | null;
  driverComfortDeclared: boolean;
}): Promise<void> {
  const date = input.clearanceDate.slice(0, 10);
  const verifiedAt = operationalNowIso();
  const queued: QueuedBusClearance = {
    key: queueKey(input.assetId, date),
    assetId: input.assetId,
    clearanceDate: date,
    driverStaffId: input.driverStaffId,
    startOdometer: input.startOdometer,
    items: input.items,
    accumulatedIssues: input.accumulatedIssues,
    driverComfortDeclared: input.driverComfortDeclared,
    verifiedAt,
  };
  await idbPut(STORE_CACHE, queued);
  const rows = (await loadClearances(date)).filter((row) => row.assetId !== input.assetId);
  rows.push({
    id: `local-${input.assetId}`,
    assetId: input.assetId,
    clearanceDate: date,
    driverStaffId: input.driverStaffId,
    startOdometer: input.startOdometer,
    status: "passed",
    notes: null,
    accumulatedIssues: input.accumulatedIssues,
    driverComfortDeclared: input.driverComfortDeclared,
    requiresManagerReview: false,
    driverAuthStaffId: input.driverStaffId,
    driverAuthPinVerifiedAt: verifiedAt,
    managerAuthStaffId: null,
    managerAuthPinVerifiedAt: null,
    createdAt: verifiedAt,
  });
  await idbPut(STORE_CACHE, {
    key: clearanceKey(date),
    savedAt: verifiedAt,
    date,
    rows,
  } satisfies ClearanceCache);
}

/** Upload queued walkarounds. Safe to call whenever the link is up. */
export async function flushQueuedBusClearances(): Promise<void> {
  if (!isAppOnline()) return;
  const all = await idbGetAll<QueuedBusClearance>(STORE_CACHE);
  const pending = all.filter((row) => row.key?.startsWith("fleet:clearance-queue:"));
  for (const row of pending) {
    try {
      let existing = await getClearanceForAssetOnDate(row.assetId, row.clearanceDate);
      if (!existing) {
        try {
          existing = (
            await insertAssetClearanceWithItems({
              assetId: row.assetId,
              clearanceDate: row.clearanceDate,
              driverStaffId: row.driverStaffId,
              startOdometer: row.startOdometer,
              items: row.items,
              accumulatedIssues: row.accumulatedIssues,
              driverComfortDeclared: row.driverComfortDeclared,
            })
          ).clearance;
        } catch (err) {
          if (!/already recorded/i.test(err instanceof Error ? err.message : "")) throw err;
          existing = await getClearanceForAssetOnDate(row.assetId, row.clearanceDate);
        }
      }
      if (existing && !existing.driverAuthPinVerifiedAt) {
        await markQueuedDriverAuthorization(existing.id, row.driverStaffId, row.verifiedAt);
      }
      await idbDelete(STORE_CACHE, row.key);
    } catch (err) {
      if (!isNetworkError(err)) {
        console.warn("[flushQueuedBusClearances]", err);
      }
    }
  }
}

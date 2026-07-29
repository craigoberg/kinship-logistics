/**
 * Manifest mid-run offline outbox (BL-082 Alpha).
 * Durable IndexedDB snapshot + ordered replay into real Manifest APIs.
 */
import {
  patchTripLeg,
  type ActiveTripBundle,
  type LegPatch,
  type TripLeg,
} from "@/lib/data-store";
import {
  markNotTravelling,
  markOnBus,
  type EventBusManifestRow,
} from "@/lib/api/event-day-ops";
import { isAppOnline } from "@/lib/simulated-offline";
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbGetAllByIndex,
  idbPut,
  STORE_META,
  STORE_OUTBOX,
  STORE_SNAPSHOTS,
} from "./idb";
import type {
  ManifestOfflineListener,
  ManifestOfflineSnapshot,
  ManifestOutboxItem,
  ManifestOutboxOp,
} from "./types";

const CURRENT_DRIVER_META = "currentDriverStaffId";
const listeners = new Set<ManifestOfflineListener>();

let flushInFlight: Promise<{ ok: number; failed: number }> | null = null;

export function subscribeManifestOffline(fn: ManifestOfflineListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((l) => l());
}

export function isNetworkError(err: unknown): boolean {
  if (!isAppOnline()) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(
    msg,
  );
}

function newId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneBundle(bundle: ActiveTripBundle): ActiveTripBundle {
  return {
    trip: { ...bundle.trip },
    legs: bundle.legs.map((l) => ({ ...l })),
    eventTitle: bundle.eventTitle,
  };
}

function applyLegPatchLocal(leg: TripLeg, patch: LegPatch): TripLeg {
  return { ...leg, ...patch };
}

function applyOpToSnapshot(
  snap: ManifestOfflineSnapshot,
  op: ManifestOutboxOp,
): ManifestOfflineSnapshot {
  const next = {
    ...snap,
    bundle: cloneBundle(snap.bundle),
    busManifest: snap.busManifest.map((r) => ({ ...r })),
    savedAt: new Date().toISOString(),
  };

  if (op.kind === "patch_leg") {
    next.bundle.legs = next.bundle.legs.map((l) =>
      l.id === op.legId ? applyLegPatchLocal(l, op.patch) : l,
    );
    return next;
  }

  if (op.kind === "mark_on_bus") {
    const nowIso = new Date().toISOString();
    // Toggle from the row state at enqueue time (matches markOnBus server semantics).
    const nextStatus = op.row.status === "on_bus" ? "expected" : "on_bus";
    next.busManifest = next.busManifest.map((r) => {
      if (r.id !== op.row.id) return r;
      return {
        ...r,
        status: nextStatus,
        checked_on_at: nextStatus === "on_bus" ? nowIso : null,
      };
    });
    return next;
  }

  // mark_not_travelling
  next.busManifest = next.busManifest.map((r) =>
    r.id === op.row.id
      ? { ...r, status: "not_travelling" as const, notes: op.notes }
      : r,
  );
  return next;
}

export async function saveActiveTripSnapshot(
  driverStaffId: string | null,
  bundle: ActiveTripBundle,
  busManifest: EventBusManifestRow[] = [],
): Promise<void> {
  const existing = await idbGet<ManifestOfflineSnapshot>(STORE_SNAPSHOTS, bundle.trip.id);
  const snap: ManifestOfflineSnapshot = {
    tripId: bundle.trip.id,
    driverStaffId,
    savedAt: new Date().toISOString(),
    bundle: cloneBundle(bundle),
    busManifest:
      busManifest.length > 0
        ? busManifest.map((r) => ({ ...r }))
        : (existing?.busManifest ?? []).map((r) => ({ ...r })),
  };
  await idbPut(STORE_SNAPSHOTS, snap);
  await idbPut(STORE_META, { key: CURRENT_DRIVER_META, value: driverStaffId ?? "" });
  notify();
}

export async function saveBusManifestSnapshot(
  tripId: string,
  busManifest: EventBusManifestRow[],
): Promise<void> {
  const existing = await idbGet<ManifestOfflineSnapshot>(STORE_SNAPSHOTS, tripId);
  if (!existing) return;
  await idbPut(STORE_SNAPSHOTS, {
    ...existing,
    busManifest: busManifest.map((r) => ({ ...r })),
    savedAt: new Date().toISOString(),
  });
  notify();
}

export async function loadSnapshotByTripId(
  tripId: string,
): Promise<ManifestOfflineSnapshot | null> {
  return (await idbGet<ManifestOfflineSnapshot>(STORE_SNAPSHOTS, tripId)) ?? null;
}

export async function loadSnapshotForDriver(
  driverStaffId: string | null,
): Promise<ManifestOfflineSnapshot | null> {
  if (driverStaffId) {
    const rows = await idbGetAllByIndex<ManifestOfflineSnapshot>(
      STORE_SNAPSHOTS,
      "byDriver",
      driverStaffId,
    );
    if (rows.length > 0) {
      return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
    }
  }
  const all = await idbGetAll<ManifestOfflineSnapshot>(STORE_SNAPSHOTS);
  if (all.length === 1) return all[0]!;
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
}

export async function clearSnapshotForTrip(tripId: string): Promise<void> {
  await idbDelete(STORE_SNAPSHOTS, tripId);
  const pending = await listOutboxForTrip(tripId);
  for (const item of pending) {
    await idbDelete(STORE_OUTBOX, item.id);
  }
  notify();
}

export async function listOutboxForTrip(tripId: string): Promise<ManifestOutboxItem[]> {
  const rows = await idbGetAllByIndex<ManifestOutboxItem>(STORE_OUTBOX, "byTrip", tripId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listAllOutbox(): Promise<ManifestOutboxItem[]> {
  const rows = await idbGetAll<ManifestOutboxItem>(STORE_OUTBOX);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingOutbox(tripId?: string): Promise<number> {
  const rows = tripId ? await listOutboxForTrip(tripId) : await listAllOutbox();
  return rows.filter((r) => r.status === "pending" || r.status === "failed").length;
}

async function persistOutboxItem(item: ManifestOutboxItem): Promise<void> {
  await idbPut(STORE_OUTBOX, item);
  notify();
}

async function enqueueOp(
  tripId: string,
  op: ManifestOutboxOp,
): Promise<ManifestOutboxItem> {
  const item: ManifestOutboxItem = {
    id: newId(),
    tripId,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    idempotencyKey: `${op.kind}:${newId()}`,
    op,
  };
  const snap = await loadSnapshotByTripId(tripId);
  if (snap) {
    await idbPut(STORE_SNAPSHOTS, applyOpToSnapshot(snap, op));
  }
  await persistOutboxItem(item);
  return item;
}

/**
 * Offline-aware leg patch: live write when online; else / on network fail → outbox.
 */
export async function patchTripLegOfflineAware(
  tripId: string,
  legId: string,
  patch: LegPatch,
): Promise<TripLeg> {
  if (!isAppOnline()) {
    await enqueueOp(tripId, { kind: "patch_leg", legId, patch });
    const snap = await loadSnapshotByTripId(tripId);
    const leg = snap?.bundle.legs.find((l) => l.id === legId);
    if (!leg) throw new Error("Leg not found in offline snapshot — start the run online first.");
    return leg;
  }

  try {
    const leg = await patchTripLeg(legId, patch);
    const snap = await loadSnapshotByTripId(tripId);
    if (snap) {
      const pending = await countPendingOutbox(tripId);
      if (pending === 0) {
        await idbPut(STORE_SNAPSHOTS, {
          ...snap,
          savedAt: new Date().toISOString(),
          bundle: {
            ...snap.bundle,
            legs: snap.bundle.legs.map((l) => (l.id === legId ? leg : l)),
          },
        });
        notify();
      } else {
        await idbPut(STORE_SNAPSHOTS, applyOpToSnapshot(snap, { kind: "patch_leg", legId, patch }));
        notify();
      }
    }
    return leg;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await enqueueOp(tripId, { kind: "patch_leg", legId, patch });
    const snap = await loadSnapshotByTripId(tripId);
    const leg = snap?.bundle.legs.find((l) => l.id === legId);
    if (!leg) throw err;
    return leg;
  }
}

export async function markOnBusOfflineAware(
  tripId: string,
  row: EventBusManifestRow,
): Promise<EventBusManifestRow> {
  if (!isAppOnline()) {
    await enqueueOp(tripId, { kind: "mark_on_bus", row });
    const snap = await loadSnapshotByTripId(tripId);
    const next = snap?.busManifest.find((r) => r.id === row.id);
    if (!next) throw new Error("Bus manifest not cached — open hop boarding online once first.");
    return next;
  }

  try {
    const updated = await markOnBus(row);
    const snap = await loadSnapshotByTripId(tripId);
    if (snap) {
      const pending = await countPendingOutbox(tripId);
      const busManifest =
        pending === 0
          ? snap.busManifest.map((r) => (r.id === updated.id ? updated : r))
          : applyOpToSnapshot(snap, { kind: "mark_on_bus", row }).busManifest;
      await idbPut(STORE_SNAPSHOTS, {
        ...snap,
        busManifest,
        savedAt: new Date().toISOString(),
      });
      notify();
    }
    return updated;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await enqueueOp(tripId, { kind: "mark_on_bus", row });
    const snap = await loadSnapshotByTripId(tripId);
    const next = snap?.busManifest.find((r) => r.id === row.id);
    if (!next) throw err;
    return next;
  }
}

export async function markNotTravellingOfflineAware(
  tripId: string,
  row: EventBusManifestRow,
  notes: string,
): Promise<EventBusManifestRow> {
  if (!isAppOnline()) {
    await enqueueOp(tripId, { kind: "mark_not_travelling", row, notes });
    const snap = await loadSnapshotByTripId(tripId);
    const next = snap?.busManifest.find((r) => r.id === row.id);
    if (!next) throw new Error("Bus manifest not cached — open hop boarding online once first.");
    return next;
  }

  try {
    const updated = await markNotTravelling(row, notes);
    const snap = await loadSnapshotByTripId(tripId);
    if (snap) {
      await idbPut(STORE_SNAPSHOTS, {
        ...snap,
        busManifest: snap.busManifest.map((r) => (r.id === updated.id ? updated : r)),
        savedAt: new Date().toISOString(),
      });
      notify();
    }
    return updated;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await enqueueOp(tripId, { kind: "mark_not_travelling", row, notes });
    const snap = await loadSnapshotByTripId(tripId);
    const next = snap?.busManifest.find((r) => r.id === row.id);
    if (!next) throw err;
    return next;
  }
}

async function replayItem(item: ManifestOutboxItem): Promise<void> {
  const { op } = item;
  if (op.kind === "patch_leg") {
    await patchTripLeg(op.legId, op.patch);
    return;
  }
  if (op.kind === "mark_on_bus") {
    await markOnBus(op.row);
    return;
  }
  await markNotTravelling(op.row, op.notes);
}

/** Drain outbox in creation order. Safe to call concurrently — single-flight. */
export async function flushManifestOutbox(
  tripId?: string,
): Promise<{ ok: number; failed: number }> {
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    let ok = 0;
    let failed = 0;
    const items = tripId ? await listOutboxForTrip(tripId) : await listAllOutbox();
    for (const item of items) {
      if (item.status !== "pending" && item.status !== "failed") continue;
      const next: ManifestOutboxItem = {
        ...item,
        status: "pending",
        attempts: item.attempts + 1,
      };
      await persistOutboxItem(next);
      try {
        await replayItem(next);
        await idbDelete(STORE_OUTBOX, next.id);
        ok += 1;
        notify();
      } catch (err) {
        await persistOutboxItem({
          ...next,
          status: "failed",
          lastError: err instanceof Error ? err.message : String(err),
        });
        failed += 1;
      }
    }
    return { ok, failed };
  })();

  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export async function retryManifestOutboxItem(id: string): Promise<void> {
  const item = await idbGet<ManifestOutboxItem>(STORE_OUTBOX, id);
  if (!item) return;
  await persistOutboxItem({ ...item, status: "pending", lastError: undefined });
  await flushManifestOutbox(item.tripId);
}

/**
 * Resolve active trip for UI: live when online (respect pending outbox);
 * snapshot when offline or fetch fails.
 */
export async function resolveActiveTripBundle(
  driverStaffId: string | null,
  fetchLive: () => Promise<ActiveTripBundle | null>,
): Promise<ActiveTripBundle | null> {
  if (!isAppOnline()) {
    return (await loadSnapshotForDriver(driverStaffId))?.bundle ?? null;
  }

  try {
    const live = await fetchLive();
    if (!live) {
      const snap = await loadSnapshotForDriver(driverStaffId);
      if (snap) {
        const pending = await countPendingOutbox(snap.tripId);
        if (pending === 0) await clearSnapshotForTrip(snap.tripId);
      }
      return null;
    }

    const pending = await countPendingOutbox(live.trip.id);
    if (pending === 0) {
      await saveActiveTripSnapshot(driverStaffId, live);
      return live;
    }

    const snap = await loadSnapshotByTripId(live.trip.id);
    if (snap) return snap.bundle;

    await saveActiveTripSnapshot(driverStaffId, live);
    return live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadSnapshotForDriver(driverStaffId))?.bundle ?? null;
  }
}

export async function resolveBusManifestForUi(
  tripId: string,
  fetchLive: () => Promise<EventBusManifestRow[]>,
): Promise<EventBusManifestRow[]> {
  if (!isAppOnline()) {
    return (await loadSnapshotByTripId(tripId))?.busManifest ?? [];
  }

  try {
    const live = await fetchLive();
    const pending = await countPendingOutbox(tripId);
    if (pending === 0) {
      await saveBusManifestSnapshot(tripId, live);
      return live;
    }
    const snap = await loadSnapshotByTripId(tripId);
    if (snap && snap.busManifest.length > 0) return snap.busManifest;
    await saveBusManifestSnapshot(tripId, live);
    return live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadSnapshotByTripId(tripId))?.busManifest ?? [];
  }
}

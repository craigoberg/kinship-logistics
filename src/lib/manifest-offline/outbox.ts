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
import { commitForcedHopStart } from "@/lib/api/event-hop-transport";
import type { ExpectedHopPerson } from "@/lib/api/event-hop-transport";
import { operationalNowIso } from "@/lib/operational-clock";
import { isAppOnline } from "@/lib/simulated-offline";
import { markPaperHeadcountTrip } from "./expected-hops";
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

export function isLocalHopTripId(tripId: string): boolean {
  return tripId.startsWith("local-hop:");
}

export function localHopTripId(sessionId: string, hopIndex: number): string {
  return `local-hop:${sessionId}:${hopIndex}`;
}
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
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "");
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timed out|timeout|aborted/i.test(
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

  if (op.kind === "force_start_hop") return next;

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

export async function discardManifestOutboxItem(id: string): Promise<void> {
  await idbDelete(STORE_OUTBOX, id);
  notify();
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

function blankHopLeg(opts: {
  tripId: string;
  sessionId: string;
  hopIndex: number;
  fromLabel: string;
  toLabel: string;
  toAddress: string | null;
}): TripLeg {
  return {
    id: `local-leg:${opts.sessionId}:${opts.hopIndex}`,
    tripId: opts.tripId,
    legIndex: 1,
    legKind: "venue_to_venue",
    fromLabel: opts.fromLabel,
    toLabel: opts.toLabel,
    fromParticipantId: null,
    toParticipantId: null,
    fromStaffId: null,
    toStaffId: null,
    fromCarerId: null,
    toCarerId: null,
    status: "pending",
    startLat: null,
    startLng: null,
    startAt: null,
    endLat: null,
    endLng: null,
    endAt: null,
    gpsDistanceKm: null,
    loggedDistanceKm: null,
    passengerPresent: null,
    noShowTriggeredAt: null,
    medicationExpected: false,
    medicationHandoverConfirmed: false,
    medicationHandoverStatus: "not_required",
    unexpectedMedicationLogged: false,
    unexpectedMedicationNotes: null,
    completedAt: null,
    targetAddress: opts.toAddress,
  };
}

function personRow(
  tripId: string,
  sessionId: string,
  person: ExpectedHopPerson,
  now: string,
): EventBusManifestRow {
  return {
    id: `local-row:${person.participantId ?? person.staffId ?? person.carerId ?? person.name}`,
    event_day_session_id: sessionId,
    transport_trip_id: tripId,
    participant_id: person.participantId,
    staff_id: person.staffId,
    carer_id: person.carerId,
    expected_on_bus: true,
    status: "expected",
    checked_on_at: null,
    checked_on_by: null,
    notes: null,
    created_at: now,
    updated_at: now,
    participant_name: person.name,
  };
}

/** Open a venue hop on this tablet before Release has reached the server. */
export async function beginForcedHopOffline(input: {
  eventId: string;
  sessionId: string;
  sessionDate: string;
  hopIndex: number;
  fromStopId: string;
  toStopId: string;
  fromLabel: string;
  toLabel: string;
  originAddress: string | null;
  toAddress: string | null;
  driverStaffId: string;
  startOdometerKm: number;
  assetId: string | null;
  paperRoll: boolean;
  people: ExpectedHopPerson[];
}): Promise<ActiveTripBundle> {
  const tripId = localHopTripId(input.sessionId, input.hopIndex);
  const now = operationalNowIso();
  const leg = blankHopLeg({
    tripId,
    sessionId: input.sessionId,
    hopIndex: input.hopIndex,
    fromLabel: input.fromLabel,
    toLabel: input.toLabel,
    toAddress: input.toAddress,
  });
  const bundle: ActiveTripBundle = {
    trip: {
      id: tripId,
      driverStaffId: input.driverStaffId,
      eventId: input.eventId,
      busRunCode: null,
      tripDate: input.sessionDate.slice(0, 10),
      startOdometerKm: input.startOdometerKm,
      endOdometerKm: null,
      status: "active",
      startedAt: now,
      completedAt: null,
      tripOrigin: "depot",
      tripReturn: "none",
      originAddress: input.originAddress,
      assetId: input.assetId,
      tripKind: "event_venue_hop",
      eventDaySessionId: input.sessionId,
      hopIndex: input.hopIndex,
      venueStopFromId: input.fromStopId,
      venueStopToId: input.toStopId,
    },
    legs: [leg],
    eventTitle: null,
  };
  const snap: ManifestOfflineSnapshot = {
    tripId,
    driverStaffId: input.driverStaffId,
    savedAt: now,
    bundle,
    busManifest: input.paperRoll
      ? []
      : input.people.map((person) => personRow(tripId, input.sessionId, person, now)),
    paperRoll: input.paperRoll,
    forcedBeforeRelease: true,
  };
  await idbPut(STORE_SNAPSHOTS, snap);
  await idbPut(STORE_META, { key: CURRENT_DRIVER_META, value: input.driverStaffId });
  if (input.paperRoll) markPaperHeadcountTrip(tripId);
  await enqueueOp(tripId, { kind: "force_start_hop", localTripId: tripId });
  return bundle;
}

export async function appendLocalBoarder(tripId: string, name: string): Promise<void> {
  const snap = await loadSnapshotByTripId(tripId);
  if (!snap) throw new Error("This leg is not saved on this tablet.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter the person's name.");
  const already = snap.busManifest.some(
    (row) => (row.participant_name ?? "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (already) throw new Error("That name is already on this leg.");
  const now = operationalNowIso();
  const row: EventBusManifestRow = {
    id: `local-row:x:${trimmed.toLowerCase()}`,
    event_day_session_id: snap.bundle.trip.eventDaySessionId ?? "",
    transport_trip_id: tripId,
    participant_id: null,
    staff_id: null,
    carer_id: null,
    expected_on_bus: true,
    status: "expected",
    checked_on_at: null,
    checked_on_by: null,
    notes: "Added on the bus — confirm in the office",
    created_at: now,
    updated_at: now,
    participant_name: trimmed,
  };
  await idbPut(STORE_SNAPSHOTS, {
    ...snap,
    busManifest: [...snap.busManifest, row],
    savedAt: now,
  });
  notify();
}

async function replayForcedHop(localTripId: string): Promise<void> {
  const snap = await loadSnapshotByTripId(localTripId);
  const trip = snap?.bundle.trip;
  if (!snap?.forcedBeforeRelease || !trip?.eventId || !trip.eventDaySessionId) {
    throw new Error("The offline leg is no longer on this tablet.");
  }
  if (trip.hopIndex == null || !trip.venueStopFromId || !trip.venueStopToId) {
    throw new Error("The offline leg is missing its stops.");
  }
  const bundle = await commitForcedHopStart({
    eventId: trip.eventId,
    eventDaySessionId: trip.eventDaySessionId,
    sessionDate: trip.tripDate.slice(0, 10),
    hopIndex: trip.hopIndex,
    fromStopId: trip.venueStopFromId,
    toStopId: trip.venueStopToId,
    driverStaffId: trip.driverStaffId || snap.driverStaffId || "",
    startOdometerKm: trip.startOdometerKm,
    assetId: trip.assetId,
    paperRoll: !!snap.paperRoll,
    people: snap.busManifest.map((row) => ({
      participantId: row.participant_id,
      staffId: row.staff_id ?? null,
      carerId: row.carer_id,
      name: row.participant_name?.trim() || "Person",
      status: row.status,
      notes: row.notes,
    })),
    leg: snap.bundle.legs[0] ?? null,
  });
  if (snap.paperRoll) markPaperHeadcountTrip(bundle.trip.id);
  await idbDelete(STORE_SNAPSHOTS, localTripId);
}

async function replayItem(item: ManifestOutboxItem): Promise<void> {
  const { op } = item;
  if (op.kind === "force_start_hop") {
    await replayForcedHop(op.localTripId);
    return;
  }
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
    const consumedLocal = new Set<string>();
    for (const item of items) {
      if (item.status !== "pending" && item.status !== "failed") continue;
      if (consumedLocal.has(item.tripId) && item.op.kind !== "force_start_hop") {
        await idbDelete(STORE_OUTBOX, item.id);
        continue;
      }
      const next: ManifestOutboxItem = {
        ...item,
        status: "pending",
        attempts: item.attempts + 1,
      };
      await persistOutboxItem(next);
      try {
        await replayItem(next);
        if (next.op.kind === "force_start_hop") consumedLocal.add(next.op.localTripId);
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
    const snap = await loadSnapshotForDriver(driverStaffId);
    if (snap) return snap.bundle;
    // A start can land on the server while this switch is on. Keep that run
    // on screen instead of sending the driver back to Start.
    try {
      const live = await fetchLive();
      if (!live) return null;
      await saveActiveTripSnapshot(driverStaffId, live);
      return live;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return null;
    }
  }

  try {
    const live = await fetchLive();
    if (!live) {
      const snap = await loadSnapshotForDriver(driverStaffId);
      if (snap) {
        const pending = await countPendingOutbox(snap.tripId);
        if (pending > 0) return snap.bundle;
        await clearSnapshotForTrip(snap.tripId);
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
  if (!isAppOnline() || isLocalHopTripId(tripId)) {
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

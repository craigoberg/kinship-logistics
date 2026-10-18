/**
 * Trip Deliver store-and-forward.
 * Check-in, check-out, venue open/close, and activity check-in stay on the
 * tablet when the venue has no signal, then replay in order.
 */
import type { ActivityRollRow, MovementMethod } from "@/lib/api/event-activity-roll";
import {
  closeVenueStop,
  confirmBusLeave,
  confirmNonBusLeave,
  skipVenueStop,
  undoOpenVenueStop,
  undoSkipVenueStop,
  declareProgrammeStopOpen,
  leaveVenueForNext,
  listActivityRoll,
  openVenueStop,
  toggleActivityCheckIn,
  type HopHeadcountMark,
  type LeaveVenueResult,
} from "@/lib/api/event-activity-roll";
import type { EventAttendanceRow, EventArrivalChoice, ReturnTransport } from "@/lib/api/event-attendance";
import {
  checkoutEventParticipant,
  markNotCollected,
  recordEventArrival,
  toggleEventCheckIn,
  undoCheckoutEventParticipant,
} from "@/lib/api/event-attendance";
import type { EventDaySession, EventVenueStop } from "@/lib/api/event-outing";
import type { EventAccountabilityRow } from "@/lib/api/event-day-ops";
import { eveningRollUnlockFromStops, toggleAccounted } from "@/lib/api/event-day-ops";
import type { EventSupportAttendanceRow } from "@/lib/api/event-support";
import {
  checkOutEventSupport,
  markEventSupportAbsent,
  recordEventSupportArrival,
  undoEventSupportCheckIn,
  undoEventSupportCheckOut,
} from "@/lib/api/event-support";
import { withSkippedStopNotes, withoutSkippedStopNotes } from "@/lib/api/event-outing";
import {
  applyEventLocationClose,
  closeEventLocation,
} from "@/lib/api/event-location";
import { assertDaySessionCloseable } from "@/lib/api/event-lifecycle-gates";
import { getStaffId } from "@/lib/data-store";
import { isNetworkError } from "@/lib/manifest-offline";
import { confirmLinkAfterFailure } from "@/lib/field-link";
import { operationalNowIso } from "@/lib/operational-clock";
import { isAppOnline, latchFieldLinkDown } from "@/lib/simulated-offline";
import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbGetAllByIndex,
  idbPut,
  STORE_CACHE,
  STORE_OUTBOX,
} from "./idb";

export interface DeliverSessionCache {
  key: string;
  sessionId: string;
  savedAt: string;
  attendance: EventAttendanceRow[];
  support: EventSupportAttendanceRow[];
}

export interface DeliverStopsCache {
  key: string;
  eventId: string;
  savedAt: string;
  stops: EventVenueStop[];
}

export interface DeliverDaySessionsCache {
  key: string;
  eventId: string;
  savedAt: string;
  sessions: EventDaySession[];
}

export interface DeliverActivityCache {
  key: string;
  stopId: string;
  sessionId: string;
  savedAt: string;
  rows: ActivityRollRow[];
}

export type DeliverOutboxOp =
  | {
      kind: "participant_arrival";
      sessionId: string;
      row: EventAttendanceRow;
      arrival: EventArrivalChoice;
      busRunCode?: string | null;
      notes?: string;
      alsoCheckIn?: boolean;
      occurredAt: string;
    }
  | { kind: "participant_undo_check_in"; sessionId: string; row: EventAttendanceRow }
  | {
      kind: "participant_not_collected";
      sessionId: string;
      row: EventAttendanceRow;
      place: string;
    }
  | {
      kind: "participant_checkout";
      sessionId: string;
      row: EventAttendanceRow;
      returnTransport: ReturnTransport;
      returnBusRunCode?: string | null;
      occurredAt: string;
    }
  | { kind: "participant_undo_checkout"; sessionId: string; row: EventAttendanceRow }
  | {
      kind: "support_arrival";
      sessionId: string;
      row: EventSupportAttendanceRow;
      arrivalMethod: "bus" | "private" | "other";
      arrivalBusRunCode?: string | null;
      notes?: string | null;
      occurredAt: string;
    }
  | {
      kind: "support_not_collected";
      sessionId: string;
      row: EventSupportAttendanceRow;
      place: string;
    }
  | {
      kind: "support_checkout";
      sessionId: string;
      row: EventSupportAttendanceRow;
      returnTransport?: "bus" | "self" | null;
      returnBusRunCode?: string | null;
      occurredAt: string;
    }
  | { kind: "support_undo_check_in"; sessionId: string; rowId: string }
  | { kind: "support_undo_checkout"; sessionId: string; rowId: string }
  | {
      kind: "activity_toggle";
      sessionId: string;
      stopId: string;
      row: ActivityRollRow;
      occurredAt: string;
    }
  | {
      kind: "roll_toggle";
      sessionId: string;
      table: "event_curfew_log" | "event_morning_log";
      row: EventAccountabilityRow;
      occurredAt: string;
    }
  | {
      kind: "plan_movement";
      sessionId: string;
      eventId: string;
      stopId: string;
      sessionDate: string;
      venueName: string | null;
      fromStopId: string;
      fromVenueName: string | null;
      method: MovementMethod;
      occurredAt: string;
    }
  | {
      kind: "confirm_leave";
      sessionId: string;
      eventId: string;
      sessionDate: string;
      fromStopId: string;
      fromVenueName: string | null;
      toStopId: string;
      toVenueName: string | null;
      occurredAt: string;
    }
  | {
      kind: "confirm_bus_leave";
      sessionId: string;
      eventId: string;
      sessionDate: string;
      fromStopId: string;
      fromVenueName: string | null;
      toStopId: string;
      toVenueName: string | null;
      marks: HopHeadcountMark[];
      occurredAt: string;
    }
  | {
      kind: "declare_open";
      sessionId: string;
      eventId: string;
      stopId: string;
      sessionDate: string;
      venueName: string | null;
      occurredAt: string;
    }
  | {
      kind: "open_venue";
      sessionId: string;
      eventId: string;
      stopId: string;
      sessionDate: string;
      venueName: string | null;
      movementMethod: Exclude<MovementMethod, "bus">;
      occurredAt: string;
    }
  | {
      kind: "close_venue";
      sessionId: string;
      eventId: string;
      stopId: string;
      venueName: string | null;
      sessionDate?: string;
      occurredAt: string;
    }
  | {
      kind: "skip_venue";
      sessionId: string;
      eventId: string;
      stopId: string;
      venueName: string | null;
      occurredAt: string;
    }
  | {
      kind: "undo_skip_venue";
      sessionId: string;
      eventId: string;
      stopId: string;
      venueName: string | null;
      occurredAt: string;
    }
  | {
      kind: "undo_open_venue";
      sessionId: string;
      eventId: string;
      stopId: string;
      venueName: string | null;
      occurredAt: string;
    }
  | {
      kind: "close_day";
      sessionId: string;
      eventId: string;
      sessionDate: string;
      outcome: "closed_orderly" | "closed_incident";
      notes: string | null;
      tripLeaderId: string;
      occurredAt: string;
    };

export interface DeliverOutboxItem {
  id: string;
  sessionId: string;
  createdAt: string;
  status: "pending" | "failed";
  attempts: number;
  lastError?: string;
  op: DeliverOutboxOp;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeDeliverOffline(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sessionKey(sessionId: string) {
  return `session:${sessionId}`;
}
function stopsKey(eventId: string) {
  return `stops:${eventId}`;
}
function daySessionsKey(eventId: string) {
  return `day-sessions:${eventId}`;
}
function activityKey(stopId: string) {
  return `activity:${stopId}`;
}

function newId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadSession(sessionId: string): Promise<DeliverSessionCache | null> {
  return (await idbGet<DeliverSessionCache>(STORE_CACHE, sessionKey(sessionId))) ?? null;
}

async function saveSession(cache: DeliverSessionCache): Promise<void> {
  await idbPut(STORE_CACHE, cache);
  notify();
}

export async function rememberSessionRolls(opts: {
  sessionId: string;
  attendance?: EventAttendanceRow[];
  support?: EventSupportAttendanceRow[];
}): Promise<void> {
  const existing = await loadSession(opts.sessionId);
  await saveSession({
    key: sessionKey(opts.sessionId),
    sessionId: opts.sessionId,
    savedAt: operationalNowIso(),
    attendance: opts.attendance ?? existing?.attendance ?? [],
    support: opts.support ?? existing?.support ?? [],
  });
}

export async function rememberVenueStops(eventId: string, stops: EventVenueStop[]): Promise<void> {
  await idbPut(STORE_CACHE, {
    key: stopsKey(eventId),
    eventId,
    savedAt: operationalNowIso(),
    stops,
  } satisfies DeliverStopsCache);
  notify();
}

export async function rememberActivityRoll(
  stopId: string,
  sessionId: string,
  rows: ActivityRollRow[],
): Promise<void> {
  await idbPut(STORE_CACHE, {
    key: activityKey(stopId),
    stopId,
    sessionId,
    savedAt: operationalNowIso(),
    rows,
  } satisfies DeliverActivityCache);
  notify();
}

async function loadActivity(stopId: string): Promise<DeliverActivityCache | null> {
  return (await idbGet<DeliverActivityCache>(STORE_CACHE, activityKey(stopId))) ?? null;
}

async function loadStops(eventId: string): Promise<DeliverStopsCache | null> {
  return (await idbGet<DeliverStopsCache>(STORE_CACHE, stopsKey(eventId))) ?? null;
}

async function loadDaySessions(eventId: string): Promise<DeliverDaySessionsCache | null> {
  return (await idbGet<DeliverDaySessionsCache>(STORE_CACHE, daySessionsKey(eventId))) ?? null;
}

export async function rememberEventDaySessions(
  eventId: string,
  sessions: EventDaySession[],
): Promise<void> {
  await idbPut(STORE_CACHE, {
    key: daySessionsKey(eventId),
    eventId,
    savedAt: operationalNowIso(),
    sessions,
  } satisfies DeliverDaySessionsCache);
  notify();
}

export async function discardDeliverOutboxItem(id: string): Promise<void> {
  await idbDelete(STORE_OUTBOX, id);
  notify();
}

/**
 * Drop this trip day's tablet queue and cached programme.
 * Reset Start of Day calls this so a leave that was already queued cannot
 * reopen a stop after the server rewind.
 */
export async function clearDeliverDayOnTablet(
  eventId: string,
  sessionId: string,
): Promise<void> {
  const items = await listDeliverOutbox(sessionId);
  for (const item of items) {
    await idbDelete(STORE_OUTBOX, item.id);
  }
  const stops = await loadStops(eventId);
  for (const stop of stops?.stops ?? []) {
    await idbDelete(STORE_CACHE, activityKey(stop.id));
  }
  await idbDelete(STORE_CACHE, stopsKey(eventId));
  await idbDelete(STORE_CACHE, sessionKey(sessionId));
  await idbDelete(STORE_CACHE, rollKey("event_morning_log", sessionId));
  await idbDelete(STORE_CACHE, rollKey("event_curfew_log", sessionId));
  notify();
  if (flushInFlight) await flushInFlight;
}

export async function listDeliverOutbox(sessionId?: string): Promise<DeliverOutboxItem[]> {
  const rows = sessionId
    ? await idbGetAllByIndex<DeliverOutboxItem>(STORE_OUTBOX, "bySession", sessionId)
    : await idbGetAll<DeliverOutboxItem>(STORE_OUTBOX);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countDeliverOutbox(sessionId?: string): Promise<number> {
  const rows = await listDeliverOutbox(sessionId);
  return rows.filter((row) => row.status === "pending" || row.status === "failed").length;
}

async function enqueue(sessionId: string, op: DeliverOutboxOp): Promise<void> {
  const item: DeliverOutboxItem = {
    id: newId(),
    sessionId,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    op,
  };
  await idbPut(STORE_OUTBOX, item);
  notify();
}

function requireSession(cache: DeliverSessionCache | null): DeliverSessionCache {
  if (!cache || (cache.attendance.length === 0 && cache.support.length === 0)) {
    throw new Error("Open Trip Deliver while you still have signal so this tablet has today's list.");
  }
  return cache;
}

function patchAttendance(
  cache: DeliverSessionCache,
  rowId: string,
  patch: Partial<EventAttendanceRow>,
): EventAttendanceRow {
  const current = cache.attendance.find((row) => row.id === rowId);
  if (!current) throw new Error("That person is not on the list saved on this tablet.");
  const next = { ...current, ...patch };
  cache.attendance = cache.attendance.map((row) => (row.id === rowId ? next : row));
  return next;
}

function patchSupport(
  cache: DeliverSessionCache,
  rowId: string,
  patch: Partial<EventSupportAttendanceRow>,
): EventSupportAttendanceRow {
  const current = cache.support.find((row) => row.id === rowId);
  if (!current) throw new Error("That person is not on the list saved on this tablet.");
  const next = { ...current, ...patch };
  cache.support = cache.support.map((row) => (row.id === rowId ? next : row));
  return next;
}

export async function recordEventArrivalOfflineAware(
  row: EventAttendanceRow,
  input: {
    arrival: EventArrivalChoice;
    busRunCode?: string | null;
    notes?: string;
    alsoCheckIn?: boolean;
  },
): Promise<EventAttendanceRow> {
  const run = async () => recordEventArrival(row, input);
  if (!isAppOnline()) return queueParticipantArrival(row, input);
  try {
    const saved = await run();
    const cache = await loadSession(row.eventDaySessionId);
    if (cache) {
      cache.attendance = cache.attendance.map((item) => (item.id === saved.id ? saved : item));
      await saveSession(cache);
    }
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueParticipantArrival(row, input);
  }
}

async function queueParticipantArrival(
  row: EventAttendanceRow,
  input: {
    arrival: EventArrivalChoice;
    busRunCode?: string | null;
    notes?: string;
    alsoCheckIn?: boolean;
  },
): Promise<EventAttendanceRow> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const occurredAt = operationalNowIso();
  const alsoCheckIn = input.alsoCheckIn ?? row.status === "expected";
  const isSelf = input.arrival === "self";
  const collected = /^Collected at /.test(input.notes?.trim() ?? "");
  const next = patchAttendance(cache, row.id, {
    arrivalMethod: collected ? "other" : isSelf ? "walk_in" : "bus",
    arrivalBusRunCode: isSelf ? null : (input.busRunCode ?? "").trim() || null,
    notes: input.notes?.trim() ? input.notes.trim() : row.notes,
    ...(alsoCheckIn && row.status === "expected"
      ? { status: "checked_in" as const, checkedInAt: occurredAt, checkedInBy: getStaffId() }
      : {}),
  });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "participant_arrival",
    sessionId: row.eventDaySessionId,
    row,
    arrival: input.arrival,
    busRunCode: input.busRunCode,
    notes: input.notes,
    alsoCheckIn: input.alsoCheckIn,
    occurredAt,
  });
  return next;
}

export async function markNotCollectedOfflineAware(
  row: EventAttendanceRow,
  place: string,
): Promise<void> {
  const run = () => markNotCollected(row, place);
  if (!isAppOnline()) {
    await queueNotCollected(row, place);
    return;
  }
  try {
    await run();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queueNotCollected(row, place);
  }
}

async function queueNotCollected(row: EventAttendanceRow, place: string): Promise<void> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const where = place.trim() || "the pickup";
  patchAttendance(cache, row.id, {
    status: "absent",
    notes: `Not collected — ${where}`,
  });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "participant_not_collected",
    sessionId: row.eventDaySessionId,
    row,
    place: where,
  });
}

export async function toggleEventCheckInOfflineAware(
  row: EventAttendanceRow,
): Promise<EventAttendanceRow> {
  if (!isAppOnline()) return queueUndoCheckIn(row);
  try {
    const saved = await toggleEventCheckIn(row);
    const cache = await loadSession(row.eventDaySessionId);
    if (cache) {
      cache.attendance = cache.attendance.map((item) => (item.id === saved.id ? saved : item));
      await saveSession(cache);
    }
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueUndoCheckIn(row);
  }
}

async function queueUndoCheckIn(row: EventAttendanceRow): Promise<EventAttendanceRow> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const undoing = row.status === "checked_in";
  const next = patchAttendance(cache, row.id, undoing
    ? { status: "expected", checkedInAt: null, checkedInBy: null }
    : { status: "checked_in", checkedInAt: operationalNowIso(), checkedInBy: getStaffId() });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "participant_undo_check_in",
    sessionId: row.eventDaySessionId,
    row,
  });
  return next;
}

export async function checkoutEventParticipantOfflineAware(
  row: EventAttendanceRow,
  returnTransport: ReturnTransport,
  returnBusRunCode?: string | null,
): Promise<EventAttendanceRow> {
  if (!isAppOnline()) return queueCheckout(row, returnTransport, returnBusRunCode);
  try {
    const saved = await checkoutEventParticipant(row, returnTransport, returnBusRunCode);
    const cache = await loadSession(row.eventDaySessionId);
    if (cache) {
      cache.attendance = cache.attendance.map((item) => (item.id === saved.id ? saved : item));
      await saveSession(cache);
    }
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueCheckout(row, returnTransport, returnBusRunCode);
  }
}

async function queueCheckout(
  row: EventAttendanceRow,
  returnTransport: ReturnTransport,
  returnBusRunCode?: string | null,
): Promise<EventAttendanceRow> {
  if (row.status !== "checked_in") {
    throw new Error("Participant must be checked in before departure handover.");
  }
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const occurredAt = operationalNowIso();
  const next = patchAttendance(cache, row.id, {
    status: "checked_out",
    checkedOutAt: occurredAt,
    checkedOutBy: getStaffId(),
    returnTransport,
    returnBusRunCode: returnTransport === "bus" ? returnBusRunCode ?? row.returnBusRunCode : null,
  });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "participant_checkout",
    sessionId: row.eventDaySessionId,
    row,
    returnTransport,
    returnBusRunCode,
    occurredAt,
  });
  return next;
}

export async function undoCheckoutEventParticipantOfflineAware(
  row: EventAttendanceRow,
): Promise<EventAttendanceRow> {
  if (!isAppOnline()) return queueUndoCheckout(row);
  try {
    const saved = await undoCheckoutEventParticipant(row);
    const cache = await loadSession(row.eventDaySessionId);
    if (cache) {
      cache.attendance = cache.attendance.map((item) => (item.id === saved.id ? saved : item));
      await saveSession(cache);
    }
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueUndoCheckout(row);
  }
}

async function queueUndoCheckout(row: EventAttendanceRow): Promise<EventAttendanceRow> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const next = patchAttendance(cache, row.id, {
    status: "checked_in",
    checkedOutAt: null,
    checkedOutBy: null,
    returnTransport: null,
    returnBusRunCode: null,
  });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "participant_undo_checkout",
    sessionId: row.eventDaySessionId,
    row,
  });
  return next;
}

export async function recordEventSupportArrivalOfflineAware(input: {
  row: EventSupportAttendanceRow;
  arrivalMethod: "bus" | "private" | "other";
  arrivalBusRunCode?: string | null;
  notes?: string | null;
}): Promise<EventSupportAttendanceRow> {
  const live = () =>
    recordEventSupportArrival({
      rowId: input.row.id,
      arrivalMethod: input.arrivalMethod,
      arrivalBusRunCode: input.arrivalBusRunCode,
      notes: input.notes,
    });
  if (!isAppOnline()) return queueSupportArrival(input);
  try {
    return await live();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueSupportArrival(input);
  }
}

async function queueSupportArrival(input: {
  row: EventSupportAttendanceRow;
  arrivalMethod: "bus" | "private" | "other";
  arrivalBusRunCode?: string | null;
  notes?: string | null;
}): Promise<EventSupportAttendanceRow> {
  const cache = requireSession(await loadSession(input.row.eventDaySessionId));
  const occurredAt = operationalNowIso();
  const next = patchSupport(cache, input.row.id, {
    status: "checked_in",
    arrivalMethod: input.arrivalMethod,
    arrivalBusRunCode: input.arrivalMethod === "bus" ? input.arrivalBusRunCode ?? null : null,
    checkedInAt: occurredAt,
    notes: input.notes?.trim() ? input.notes.trim() : input.row.notes,
  });
  await saveSession(cache);
  await enqueue(input.row.eventDaySessionId, {
    kind: "support_arrival",
    sessionId: input.row.eventDaySessionId,
    row: input.row,
    arrivalMethod: input.arrivalMethod,
    arrivalBusRunCode: input.arrivalBusRunCode,
    notes: input.notes,
    occurredAt,
  });
  return next;
}

export async function markSupportNotCollectedOfflineAware(
  row: EventSupportAttendanceRow,
  place: string,
): Promise<void> {
  const where = place.trim() || "the pickup";
  const run = () => markEventSupportAbsent(row.id, `Not collected — ${where}`);
  if (!isAppOnline()) {
    await queueSupportNotCollected(row, where);
    return;
  }
  try {
    await run();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queueSupportNotCollected(row, where);
  }
}

async function queueSupportNotCollected(
  row: EventSupportAttendanceRow,
  place: string,
): Promise<void> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  patchSupport(cache, row.id, {
    status: "absent",
    notes: `Not collected — ${place}`,
  });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "support_not_collected",
    sessionId: row.eventDaySessionId,
    row,
    place,
  });
}

export async function checkOutEventSupportOfflineAware(input: {
  row: EventSupportAttendanceRow;
  returnTransport?: "bus" | "self" | null;
  returnBusRunCode?: string | null;
}): Promise<EventSupportAttendanceRow> {
  const live = () =>
    checkOutEventSupport({
      rowId: input.row.id,
      returnTransport: input.returnTransport,
      returnBusRunCode: input.returnBusRunCode,
    });
  if (!isAppOnline()) return queueSupportCheckout(input);
  try {
    return await live();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueSupportCheckout(input);
  }
}

async function queueSupportCheckout(input: {
  row: EventSupportAttendanceRow;
  returnTransport?: "bus" | "self" | null;
  returnBusRunCode?: string | null;
}): Promise<EventSupportAttendanceRow> {
  const cache = requireSession(await loadSession(input.row.eventDaySessionId));
  const occurredAt = operationalNowIso();
  const next = patchSupport(cache, input.row.id, {
    status: "checked_out",
    returnTransport: input.returnTransport ?? null,
    returnBusRunCode: input.returnBusRunCode ?? null,
    checkedOutAt: occurredAt,
  });
  await saveSession(cache);
  await enqueue(input.row.eventDaySessionId, {
    kind: "support_checkout",
    sessionId: input.row.eventDaySessionId,
    row: input.row,
    returnTransport: input.returnTransport,
    returnBusRunCode: input.returnBusRunCode,
    occurredAt,
  });
  return next;
}

export async function undoEventSupportCheckInOfflineAware(
  row: EventSupportAttendanceRow,
): Promise<EventSupportAttendanceRow> {
  if (!isAppOnline()) return queueSupportUndoIn(row);
  try {
    return await undoEventSupportCheckIn(row.id);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueSupportUndoIn(row);
  }
}

async function queueSupportUndoIn(row: EventSupportAttendanceRow): Promise<EventSupportAttendanceRow> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const next = patchSupport(cache, row.id, { status: "expected", checkedInAt: null });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "support_undo_check_in",
    sessionId: row.eventDaySessionId,
    rowId: row.id,
  });
  return next;
}

export async function undoEventSupportCheckOutOfflineAware(
  row: EventSupportAttendanceRow,
): Promise<EventSupportAttendanceRow> {
  if (!isAppOnline()) return queueSupportUndoOut(row);
  try {
    return await undoEventSupportCheckOut(row.id);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueSupportUndoOut(row);
  }
}

async function queueSupportUndoOut(row: EventSupportAttendanceRow): Promise<EventSupportAttendanceRow> {
  const cache = requireSession(await loadSession(row.eventDaySessionId));
  const next = patchSupport(cache, row.id, { status: "checked_in", checkedOutAt: null });
  await saveSession(cache);
  await enqueue(row.eventDaySessionId, {
    kind: "support_undo_checkout",
    sessionId: row.eventDaySessionId,
    rowId: row.id,
  });
  return next;
}

export async function resolveEventAttendanceRoll(
  sessionId: string,
  fetchLive: () => Promise<EventAttendanceRow[]>,
): Promise<EventAttendanceRow[]> {
  if (!isAppOnline()) return (await loadSession(sessionId))?.attendance ?? [];
  try {
    const live = await fetchLive();
    const pending = await countDeliverOutbox(sessionId);
    if (pending === 0) {
      await rememberSessionRolls({ sessionId, attendance: live });
      return live;
    }
    return (await loadSession(sessionId))?.attendance ?? live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadSession(sessionId))?.attendance ?? [];
  }
}

export async function resolveEventSupportRoll(
  sessionId: string,
  fetchLive: () => Promise<EventSupportAttendanceRow[]>,
): Promise<EventSupportAttendanceRow[]> {
  if (!isAppOnline()) return (await loadSession(sessionId))?.support ?? [];
  try {
    const live = await fetchLive();
    const pending = await countDeliverOutbox(sessionId);
    if (pending === 0) {
      await rememberSessionRolls({ sessionId, support: live });
      return live;
    }
    return (await loadSession(sessionId))?.support ?? live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadSession(sessionId))?.support ?? [];
  }
}

export async function resolveVenueStops(
  eventId: string,
  fetchLive: () => Promise<EventVenueStop[]>,
): Promise<EventVenueStop[]> {
  if (!isAppOnline()) {
    const cached = (await loadStops(eventId))?.stops;
    if (cached?.length) return cached;
    throw new Error("timed out");
  }
  try {
    const live = await fetchLive();
    const pending = await countDeliverOutbox();
    if (pending === 0) {
      await rememberVenueStops(eventId, live);
      return live;
    }
    return (await loadStops(eventId))?.stops ?? live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadStops(eventId))?.stops ?? [];
  }
}

export async function resolveActivityRoll(
  stopId: string,
  sessionId: string,
  fetchLive: () => Promise<ActivityRollRow[]>,
): Promise<ActivityRollRow[]> {
  if (!isAppOnline() || stopId.startsWith("local-")) {
    return (await loadActivity(stopId))?.rows ?? [];
  }
  try {
    const live = await fetchLive();
    const pending = await countDeliverOutbox(sessionId);
    if (pending === 0) {
      await rememberActivityRoll(stopId, sessionId, live);
      return live;
    }
    return (await loadActivity(stopId))?.rows ?? live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadActivity(stopId))?.rows ?? [];
  }
}

function localActiveStop(
  stops: EventVenueStop[],
  stopId: string,
  sessionDate: string,
): EventVenueStop | undefined {
  return stops.find(
    (row) =>
      row.id !== stopId &&
      row.session_date === sessionDate &&
      (row.phase ?? "pending") === "active",
  );
}

/** Open (ready to travel) follows the tablet when a close is still waiting to upload. */
export async function declareProgrammeStopOpenOfflineAware(opts: {
  stopId: string;
  eventId: string;
  sessionDate: string;
  venueName: string | null;
  eventDaySessionId: string;
}): Promise<void> {
  const cached = await loadStops(opts.eventId);
  const busy = cached ? localActiveStop(cached.stops, opts.stopId, opts.sessionDate) : undefined;
  if (busy) {
    throw new Error(
      `Finish ${busy.label_override?.trim() || busy.venue_name?.trim() || "the current activity"} before opening the next one.`,
    );
  }
  if (!isAppOnline()) {
    await queueDeclareOpen(opts);
    return;
  }
  try {
    await declareProgrammeStopOpen(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const closedOnTablet = message.startsWith("Finish ") && !!cached && !busy;
    if (!isNetworkError(err) && !closedOnTablet) throw err;
    await queueDeclareOpen(opts);
  }
}

async function queueDeclareOpen(opts: {
  stopId: string;
  eventId: string;
  sessionDate: string;
  venueName: string | null;
  eventDaySessionId: string;
}): Promise<void> {
  const occurredAt = operationalNowIso();
  const stops = await loadStops(opts.eventId);
  if (!stops) {
    throw new Error("Open Trip Deliver while you still have signal so this tablet has today's list.");
  }
  stops.stops = stops.stops.map((row) => {
    if (row.id === opts.stopId) {
      return { ...row, opened_at: row.opened_at ?? occurredAt };
    }
    if (
      row.session_date === opts.sessionDate &&
      (row.phase ?? "pending") === "pending" &&
      row.opened_at
    ) {
      return { ...row, opened_at: null, movement_method: null };
    }
    return row;
  });
  await idbPut(STORE_CACHE, { ...stops, savedAt: occurredAt });
  await enqueue(opts.eventDaySessionId, {
    kind: "declare_open",
    sessionId: opts.eventDaySessionId,
    eventId: opts.eventId,
    stopId: opts.stopId,
    sessionDate: opts.sessionDate,
    venueName: opts.venueName,
    occurredAt,
  });
}

/** While uploads are waiting, the programme list is the tablet copy. Reopen that copy too. */
export async function reopenProgrammeStopOnTablet(
  eventId: string,
  stopId: string,
): Promise<void> {
  await patchStops(eventId, (row) =>
    row.id === stopId ? { ...row, phase: "active", closed_at: null } : row,
  );
}

async function patchStops(
  eventId: string,
  map: (row: EventVenueStop) => EventVenueStop,
): Promise<void> {
  const stops = await loadStops(eventId);
  if (!stops) {
    throw new Error("Open Trip Deliver while you still have signal so this tablet has today's list.");
  }
  const occurredAt = operationalNowIso();
  stops.stops = stops.stops.map(map);
  await idbPut(STORE_CACHE, { ...stops, savedAt: occurredAt });
}

function rollKey(table: string, sessionId: string) {
  return `roll:${table}:${sessionId}`;
}

interface DeliverRollCache {
  key: string;
  sessionId: string;
  table: string;
  savedAt: string;
  rows: EventAccountabilityRow[];
}

async function loadRoll(table: string, sessionId: string): Promise<DeliverRollCache | null> {
  return (await idbGet<DeliverRollCache>(STORE_CACHE, rollKey(table, sessionId))) ?? null;
}

async function rememberRoll(
  table: string,
  sessionId: string,
  rows: EventAccountabilityRow[],
): Promise<void> {
  await idbPut(STORE_CACHE, {
    key: rollKey(table, sessionId),
    sessionId,
    table,
    savedAt: operationalNowIso(),
    rows,
  } satisfies DeliverRollCache);
  notify();
}

/** Tablet stop phases win over the server while a close is still waiting to upload. */
export async function cachedEveningRollGate(
  eventId: string,
  sessionDate: string,
): Promise<{ unlocked: boolean; reason?: string } | null> {
  const cached = await loadStops(eventId);
  if (!cached) return null;
  if (cached.stops.length === 0) return null;
  return eveningRollUnlockFromStops(cached.stops, sessionDate);
}

export async function resolveAccountabilityRoll(
  table: "event_curfew_log" | "event_morning_log",
  sessionId: string,
  fetchLive: () => Promise<EventAccountabilityRow[]>,
): Promise<EventAccountabilityRow[]> {
  const pending = async () => {
    const rows = await listDeliverOutbox(sessionId);
    return rows.some((item) => item.op.kind === "roll_toggle" && item.op.table === table);
  };
  if (!isAppOnline()) {
    const cached = await loadRoll(table, sessionId);
    if (cached) return cached.rows;
    try {
      const live = await fetchLive();
      await rememberRoll(table, sessionId, live);
      return live;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      return [];
    }
  }
  try {
    const live = await fetchLive();
    if (await pending()) return (await loadRoll(table, sessionId))?.rows ?? live;
    await rememberRoll(table, sessionId, live);
    return live;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return (await loadRoll(table, sessionId))?.rows ?? [];
  }
}

export async function toggleAccountedOfflineAware(opts: {
  table: "event_curfew_log" | "event_morning_log";
  row: EventAccountabilityRow;
  eventId: string;
  sessionDate: string;
}): Promise<EventAccountabilityRow> {
  const queue = async () => {
    const occurredAt = operationalNowIso();
    const marking = opts.row.status !== "accounted";
    const next: EventAccountabilityRow = {
      ...opts.row,
      status: marking ? "accounted" : "expected",
      accounted_at: marking ? occurredAt : null,
      accounted_by: marking ? getStaffId() : null,
    };
    const cached = await loadRoll(opts.table, opts.row.event_day_session_id);
    const rows = cached?.rows ?? [];
    const exists = rows.some((item) => item.id === opts.row.id);
    await rememberRoll(
      opts.table,
      opts.row.event_day_session_id,
      exists ? rows.map((item) => (item.id === opts.row.id ? next : item)) : [...rows, next],
    );
    await enqueue(opts.row.event_day_session_id, {
      kind: "roll_toggle",
      sessionId: opts.row.event_day_session_id,
      table: opts.table,
      row: opts.row,
      occurredAt,
    });
    return next;
  };
  if (!isAppOnline()) return queue();
  try {
    const saved = await toggleAccounted(opts.table, opts.row, "");
    const cached = await loadRoll(opts.table, opts.row.event_day_session_id);
    if (cached) {
      await rememberRoll(
        opts.table,
        opts.row.event_day_session_id,
        cached.rows.map((item) => (item.id === opts.row.id ? saved : item)),
      );
    }
    return saved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cachedGate = await cachedEveningRollGate(opts.eventId, opts.sessionDate);
    const staleGate =
      !!cachedGate?.unlocked &&
      (message.startsWith("Finish today's programme") ||
        message.startsWith("Return to the overnight venue"));
    if (!isNetworkError(err) && !staleGate) throw err;
    return queue();
  }
}

export async function leaveVenueForNextOfflineAware(opts: {
  fromStop: { id: string; eventId: string; sessionDate: string; venueName: string | null };
  toStop: { id: string; eventId: string; sessionDate: string; venueName: string | null };
  method: MovementMethod;
  eventDaySessionId: string;
}): Promise<LeaveVenueResult> {
  const remember = () =>
    patchStops(opts.toStop.eventId, (row) =>
      row.id === opts.toStop.id ? { ...row, movement_method: opts.method } : row,
    );
  const queue = async () => {
    await remember();
    await enqueue(opts.eventDaySessionId, {
      kind: "plan_movement",
      sessionId: opts.eventDaySessionId,
      eventId: opts.toStop.eventId,
      stopId: opts.toStop.id,
      sessionDate: opts.toStop.sessionDate,
      venueName: opts.toStop.venueName,
      fromStopId: opts.fromStop.id,
      fromVenueName: opts.fromStop.venueName,
      method: opts.method,
      occurredAt: operationalNowIso(),
    });
  };
  if (!isAppOnline()) {
    await queue();
    return { mode: "planned", method: opts.method };
  }
  try {
    const result = await leaveVenueForNext(opts);
    await remember();
    return result;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queue();
    return { mode: "planned", method: opts.method };
  }
}

export async function confirmNonBusLeaveOfflineAware(opts: {
  fromStop: { id: string; eventId: string; sessionDate: string; venueName: string | null };
  toStop: { id: string; eventId: string; sessionDate: string; venueName: string | null };
  eventDaySessionId: string;
}): Promise<{ openedStopId: string }> {
  const remember = async () => {
    const occurredAt = operationalNowIso();
    await patchStops(opts.toStop.eventId, (row) => {
      if (row.id === opts.toStop.id) {
        return {
          ...row,
          phase: "active",
          opened_at: row.opened_at ?? occurredAt,
        };
      }
      if (row.id === opts.fromStop.id) {
        return { ...row, phase: "completed", closed_at: occurredAt };
      }
      return row;
    });
    const session = await loadSession(opts.eventDaySessionId);
    const rows: ActivityRollRow[] = (session?.attendance ?? [])
      .filter((person) => person.status === "checked_in")
      .map((person) => ({
        id: `local-activity:${opts.toStop.id}:${person.participantId}`,
        venueStopId: opts.toStop.id,
        eventDaySessionId: opts.eventDaySessionId,
        participantId: person.participantId,
        status: "expected" as const,
        checkedInAt: null,
        checkedInById: null,
        markedAbsentAt: null,
        markedAbsentById: null,
        notes: null,
      }));
    if (rows.length > 0) await rememberActivityRoll(opts.toStop.id, opts.eventDaySessionId, rows);
  };
  const queue = async () => {
    await remember();
    await enqueue(opts.eventDaySessionId, {
      kind: "confirm_leave",
      sessionId: opts.eventDaySessionId,
      eventId: opts.toStop.eventId,
      sessionDate: opts.toStop.sessionDate,
      fromStopId: opts.fromStop.id,
      fromVenueName: opts.fromStop.venueName,
      toStopId: opts.toStop.id,
      toVenueName: opts.toStop.venueName,
      occurredAt: operationalNowIso(),
    });
  };
  if (!isAppOnline()) {
    await queue();
    return { openedStopId: opts.toStop.id };
  }
  try {
    const result = await confirmNonBusLeave(opts);
    await remember();
    return result;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queue();
    return { openedStopId: opts.toStop.id };
  }
}

export async function confirmBusLeaveOfflineAware(opts: {
  fromStop: { id: string; eventId: string; sessionDate: string; venueName: string | null };
  toStop: { id: string; eventId: string; sessionDate: string; venueName: string | null };
  eventDaySessionId: string;
  marks: HopHeadcountMark[];
}): Promise<{ openedStopId: string }> {
  const remember = async () => {
    const occurredAt = operationalNowIso();
    await patchStops(opts.toStop.eventId, (row) => {
      if (row.id === opts.toStop.id) {
        return {
          ...row,
          phase: "active",
          movement_method: "bus",
          opened_at: row.opened_at ?? occurredAt,
        };
      }
      if (row.id === opts.fromStop.id) {
        return { ...row, phase: "completed", closed_at: occurredAt };
      }
      return row;
    });
  };
  const queue = async () => {
    await remember();
    await enqueue(opts.eventDaySessionId, {
      kind: "confirm_bus_leave",
      sessionId: opts.eventDaySessionId,
      eventId: opts.toStop.eventId,
      sessionDate: opts.toStop.sessionDate,
      fromStopId: opts.fromStop.id,
      fromVenueName: opts.fromStop.venueName,
      toStopId: opts.toStop.id,
      toVenueName: opts.toStop.venueName,
      marks: opts.marks,
      occurredAt: operationalNowIso(),
    });
  };
  if (!isAppOnline()) {
    await queue();
    return { openedStopId: opts.toStop.id };
  }
  try {
    const result = await confirmBusLeave(opts);
    await remember();
    return result;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queue();
    return { openedStopId: opts.toStop.id };
  }
}

export async function openVenueStopOfflineAware(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
    movementMethod: Exclude<MovementMethod, "bus">;
  },
  eventDaySessionId: string,
): Promise<void> {
  if (!isAppOnline()) {
    await queueOpenVenue(stop, eventDaySessionId);
    return;
  }
  try {
    await openVenueStop(stop, eventDaySessionId);
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queueOpenVenue(stop, eventDaySessionId);
  }
}

async function queueOpenVenue(
  stop: {
    id: string;
    eventId: string;
    sessionDate: string;
    venueName: string | null;
    movementMethod: Exclude<MovementMethod, "bus">;
  },
  sessionId: string,
): Promise<void> {
  const occurredAt = operationalNowIso();
  const stops = await loadStops(stop.eventId);
  if (stops) {
    stops.stops = stops.stops.map((row) =>
      row.id === stop.id
        ? {
            ...row,
            phase: "active",
            movement_method: stop.movementMethod,
            opened_at: row.opened_at ?? occurredAt,
          }
        : row,
    );
    await idbPut(STORE_CACHE, { ...stops, savedAt: occurredAt });
  }
  const session = await loadSession(sessionId);
  const rows: ActivityRollRow[] = (session?.attendance ?? [])
    .filter((person) => person.status === "checked_in")
    .map((person) => ({
      id: `local-activity:${stop.id}:${person.participantId}`,
      venueStopId: stop.id,
      eventDaySessionId: sessionId,
      participantId: person.participantId,
      status: "expected" as const,
      checkedInAt: null,
      checkedInById: null,
      markedAbsentAt: null,
      markedAbsentById: null,
      notes: null,
    }));
  await rememberActivityRoll(stop.id, sessionId, rows);
  await enqueue(sessionId, {
    kind: "open_venue",
    sessionId,
    eventId: stop.eventId,
    stopId: stop.id,
    sessionDate: stop.sessionDate,
    venueName: stop.venueName,
    movementMethod: stop.movementMethod,
    occurredAt,
  });
}

export function withFieldTimeout<T>(work: Promise<T>, ms = 4_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function closeVenueStopOfflineAware(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
  sessionDate?: string;
  sessionId: string;
}): Promise<void> {
  if (!isAppOnline()) {
    await queueCloseVenue(stop);
    return;
  }
  try {
    // A dropped link often stays "online" and the close request never answers.
    await withFieldTimeout(closeVenueStop(stop));
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    latchFieldLinkDown();
    confirmLinkAfterFailure();
    await queueCloseVenue(stop);
  }
}

async function queueCloseVenue(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
  sessionDate?: string;
  sessionId: string;
}): Promise<void> {
  const occurredAt = operationalNowIso();
  const stops = await loadStops(stop.eventId);
  if (stops) {
    stops.stops = stops.stops.map((row) =>
      row.id === stop.id ? { ...row, phase: "completed", closed_at: occurredAt } : row,
    );
    await idbPut(STORE_CACHE, { ...stops, savedAt: occurredAt });
    notify();
  }
  await enqueue(stop.sessionId, {
    kind: "close_venue",
    sessionId: stop.sessionId,
    eventId: stop.eventId,
    stopId: stop.id,
    venueName: stop.venueName,
    sessionDate: stop.sessionDate,
    occurredAt,
  });
}

async function overlayQueuedDayCloses(
  eventId: string,
  sessions: EventDaySession[],
): Promise<EventDaySession[]> {
  const queued = await listDeliverOutbox();
  const closes = queued.filter(
    (item) => item.op.kind === "close_day" && item.op.eventId === eventId,
  );
  if (!closes.length) return sessions;
  return sessions.map((row) => {
    const hit = closes.find((item) => item.op.kind === "close_day" && item.op.sessionId === row.id);
    if (!hit || hit.op.kind !== "close_day") return row;
    return {
      ...row,
      phase: hit.op.outcome,
      close_declared_at: hit.op.occurredAt,
      closed_by_id: hit.op.tripLeaderId,
      close_leader_notes: hit.op.notes,
    };
  });
}

export async function resolveEventDaySessions(
  eventId: string,
  fetchLive: () => Promise<EventDaySession[]>,
): Promise<EventDaySession[]> {
  const cached = await loadDaySessions(eventId);
  if (!isAppOnline()) {
    if (cached?.sessions.length) return overlayQueuedDayCloses(eventId, cached.sessions);
    throw new Error("timed out");
  }
  try {
    const live = await withFieldTimeout(fetchLive());
    const merged = await overlayQueuedDayCloses(eventId, live);
    await rememberEventDaySessions(eventId, merged);
    return merged;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    latchFieldLinkDown();
    confirmLinkAfterFailure();
    if (cached?.sessions.length) return overlayQueuedDayCloses(eventId, cached.sessions);
    throw err;
  }
}

async function queueCloseDay(input: {
  session: EventDaySession;
  outcome: "closed_orderly" | "closed_incident";
  notes?: string;
}): Promise<void> {
  const occurredAt = operationalNowIso();
  const tripLeaderId = input.session.manager_staff_id ?? "";
  const cached = await loadDaySessions(input.session.event_id);
  const closed: EventDaySession = {
    ...input.session,
    phase: input.outcome,
    close_declared_at: occurredAt,
    closed_by_id: tripLeaderId || input.session.closed_by_id,
    close_leader_notes: input.notes?.trim() || null,
  };
  if (cached?.sessions.length) {
    await rememberEventDaySessions(
      input.session.event_id,
      cached.sessions.map((row) => (row.id === closed.id ? closed : row)),
    );
  }
  await enqueue(input.session.id, {
    kind: "close_day",
    sessionId: input.session.id,
    eventId: input.session.event_id,
    sessionDate: input.session.session_date,
    outcome: input.outcome,
    notes: input.notes?.trim() || null,
    tripLeaderId,
    occurredAt,
  });
}

/** Close day / Close trip. A dead link saves the close on this tablet. */
export async function closeEventLocationOfflineAware(input: {
  session: EventDaySession;
  managerPin: string;
  outcome: "closed_orderly" | "closed_incident";
  notes?: string;
}): Promise<void> {
  if (!isAppOnline()) {
    await queueCloseDay(input);
    return;
  }
  try {
    await withFieldTimeout(
      closeEventLocation({
        sessionId: input.session.id,
        managerPin: input.managerPin,
        outcome: input.outcome,
        notes: input.notes,
      }),
    );
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    latchFieldLinkDown();
    confirmLinkAfterFailure();
    await queueCloseDay(input);
  }
}

export async function skipVenueStopOfflineAware(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
  sessionId: string;
}): Promise<void> {
  const remember = async () => {
    const occurredAt = operationalNowIso();
    await patchStops(stop.eventId, (row) =>
      row.id === stop.id
        ? {
            ...row,
            phase: "completed",
            closed_at: occurredAt,
            notes: withSkippedStopNotes(row.notes),
          }
        : row,
    );
  };
  const queue = async () => {
    await remember();
    await enqueue(stop.sessionId, {
      kind: "skip_venue",
      sessionId: stop.sessionId,
      eventId: stop.eventId,
      stopId: stop.id,
      venueName: stop.venueName,
      occurredAt: operationalNowIso(),
    });
  };
  if (!isAppOnline()) {
    await queue();
    return;
  }
  try {
    await skipVenueStop(stop);
    await remember();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queue();
  }
}

export async function undoSkipVenueStopOfflineAware(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
  sessionId: string;
}): Promise<void> {
  const remember = async () => {
    await patchStops(stop.eventId, (row) =>
      row.id === stop.id
        ? {
            ...row,
            phase: "pending",
            closed_at: null,
            opened_at: null,
            movement_method: null,
            notes: withoutSkippedStopNotes(row.notes),
          }
        : row,
    );
  };
  const queue = async () => {
    await remember();
    await enqueue(stop.sessionId, {
      kind: "undo_skip_venue",
      sessionId: stop.sessionId,
      eventId: stop.eventId,
      stopId: stop.id,
      venueName: stop.venueName,
      occurredAt: operationalNowIso(),
    });
  };
  if (!isAppOnline()) {
    await queue();
    return;
  }
  try {
    await undoSkipVenueStop(stop);
    await remember();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await queue();
  }
}

/** Active or Done goes back to waiting, on this tablet first. */
export async function undoOpenVenueStopOfflineAware(stop: {
  id: string;
  eventId: string;
  venueName: string | null;
  sessionId: string;
}): Promise<void> {
  const remember = async () => {
    await patchStops(stop.eventId, (row) =>
      row.id === stop.id
        ? {
            ...row,
            phase: "pending",
            opened_at: null,
            closed_at: null,
            movement_method: null,
          }
        : row,
    );
    await rememberActivityRoll(stop.id, stop.sessionId, []);
  };
  const queue = async () => {
    await remember();
    await enqueue(stop.sessionId, {
      kind: "undo_open_venue",
      sessionId: stop.sessionId,
      eventId: stop.eventId,
      stopId: stop.id,
      venueName: stop.venueName,
      occurredAt: operationalNowIso(),
    });
  };
  if (!isAppOnline()) {
    await queue();
    return;
  }
  try {
    await withFieldTimeout(undoOpenVenueStop(stop));
    await remember();
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    latchFieldLinkDown();
    confirmLinkAfterFailure();
    await queue();
  }
}

export async function toggleActivityCheckInOfflineAware(
  row: ActivityRollRow,
): Promise<ActivityRollRow> {
  if (!isAppOnline() || row.id.startsWith("local-activity:")) return queueActivityToggle(row);
  try {
    const saved = await toggleActivityCheckIn(row);
    const cache = await loadActivity(row.venueStopId);
    if (cache) {
      cache.rows = cache.rows.map((item) => (item.id === saved.id ? saved : item));
      await rememberActivityRoll(row.venueStopId, row.eventDaySessionId, cache.rows);
    }
    return saved;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return queueActivityToggle(row);
  }
}

async function queueActivityToggle(row: ActivityRollRow): Promise<ActivityRollRow> {
  const cache = await loadActivity(row.venueStopId);
  if (!cache) throw new Error("Open this activity while you still have signal, or start it offline first.");
  const occurredAt = operationalNowIso();
  const isIn = row.status === "checked_in";
  const next: ActivityRollRow = {
    ...row,
    status: isIn ? "expected" : "checked_in",
    checkedInAt: isIn ? null : occurredAt,
    checkedInById: isIn ? null : getStaffId(),
  };
  cache.rows = cache.rows.map((item) => (item.id === row.id ? next : item));
  await rememberActivityRoll(row.venueStopId, row.eventDaySessionId, cache.rows);
  await enqueue(row.eventDaySessionId, {
    kind: "activity_toggle",
    sessionId: row.eventDaySessionId,
    stopId: row.venueStopId,
    row,
    occurredAt,
  });
  return next;
}

/** Tablet check-ins that have not reached the server yet. Send them before a leave. */
async function uploadCachedActivityCheckIns(
  stopId: string,
  sessionId: string,
  occurredAt: string,
): Promise<void> {
  const local = await loadActivity(stopId);
  if (!local?.rows.length) return;
  const live = await listActivityRoll(stopId, { eventDaySessionId: sessionId });
  for (const row of local.rows) {
    if (row.status !== "checked_in") continue;
    const match = live.find(
      (item) => item.participantId === row.participantId && item.status === "expected",
    );
    if (match) await toggleActivityCheckIn(match, row.checkedInAt ?? occurredAt);
  }
}

async function replay(item: DeliverOutboxItem): Promise<void> {
  const op = item.op;
  if (op.kind === "participant_arrival") {
    await recordEventArrival(op.row, {
      arrival: op.arrival,
      busRunCode: op.busRunCode,
      notes: op.notes,
      alsoCheckIn: op.alsoCheckIn,
      occurredAt: op.occurredAt,
    });
    return;
  }
  if (op.kind === "participant_not_collected") {
    await markNotCollected(op.row, op.place);
    return;
  }
  if (op.kind === "participant_undo_check_in") {
    await toggleEventCheckIn(op.row);
    return;
  }
  if (op.kind === "participant_checkout") {
    await checkoutEventParticipant(op.row, op.returnTransport, op.returnBusRunCode, op.occurredAt);
    return;
  }
  if (op.kind === "participant_undo_checkout") {
    await undoCheckoutEventParticipant(op.row);
    return;
  }
  if (op.kind === "support_arrival") {
    await recordEventSupportArrival({
      rowId: op.row.id,
      arrivalMethod: op.arrivalMethod,
      arrivalBusRunCode: op.arrivalBusRunCode,
      notes: op.notes,
      occurredAt: op.occurredAt,
    });
    return;
  }
  if (op.kind === "support_not_collected") {
    await markEventSupportAbsent(op.row.id, `Not collected — ${op.place}`);
    return;
  }
  if (op.kind === "support_checkout") {
    await checkOutEventSupport({
      rowId: op.row.id,
      returnTransport: op.returnTransport,
      returnBusRunCode: op.returnBusRunCode,
      occurredAt: op.occurredAt,
    });
    return;
  }
  if (op.kind === "support_undo_check_in") {
    await undoEventSupportCheckIn(op.rowId);
    return;
  }
  if (op.kind === "support_undo_checkout") {
    await undoEventSupportCheckOut(op.rowId);
    return;
  }
  if (op.kind === "activity_toggle") {
    if (op.row.id.startsWith("local-activity:")) return;
    await toggleActivityCheckIn(op.row, op.occurredAt);
    return;
  }
  if (op.kind === "roll_toggle") {
    await toggleAccounted(op.table, op.row, "");
    return;
  }
  if (op.kind === "plan_movement") {
    await uploadCachedActivityCheckIns(op.fromStopId, op.sessionId, op.occurredAt);
    await leaveVenueForNext({
      fromStop: {
        id: op.fromStopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.fromVenueName,
      },
      toStop: {
        id: op.stopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.venueName,
      },
      method: op.method,
      eventDaySessionId: op.sessionId,
    });
    return;
  }
  if (op.kind === "confirm_bus_leave") {
    await confirmBusLeave({
      fromStop: {
        id: op.fromStopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.fromVenueName,
      },
      toStop: {
        id: op.toStopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.toVenueName,
      },
      eventDaySessionId: op.sessionId,
      marks: op.marks,
    });
    return;
  }
  if (op.kind === "confirm_leave") {
    await uploadCachedActivityCheckIns(op.fromStopId, op.sessionId, op.occurredAt);
    await confirmNonBusLeave({
      fromStop: {
        id: op.fromStopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.fromVenueName,
      },
      toStop: {
        id: op.toStopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.toVenueName,
      },
      eventDaySessionId: op.sessionId,
    });
    return;
  }
  if (op.kind === "declare_open") {
    await declareProgrammeStopOpen({
      stopId: op.stopId,
      eventId: op.eventId,
      sessionDate: op.sessionDate,
      venueName: op.venueName,
      eventDaySessionId: op.sessionId,
      occurredAt: op.occurredAt,
    });
    return;
  }
  if (op.kind === "open_venue") {
    await openVenueStop(
      {
        id: op.stopId,
        eventId: op.eventId,
        sessionDate: op.sessionDate,
        venueName: op.venueName,
        movementMethod: op.movementMethod,
      },
      op.sessionId,
    );
    const local = await loadActivity(op.stopId);
    const live = await listActivityRoll(op.stopId, { eventDaySessionId: op.sessionId });
    for (const row of local?.rows ?? []) {
      if (row.status !== "checked_in") continue;
      const match = live.find(
        (item) => item.participantId === row.participantId && item.status === "expected",
      );
      if (match) await toggleActivityCheckIn(match, row.checkedInAt ?? op.occurredAt);
    }
    return;
  }
  if (op.kind === "skip_venue") {
    await skipVenueStop({
      id: op.stopId,
      eventId: op.eventId,
      venueName: op.venueName,
    });
    return;
  }
  if (op.kind === "undo_skip_venue") {
    await undoSkipVenueStop({
      id: op.stopId,
      eventId: op.eventId,
      venueName: op.venueName,
    });
    return;
  }
  if (op.kind === "undo_open_venue") {
    await undoOpenVenueStop({
      id: op.stopId,
      eventId: op.eventId,
      venueName: op.venueName,
    });
    const empty = await loadActivity(op.stopId);
    if (empty) await rememberActivityRoll(op.stopId, op.sessionId, []);
    return;
  }
  if (op.kind === "close_day") {
    await assertDaySessionCloseable({
      eventId: op.eventId,
      sessionId: op.sessionId,
      sessionDate: op.sessionDate,
    });
    await applyEventLocationClose({
      sessionId: op.sessionId,
      eventId: op.eventId,
      outcome: op.outcome,
      notes: op.notes ?? undefined,
      tripLeaderId: op.tripLeaderId,
      occurredAt: op.occurredAt,
    });
    return;
  }
  await uploadCachedActivityCheckIns(op.stopId, op.sessionId, op.occurredAt);
  await closeVenueStop({
    id: op.stopId,
    eventId: op.eventId,
    venueName: op.venueName,
    sessionDate: op.sessionDate,
  });
}

function outboxErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = String((err as { message: unknown }).message ?? "");
    if (message) return message;
  }
  return "Sync failed";
}

/** The server already has this tap. Drop it and keep going. */
function isAlreadyApplied(message: string): boolean {
  return /already underway or finished|already open or completed|movement is already underway or this stop is open|already closed/i.test(
    message,
  );
}

let flushInFlight: Promise<{ ok: number; failed: number; error?: string }> | null = null;

export async function flushDeliverOutbox(
  sessionId?: string,
): Promise<{ ok: number; failed: number; error?: string }> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    let ok = 0;
    let failed = 0;
    let error: string | undefined;
    let blocked = false;
    const items = await listDeliverOutbox(sessionId);
    const skip = new Set<string>();
    for (const item of items) {
      if (item.status !== "pending" && item.status !== "failed") continue;
      if (skip.has(item.id)) {
        await idbDelete(STORE_OUTBOX, item.id);
        continue;
      }
      const stillQueued = await idbGet<DeliverOutboxItem>(STORE_OUTBOX, item.id);
      if (!stillQueued) continue;
      if (blocked) {
        if (item.status === "failed") {
          await idbPut(STORE_OUTBOX, { ...item, status: "pending", lastError: undefined });
        }
        continue;
      }
      const next = { ...item, status: "pending" as const, attempts: item.attempts + 1 };
      await idbPut(STORE_OUTBOX, next);
      try {
        await replay(next);
        if (next.op.kind === "open_venue") {
          for (const other of items) {
            if (
              other.op.kind === "activity_toggle" &&
              other.op.stopId === next.op.stopId &&
              other.op.row.id.startsWith("local-activity:")
            ) {
              skip.add(other.id);
            }
          }
        }
        await idbDelete(STORE_OUTBOX, next.id);
        ok += 1;
        notify();
      } catch (err) {
        const message = outboxErrorMessage(err);
        if (isAlreadyApplied(message)) {
          await idbDelete(STORE_OUTBOX, next.id);
          ok += 1;
          notify();
          continue;
        }
        if (isNetworkError(err)) {
          await idbPut(STORE_OUTBOX, { ...next, status: "pending", lastError: undefined });
          blocked = true;
          error = "The link dropped before this tap uploaded.";
          notify();
          continue;
        }
        await idbPut(STORE_OUTBOX, {
          ...next,
          status: "failed",
          lastError: message,
        });
        failed += 1;
        error = message;
        blocked = true;
        notify();
      }
    }
    return { ok, failed, error };
  })();
  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

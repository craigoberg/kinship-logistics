import { listMovingParty, type MovingPerson } from "@/lib/api/event-activity-roll";
import { operationalNowIso } from "@/lib/operational-clock";
import { isAppOnline } from "@/lib/simulated-offline";
import { idbDelete, idbGet, idbPut, STORE_CACHE } from "./idb";

export type HopMark = "on_bus" | "not_travelling";

interface HopHeadcountCache {
  key: string;
  sessionId: string;
  marks: Record<string, HopMark>;
  savedAt: string;
}

export function hopHeadcountKey(fromStopId: string, toStopId: string): string {
  return `hop-headcount:${fromStopId}:${toStopId}`;
}

export async function loadHopHeadcount(
  fromStopId: string,
  toStopId: string,
): Promise<Record<string, HopMark>> {
  const row = await idbGet<HopHeadcountCache>(STORE_CACHE, hopHeadcountKey(fromStopId, toStopId));
  return row?.marks ?? {};
}

export async function saveHopHeadcount(opts: {
  sessionId: string;
  fromStopId: string;
  toStopId: string;
  marks: Record<string, HopMark>;
}): Promise<void> {
  const value: HopHeadcountCache = {
    key: hopHeadcountKey(opts.fromStopId, opts.toStopId),
    sessionId: opts.sessionId,
    marks: opts.marks,
    savedAt: operationalNowIso(),
  };
  await idbPut(STORE_CACHE, value);
}

function partyKey(sessionId: string) {
  return `moving-party:${sessionId}`;
}

export async function loadMovingPartyCache(sessionId: string): Promise<MovingPerson[] | null> {
  const row = await idbGet<{ key: string; people: MovingPerson[] }>(STORE_CACHE, partyKey(sessionId));
  return row?.people ?? null;
}

export async function saveMovingPartyCache(sessionId: string, people: MovingPerson[]): Promise<void> {
  await idbPut(STORE_CACHE, { key: partyKey(sessionId), people, savedAt: operationalNowIso() });
}

/** Save who can move with the group while the link is up, so a later offline leave still lists them. */
export async function cacheMovingParty(eventId: string, sessionId: string): Promise<void> {
  if (!isAppOnline()) return;
  const people = await listMovingParty(eventId, sessionId);
  if (people.length > 0) await saveMovingPartyCache(sessionId, people);
}

export async function clearHopHeadcount(fromStopId: string, toStopId: string): Promise<void> {
  await idbDelete(STORE_CACHE, hopHeadcountKey(fromStopId, toStopId));
}

import { operationalNowIso } from "@/lib/operational-clock";
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

export async function clearHopHeadcount(fromStopId: string, toStopId: string): Promise<void> {
  await idbDelete(STORE_CACHE, hopHeadcountKey(fromStopId, toStopId));
}

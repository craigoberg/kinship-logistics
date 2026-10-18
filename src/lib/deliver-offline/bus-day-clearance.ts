/**
 * First bus of a trip day — who is driving, remembered on this tablet.
 * Later bus legs the same day only confirm. A new day asks again.
 */
import { operationalNowIso } from "@/lib/operational-clock";
import { idbGet, idbPut, STORE_CACHE } from "./idb";

type BusDayBase = {
  key: string;
  eventId: string;
  sessionDate: string;
  savedAt: string;
  /** Ledger still to upload. The tablet copy is enough to keep moving. */
  ledgerPending: boolean;
  summary: string;
};

export type BusDayClearance =
  | (BusDayBase & {
      kind: "own_bus";
      assetId: string;
      assetName: string;
      rego: string;
      source: "leader_walkaround" | "already_cleared" | "driver_seen" | "offline_go";
    })
  | (BusDayBase & {
      kind: "hired";
      driverName: string;
      company: string;
      rego: string;
    });

export type BusDayDraft =
  | Omit<Extract<BusDayClearance, { kind: "own_bus" }>, "key" | "savedAt" | "summary" | "ledgerPending">
  | Omit<Extract<BusDayClearance, { kind: "hired" }>, "key" | "savedAt" | "summary" | "ledgerPending">;

export function busDayClearanceKey(eventId: string, sessionDate: string): string {
  return `bus-day:${eventId}:${sessionDate.slice(0, 10)}`;
}

export async function loadBusDayClearance(
  eventId: string,
  sessionDate: string,
): Promise<BusDayClearance | null> {
  return (await idbGet<BusDayClearance>(STORE_CACHE, busDayClearanceKey(eventId, sessionDate))) ?? null;
}

export async function saveBusDayClearance(
  row: BusDayDraft & { summary: string; ledgerPending: boolean; savedAt?: string },
): Promise<BusDayClearance> {
  const value = {
    ...row,
    key: busDayClearanceKey(row.eventId, row.sessionDate),
    savedAt: row.savedAt ?? operationalNowIso(),
  } as BusDayClearance;
  await idbPut(STORE_CACHE, value);
  return value;
}

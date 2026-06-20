import { supabase } from "@/integrations/supabase/client";
import {
  listStaffRegistry,
  resolveStaffIdWithFallback,
  updateStaffMember,
  type StaffCertification,
} from "@/lib/data-store";

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

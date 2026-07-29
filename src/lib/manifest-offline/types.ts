import type { ActiveTripBundle, LegPatch, TripLeg } from "@/lib/data-store";
import type { EventBusManifestRow } from "@/lib/api/event-day-ops";

export type ManifestOutboxStatus = "pending" | "failed";

export type ManifestOutboxOp =
  | {
      kind: "patch_leg";
      legId: string;
      patch: LegPatch;
    }
  | {
      kind: "mark_on_bus";
      /** Row state at tap time — replay calls markOnBus with this snapshot. */
      row: EventBusManifestRow;
    }
  | {
      kind: "mark_not_travelling";
      row: EventBusManifestRow;
      notes: string;
    };

export interface ManifestOutboxItem {
  id: string;
  tripId: string;
  createdAt: string;
  status: ManifestOutboxStatus;
  attempts: number;
  lastError?: string;
  /** Stable key for dedupe / debugging (client-generated). */
  idempotencyKey: string;
  op: ManifestOutboxOp;
}

export interface ManifestOfflineSnapshot {
  tripId: string;
  driverStaffId: string | null;
  savedAt: string;
  bundle: ActiveTripBundle;
  busManifest: EventBusManifestRow[];
}

export type ManifestOfflineListener = () => void;

export type { ActiveTripBundle, LegPatch, TripLeg, EventBusManifestRow };

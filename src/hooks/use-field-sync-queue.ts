import { useCallback, useEffect, useState } from "react";
import type { DeliverOutboxItem } from "@/lib/deliver-offline/outbox";
import {
  listDeliverOutbox,
  subscribeDeliverOffline,
} from "@/lib/deliver-offline/outbox";
import type { ManifestOutboxItem } from "@/lib/manifest-offline";
import { listAllOutbox, subscribeManifestOffline } from "@/lib/manifest-offline";

export interface FieldSyncRow {
  id: string;
  source: "Trip Deliver" | "Manifest";
  label: string;
  detail: string;
  createdAt: string;
  status: "pending" | "failed";
  attempts: number;
  error?: string;
}

function named(value?: string | null): string {
  const text = value?.trim();
  return text || "a person";
}

function describeDeliver(item: DeliverOutboxItem): Pick<FieldSyncRow, "label" | "detail"> {
  const op = item.op;
  switch (op.kind) {
    case "participant_arrival":
      return { label: "Check in", detail: named(op.row.participantName) };
    case "participant_undo_check_in":
      return { label: "Undo check-in", detail: named(op.row.participantName) };
    case "participant_checkout":
      return { label: "Check out", detail: named(op.row.participantName) };
    case "participant_undo_checkout":
      return { label: "Undo check-out", detail: named(op.row.participantName) };
    case "support_arrival":
      return { label: "Support arrived", detail: op.row.displayName };
    case "support_checkout":
      return { label: "Support left", detail: op.row.displayName };
    case "support_undo_check_in":
      return { label: "Undo support check-in", detail: "Trip Deliver" };
    case "support_undo_checkout":
      return { label: "Undo support check-out", detail: "Trip Deliver" };
    case "activity_toggle":
      return { label: "Activity check-in", detail: "Trip Deliver" };
    case "roll_toggle":
      return {
        label: op.table === "event_curfew_log" ? "Evening roll" : "Morning roll",
        detail: named(op.row.participant_name),
      };
    case "plan_movement":
      return { label: "Choose how to leave", detail: op.venueName ?? "next stop" };
    case "confirm_leave":
      return {
        label: "Confirm leave",
        detail: `${op.fromVenueName ?? "this stop"} → ${op.toVenueName ?? "the next stop"}`,
      };
    case "declare_open":
      return { label: "Open activity", detail: op.venueName ?? "stop" };
    case "open_venue":
      return { label: "Open venue", detail: op.venueName ?? "stop" };
    case "close_venue":
      return { label: "Close activity", detail: op.venueName ?? "stop" };
    default:
      return { label: "Trip Deliver tap", detail: "Trip Deliver" };
  }
}

function describeManifest(item: ManifestOutboxItem): Pick<FieldSyncRow, "label" | "detail"> {
  const op = item.op;
  switch (op.kind) {
    case "patch_leg":
      return { label: "Update a stop", detail: "Manifest" };
    case "mark_on_bus":
      return { label: "On the bus", detail: named(op.row.participant_name) };
    case "mark_not_travelling":
      return { label: "Not travelling", detail: named(op.row.participant_name) };
    case "force_start_hop":
      return { label: "Start leg before release", detail: "Manifest" };
    default:
      return { label: "Manifest tap", detail: "Manifest" };
  }
}

export function useFieldSyncQueue(): FieldSyncRow[] {
  const [rows, setRows] = useState<FieldSyncRow[]>([]);

  const reload = useCallback(async () => {
    const [deliver, manifest] = await Promise.all([listDeliverOutbox(), listAllOutbox()]);
    const next: FieldSyncRow[] = [
      ...deliver.map((item) => ({
        id: item.id,
        source: "Trip Deliver" as const,
        ...describeDeliver(item),
        createdAt: item.createdAt,
        status: item.status,
        attempts: item.attempts,
        error: item.lastError,
      })),
      ...manifest.map((item) => ({
        id: item.id,
        source: "Manifest" as const,
        ...describeManifest(item),
        createdAt: item.createdAt,
        status: item.status,
        attempts: item.attempts,
        error: item.lastError,
      })),
    ];
    next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setRows(next);
  }, []);

  useEffect(() => {
    void reload();
    const stopDeliver = subscribeDeliverOffline(() => {
      void reload();
    });
    const stopManifest = subscribeManifestOffline(() => {
      void reload();
    });
    return () => {
      stopDeliver();
      stopManifest();
    };
  }, [reload]);

  return rows;
}

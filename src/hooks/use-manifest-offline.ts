import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  countPendingOutbox,
  flushManifestOutbox,
  listAllOutbox,
  subscribeManifestOffline,
  type ManifestOutboxItem,
} from "@/lib/manifest-offline";

const ACTIVE_TRIP_KEY = ["transport_trips", "active"] as const;

export function useManifestOffline(tripId?: string | null) {
  const online = useOnlineStatus();
  const qc = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [items, setItems] = useState<ManifestOutboxItem[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [lastFlushError, setLastFlushError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = tripId
        ? (await listAllOutbox()).filter((i) => i.tripId === tripId)
        : await listAllOutbox();
      setItems(all);
      setPendingCount(all.filter((i) => i.status === "pending" || i.status === "failed").length);
      setFailedCount(all.filter((i) => i.status === "failed").length);
    } catch {
      /* IndexedDB unavailable — treat as empty */
      setItems([]);
      setPendingCount(0);
      setFailedCount(0);
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
    return subscribeManifestOffline(() => {
      void refresh();
    });
  }, [refresh]);

  const flush = useCallback(async () => {
    setFlushing(true);
    setLastFlushError(null);
    try {
      const result = await flushManifestOutbox(tripId ?? undefined);
      if (result.failed > 0) {
        setLastFlushError(`${result.failed} action(s) failed to sync — tap Retry.`);
      }
      await refresh();
      qc.invalidateQueries({ queryKey: ACTIVE_TRIP_KEY });
      if (tripId) {
        qc.invalidateQueries({ queryKey: ["event-bus-manifest", tripId] });
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastFlushError(msg);
      return { ok: 0, failed: 1 };
    } finally {
      setFlushing(false);
    }
  }, [qc, refresh, tripId]);

  // Auto-flush when connectivity returns.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void (async () => {
      const n = await countPendingOutbox(tripId ?? undefined);
      if (cancelled || n === 0) return;
      await flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [online, tripId, flush]);

  return {
    online,
    pendingCount,
    failedCount,
    items,
    flushing,
    lastFlushError,
    flush,
    refresh,
    hasPending: pendingCount > 0,
  };
}

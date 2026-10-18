import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { eventDeliverStatusKey } from "@/lib/api/event-deliver-status";
import { flushQueuedBusClearances } from "@/lib/deliver-offline/fleet-cache";
import {
  countDeliverOutbox,
  flushDeliverOutbox,
  listDeliverOutbox,
  subscribeDeliverOffline,
  type DeliverOutboxItem,
} from "@/lib/deliver-offline/outbox";

export function useDeliverOffline(sessionId?: string | null) {
  const online = useOnlineStatus();
  const qc = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const [lastFlushError, setLastFlushError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await listDeliverOutbox(sessionId ?? undefined);
      setPendingCount(all.filter((i) => i.status === "pending" || i.status === "failed").length);
      setFailedCount(all.filter((i) => i.status === "failed").length);
    } catch {
      setPendingCount(0);
      setFailedCount(0);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    return subscribeDeliverOffline(() => {
      void refresh();
    });
  }, [refresh]);

  const flush = useCallback(async () => {
    setFlushing(true);
    setLastFlushError(null);
    try {
      const result = await flushDeliverOutbox(sessionId ?? undefined);
      if (result.error) setLastFlushError(result.error);
      await refresh();
      if (sessionId) {
        qc.invalidateQueries({ queryKey: ["event-attendance-log", sessionId] });
        qc.invalidateQueries({ queryKey: ["event-support-attendance", sessionId] });
        qc.invalidateQueries({ queryKey: eventDeliverStatusKey(sessionId) });
      }
      qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey?.[0] === "event-activity-roll" || q.queryKey?.[0] === "event-venue-stops",
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastFlushError(msg);
      return { ok: 0, failed: 1 };
    } finally {
      setFlushing(false);
    }
  }, [qc, refresh, sessionId]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void (async () => {
      await flushQueuedBusClearances();
      const n = await countDeliverOutbox(sessionId ?? undefined);
      if (cancelled || n === 0) return;
      await flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [online, sessionId, flush]);

  return {
    online,
    pendingCount,
    failedCount,
    flushing,
    lastFlushError,
    flush,
    refresh,
    hasPending: pendingCount > 0,
  };
}

export type { DeliverOutboxItem };

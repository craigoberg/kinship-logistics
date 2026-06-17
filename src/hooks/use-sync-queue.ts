import { useEffect, useState } from "react";
import { listQueue, subscribe, flush } from "@/lib/sync-queue";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useQueryClient } from "@tanstack/react-query";
import type { SyncQueueItem } from "@/lib/data-store";

export function useSyncQueue(): SyncQueueItem[] {
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const online = useOnlineStatus();
  const qc = useQueryClient();

  useEffect(() => {
    setItems(listQueue());
    return subscribe(() => setItems(listQueue()));
  }, []);

  useEffect(() => {
    if (!online) return;
    const pending = listQueue().some((i) => i.status !== "synced");
    if (!pending) return;
    // Decoupled background drain: a failing offline_sync_logs insert must
    // never bubble into the React tree and cancel a primary mutation.
    (async () => {
      try {
        await flush();
        qc.invalidateQueries({ queryKey: ["offline_sync_logs"] });
        qc.invalidateQueries({ queryKey: ["participants"] });
      } catch (err) {
        console.warn("[sync-queue] background flush failed (decoupled)", err);
      }
    })();
  }, [online, qc]);

  return items;
}

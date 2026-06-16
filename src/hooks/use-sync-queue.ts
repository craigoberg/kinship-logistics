import { useEffect, useState } from "react";
import { listQueue, subscribe } from "@/lib/sync-queue";
import type { SyncQueueItem } from "@/lib/data-store";

export function useSyncQueue(): SyncQueueItem[] {
  const [items, setItems] = useState<SyncQueueItem[]>([]);

  useEffect(() => {
    setItems(listQueue());
    return subscribe(() => setItems(listQueue()));
  }, []);

  return items;
}

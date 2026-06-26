import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

interface Options {
  /** Public table name to subscribe to (e.g. "client_attendance_log"). */
  table: string;
  /**
   * Optional PostgREST filter (e.g. `"session_id=eq.<uuid>"`). Mirrors the
   * Realtime filter syntax accepted by `postgres_changes`.
   */
  filter?: string;
  /** Query keys to invalidate when an INSERT/UPDATE/DELETE arrives. */
  queryKeys: QueryKey[];
  /** Disable the subscription without unmounting the component. */
  enabled?: boolean;
}

/**
 * BMS-style silent refresh: listen for INSERT/UPDATE/DELETE events on a
 * Supabase table and invalidate the supplied TanStack Query keys. Surrounding
 * components keep their local state (open dialogs, in-progress textarea
 * input) — only the data payload refreshes.
 *
 * Always paired with a polling `refetchInterval` on the underlying query so a
 * dropped socket can't strand the UI on stale data.
 */
export function useRealtimeInvalidate({
  table,
  filter,
  queryKeys,
  enabled = true,
}: Options): void {
  const qc = useQueryClient();
  // Stabilise key list across renders without forcing the caller to memoise.
  const keysSig = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const channelName = `silent-${table}-${filter ?? "all"}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        // Supabase realtime types are loose on the event/schema discriminated
        // union — cast through `any` so the JSON filter shape compiles
        // without dragging in the generated DB types here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) } as any,
        () => {
          for (const key of queryKeys) {
            qc.invalidateQueries({ queryKey: key });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // keysSig captures queryKeys equality; qc is stable from the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, enabled, keysSig]);
}

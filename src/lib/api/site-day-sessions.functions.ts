// TanStack server functions that perform the privileged site_day_sessions
// open/close/phase writes using the service-role key. Keep this module thin:
// declarations + imports only — the admin client lives in
// `./site-day-sessions.server.ts` so the bundler tree-shakes it from the
// client graph. See tanstack-supabase-import-graph.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const isoDateLike = z.string().min(8);

export type SiteSessionPhase =
  | "open_pending"
  | "active_day"
  | "escalated_lock"
  | "closed_orderly"
  | "closed_no_go";

const phaseSchema = z.enum([
  "open_pending",
  "active_day",
  "escalated_lock",
  "closed_orderly",
  "closed_no_go",
]);

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const ensureTodaySessionFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const { getSiteDayAdminClient } = await import("./site-day-sessions.server");
    const supabase = getSiteDayAdminClient();
    const date = todayIso();
    const existing = await supabase
      .from("site_day_sessions")
      .select("*")
      .eq("session_date", date)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return existing.data;
    const created = await supabase
      .from("site_day_sessions")
      .insert({ session_date: date, phase: "open_pending" })
      .select("*")
      .single();
    if (created.error) throw new Error(created.error.message);
    return created.data;
  },
);

export const openSessionFn = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; notes: string }) =>
    z
      .object({
        staffId: z.string().uuid(),
        notes: z.string().max(2000).default(""),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { getSiteDayAdminClient } = await import("./site-day-sessions.server");
    const supabase = getSiteDayAdminClient();
    const date = todayIso();
    const nowIso = new Date().toISOString();

    // Find-or-create today's row, then promote to active_day with the
    // declaring Check Leader stamped on it.
    const existing = await supabase
      .from("site_day_sessions")
      .select("*")
      .eq("session_date", date)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let rowId: string | undefined = existing.data?.id;
    if (!rowId) {
      const created = await supabase
        .from("site_day_sessions")
        .insert({ session_date: date, phase: "open_pending" })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);
      rowId = created.data.id as string;
    }

    const updated = await supabase
      .from("site_day_sessions")
      .update({
        phase: "active_day",
        opened_by_id: data.staffId,
        open_declared_at: nowIso,
        open_leader_notes: data.notes || null,
      })
      .eq("id", rowId!)
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    return updated.data;
  });

export const closeSessionFn = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; notes: string }) =>
    z
      .object({
        staffId: z.string().uuid(),
        notes: z.string().max(2000).default(""),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { getSiteDayAdminClient } = await import("./site-day-sessions.server");
    const supabase = getSiteDayAdminClient();
    const date = todayIso();

    const existing = await supabase
      .from("site_day_sessions")
      .select("id")
      .eq("session_date", date)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("No session row to close.");

    const updated = await supabase
      .from("site_day_sessions")
      .update({
        phase: "closed_orderly",
        closed_by_id: data.staffId,
        close_declared_at: new Date().toISOString(),
        close_leader_notes: data.notes || null,
      })
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    return updated.data;
  });

export const setPhaseFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; phase: SiteSessionPhase }) =>
    z.object({ id: z.string().uuid(), phase: phaseSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { getSiteDayAdminClient } = await import("./site-day-sessions.server");
    const supabase = getSiteDayAdminClient();
    const updated = await supabase
      .from("site_day_sessions")
      .update({ phase: data.phase })
      .eq("id", data.id)
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    return updated.data;
  });

// Date-derived isoDateLike kept for downstream extension; not exported.
void isoDateLike;

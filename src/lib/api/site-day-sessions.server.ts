// Server-only Supabase admin client for the Day Centre open/close flow.
// The browser uses a publishable/anon key and RLS rejects writes to
// site_day_sessions; the operator session is PIN-based and never establishes
// a Supabase Auth user, so the bearer is anon. Routing the privileged writes
// through here with the service-role key lets the documented flow proceed
// without changing RLS or schema.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function normalizeUrl(raw: string): string {
  return raw.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
}

let cached: SupabaseClient | null = null;

export function getSiteDayAdminClient(): SupabaseClient {
  if (cached) return cached;
  const rawUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.YADA_SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl) {
    throw new Error(
      "Server config missing: SUPABASE_URL is not set. Cannot open/close the Day Centre.",
    );
  }
  if (!serviceRole) {
    throw new Error(
      "Server config missing: YADA_SUPABASE_SERVICE_ROLE_KEY is not set. Cannot open/close the Day Centre.",
    );
  }
  cached = createClient(normalizeUrl(rawUrl), serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

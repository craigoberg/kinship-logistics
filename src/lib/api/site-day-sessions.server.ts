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

function isLikelyServiceRoleKey(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function getSiteDayAdminClient(): SupabaseClient {
  if (cached) return cached;
  const rawUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.YADA_SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl) {
    throw new Error(
      "Server config missing: SUPABASE_URL is not set. Cannot open/close the Day Centre.",
    );
  }
  if (!serviceRole) {
    throw new Error(
      "Server config missing: SUPABASE_SERVICE_ROLE_KEY / YADA_SUPABASE_SERVICE_ROLE_KEY is not set. Cannot open/close the Day Centre.",
    );
  }
  if (!isLikelyServiceRoleKey(serviceRole)) {
    throw new Error(
      "Server config invalid: the Day Centre service-role key is not the valid service_role JWT for this backend project. Update the stored secret from Project Settings → API → service_role, then retry Confirm & Open.",
    );
  }
  cached = createClient(normalizeUrl(rawUrl), serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

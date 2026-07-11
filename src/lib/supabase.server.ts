import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function normalizeSupabaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

export function createPublishableServerClient(): SupabaseClient {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server env missing (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export function createServiceServerClient(): SupabaseClient {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Restore requires SUPABASE_SERVICE_ROLE_KEY in server env. Add it to .env (never VITE_).",
    );
  }
  if (
    key === process.env.SUPABASE_PUBLISHABLE_KEY ||
    key.startsWith("sb_publishable_")
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is set to the publishable key. In Supabase Dashboard → Project Settings → API, copy the service_role secret (not anon/publishable) into .env.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

export function getServerSupabaseUrl(): string {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  if (!url) throw new Error("SUPABASE_URL is not configured.");
  return url;
}

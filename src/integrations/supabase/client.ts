import { createClient } from "@supabase/supabase-js";
import { confirmLinkAfterFailure, startFieldLinkWatch } from "@/lib/field-link";
import { isAppOnline } from "@/lib/simulated-offline";

// The .env value may include a trailing `/rest/v1/` segment from the REST docs URL.
// supabase-js expects the project base URL only, so normalise it here.
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!rawUrl?.trim() || !SUPABASE_PUBLISHABLE_KEY?.trim()) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Set them in Lovable Project settings → Secrets / Environment " +
      "(or local .env). Do not commit real keys.",
  );
}

const SUPABASE_URL = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

export const supabaseUrl = SUPABASE_URL;

// Environment audit — confirm the client is pointed at the active Supabase project.
if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.log("[supabase] VITE_SUPABASE_URL =", SUPABASE_URL);
  // eslint-disable-next-line no-console
  console.log(
    "[supabase] publishable key suffix =",
    SUPABASE_PUBLISHABLE_KEY ? `…${SUPABASE_PUBLISHABLE_KEY.slice(-6)}` : "(missing)",
  );
}

function fieldFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const isData = url.includes("/rest/v1/");
  if (isData && !isAppOnline()) {
    return Promise.reject(new TypeError("Failed to fetch"));
  }
  return fetch(input, init).catch((err: unknown) => {
    if (isData) confirmLinkAfterFailure();
    throw err;
  });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: true,
  },
  global: {
    fetch: fieldFetch,
  },
});

/** Call after the app has mounted. Must not run while this module is still loading. */
export function bootFieldLinkWatch(): void {
  startFieldLinkWatch(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

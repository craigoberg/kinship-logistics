import { createClient } from "@supabase/supabase-js";

// The .env value may include a trailing `/rest/v1/` segment from the REST docs URL.
// supabase-js expects the project base URL only, so normalise it here.
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_URL = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

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

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: true,
  },
});

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tracks Supabase session restoration so that downstream useQuery hooks can
 * be gated on `isReady && !!user`. This prevents 401s on flat routes that
 * fire `useQuery` before the publishable client has rehydrated the session
 * from localStorage on a hard refresh.
 */
async function sessionIfStillActive(user: User | null): Promise<User | null> {
  const email = user?.email?.trim();
  if (!user || !email) return user;
  try {
    const { data, error } = await supabase
      .from("staff_registry")
      .select("active")
      .ilike("email", email)
      .maybeSingle();
    if (error || !data) return user;
    if ((data as { active?: boolean | null }).active === false) {
      await supabase.auth.signOut();
      return null;
    }
  } catch {
    return user;
  }
  return user;
}

export function useAuthReady() {
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const next = await sessionIfStillActive(session?.user ?? null);
      if (cancelled) return;
      setUser(next);
      setIsReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void sessionIfStillActive(session?.user ?? null).then((next) => {
        if (!cancelled) setUser(next);
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { user, isReady };
}

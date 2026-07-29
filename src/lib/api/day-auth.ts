/**
 * BL-099 / BL-002 slice — thin day session (Supabase Auth email + password).
 * Front door before PIN terminal. Not full RBAC (menus / idle lock / tight RLS).
 */
import { supabase } from "@/integrations/supabase/client";

export async function signInDaySession(
  email: string,
  password: string,
): Promise<{ userId: string; email: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
  if (!password) {
    throw new Error("Enter your password.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmed,
    password,
  });
  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
      throw new Error("Incorrect email or password.");
    }
    throw new Error(error.message || "Day login failed. Check your connection and retry.");
  }
  const user = data.user;
  if (!user) {
    throw new Error("Day login failed — no session returned.");
  }
  return { userId: user.id, email: user.email ?? trimmed };
}

export async function signOutDaySession(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Best-effort: does this Auth email match a staff_registry row?
 * Useful for a soft warning; PIN login still owns floor identity.
 */
export async function findStaffIdForAuthEmail(
  email: string,
): Promise<{ staffId: string; fullName: string } | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from("staff_registry")
    .select("id, full_name, email, auth_user_id, active")
    .ilike("email", trimmed)
    .maybeSingle();
  if (error || !data) return null;
  const active = (data as { active?: boolean | null }).active;
  if (active === false) return null;
  const row = data as {
    id: string;
    full_name: string;
    email: string | null;
    auth_user_id: string | null;
  };
  return { staffId: row.id, fullName: row.full_name };
}

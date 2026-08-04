/**
 * Server-only: set / reset Supabase Auth day-login password for a staff member.
 * Uses service role — never call from the browser client directly.
 *
 * Interim Alpha helper (BL-002 will revisit invite / self-reset / RBAC).
 */
import { verifyManagerPin } from "@/lib/backup-restore/engine.server";
import { createServiceServerClient } from "@/lib/supabase.server";

const MIN_PASSWORD_LEN = 6;

export type SetStaffAuthPasswordResult = {
  authUserId: string;
  email: string;
  createdAuthUser: boolean;
  linkedAuthUserId: boolean;
};

async function findAuthUserIdByEmail(
  service: ReturnType<typeof createServiceServerClient>,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list Auth users: ${error.message}`);
    const hit = (data.users ?? []).find(
      (u) => (u.email ?? "").trim().toLowerCase() === target,
    );
    if (hit?.id) return hit.id;
    if ((data.users ?? []).length < 200) break;
  }
  return null;
}

export async function setStaffAuthPassword(args: {
  targetStaffId: string;
  newPassword: string;
  actorStaffId: string;
  actorPin: string;
}): Promise<SetStaffAuthPasswordResult> {
  const password = args.newPassword;
  if (password.length < MIN_PASSWORD_LEN) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
  }

  await verifyManagerPin(args.actorStaffId, args.actorPin);

  const service = createServiceServerClient();
  const { data: staff, error: staffErr } = await service
    .from("staff_registry")
    .select("id, full_name, email, auth_user_id, active")
    .eq("id", args.targetStaffId)
    .maybeSingle();
  if (staffErr) throw new Error(`Could not load staff: ${staffErr.message}`);
  if (!staff) throw new Error("Staff member not found.");

  const email = String((staff as { email?: string | null }).email ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error(
      "Staff email is required. Save an email on the personnel record, then set the password.",
    );
  }

  const linkedId =
    ((staff as { auth_user_id?: string | null }).auth_user_id ?? "").trim() || null;
  let authUserId = linkedId;
  let createdAuthUser = false;
  let passwordSet = false;

  if (authUserId) {
    const { error } = await service.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
    });
    if (!error) {
      passwordSet = true;
    } else if (/not.*(found|exist)|user.*not/i.test(error.message)) {
      authUserId = null;
    } else {
      throw new Error(`Could not update Auth password: ${error.message}`);
    }
  }

  if (!passwordSet) {
    if (!authUserId) {
      authUserId = await findAuthUserIdByEmail(service, email);
    }

    if (!authUserId) {
      const { data: created, error: createErr } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: (staff as { full_name?: string | null }).full_name ?? undefined,
          staff_id: args.targetStaffId,
        },
      });
      if (createErr) {
        throw new Error(`Could not create Auth user: ${createErr.message}`);
      }
      authUserId = created.user?.id ?? null;
      createdAuthUser = true;
      if (!authUserId) throw new Error("Auth user create returned no id.");
      passwordSet = true;
    } else {
      const { error } = await service.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`Could not update Auth password: ${error.message}`);
      passwordSet = true;
    }
  }

  if (!passwordSet || !authUserId) {
    throw new Error("Password was not set.");
  }

  let linkedAuthUserId = false;
  if (linkedId !== authUserId) {
    const { error: linkErr } = await service
      .from("staff_registry")
      .update({ auth_user_id: authUserId })
      .eq("id", args.targetStaffId);
    if (linkErr) {
      throw new Error(
        `Password set, but linking auth_user_id failed: ${linkErr.message}. Run the auth_user_id backfill SQL if needed.`,
      );
    }
    linkedAuthUserId = true;
  }

  return { authUserId, email, createdAuthUser, linkedAuthUserId };
}

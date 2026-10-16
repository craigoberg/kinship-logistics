/**
 * Server-only: set / reset Supabase Auth day-login password for a staff member.
 * Uses service role — never call from the browser client directly.
 *
 * Interim Alpha helper (BL-002 will revisit invite / self-reset / RBAC).
 */
import { assertManagerPin } from "@/lib/auth/pin-auth.server";
import { createServiceServerClient } from "@/lib/supabase.server";

const MIN_PASSWORD_LEN = 6;

export type SetStaffAuthPasswordResult = {
  authUserId: string;
  email: string;
  createdAuthUser: boolean;
  linkedAuthUserId: boolean;
};

type ServiceClient = ReturnType<typeof createServiceServerClient>;

async function findAuthUserIdByEmail(service: ServiceClient, email: string): Promise<string | null> {
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

/** True when this Auth user is already the sign-in for a different person. */
async function authUserBelongsToSomeoneElse(
  service: ServiceClient,
  authUserId: string,
  staffId: string,
): Promise<boolean> {
  const { data: self, error: selfErr } = await service
    .from("staff_registry")
    .select("person_id")
    .eq("id", staffId)
    .maybeSingle();
  if (selfErr) throw new Error(`Could not load staff: ${selfErr.message}`);
  const personId = ((self as { person_id?: string | null } | null)?.person_id ?? "").trim();

  const [staffRes, carerRes] = await Promise.all([
    service.from("staff_registry").select("id, person_id").eq("auth_user_id", authUserId),
    service.from("carers_registry").select("id, person_id").eq("auth_user_id", authUserId),
  ]);
  if (staffRes.error) throw new Error(`Could not check sign-in link: ${staffRes.error.message}`);
  if (carerRes.error) throw new Error(`Could not check sign-in link: ${carerRes.error.message}`);

  const samePerson = (rowPersonId: string | null | undefined) =>
    !!personId && (rowPersonId ?? "").trim() === personId;

  for (const row of (staffRes.data ?? []) as Array<{ id: string; person_id?: string | null }>) {
    if (row.id === staffId || samePerson(row.person_id)) continue;
    return true;
  }
  for (const row of (carerRes.data ?? []) as Array<{ id: string; person_id?: string | null }>) {
    if (samePerson(row.person_id)) continue;
    return true;
  }
  return false;
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

  await assertManagerPin(args.actorStaffId, args.actorPin);

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
  // Sign-in uses the staff email. The password has to land on that Auth account,
  // even when auth_user_id still points at an older internal address.
  const emailOwnerId = await findAuthUserIdByEmail(service, email);
  if (emailOwnerId && (await authUserBelongsToSomeoneElse(service, emailOwnerId, args.targetStaffId))) {
    throw new Error(
      "That email is already the sign-in for someone else. Change the email on this person, then set the password again.",
    );
  }

  let authUserId = emailOwnerId;
  let createdAuthUser = false;

  if (authUserId) {
    const { error } = await service.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not update Auth password: ${error.message}`);
  } else if (
    linkedId &&
    !(await authUserBelongsToSomeoneElse(service, linkedId, args.targetStaffId))
  ) {
    const { data: linked, error: linkedErr } = await service.auth.admin.getUserById(linkedId);
    if (!linkedErr && linked.user) {
      const { error } = await service.auth.admin.updateUserById(linkedId, {
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`Could not update Auth password: ${error.message}`);
      authUserId = linkedId;
    }
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

import { runSetStaffAuthPassword } from "@/lib/api/staff-auth.functions";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";

export type SetStaffAuthPasswordOutcome = {
  authUserId: string;
  email: string;
  createdAuthUser: boolean;
  linkedAuthUserId: boolean;
};

/**
 * Manager sets / resets the Supabase Auth day-login password for a staff member.
 * Server uses service role; requires manager PIN step-up.
 */
export async function setStaffDayLoginPassword(args: {
  targetStaffId: string;
  newPassword: string;
  actorStaffId: string;
  actorPin: string;
}): Promise<SetStaffAuthPasswordOutcome> {
  const json = await runSetStaffAuthPassword({ data: args });
  if (!json.ok || !json.result) {
    throw new Error(json.error ?? "Set password failed.");
  }
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: "staff",
    recordId: args.targetStaffId,
    recordName: json.result.email,
    summary: `Set day-login password for ${json.result.email}`,
    after: {
      email: json.result.email,
      createdAuthUser: json.result.createdAuthUser,
      linkedAuthUserId: json.result.linkedAuthUserId,
    },
  });
  return json.result;
}

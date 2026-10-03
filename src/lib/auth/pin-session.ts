/**
 * Browser side of go-live PIN login. The server holds the pepper and mints the session.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  runChangeOwnPin,
  runCompleteManagerPinUpgrade,
  runCompletePinUpgrade,
  runConfirmManagerPassword,
  runManagerSetPin,
  runManagerUnlockPin,
  runPinSignIn,
  runResolvePinHolder,
  runVerifyNamedPin,
} from "@/lib/auth/pin-auth.functions";
import { isManagerLevelAccess, type PinProfile } from "@/lib/auth/pin-role";
import { recordOfficeChangeBestEffort } from "@/lib/api/office-change-log";
import {
  getDeviceUuid,
  persistFloorIdentity,
  type ActiveUserProfile,
} from "@/lib/data-store";

export type { PinProfile };

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  if (!token) throw new Error("Sign in first.");
  return token;
}

function unwrap<T>(json: { ok: true; result: T } | { ok: false; error: string }): T {
  if (!json.ok) throw new Error(json.error);
  return json.result;
}

export function profileToActive(profile: PinProfile): ActiveUserProfile {
  return {
    staffId: profile.personKind === "staff" ? profile.personId : "",
    carerId: profile.personKind === "carer" ? profile.personId : null,
    personKind: profile.personKind,
    fullName: profile.fullName,
    role: profile.role,
    staffRole: profile.staffRole,
    accessRole: profile.accessRole,
    authUserId: profile.authUserId,
  };
}

export async function applySessionTokens(accessTokenValue: string, refreshToken: string): Promise<void> {
  const { error } = await supabase.auth.setSession({
    access_token: accessTokenValue,
    refresh_token: refreshToken,
  });
  if (error) throw new Error(error.message || "Could not start the session.");
}

export function rememberProfile(profile: PinProfile): ActiveUserProfile {
  const active = profileToActive(profile);
  persistFloorIdentity(active);
  return active;
}

export async function signInWithPin(pin: string) {
  const json = await runPinSignIn({ data: { pin, deviceId: getDeviceUuid() } });
  return unwrap(json);
}

export async function finishPinUpgrade(upgradeToken: string, newPin: string, confirmPin: string) {
  const json = await runCompletePinUpgrade({
    data: { upgradeToken, newPin, confirmPin, deviceId: getDeviceUuid() },
  });
  const result = unwrap(json);
  await applySessionTokens(result.accessToken, result.refreshToken);
  return rememberProfile(result.profile);
}

export async function confirmManagerPassword(confirmToken: string, email: string, password: string) {
  const json = await runConfirmManagerPassword({
    data: { confirmToken, email, password },
  });
  return unwrap(json);
}

export async function finishManagerPinUpgrade(args: {
  accessToken: string;
  refreshToken: string;
  upgradeToken: string;
  newPin: string;
  confirmPin: string;
}) {
  const json = await runCompleteManagerPinUpgrade({
    data: {
      accessToken: args.accessToken,
      upgradeToken: args.upgradeToken,
      newPin: args.newPin,
      confirmPin: args.confirmPin,
    },
  });
  const result = unwrap(json);
  await applySessionTokens(args.accessToken, args.refreshToken);
  return rememberProfile(result.profile);
}

export async function verifyNamedPersonPin(args: {
  personKind: "staff" | "carer";
  personId: string;
  pin: string;
}): Promise<{ personnelType: string | null; roleTitle: string | null }> {
  const json = await runVerifyNamedPin({
    data: { ...args, accessToken: await accessToken() },
  });
  return unwrap(json);
}

export async function resolveStaffIdFromPin(pin: string): Promise<string> {
  const json = await runResolvePinHolder({
    data: { accessToken: await accessToken(), pin, deviceId: getDeviceUuid() },
  });
  const result = unwrap(json);
  if (result.personKind !== "staff") {
    throw new Error("That PIN belongs to a carer and cannot authorise this action.");
  }
  return result.personId;
}

export async function changeMyPin(currentPin: string, newPin: string, confirmPin: string): Promise<void> {
  const json = await runChangeOwnPin({
    data: { accessToken: await accessToken(), currentPin, newPin, confirmPin },
  });
  const result = unwrap(json);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: result.personKind === "carer" ? "carer" : "staff",
    recordId: result.personId,
    recordName: result.fullName,
    summary: `PIN changed for ${result.fullName}`,
    after: { pin: "changed" },
  });
}

export async function managerSetPersonPin(args: {
  personKind: "staff" | "carer";
  personId: string;
  newPin: string;
}): Promise<void> {
  const json = await runManagerSetPin({
    data: { ...args, accessToken: await accessToken() },
  });
  const result = unwrap(json);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: args.personKind === "carer" ? "carer" : "staff",
    recordId: args.personId,
    recordName: result.fullName,
    summary: `Set sign-in PIN for ${result.fullName}`,
    after: { pin: "set" },
  });
}

export async function managerUnlockPersonPin(args: {
  personKind: "staff" | "carer";
  personId: string;
}): Promise<void> {
  const json = await runManagerUnlockPin({
    data: { ...args, accessToken: await accessToken() },
  });
  const result = unwrap(json);
  void recordOfficeChangeBestEffort({
    action: "updated",
    entity: args.personKind === "carer" ? "carer" : "staff",
    recordId: args.personId,
    recordName: result.fullName,
    summary: `Unlocked sign-in PIN for ${result.fullName}`,
  });
}

export function managerLevelFromProfile(profile: {
  accessRole?: string | null;
  staffRole?: string | null;
} | null): boolean {
  return isManagerLevelAccess(profile?.accessRole, profile?.staffRole);
}

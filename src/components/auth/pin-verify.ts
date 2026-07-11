import {
  verifyCoordinatorPin,
  loginWithPin,
  GuardianPinError,
} from "@/lib/data-store";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the staff row that owns this 4-digit PIN (terminal login RPC).
 * Returns staff id — does not require a pre-set session staffId in localStorage.
 */
export async function resolveOperatorStaffIdFromPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("Incorrect operator PIN. Please try again.");
  }
  const { data, error } = await supabase.rpc("verify_operator_pin", {
    entered_pin: pin,
  });
  if (error) {
    console.error("[resolveOperatorStaffIdFromPin] failed", error);
    throw new Error("Could not verify PIN. Check your connection and try again.");
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new Error("Incorrect operator PIN. Please try again.");
  }
  return rows[0].id;
}

/** Verify a 4-digit operator PIN (any active staff holder). */
export async function verifyOperatorPin(pin: string): Promise<void> {
  await resolveOperatorStaffIdFromPin(pin);
}

/** Verify a manager/coordinator PIN (4–6 digits). */
export async function verifyManagerPin(managerStaffId: string, pin: string): Promise<void> {
  if (!managerStaffId) throw new Error("Please select the authorising manager.");
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error("Incorrect manager PIN. Please try again.");
  }
  try {
    const ok = await verifyCoordinatorPin(managerStaffId, pin);
    if (!ok) throw new Error("Incorrect manager PIN. Please try again.");
  } catch (roleErr: unknown) {
    throw new Error(
      roleErr instanceof Error ? roleErr.message : "Manager role verification failed.",
    );
  }
}

/** Terminal login — 4-digit PIN. Returns profile on success. */
export async function verifyLoginPin(pin: string) {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("Incorrect PIN. Please try again.");
  }
  try {
    const profile = await loginWithPin(pin);
    if (!profile) throw new Error("Incorrect PIN. Please try again.");
    return profile;
  } catch (e) {
    if (e instanceof GuardianPinError) throw e;
    throw new Error("Sign-in failed. Check your connection and retry.");
  }
}

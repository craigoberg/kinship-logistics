import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  changeOwnPin,
  completeManagerPinUpgrade,
  completePinUpgrade,
  confirmManagerPassword,
  managerSetPin,
  managerUnlockPin,
  pinSignIn,
  resolvePinHolder,
  verifyNamedPin,
} from "@/lib/auth/pin-auth.server";

function fail(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error ? e.message : "PIN check failed. Try again.",
  };
}

const pinField = z.string().min(1).max(12);
const deviceField = z.string().min(1).max(80);
const tokenField = z.string().min(1).max(4000);

export const runPinSignIn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ pin: pinField, deviceId: deviceField }))
  .handler(async ({ data }) => {
    try {
      const result = await pinSignIn(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runCompletePinUpgrade = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      upgradeToken: tokenField,
      newPin: pinField,
      confirmPin: pinField,
      deviceId: deviceField,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await completePinUpgrade(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runConfirmManagerPassword = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      confirmToken: tokenField,
      email: z.string().min(3).max(200),
      password: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await confirmManagerPassword(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runCompleteManagerPinUpgrade = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: tokenField,
      upgradeToken: tokenField,
      newPin: pinField,
      confirmPin: pinField,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await completeManagerPinUpgrade(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runVerifyNamedPin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: tokenField,
      personKind: z.enum(["staff", "carer"]),
      personId: z.string().uuid(),
      pin: pinField,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await verifyNamedPin(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runResolvePinHolder = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: tokenField,
      pin: pinField,
      deviceId: deviceField,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await resolvePinHolder(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runChangeOwnPin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: tokenField,
      currentPin: pinField,
      newPin: pinField,
      confirmPin: pinField,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await changeOwnPin(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runManagerSetPin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: tokenField,
      personKind: z.enum(["staff", "carer"]),
      personId: z.string().uuid(),
      newPin: pinField,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await managerSetPin(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

export const runManagerUnlockPin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      accessToken: tokenField,
      personKind: z.enum(["staff", "carer"]),
      personId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const result = await managerUnlockPin(data);
      return { ok: true as const, result };
    } catch (e) {
      return fail(e);
    }
  });

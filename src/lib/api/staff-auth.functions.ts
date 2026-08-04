import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { setStaffAuthPassword } from "@/lib/api/staff-auth.server";

const setPasswordInput = z.object({
  targetStaffId: z.string().uuid(),
  newPassword: z.string().min(6).max(128),
  actorStaffId: z.string().uuid(),
  actorPin: z.string().min(4).max(6),
});

export const runSetStaffAuthPassword = createServerFn({ method: "POST" })
  .inputValidator(setPasswordInput)
  .handler(async ({ data }) => {
    try {
      const result = await setStaffAuthPassword(data);
      return { ok: true as const, result };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Set password failed.",
      };
    }
  });

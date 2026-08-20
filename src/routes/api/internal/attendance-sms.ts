// Server route — RED attendance SMS pipeline (GatewayAPI connector).
//
// Called by the client-side sweeper in src/lib/api/client-attendance.ts the
// moment a single-row escalation flips YELLOW → RED. Reads recipient list
// from system_parameters.attendance_red_sms_recipients (comma-separated
// E.164). When null, falls back to every staff_registry row with
// staff_role = 'Manager'.

import { createFileRoute } from "@tanstack/react-router";
import { createServiceServerClient } from "@/lib/supabase.server";
import { formatTime } from "@/lib/utils";

interface Body {
  attendanceId: string;
  participantName: string;
  expectedAt: string;
  sessionId: string;
}

function digitsOnly(phone: string): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

export const Route = createFileRoute("/api/internal/attendance-sms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        if (!body?.attendanceId || !body?.participantName) {
          return Response.json({ ok: false, error: "Missing fields" }, { status: 400 });
        }

        let supa;
        try {
          supa = createServiceServerClient();
        } catch (e) {
          return Response.json(
            {
              ok: false,
              error:
                e instanceof Error
                  ? e.message
                  : "Supabase service role missing (needed after day-login RLS lock).",
            },
            { status: 500 },
          );
        }

        // 1) Resolve recipients
        let recipients: string[] = [];
        const { data: paramRow } = await supa
          .from("system_parameters")
          .select("value")
          .eq("key", "attendance_red_sms_recipients")
          .maybeSingle();
        const paramVal = paramRow?.value;
        if (typeof paramVal === "string" && paramVal.trim().length > 0) {
          recipients = paramVal
            .split(",")
            .map((s) => digitsOnly(s.trim()))
            .filter((s) => s.length >= 8);
        }
        if (recipients.length === 0) {
          const { data: managers } = await supa
            .from("staff_registry")
            .select("phone, staff_role")
            .ilike("staff_role", "%Manager%");
          recipients = (managers ?? [])
            .map((m) => digitsOnly((m as { phone: string | null }).phone ?? ""))
            .filter((s) => s.length >= 8);
        }
        recipients = Array.from(new Set(recipients));

        const expectedLocal = formatTime(body.expectedAt);
        const message = `[RED] ${body.participantName} missing from Day Centre — expected ${expectedLocal}. Please confirm whereabouts.`;
        const reference = `att-red-${body.attendanceId}`;

        if (recipients.length === 0) {
          console.warn("[attendance-sms] no recipients resolved");
          return Response.json({
            ok: true,
            sent: 0,
            reason: "no_recipients",
            recipients,
            message,
            reference,
          });
        }

        const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
        const GATEWAY_API_KEY = process.env.GATEWAYAPI_API_KEY;
        if (!LOVABLE_API_KEY || !GATEWAY_API_KEY) {
          console.warn("[attendance-sms] GatewayAPI connector not configured", {
            hasLovable: !!LOVABLE_API_KEY,
            hasGateway: !!GATEWAY_API_KEY,
          });
          return Response.json({
            ok: true,
            sent: 0,
            reason: "gatewayapi_not_configured",
            recipients,
            message,
            reference,
          });
        }

        let sent = 0;
        for (const to of recipients) {
          try {
            const res = await fetch(
              "https://connector-gateway.lovable.dev/gatewayapi/mobile/single",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "X-Connection-Api-Key": GATEWAY_API_KEY,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  sender: "DayCentre",
                  recipient: Number(to),
                  message,
                  reference,
                }),
              },
            );
            if (res.ok) {
              sent += 1;
            } else {
              console.error("[attendance-sms] gateway non-OK", res.status, await res.text());
            }
          } catch (e) {
            console.error("[attendance-sms] dispatch threw", e);
          }
        }
        return Response.json({
          ok: true,
          sent,
          total: recipients.length,
          reason: "real_send",
          recipients,
          message,
          reference,
        });
      },
    },
  },
});

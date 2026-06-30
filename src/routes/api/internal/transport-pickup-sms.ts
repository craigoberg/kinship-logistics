// Server route — manager SMS when a driver cancels a manifest pickup.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

interface Body {
  legId: string;
  tripId: string;
  participantName: string;
  reason?: string | null;
  issueId?: string | null;
}

function digitsOnly(phone: string): string {
  return (phone ?? "").replace(/[^0-9]/g, "");
}

export const Route = createFileRoute("/api/internal/transport-pickup-sms")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        if (!body?.legId || !body?.participantName) {
          return Response.json({ ok: false, error: "Missing fields" }, { status: 400 });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_KEY) {
          return Response.json({ ok: false, error: "Supabase env missing" }, { status: 500 });
        }

        const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        let recipients: string[] = [];
        const { data: paramRow } = await supa
          .from("system_parameters")
          .select("value")
          .eq("key", "transport_pickup_sms_recipients")
          .maybeSingle();
        const paramVal = paramRow?.value;
        if (typeof paramVal === "string" && paramVal.trim().length > 0) {
          recipients = paramVal
            .split(",")
            .map((s) => digitsOnly(s.trim()))
            .filter((s) => s.length >= 8);
        }
        if (recipients.length === 0) {
          const { data: fallbackRow } = await supa
            .from("system_parameters")
            .select("value")
            .eq("key", "attendance_red_sms_recipients")
            .maybeSingle();
          const fallbackVal = fallbackRow?.value;
          if (typeof fallbackVal === "string" && fallbackVal.trim().length > 0) {
            recipients = fallbackVal
              .split(",")
              .map((s) => digitsOnly(s.trim()))
              .filter((s) => s.length >= 8);
          }
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

        const reason = body.reason?.trim() || "Passenger not travelling today.";
        const message =
          `[PICKUP CANCELLED] Driver skipped ${body.participantName} on today's run. ` +
          `${reason} Follow up in Governance Hub.`;
        const reference = `pickup-cancel-${body.legId}`;

        if (recipients.length === 0) {
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
            if (res.ok) sent += 1;
          } catch (e) {
            console.error("[transport-pickup-sms] dispatch threw", e);
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

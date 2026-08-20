// Server route — App ticket email notify (Postmark; Resend fallback).
//
// Called by RaiseTicketDialog after a successful insert. Also accepts a
// Supabase Database Webhook INSERT payload as a backup (do not enable both
// unless notify_email_sent_at is in place — this route skips if already sent).
//
// Recipients: system_parameters.app_tickets.notify_to (comma-separated).
// Ticket insert always succeeds even if this route skips or fails.
// Notify is best-effort: skip reasons return HTTP 200 so the floor console
// is not a red 500 when mail is not configured yet.

import { createFileRoute } from "@tanstack/react-router";
import { getServerConfig } from "@/lib/config.server";
import { createPublishableServerClient } from "@/lib/supabase.server";
import {
  jsonbParamString,
  parseNotifyEmailList,
} from "@/lib/app-tickets/notify-params";
import {
  formatNotifyFrom,
  sendAppTicketEmail,
} from "@/lib/app-tickets/send-notify-email";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TicketRow {
  id: string;
  title: string;
  description: string;
  status: string;
  reported_by_name: string;
  path_label: string;
  form_title: string | null;
  last_control_label: string | null;
  notify_email_sent_at?: string | null;
}

function jsonOk(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function isWebhookBody(raw: Record<string, unknown>): boolean {
  return raw.table === "app_tickets" && raw.record != null && typeof raw.record === "object";
}

function webhookSecretMatches(request: Request, expected: string | undefined): boolean {
  if (!expected) return true;
  const header =
    request.headers.get("x-app-ticket-notify-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return header === expected;
}

function hubUrl(request: Request, publicUrl: string | undefined): string {
  const origin =
    request.headers.get("origin") ||
    (publicUrl ?? "").replace(/\/$/, "") ||
    "";
  const base = origin || "https://crm-test.yada.org.au";
  return `${base}/governance?tab=app_tickets`;
}

function buildEmail(ticket: TicketRow, link: string): { subject: string; text: string } {
  const subject = `[Yada Connect] App ticket — ${ticket.path_label || ticket.title}`;
  const lines = [
    "A staff member filed an app ticket.",
    "",
    `Who: ${ticket.reported_by_name}`,
    `Where: ${ticket.path_label}`,
    ticket.form_title ? `Form: ${ticket.form_title}` : null,
    ticket.last_control_label ? `Last tap: ${ticket.last_control_label}` : null,
    `Status: ${ticket.status}`,
    "",
    "What happened:",
    ticket.description,
    "",
    `Open in Hub: ${link}`,
  ];
  return { subject, text: lines.filter((l) => l !== null).join("\n") };
}

export const Route = createFileRoute("/api/internal/app-ticket-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await handleNotify(request);
        } catch (e) {
          console.error("[app-ticket-notify] unhandled", e);
          return jsonOk({
            ok: true,
            sent: 0,
            reason: "handler_threw",
            error: e instanceof Error ? e.message : "notify failed",
          });
        }
      },
    },
  },
});

async function handleNotify(request: Request): Promise<Response> {
  let raw: Record<string, unknown>;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonOk({ ok: false, error: "Invalid JSON" }, 400);
  }

  const cfg = getServerConfig();
  if (isWebhookBody(raw) && !webhookSecretMatches(request, cfg.appTicketNotifySecret)) {
    return jsonOk({ ok: false, error: "Unauthorized webhook" }, 401);
  }

  const ticketId = isWebhookBody(raw)
    ? String((raw.record as Record<string, unknown>).id ?? "")
    : String(raw.ticketId ?? "");
  if (!UUID_RE.test(ticketId)) {
    return jsonOk({ ok: false, error: "Missing ticketId" }, 400);
  }

  const webhookType = String(raw.type ?? raw.event ?? "").toUpperCase();
  if (isWebhookBody(raw) && webhookType && webhookType !== "INSERT") {
    return jsonOk({ ok: true, sent: 0, reason: "not_insert" });
  }

  let supa;
  try {
    supa = createPublishableServerClient();
  } catch (e) {
    console.error("[app-ticket-notify] supabase client", e);
    return jsonOk({
      ok: true,
      sent: 0,
      reason: "supabase_env_missing",
      error: e instanceof Error ? e.message : "Supabase env missing",
    });
  }

  const coreSelect =
    "id, title, description, status, reported_by_name, path_label, form_title, last_control_label";

  let { data: ticketData, error: ticketErr } = await supa
    .from("app_tickets")
    .select(`${coreSelect}, notify_email_sent_at`)
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketErr && /notify_email_sent_at/i.test(ticketErr.message)) {
    const retry = await supa
      .from("app_tickets")
      .select(coreSelect)
      .eq("id", ticketId)
      .maybeSingle();
    ticketData = retry.data;
    ticketErr = retry.error;
  }

  if (ticketErr) {
    console.error("[app-ticket-notify] load failed", ticketErr);
    return jsonOk({
      ok: true,
      sent: 0,
      reason: "ticket_load_failed",
      error: ticketErr.message,
    });
  }
  if (!ticketData) {
    return jsonOk({ ok: true, sent: 0, reason: "ticket_not_found" });
  }

  const ticket = ticketData as TicketRow;
  const { subject, text } = buildEmail(ticket, hubUrl(request, cfg.appPublicUrl));

  if (ticket.notify_email_sent_at) {
    return jsonOk({
      ok: true,
      sent: 0,
      reason: "already_sent",
      recipients: [],
      subject,
      previewBody: text,
    });
  }

  const { data: toRow } = await supa
    .from("system_parameters")
    .select("value")
    .eq("key", "app_tickets.notify_to")
    .maybeSingle();
  const recipients = parseNotifyEmailList(toRow?.value);
  if (recipients.length === 0) {
    return jsonOk({
      ok: true,
      sent: 0,
      reason: "no_recipients",
      recipients,
      subject,
      previewBody: text,
    });
  }

  const { data: fromRow } = await supa
    .from("system_parameters")
    .select("value")
    .eq("key", "app_tickets.notify_from")
    .maybeSingle();
  const fromParam = jsonbParamString(fromRow?.value).trim();
  const from = formatNotifyFrom(
    fromParam || cfg.postmarkFrom || cfg.resendFrom || "",
  );
  if (!from) {
    return jsonOk({
      ok: true,
      sent: 0,
      reason: "no_from",
      recipients,
      subject,
      previewBody: text,
    });
  }

  const sent = await sendAppTicketEmail({
    from,
    to: recipients,
    subject,
    text,
    postmarkToken: cfg.postmarkServerToken,
    postmarkStream: cfg.postmarkMessageStream,
    resendApiKey: cfg.resendApiKey,
  });
  if (!sent.ok) {
    return jsonOk({
      ok: true,
      sent: 0,
      reason: sent.reason,
      error: sent.detail,
      recipients,
      subject,
      previewBody: text,
    });
  }

  const { error: stampErr } = await supa
    .from("app_tickets")
    .update({ notify_email_sent_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (stampErr) {
    console.warn("[app-ticket-notify] could not stamp notify_email_sent_at", stampErr);
  }

  return jsonOk({
    ok: true,
    sent: recipients.length,
    reason: "real_send",
    recipients,
    subject,
    previewBody: text,
  });
}

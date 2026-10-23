/**
 * Fire-and-forget notify after a ticket insert. Filing must not fail if mail fails.
 *
 * DEV/TEST: a short status toast (not the mock-email body dump). Real delivery
 * needs server-only POSTMARK_SERVER_TOKEN — Admin To alone is not enough.
 */
import { toast } from "sonner";
import { IS_TEST_BUILD } from "@/lib/test-mode";
import type { AppTicket } from "@/lib/api/app-tickets";

interface NotifyResponse {
  ok?: boolean;
  reason?: string;
  recipients?: string[];
  subject?: string;
  previewBody?: string;
  error?: string;
}

function statusCopy(json: NotifyResponse): { title: string; description: string } | null {
  const to = (json.recipients ?? []).join(", ");
  switch (json.reason) {
    case "real_send":
      return {
        title: "Notify email sent",
        description: to ? `Sent to ${to}` : "Mail provider accepted the message.",
      };
    case "mailer_not_configured":
    case "resend_not_configured":
      return {
        title: "Ticket filed — email not sent",
        description:
          "Admin To is set, but this host has no POSTMARK_SERVER_TOKEN. Add it to .env or Vercel (never VITE_) and restart.",
      };
    case "no_from":
      return {
        title: "Ticket filed — email not sent",
        description:
          "Set App ticket notify From (a Postmark-verified sender) or POSTMARK_FROM in env.",
      };
    case "postmark_failed":
      return {
        title: "Ticket filed — email not sent",
        description:
          json.error ||
          "Postmark rejected the send. Check the Server API token and that From is a verified signature.",
      };
    case "no_recipients":
      return {
        title: "Ticket filed — no notify To",
        description: "Set Admin → System Parameters → App ticket notify → To to receive email.",
      };
    case "already_sent":
      return null;
    default:
      if (!IS_TEST_BUILD) return null;
      return {
        title: "Ticket filed — email skipped",
        description: json.error || json.reason || "Notify did not send.",
      };
  }
}

export async function notifyAppTicketCreated(ticket: AppTicket): Promise<void> {
  let json: NotifyResponse = {};
  try {
    const res = await fetch("/api/internal/app-ticket-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.id }),
    });
    json = (await res.json().catch(() => ({}))) as NotifyResponse;
    if (!res.ok) {
      console.warn("[app-ticket-notify] HTTP", res.status, json);
    }
  } catch (err) {
    console.error("[app-ticket-notify] client fetch failed", err);
    json = { ok: false, reason: "client_fetch_failed" };
  }

  const copy = statusCopy(json);
  if (!copy) return;
  if (json.reason === "real_send") {
    toast.success(copy.title, { description: copy.description });
  } else {
    toast.message(copy.title, { description: copy.description });
  }
}

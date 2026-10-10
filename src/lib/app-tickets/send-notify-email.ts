/** Server-only: send App ticket notify mail (Postmark first, Resend fallback). */

export function formatNotifyFrom(addr: string): string {
  const trimmed = addr.trim();
  if (!trimmed) return "";
  if (trimmed.includes("<")) return trimmed;
  return `Yada Connect <${trimmed}>`;
}

/** @deprecated use formatNotifyFrom */
export const formatResendFrom = formatNotifyFrom;

export async function sendAppTicketEmail(args: {
  from: string;
  to: string[];
  subject: string;
  text: string;
  postmarkToken?: string;
  postmarkStream?: string;
  resendApiKey?: string;
}): Promise<
  | { ok: true; provider: "postmark" | "resend" }
  | { ok: false; reason: string; detail?: string }
> {
  const from = args.from.trim();
  if (!from) {
    return { ok: false, reason: "no_from" };
  }
  if (args.to.length === 0) {
    return { ok: false, reason: "no_recipients" };
  }

  if (args.postmarkToken) {
    try {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": args.postmarkToken,
        },
        body: JSON.stringify({
          From: from,
          To: args.to.join(", "),
          Subject: args.subject,
          TextBody: args.text,
          MessageStream: args.postmarkStream || "outbound",
        }),
      });
      if (res.ok) return { ok: true, provider: "postmark" };
      const detail = await res.text();
      console.error("[app-ticket-notify] Postmark non-OK", res.status, detail);
      return { ok: false, reason: "postmark_failed", detail };
    } catch (e) {
      console.error("[app-ticket-notify] Postmark threw", e);
      return {
        ok: false,
        reason: "postmark_threw",
        detail: e instanceof Error ? e.message : "threw",
      };
    }
  }

  if (args.resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: args.to,
          subject: args.subject,
          text: args.text,
        }),
      });
      if (res.ok) return { ok: true, provider: "resend" };
      const detail = await res.text();
      console.error("[app-ticket-notify] Resend non-OK", res.status, detail);
      return { ok: false, reason: "resend_failed", detail };
    } catch (e) {
      console.error("[app-ticket-notify] Resend threw", e);
      return {
        ok: false,
        reason: "resend_threw",
        detail: e instanceof Error ? e.message : "threw",
      };
    }
  }

  return { ok: false, reason: "mailer_not_configured" };
}

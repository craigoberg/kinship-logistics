/**
 * Hub App tickets — mailto update to the person who raised the ticket.
 * Same production stance as Council: prefill the operator's mail client;
 * they edit or send. Not Postmark (that path is office notify on create).
 */
import { formatDateTime } from "@/lib/utils";
import {
  buildCouncilMailto,
  openCouncilMailto,
} from "@/lib/api/site-issues";
import {
  getStaffEmailByFullName,
  getStaffEmailById,
} from "@/lib/data-store";
import type { AppTicket } from "@/lib/api/app-tickets";

export type AppTicketUpdateKind = "note" | "defer" | "resolve";

const MAX_BODY_CHARS = 1600;

export async function resolveAppTicketOpenerEmail(
  ticket: AppTicket,
): Promise<string | null> {
  const byId = await getStaffEmailById(ticket.reportedByStaffId);
  if (byId) return byId;
  return getStaffEmailByFullName(ticket.reportedByName);
}

function trimBody(text: string): string {
  if (text.length <= MAX_BODY_CHARS) return text;
  return `${text.slice(0, MAX_BODY_CHARS - 40).trimEnd()}\n\n…(earlier notes omitted)`;
}

export function buildAppTicketOpenerUpdateBody(args: {
  ticket: AppTicket;
  kind: AppTicketUpdateKind;
  latestText: string;
  priorTimelineLines: string[];
}): string {
  const { ticket, kind, latestText, priorTimelineLines } = args;
  const latestLabel =
    kind === "resolve"
      ? "Resolved"
      : kind === "defer"
        ? "Deferred"
        : "Latest note";
  const form = ticket.formTitle?.trim() || "—";
  const raised = formatDateTime(ticket.createdAt);

  const notesBlock =
    priorTimelineLines.length > 0
      ? priorTimelineLines.join("\n")
      : "(No earlier notes.)";

  return trimBody(
    [
      `Hi ${ticket.reportedByName},`,
      "",
      "This is an update on the app ticket you raised in Yada Connect. You can reply to this email if you have more to add.",
      "",
      `${latestLabel}:`,
      latestText.trim(),
      "",
      "—",
      `Ticket: ${ticket.title}`,
      `Screen: ${ticket.pathLabel}`,
      `Form: ${form}`,
      `Raised: ${raised} by ${ticket.reportedByName}`,
      "",
      "What you reported:",
      ticket.description.trim(),
      "",
      "Notes so far:",
      notesBlock,
      "",
      "—",
      "Yada Connect · Hub → App tickets",
    ].join("\n"),
  );
}

export function appTicketOpenerUpdateSubject(
  ticket: AppTicket,
  kind: AppTicketUpdateKind,
): string {
  const prefix = kind === "resolve" ? "App ticket resolved" : "App ticket update";
  return `${prefix} — ${ticket.title}`.slice(0, 140);
}

/**
 * Opens a prefilled mailto to the ticket opener. Does not throw on missing email.
 */
export async function openAppTicketOpenerUpdateMailto(args: {
  ticket: AppTicket;
  kind: AppTicketUpdateKind;
  latestText: string;
  priorTimelineLines: string[];
}): Promise<{ opened: boolean; to: string | null }> {
  const to = await resolveAppTicketOpenerEmail(args.ticket);
  if (!to) return { opened: false, to: null };
  const mailto = buildCouncilMailto(
    to,
    appTicketOpenerUpdateSubject(args.ticket, args.kind),
    buildAppTicketOpenerUpdateBody(args),
  );
  openCouncilMailto(mailto);
  return { opened: true, to };
}

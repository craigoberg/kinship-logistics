/**
 * Public / Connect voice forms land in operational_incidents tagged
 * `[PUBLIC FORM · …]`. Hub display must not treat them as floor Incidents.
 */

export const PUBLIC_WEB_HUB_LABEL = "Public web";
export const PUBLIC_WEB_HUB_BADGE = "bg-indigo-600 text-white";

const ISSUE_PREVIEW_CHARS = 140;

const TYPE_LABELS: Record<string, string> = {
  COMPLAINT: "Complaint",
  ENQUIRY: "Enquiry",
  FEEDBACK: "Feedback",
  COMPLIMENT: "Compliment",
  VOLUNTEER_INTEREST: "Volunteer EOI",
  VOLUNTEER_EOI: "Volunteer EOI",
  VOLUNTEER: "Volunteer EOI",
  WHISTLEBLOW: "Whistleblow",
};

export interface PublicFormHubParsed {
  formTypeRaw: string;
  formTypeLabel: string;
  referenceCode: string | null;
  channel: string | null;
  from: string | null;
  message: string;
}

export function isPublicFormHubText(text: string | null | undefined): boolean {
  return /\[PUBLIC FORM\s*[·\-–—]\s*/i.test(text ?? "");
}

function titleCaseType(raw: string): string {
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parsePublicFormHubText(
  text: string | null | undefined,
): PublicFormHubParsed | null {
  const src = (text ?? "").trim();
  if (!src) return null;
  const tag = src.match(/^\[PUBLIC FORM\s*[·\-–—]\s*([^\]]+)\](?:\s+(\S+))?/i);
  if (!tag) return null;

  const formTypeRaw = tag[1].trim();
  const key = formTypeRaw.toUpperCase().replace(/\s+/g, "_");
  const formTypeLabel = TYPE_LABELS[key] ?? titleCaseType(formTypeRaw);

  const rest = src.slice(tag[0].length).replace(/^\s+/, "");
  const yada = rest.match(/\bYADA-[A-Z]+-\d{8}-\d+\b/i)?.[0] ?? null;
  const referenceCode =
    tag[2] && /^YADA-/i.test(tag[2]) ? tag[2] : yada ?? tag[2] ?? null;

  const lines = rest.split(/\r?\n/);
  let channel: string | null = null;
  let from: string | null = null;
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  while (i < lines.length && lines[i].trim()) {
    const line = lines[i];
    const ch = line.match(/^Channel:\s*(.+)$/i);
    const fr = line.match(/^From:\s*(.+)$/i);
    if (ch) channel = ch[1].trim();
    else if (fr) from = fr[1].trim();
    else if (!/^(Email|Phone|Preferred contact|Relates to|Organisation):/i.test(line)) {
      break;
    }
    i++;
  }
  while (i < lines.length && !lines[i].trim()) i++;

  const message = lines.slice(i).join("\n").trim();

  return {
    formTypeRaw,
    formTypeLabel,
    referenceCode,
    channel,
    from,
    message,
  };
}

export function publicFormIssuePreviewTitle(
  parsed: PublicFormHubParsed,
  max = ISSUE_PREVIEW_CHARS,
): string {
  const body = parsed.message.replace(/\s+/g, " ").trim();
  if (!body) return `${parsed.formTypeLabel}: (no message)`;
  const clipped = body.length <= max ? body : `${body.slice(0, max).trimEnd()}…`;
  return `${parsed.formTypeLabel}: ${clipped}`;
}

export function publicFormHubDisplay(
  description: string,
  opts?: { deferred?: boolean },
): { title: string; sourceLabel: string } | null {
  const parsed = parsePublicFormHubText(description);
  if (!parsed) return null;
  return {
    title: publicFormIssuePreviewTitle(parsed),
    sourceLabel: opts?.deferred
      ? `${PUBLIC_WEB_HUB_LABEL} · Deferred`
      : PUBLIC_WEB_HUB_LABEL,
  };
}

export function formatPublicFormManageBody(parsed: PublicFormHubParsed): string {
  return parsed.message.trim();
}

export function publicFormLocationLabel(channel: string | null): string {
  if (channel === "connect") return "Connect (Rights & voice)";
  return "Public website";
}

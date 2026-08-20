/** Admin + server helpers for App ticket email notify (BL-116). */

export const APP_TICKET_NOTIFY_PARAM_KEYS = [
  "app_tickets.notify_to",
  "app_tickets.notify_from",
] as const;

export const APP_TICKET_NOTIFY_TO_KEY = "app_tickets.notify_to";
export const APP_TICKET_NOTIFY_FROM_KEY = "app_tickets.notify_from";

export function looksLikeEmail(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v.includes("@") && v.length >= 5 && !v.includes(" ");
}

/** Split comma/semicolon To list; drop blanks. */
export function parseNotifyEmailList(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") parts.push(item);
    }
  } else if (typeof raw === "string") {
    parts.push(...raw.split(/[,;]+/));
  } else if (raw != null) {
    parts.push(String(raw));
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const email = p.trim();
    if (!looksLikeEmail(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export function jsonbParamString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

/**
 * Public CMS HTML allowlist — office WYSIWYG + public render.
 * Scripts, event handlers, and non-YouTube iframes are stripped.
 */
import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p",
  "br",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
  "iframe",
  "blockquote",
  "hr",
  "div",
  "span",
];

const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "allow",
  "allowfullscreen",
  "frameborder",
  "loading",
  "colspan",
  "rowspan",
  "class",
];

let hooksInstalled = false;

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Safe href for page links: site path, hash, mailto, or http(s). */
export function isUsableCmsUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t.startsWith("/") && !t.startsWith("//")) return true;
  if (t.startsWith("#")) return true;
  if (t.startsWith("mailto:")) return t.length > 7 && !t.includes(" ");
  return isHttpUrl(t);
}

export function isYoutubePageUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return /^(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(
      u.hostname,
    );
  } catch {
    return false;
  }
}

function isYoutubeEmbedSrc(src: string): boolean {
  try {
    const u = new URL(src);
    return (
      /^(www\.)?(youtube\.com|youtube-nocookie\.com)$/i.test(u.hostname) &&
      u.pathname.startsWith("/embed/")
    );
  } catch {
    return false;
  }
}

function ensureHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe") return;
    const src = (node as Element).getAttribute("src") ?? "";
    if (!isYoutubeEmbedSrc(src)) {
      node.parentNode?.removeChild(node);
    }
  });

  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "href" && !isUsableCmsUrl(data.attrValue)) {
      data.keepAttr = false;
    }
    if (
      data.attrName === "src" &&
      node.nodeName === "IMG" &&
      !isHttpUrl(data.attrValue)
    ) {
      data.keepAttr = false;
    }
  });
}

export function sanitizeCmsHtml(dirty: string): string {
  ensureHooks();
  return DOMPurify.sanitize(dirty ?? "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ["script", "style", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

/**
 * Staff-only SharePoint URLs will 401 for public visitors.
 * Guest / anonymous / sharing links are left alone.
 */
export function sharePointPublicAccessWarning(url: string): string | null {
  let hostname = "";
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname.includes("sharepoint.com")) return null;
  const looksPublic =
    /:g:|:u:|guestaccess|share=|download=1|:b:/i.test(url);
  if (looksPublic) return null;
  return "This looks like a staff-only SharePoint link. People on yada.org.au will not be able to open it. Use a guest/anonymous or public URL.";
}

export const CMS_PROSE_CLASS =
  "[&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:underline [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1.5 [&_iframe]:my-4 [&_iframe]:aspect-video [&_iframe]:h-auto [&_iframe]:w-full [&_iframe]:max-w-full [&_[data-youtube-video]]:my-4 [&_[data-youtube-video]]:w-full [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic";

/**
 * BL-110 — CMS pages / nav / media / publish snapshots for yada.org.au
 */
import { supabase } from "@/integrations/supabase/client";
import { resolveStaffIdWithFallback } from "@/lib/data-store";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

const SCHEMA_HINT =
  "CMS tables missing — run docs/sql/2026-08-10_public_cms_and_forms.sql then hard refresh.";

export type CmsPageStatus = "draft" | "published" | "archived";

export type CmsBlock =
  | { type: "hero"; headline: string; sub?: string; ctas?: { label: string; href: string }[] }
  | { type: "richtext"; html: string }
  | { type: "form"; formKey: string }
  | { type: "cta"; label: string; href: string };

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  bodyBlocks: CmsBlock[];
  navLabel: string | null;
  navOrder: number;
  showInNav: boolean;
  easyRead: boolean;
  status: CmsPageStatus;
  publishedAt: string | null;
  updatedAt: string;
}

export interface CmsNavItem {
  id: string;
  label: string;
  href: string;
  sortOrder: number;
  visible: boolean;
}

export interface CmsMediaItem {
  id: string;
  title: string;
  url: string;
  kind: string;
  altText: string | null;
}

function throwSchema(err: unknown): never {
  if (
    isSchemaMismatchError(err) ||
    /cms_|Could not find the table/i.test(String((err as Error)?.message ?? err))
  ) {
    throw new Error(SCHEMA_HINT);
  }
  throw err;
}

function mapPage(r: Record<string, unknown>): CmsPage {
  return {
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
    summary: (r.summary as string | null) ?? null,
    bodyBlocks: Array.isArray(r.body_blocks)
      ? (r.body_blocks as CmsBlock[])
      : [],
    navLabel: (r.nav_label as string | null) ?? null,
    navOrder: Number(r.nav_order ?? 100),
    showInNav: Boolean(r.show_in_nav),
    easyRead: Boolean(r.easy_read),
    status: r.status as CmsPageStatus,
    publishedAt: (r.published_at as string | null) ?? null,
    updatedAt: String(r.updated_at ?? r.created_at),
  };
}

export async function listCmsPages(args?: {
  status?: CmsPageStatus;
}): Promise<CmsPage[]> {
  let q = supabase.from("cms_pages").select("*").order("nav_order");
  if (args?.status) q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) throwSchema(error);
  return (data ?? []).map((r) => mapPage(r as Record<string, unknown>));
}

export async function getPublishedPageBySlug(
  slug: string,
): Promise<CmsPage | null> {
  const { data, error } = await supabase
    .from("cms_pages")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throwSchema(error);
  return data ? mapPage(data as Record<string, unknown>) : null;
}

export async function upsertCmsPage(
  input: Partial<CmsPage> & { slug: string; title: string },
): Promise<CmsPage> {
  const actor = await resolveStaffIdWithFallback().catch(() => null);
  const row = {
    slug: input.slug,
    title: input.title,
    summary: input.summary ?? null,
    body_blocks: input.bodyBlocks ?? [],
    nav_label: input.navLabel ?? input.title,
    nav_order: input.navOrder ?? 100,
    show_in_nav: input.showInNav ?? true,
    easy_read: input.easyRead ?? false,
    status: input.status ?? "draft",
    published_at:
      input.status === "published"
        ? input.publishedAt ?? new Date().toISOString()
        : input.publishedAt ?? null,
    updated_by_staff_id: actor,
  };
  const { data, error } = await supabase
    .from("cms_pages")
    .upsert(row, { onConflict: "slug" })
    .select("*")
    .single();
  if (error) throwSchema(error);
  return mapPage(data as Record<string, unknown>);
}

export async function setCmsPageStatus(
  id: string,
  status: CmsPageStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "published") patch.published_at = new Date().toISOString();
  const { error } = await supabase.from("cms_pages").update(patch).eq("id", id);
  if (error) throwSchema(error);
}

export async function listCmsNav(visibleOnly = false): Promise<CmsNavItem[]> {
  let q = supabase.from("cms_nav").select("*").order("sort_order");
  if (visibleOnly) q = q.eq("visible", true);
  const { data, error } = await q;
  if (error) throwSchema(error);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      label: String(row.label),
      href: String(row.href),
      sortOrder: Number(row.sort_order ?? 100),
      visible: Boolean(row.visible),
    };
  });
}

export async function upsertCmsNavItem(
  item: Partial<CmsNavItem> & { label: string; href: string },
): Promise<void> {
  if (item.id) {
    const { error } = await supabase
      .from("cms_nav")
      .update({
        label: item.label,
        href: item.href,
        sort_order: item.sortOrder ?? 100,
        visible: item.visible ?? true,
      })
      .eq("id", item.id);
    if (error) throwSchema(error);
    return;
  }
  const { error } = await supabase.from("cms_nav").insert({
    label: item.label,
    href: item.href,
    sort_order: item.sortOrder ?? 100,
    visible: item.visible ?? true,
  });
  if (error) throwSchema(error);
}

export async function listCmsMedia(): Promise<CmsMediaItem[]> {
  const { data, error } = await supabase
    .from("cms_media")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throwSchema(error);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      title: String(row.title),
      url: String(row.url),
      kind: String(row.kind),
      altText: (row.alt_text as string | null) ?? null,
    };
  });
}

export async function addCmsMedia(input: {
  title: string;
  url: string;
  kind?: string;
  altText?: string;
}): Promise<void> {
  const { error } = await supabase.from("cms_media").insert({
    title: input.title.trim(),
    url: input.url.trim(),
    kind: input.kind ?? "link",
    alt_text: input.altText?.trim() || null,
  });
  if (error) throwSchema(error);
}

/** Publish snapshot of all currently published pages + nav for public consumers. */
export async function publishCmsSnapshot(notes?: string): Promise<string> {
  const [pages, nav] = await Promise.all([
    listCmsPages({ status: "published" }),
    listCmsNav(true),
  ]);
  const actor = await resolveStaffIdWithFallback().catch(() => null);
  const payload = {
    pages,
    nav,
    publishedAt: new Date().toISOString(),
    domains: {
      public: "yada.org.au",
      connect: "connect.yada.org.au",
    },
  };
  const { data, error } = await supabase
    .from("cms_publish_snapshots")
    .insert({
      payload,
      published_by_staff_id: actor,
      notes: notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throwSchema(error);
  return String((data as { id: string }).id);
}

export async function getLatestPublishSnapshot(): Promise<{
  id: string;
  publishedAt: string;
  payload: unknown;
} | null> {
  const { data, error } = await supabase
    .from("cms_publish_snapshots")
    .select("id, published_at, payload")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwSchema(error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    publishedAt: String(row.published_at),
    payload: row.payload,
  };
}

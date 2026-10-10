import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Globe, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CmsRichTextEditor } from "@/components/admin/cms-rich-text-editor";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  addCmsMedia,
  getLatestPublishSnapshot,
  listCmsMedia,
  listCmsNav,
  listCmsPages,
  publishCmsSnapshot,
  setCmsPageStatus,
  upsertCmsNavItem,
  upsertCmsPage,
  type CmsMediaItem,
  type CmsNavItem,
  type CmsPage,
} from "@/lib/api/public-cms";
import {
  listPublicFormDefinitions,
  listPublicFormSubmissions,
  updateFormDefinitionFlags,
  type PublicFormDefinition,
  type PublicFormSubmission,
} from "@/lib/api/public-forms";
import { FormattedDate } from "@/components/ui/formatted-time";
import { isActiveUserManager } from "@/lib/data-store";
import { sanitizeCmsHtml } from "@/lib/cms/sanitize-html";

/**
 * BL-110 / BL-111 — Admin CMS for yada.org.au + form enablement + submission log.
 */
type WebsiteTab = "pages" | "nav" | "media" | "forms" | "subs";

export function PublicWebsiteWorkspace() {
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [nav, setNav] = useState<CmsNavItem[]>([]);
  const [media, setMedia] = useState<CmsMediaItem[]>([]);
  const [forms, setForms] = useState<PublicFormDefinition[]>([]);
  const [subs, setSubs] = useState<PublicFormSubmission[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<WebsiteTab>("pages");
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editHtml, setEditHtml] = useState("");
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const isManager = isActiveUserManager();

  const reload = useCallback(async (opts?: { quiet?: boolean }) => {
    // Full loading spinner unmounts Tabs — only use on first load.
    if (!opts?.quiet) setLoading(true);
    try {
      const [p, n, m, f, s, snap] = await Promise.all([
        listCmsPages(),
        listCmsNav(false),
        listCmsMedia(),
        listPublicFormDefinitions(),
        listPublicFormSubmissions(50),
        getLatestPublishSnapshot(),
      ]);
      setPages(p);
      setNav(n);
      setMedia(m);
      setForms(f);
      setSubs(s);
      setSnapshotAt(snap?.publishedAt ?? null);
    } catch (e) {
      toast.error("Could not load public website data", {
        description: (e as Error).message,
      });
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startEdit = (page: CmsPage) => {
    setEditSlug(page.slug);
    setEditTitle(page.title);
    const rich = page.bodyBlocks.find((b) => b.type === "richtext");
    setEditHtml(rich && rich.type === "richtext" ? rich.html : "");
  };

  const savePage = async () => {
    if (!editSlug) return;
    const existing = pages.find((p) => p.slug === editSlug);
    try {
      const html = sanitizeCmsHtml(editHtml);
      const blocks = (existing?.bodyBlocks ?? []).map((b) =>
        b.type === "richtext" ? { ...b, html } : b,
      );
      if (!blocks.some((b) => b.type === "richtext")) {
        blocks.push({ type: "richtext", html });
      }
      await upsertCmsPage({
        slug: editSlug,
        title: editTitle,
        summary: existing?.summary ?? null,
        bodyBlocks: blocks,
        navLabel: existing?.navLabel ?? editTitle,
        navOrder: existing?.navOrder ?? 100,
        showInNav: existing?.showInNav ?? true,
        easyRead: existing?.easyRead ?? false,
        status: existing?.status ?? "draft",
        publishedAt: existing?.publishedAt,
      });
      toast.success("Page saved");
      await reload({ quiet: true });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    }
  };

  const publishAll = async () => {
    try {
      for (const p of pages) {
        if (p.status !== "published") {
          await setCmsPageStatus(p.id, "published");
        }
      }
      const id = await publishCmsSnapshot("Admin publish from Connect");
      toast.success("Published snapshot", { description: id.slice(0, 8) });
      await reload({ quiet: true });
    } catch (e) {
      toast.error("Publish failed", { description: (e as Error).message });
    }
  };

  if (!isManager) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Manager-only — public website CMS.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Globe className="h-5 w-5" />
            Public website
          </h2>
          <p className="text-sm text-muted-foreground">
            Content for <strong>yada.org.au</strong> is managed here. CRM stays
            on <strong>connect.yada.org.au</strong>. Preview:{" "}
            <a
              href="/public"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              /public <ExternalLink className="h-3 w-3" />
            </a>
            {snapshotAt ? (
              <>
                {" "}
                · Last snapshot <FormattedDate value={snapshotAt.slice(0, 10)} />
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => void reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1"
            onClick={() => void publishAll()}
          >
            <Upload className="h-3.5 w-3.5" />
            Publish
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as WebsiteTab)}
        >
          <TabsList>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="nav">Navigation</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="forms">Forms</TabsTrigger>
            <TabsTrigger value="subs">Submissions</TabsTrigger>
          </TabsList>

          <TabsContent value="pages" className="space-y-3 pt-3">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Slug</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{p.slug}</td>
                      <td className="px-3 py-2">{p.title}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{p.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(p)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editSlug ? (
              <div className="space-y-2 rounded-lg border p-4">
                <p className="text-sm font-medium">
                  Editing <code>{editSlug}</code>
                </p>
                <div className="space-y-1">
                  <Label>Title</Label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
                <CmsRichTextEditor
                  key={editSlug}
                  value={editHtml}
                  onChange={setEditHtml}
                  media={media}
                  onMediaChange={() => reload({ quiet: true })}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setEditSlug(null)}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void savePage()}>
                    Save page
                  </Button>
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="nav" className="space-y-3 pt-3">
            <ul className="space-y-2">
              {nav.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{n.label}</span>
                  <code className="text-xs text-muted-foreground">{n.href}</code>
                  <label className="ml-auto flex items-center gap-2 text-xs">
                    Visible
                    <Switch
                      checked={n.visible}
                      onCheckedChange={(v) => {
                        void upsertCmsNavItem({
                          id: n.id,
                          label: n.label,
                          href: n.href,
                          sortOrder: n.sortOrder,
                          visible: !!v,
                        }).then(() => reload({ quiet: true }));
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Phase 2: full nav builder. Domain cutover maps{" "}
              <code>/public</code> → <code>yada.org.au</code>.
            </p>
          </TabsContent>

          <TabsContent value="media" className="space-y-3 pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={mediaTitle}
                  onChange={(e) => setMediaTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>URL (SharePoint or public link)</Label>
                <Input
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!mediaTitle.trim() || !mediaUrl.trim()}
              onClick={() => {
                void addCmsMedia({
                  title: mediaTitle,
                  url: mediaUrl,
                  kind: "link",
                })
                  .then(() => {
                    setMediaTitle("");
                    setMediaUrl("");
                    toast.success("Media link added");
                    return reload({ quiet: true });
                  })
                  .catch((e) =>
                    toast.error("Add failed", {
                      description: (e as Error).message,
                    }),
                  );
              }}
            >
              Add media link
            </Button>
            <ul className="space-y-1 text-sm">
              {media.map((m) => (
                <li key={m.id}>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {m.title}
                  </a>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="forms" className="space-y-3 pt-3">
            {forms.map((f) => (
              <div
                key={f.formKey}
                className="flex flex-wrap items-center gap-4 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-[10rem] font-medium">{f.title}</div>
                <label className="flex items-center gap-2 text-xs">
                  Public
                  <Switch
                    checked={f.enabledPublic}
                    onCheckedChange={(v) => {
                      void updateFormDefinitionFlags(f.formKey, {
                        enabledPublic: !!v,
                      }).then(() => reload({ quiet: true }));
                    }}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  Connect
                  <Switch
                    checked={f.enabledConnect}
                    onCheckedChange={(v) => {
                      void updateFormDefinitionFlags(f.formKey, {
                        enabledConnect: !!v,
                      }).then(() => reload({ quiet: true }));
                    }}
                  />
                </label>
                {f.allowAnonymous ? (
                  <Badge variant="outline">Anon OK</Badge>
                ) : null}
              </div>
            ))}
          </TabsContent>

          <TabsContent value="subs" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Triage and resolve in Governance Hub (Human incidents). Reference
              codes link the rows.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Ref</th>
                    <th className="px-3 py-2">Form</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-muted-foreground"
                      >
                        No submissions yet.
                      </td>
                    </tr>
                  ) : (
                    subs.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">
                          {s.referenceCode}
                        </td>
                        <td className="px-3 py-2">{s.formKey}</td>
                        <td className="px-3 py-2">{s.channel}</td>
                        <td className="px-3 py-2">
                          {s.isAnonymous
                            ? "Anonymous"
                            : s.submitterName ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <FormattedDate value={s.createdAt.slice(0, 10)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

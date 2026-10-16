import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addCmsMedia, type CmsMediaItem } from "@/lib/api/public-cms";
import {
  isUsableCmsUrl,
  sharePointPublicAccessWarning,
} from "@/lib/cms/sanitize-html";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "image", label: "Image" },
  { value: "pdf", label: "PDF / document" },
  { value: "link", label: "Link" },
] as const;

type MediaKind = (typeof KINDS)[number]["value"];

interface Props {
  open: boolean;
  media: CmsMediaItem[];
  onClose: () => void;
  onMediaChange: () => void | Promise<void>;
  onInsert: (item: CmsMediaItem) => void;
}

export function CmsMediaLibraryDialog({
  open,
  media,
  onClose,
  onMediaChange,
  onInsert,
}: Props) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<MediaKind>("link");
  const [saving, setSaving] = useState(false);

  const titleOk = title.trim().length >= 2;
  const urlOk = isUsableCmsUrl(url);
  const shareWarn = sharePointPublicAccessWarning(url);
  const missing = useMemo(() => {
    const rows: string[] = [];
    if (!titleOk) rows.push("Title");
    if (!urlOk) rows.push("URL");
    return rows;
  }, [titleOk, urlOk]);

  const resetAdd = () => {
    setTitle("");
    setUrl("");
    setKind("link");
  };

  const addAndKeep = async () => {
    if (missing.length) return;
    setSaving(true);
    try {
      await addCmsMedia({
        title: title.trim(),
        url: url.trim(),
        kind,
      });
      toast.success("Saved to media library");
      resetAdd();
      await onMediaChange();
    } catch (e) {
      toast.error("Could not add media", {
        description: (e as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Media library</DialogTitle>
          <DialogDescription>
            Save a public URL once, then insert it on any page. File upload
            from here is later (SharePoint — BL-119).
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Add a URL</p>
            <CharacterCountedInput
              label="Title"
              value={title}
              onValueChange={setTitle}
              minChars={2}
              maxChars={120}
            />
            <div className="space-y-1">
              <Label htmlFor="cms-lib-url">
                URL
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input
                id="cms-lib-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className={requiredFieldOutline(!urlOk)}
                aria-invalid={!urlOk || undefined}
              />
            </div>
            <div className="space-y-1">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as MediaKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {shareWarn ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                {shareWarn}
              </p>
            ) : null}
            {missing.length ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Still needed: {missing.join(" · ")}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={missing.length > 0 || saving}
                onClick={() => void addAndKeep()}
              >
                Add to library
              </Button>
            </div>
          </div>

          <ul className="space-y-2">
            {media.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                No saved media yet. Add a title and public URL above.
              </li>
            ) : (
              media.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.kind} · {item.url}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onInsert(item)}
                  >
                    Insert
                  </Button>
                </li>
              ))
            )}
          </ul>
        </div>
        <DialogFooter className={cn("sm:justify-start")}>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
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
import { requiredFieldOutline } from "@/lib/ui/required-field";
import {
  isUsableCmsUrl,
  isYoutubePageUrl,
  sharePointPublicAccessWarning,
} from "@/lib/cms/sanitize-html";
import { cn } from "@/lib/utils";

export type CmsInsertKind = "link" | "image" | "document" | "youtube";

interface Props {
  open: boolean;
  kind: CmsInsertKind;
  initialLabel?: string;
  initialUrl?: string;
  onClose: () => void;
  onInsert: (payload: { label: string; url: string }) => void;
  onPickFromLibrary?: () => void;
}

const COPY: Record<
  CmsInsertKind,
  { title: string; description: string; labelField: string | null; urlField: string }
> = {
  link: {
    title: "Insert link",
    description: "Type the words people will tap, then paste the web address.",
    labelField: "Link text",
    urlField: "Web address",
  },
  image: {
    title: "Insert image",
    description: "Paste a public image URL. Visitors must be able to open it without signing in.",
    labelField: "Alt text",
    urlField: "Image URL",
  },
  document: {
    title: "Insert document",
    description: "Paste a public PDF or file URL. This becomes a named link on the page.",
    labelField: "Link text",
    urlField: "File URL",
  },
  youtube: {
    title: "Insert YouTube",
    description: "Paste a YouTube watch or youtu.be link. It will embed on the public page.",
    labelField: null,
    urlField: "YouTube URL",
  },
};

export function CmsInsertUrlDialog({
  open,
  kind,
  initialLabel = "",
  initialUrl = "",
  onClose,
  onInsert,
  onPickFromLibrary,
}: Props) {
  const copy = COPY[kind];
  const [label, setLabel] = useState(initialLabel);
  const [url, setUrl] = useState(initialUrl);

  useEffect(() => {
    if (!open) return;
    setLabel(initialLabel);
    setUrl(initialUrl);
  }, [open, initialLabel, initialUrl, kind]);

  const urlOk =
    kind === "youtube" ? isYoutubePageUrl(url) : isUsableCmsUrl(url);
  const labelOk = copy.labelField ? label.trim().length >= 2 : true;
  const shareWarn = sharePointPublicAccessWarning(url);
  const missing = useMemo(() => {
    const rows: string[] = [];
    if (copy.labelField && !labelOk) rows.push(copy.labelField);
    if (!urlOk) rows.push(copy.urlField);
    return rows;
  }, [copy.labelField, copy.urlField, labelOk, urlOk]);

  const canInsert = missing.length === 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {copy.labelField ? (
            <CharacterCountedInput
              label={copy.labelField}
              value={label}
              onValueChange={setLabel}
              minChars={2}
              maxChars={160}
            />
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="cms-insert-url">
              {copy.urlField}
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              id="cms-insert-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                kind === "youtube"
                  ? "https://www.youtube.com/watch?v=…"
                  : "https://…"
              }
              className={requiredFieldOutline(!urlOk)}
              aria-invalid={!urlOk || undefined}
            />
          </div>
          {shareWarn ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              {shareWarn}
            </p>
          ) : null}
          {!canInsert ? (
            <p
              className={cn(
                "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive",
              )}
            >
              Still needed: {missing.join(" · ")}
            </p>
          ) : null}
          {onPickFromLibrary && kind !== "youtube" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPickFromLibrary}
            >
              Pick from media library
            </Button>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            disabled={!canInsert}
            onClick={() =>
              onInsert({ label: label.trim(), url: url.trim() })
            }
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import { TableKit } from "@tiptap/extension-table";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  FileText,
  Image as ImageIcon,
  Italic,
  Library,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  Youtube as YoutubeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import type { CmsMediaItem } from "@/lib/api/public-cms";
import { CMS_PROSE_CLASS, sanitizeCmsHtml } from "@/lib/cms/sanitize-html";
import { cn } from "@/lib/utils";
import {
  CmsInsertUrlDialog,
  type CmsInsertKind,
} from "@/components/admin/cms-insert-url-dialog";
import { CmsMediaLibraryDialog } from "@/components/admin/cms-media-library-dialog";

interface Props {
  value: string;
  onChange: (html: string) => void;
  media: CmsMediaItem[];
  onMediaChange: () => void | Promise<void>;
}

type EditorMode = "visual" | "html";

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, " ").trim();
}

function isInternalHref(href: string): boolean {
  return href.startsWith("/") || href.startsWith("#");
}

function insertNamedLink(editor: Editor, href: string, label: string) {
  const text = label.trim() || href;
  const { empty } = editor.state.selection;
  if (!empty && editor.state.selection.from !== editor.state.selection.to) {
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({
        href,
        target: isInternalHref(href) ? null : "_blank",
      })
      .run();
    return;
  }
  editor
    .chain()
    .focus()
    .insertContent({
      type: "text",
      text,
      marks: [
        {
          type: "link",
          attrs: {
            href,
            target: isInternalHref(href) ? null : "_blank",
          },
        },
      ],
    })
    .run();
}

function insertMediaItem(editor: Editor, item: CmsMediaItem) {
  if (item.kind === "image") {
    editor
      .chain()
      .focus()
      .setImage({ src: item.url, alt: item.altText || item.title })
      .run();
    return;
  }
  insertNamedLink(editor, item.url, item.title);
}

function headingValue(editor: Editor | null): string {
  if (!editor) return "p";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  return "p";
}

export function CmsRichTextEditor({
  value,
  onChange,
  media,
  onMediaChange,
}: Props) {
  const [mode, setMode] = useState<EditorMode>("visual");
  const [htmlDraft, setHtmlDraft] = useState(value);
  const [insertKind, setInsertKind] = useState<CmsInsertKind | null>(null);
  const [insertSeed, setInsertSeed] = useState({ label: "", url: "" });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryMode, setLibraryMode] = useState<"insert" | "fill">("insert");

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Youtube.configure({
        nocookie: true,
        width: 640,
        height: 360,
        modestBranding: true,
        controls: true,
      }),
      TableKit.configure({
        table: { resizable: false },
      }),
    ],
    content: value || "<p></p>",
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[16rem] outline-none",
          CMS_PROSE_CLASS,
          "[&_a]:text-[#0077a8]",
        ),
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  useEffect(() => {
    if (mode === "html") {
      setHtmlDraft(value);
      return;
    }
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
    }
  }, [value, editor, mode]);

  const applyHeading = (next: string) => {
    if (!editor) return;
    if (next === "h2") {
      editor.chain().focus().setHeading({ level: 2 }).run();
    } else if (next === "h3") {
      editor.chain().focus().setHeading({ level: 3 }).run();
    } else {
      editor.chain().focus().setParagraph().run();
    }
  };

  const switchMode = (next: string) => {
    const dest = next as EditorMode;
    if (dest === mode) return;
    if (dest === "html") {
      const html = editor?.getHTML() ?? value;
      setHtmlDraft(html);
      onChange(html);
      setMode("html");
      return;
    }
    const clean = sanitizeCmsHtml(htmlDraft);
    setHtmlDraft(clean);
    editor?.commands.setContent(clean || "<p></p>", { emitUpdate: true });
    onChange(clean);
    setMode("visual");
  };

  const openInsert = (kind: CmsInsertKind) => {
    setInsertSeed({
      label: editor ? selectedText(editor) : "",
      url: "",
    });
    setInsertKind(kind);
  };

  const handleInsert = (payload: { label: string; url: string }) => {
    if (!editor) return;
    if (insertKind === "image") {
      editor
        .chain()
        .focus()
        .setImage({ src: payload.url, alt: payload.label })
        .run();
    } else if (insertKind === "youtube") {
      editor.chain().focus().setYoutubeVideo({ src: payload.url }).run();
    } else {
      insertNamedLink(editor, payload.url, payload.label);
    }
    setInsertKind(null);
  };

  const handleLibraryInsert = (item: CmsMediaItem) => {
    if (libraryMode === "fill" && insertKind) {
      setInsertSeed({ label: item.title, url: item.url });
      setLibraryOpen(false);
      return;
    }
    if (editor) insertMediaItem(editor, item);
    setLibraryOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Page body</p>
        <Tabs value={mode} onValueChange={switchMode}>
          <TabsList>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="html">HTML</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {mode === "visual" ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!editor?.can().undo()}
              onClick={() => editor?.chain().focus().undo().run()}
              aria-label="Undo"
              title="Undo"
            >
              <Undo2 />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!editor?.can().redo()}
              onClick={() => editor?.chain().focus().redo().run()}
              aria-label="Redo"
              title="Redo"
            >
              <Redo2 />
            </Button>
            <Select
              value={headingValue(editor)}
              onValueChange={applyHeading}
            >
              <SelectTrigger className="h-8 w-[8.5rem] text-xs">
                <SelectValue placeholder="Paragraph" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="p">Paragraph</SelectItem>
                <SelectItem value="h2">Heading</SelectItem>
                <SelectItem value="h3">Subheading</SelectItem>
              </SelectContent>
            </Select>
            <Toggle
              size="sm"
              pressed={!!editor?.isActive("bold")}
              onPressedChange={() => editor?.chain().focus().toggleBold().run()}
              aria-label="Bold"
              title="Bold"
            >
              <Bold />
            </Toggle>
            <Toggle
              size="sm"
              pressed={!!editor?.isActive("italic")}
              onPressedChange={() =>
                editor?.chain().focus().toggleItalic().run()
              }
              aria-label="Italic"
              title="Italic"
            >
              <Italic />
            </Toggle>
            <Toggle
              size="sm"
              pressed={!!editor?.isActive("underline")}
              onPressedChange={() =>
                editor?.chain().focus().toggleUnderline().run()
              }
              aria-label="Underline"
              title="Underline"
            >
              <UnderlineIcon />
            </Toggle>
            <Toggle
              size="sm"
              pressed={!!editor?.isActive("bulletList")}
              onPressedChange={() =>
                editor?.chain().focus().toggleBulletList().run()
              }
              aria-label="Bulleted list"
              title="Bulleted list"
            >
              <List />
            </Toggle>
            <Toggle
              size="sm"
              pressed={!!editor?.isActive("orderedList")}
              onPressedChange={() =>
                editor?.chain().focus().toggleOrderedList().run()
              }
              aria-label="Numbered list"
              title="Numbered list"
            >
              <ListOrdered />
            </Toggle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openInsert("link")}
              aria-label="Insert link"
              title="Insert link"
            >
              <Link2 />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openInsert("image")}
              aria-label="Insert image"
              title="Insert image"
            >
              <ImageIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openInsert("document")}
              aria-label="Insert document"
              title="Insert document"
            >
              <FileText />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openInsert("youtube")}
              aria-label="Insert YouTube"
              title="Insert YouTube"
            >
              <YoutubeIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
              aria-label="Insert table"
              title="Insert table"
            >
              <TableIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => {
                setLibraryMode("insert");
                setLibraryOpen(true);
              }}
              aria-label="Media library"
              title="Media library"
            >
              <Library />
              Library
            </Button>
          </div>
          <div className="bg-background p-3">
            <EditorContent editor={editor} />
          </div>
        </div>
      ) : (
        <Textarea
          value={htmlDraft}
          onChange={(e) => {
            setHtmlDraft(e.target.value);
            onChange(e.target.value);
          }}
          rows={16}
          className="font-mono text-xs"
          spellCheck={false}
        />
      )}

      <CmsInsertUrlDialog
        open={insertKind !== null}
        kind={insertKind ?? "link"}
        initialLabel={insertSeed.label}
        initialUrl={insertSeed.url}
        onClose={() => setInsertKind(null)}
        onInsert={handleInsert}
        onPickFromLibrary={() => {
          setLibraryMode("fill");
          setLibraryOpen(true);
        }}
      />
      <CmsMediaLibraryDialog
        open={libraryOpen}
        media={media}
        onClose={() => setLibraryOpen(false)}
        onMediaChange={onMediaChange}
        onInsert={handleLibraryInsert}
      />
    </div>
  );
}

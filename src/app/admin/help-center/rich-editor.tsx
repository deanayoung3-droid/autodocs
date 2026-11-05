"use client";

import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

// The serializer escapes brackets, which would turn a GitHub-style alert ("> [!NOTE]") into literal text.
const unescapeAlerts = (md: string) => md.replace(/^> \\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO)\\\]/gim, "> [!$1]");

/**
 * The article body edited in place, styled exactly like the help center. Markdown stays the stored
 * format: the editor loads Markdown and reports Markdown on every change. Typing Markdown shortcuts
 * works too ("## " for a heading, "- " for a list, **bold**).
 */
export function RichMarkdown({ value, onChange, placeholder = "Start writing…" }: { value: string; onChange: (md: string) => void; placeholder?: string }) {
  // The last Markdown this editor produced, so an incoming value that matches it isn't reloaded.
  const emitted = useRef(value);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
      TableKit,
      Image,
      Markdown,
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose-doc rich-editor min-h-[420px] outline-none", "aria-label": "Article body" },
    },
    onUpdate: ({ editor }) => {
      const md = unescapeAlerts(editor.getMarkdown());
      emitted.current = md;
      onChange(md);
    },
  });

  // Reload when the Markdown changes from outside (the Markdown view, or a save that reset the form).
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  return <EditorContent editor={editor} />;
}

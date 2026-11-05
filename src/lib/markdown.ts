import "server-only";
import { diffArrays } from "diff";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Article bodies can come from the docs agent, which reads pull request text
// written by anyone with repo access. Always sanitize before rendering.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "del",
    "details",
    "summary",
  ],
  allowedAttributes: {
    h2: ["id"],
    h3: ["id"],
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    code: ["class"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  // Give h2/h3 stable ids so the table of contents can link to them.
  const used = new Map<string, number>();
  const withIds = html.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
    const base = headingId(inner);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return `<${tag} id="${n ? `${base}-${n + 1}` : base}">${inner}</${tag}>`;
  });
  return callouts(sanitizeHtml(withIds, OPTIONS));
}

const CALLOUT_KINDS: Record<string, string> = {
  note: "note",
  info: "note",
  tip: "tip",
  success: "tip",
  important: "warning",
  warning: "warning",
  caution: "warning",
  danger: "warning",
};

/**
 * Turns quotes into styled callout boxes: GitHub's "> [!INFO]" style (as many help centers write them),
 * and quotes that open with a bold "Note:", "Tip:", or "Warning:". The marker is dropped and the
 * text keeps its own wording. Runs after sanitizing, on markup this function controls.
 */
function callouts(html: string): string {
  return html
    .replace(
      /<blockquote>\s*<p>\[!(NOTE|INFO|TIP|SUCCESS|IMPORTANT|WARNING|CAUTION|DANGER)\]\s*(?:<br\s*\/?>)?\s*(<\/p>\s*<p>)?/gi,
      (_m, kind: string) => `<blockquote class="callout callout-${CALLOUT_KINDS[kind.toLowerCase()]}"><p>`,
    )
    .replace(
      /<blockquote>\s*<p>(<strong>(Note|Info|Tip|Important|Warning|Caution):?<\/strong>:?)/gi,
      (_m, lead: string, kind: string) => `<blockquote class="callout callout-${CALLOUT_KINDS[kind.toLowerCase()]}"><p>${lead}`,
    );
}

export function headingId(html: string): string {
  return (
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z#0-9]+;/gi, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

/** h2/h3 headings of an article, matching the ids renderMarkdown assigns. */
export function headings(md: string): { id: string; text: string; level: 2 | 3 }[] {
  const html = renderMarkdown(md);
  return [...html.matchAll(/<(h[23]) id="([^"]+)">([\s\S]*?)<\/\1>/g)].map((m) => ({
    id: m[2],
    text: m[3].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
    level: m[1] === "h2" ? 2 : 3,
  }));
}

/** Splits Markdown into top-level blocks (paragraphs, lists, fenced code), keeping fences whole. */
function blocks(md: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (current.length) out.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) out.push(current.join("\n"));
  return out;
}

export type DiffBlock = { kind: "same" | "add" | "del"; html: string };

/** Rendered, block-level comparison of two Markdown documents. */
export function renderedDiff(before: string, after: string): DiffBlock[] {
  return diffArrays(blocks(before), blocks(after)).flatMap((part) =>
    part.value.map((b) => ({
      kind: part.added ? ("add" as const) : part.removed ? ("del" as const) : ("same" as const),
      html: renderMarkdown(b),
    })),
  );
}

/** Plain text for prompts and previews: drops markup but keeps the words. */
export function markdownToText(md: string): string {
  return sanitizeHtml(marked.parse(md, { async: false }) as string, { allowedTags: [], allowedAttributes: {} })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

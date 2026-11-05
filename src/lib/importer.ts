import "server-only";
import TurndownService from "turndown";
import { createArticle, createCollection, getArticleBySlug, getCollectionBySlug, updateArticle } from "./articles";
import { get, run } from "./db";
import { slugify } from "./format";
import { updateSettings } from "./settings";
import { MAX_IMAGE_BYTES, newKey, putFile, sniffImage } from "./storage";

// Brings an existing help center over. Sites that publish llms.txt with Markdown copies of each
// article (many hosted help centers follow the convention) import exactly: sections in order,
// clean Markdown, images re-hosted here, links rewritten, old addresses redirected. Anything else
// is imported from its sitemap by converting each page's HTML.

export type ImportStatus = {
  status: "running" | "done" | "failed";
  source: string;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  images: number;
  errors: string[];
  at: string;
};

const USER_AGENT = "AutoDocs-Importer/1.0 (+help center migration)";

async function save(s: ImportStatus) {
  await updateSettings({ lastImport: JSON.stringify({ ...s, errors: s.errors.slice(0, 20) }) });
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res;
}

const fetchText = async (url: string) => (await fetchOk(url)).text();

/** Runs fn over items, a few at a time. */
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .trim();
}

/** Some hosted help centers add a five-character id to every address ("billing-anpfa"). True if `part` is `slug` with or without one. */
const sameAddress = (part: string, slug: string) => part === slug || (part.startsWith(`${slug}-`) && part.length === slug.length + 6);

const lastPart = (url: string) => new URL(url).pathname.split("/").filter(Boolean).at(-1)?.replace(/\.md$/, "") ?? "";

/** Section icons by what the section is about; the first match wins. */
const ICONS: [RegExp, string][] = [
  [/portal/i, "portal"],
  [/getting started|start here|onboard/i, "rocket"],
  [/calendar|booking|schedul/i, "calendar"],
  [/case|matter|project/i, "briefcase"],
  [/contact|client|customer/i, "contact"],
  [/message|chat/i, "chat"],
  [/task/i, "tasks"],
  [/e-?mail|inbox/i, "mail"],
  [/drive|document|file/i, "folder"],
  [/signature|sign/i, "pen"],
  [/bank|trust/i, "bank"],
  [/billing|invoice|payment|pricing/i, "card"],
  [/intake|form/i, "inbox"],
  [/setting|admin|account|team/i, "gear"],
  [/troubleshoot|problem|issue|support|faq/i, "wrench"],
  [/integration|connect/i, "plug"],
  [/security|privacy/i, "shield"],
];

const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? "book";

type Entry = { title: string; url: string; section: string };

/** llms.txt: "## Section" headings, each followed by "- [Title](url)" or "- [Title]: url" lines. */
function parseLlms(text: string, origin: string): Entry[] {
  const out: Entry[] = [];
  let section = "Articles";
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      section = h[1];
      continue;
    }
    // "- [Title](url): description" or "- [Title]: url".
    const m = line.match(/^\s*[-*]\s+\[([^\]]+)\](?:\(([^)\s]+)\)|:\s*(\S+))/);
    if (!m) continue;
    try {
      const url = new URL(m[2] ?? m[3], origin);
      if (url.origin === origin) out.push({ title: m[1].trim(), url: url.href, section });
    } catch {
      // Not a link.
    }
  }
  return out;
}

/** The first sentence of the article, as plain text, for the search-result summary. */
function summarize(body: string): string {
  const para = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|!\[|>|\||<|[-*] |\d+\. |\*\*Before you start)/.test(p));
  if (!para) return "";
  const text = para
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > 200 ? `${sentence.slice(0, 197).replace(/\s+\S*$/, "")}…` : sentence;
}

async function addRedirect(from: string, to: string) {
  if (from === to) return;
  await run("INSERT INTO redirects (from_path, to_path) VALUES ($1, $2) ON CONFLICT (from_path) DO UPDATE SET to_path = excluded.to_path", [
    from,
    to,
  ]);
}

/** True if the article exists and nobody has changed it since it was imported, so a re-import may refresh it. */
async function untouchedImport(articleId: number): Promise<boolean> {
  const last = await get<{ source: string }>("SELECT source FROM revisions WHERE article_id = $1 ORDER BY id DESC LIMIT 1", [articleId]);
  return last?.source === "import";
}

export async function importHelpCenter(input: string, publish: boolean): Promise<void> {
  const status: ImportStatus = {
    status: "running",
    source: input,
    total: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    images: 0,
    errors: [],
    at: new Date().toISOString(),
  };
  await save(status);
  try {
    const start = new URL(input);
    let entries: Entry[] = [];
    try {
      entries = parseLlms(await fetchText(`${start.origin}/llms.txt`), start.origin).filter((e) => e.url.endsWith(".md"));
    } catch {
      // No llms.txt; use the sitemap.
    }
    if (entries.length) await importMarkdown(start.origin, entries, publish, status);
    else await importSitemap(start, publish, status);
    status.status = "done";
  } catch (err) {
    status.status = "failed";
    status.errors.push(err instanceof Error ? err.message : String(err));
  }
  await save(status);
}

async function importMarkdown(origin: string, entries: Entry[], publish: boolean, status: ImportStatus) {
  status.total = entries.length;
  await save(status);

  // Section pages are the sitemap's other entries; their meta description becomes the section's.
  const articleSlugs = new Set(entries.map((e) => lastPart(e.url)));
  let sectionPages: string[] = [];
  try {
    sectionPages = [...(await fetchText(`${origin}/sitemap.xml`)).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((m) => decode(m[1]))
      .filter((u) => new URL(u).origin === origin && lastPart(u) && !articleSlugs.has(lastPart(u)));
  } catch {
    // Sections still import, without descriptions.
  }

  const sections = [...new Set(entries.map((e) => e.section))];
  const sectionIds = new Map<string, number>();
  for (const [position, name] of sections.entries()) {
    const slug = slugify(name);
    const page = sectionPages.find((u) => sameAddress(lastPart(u), slug));
    let description = "";
    if (page) {
      try {
        const html = await fetchText(page);
        description = decode(html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? "");
      } catch {
        // Keep going without it.
      }
      await addRedirect(`/${lastPart(page)}`, `/help/c/${slug}`);
    }
    const existing = await getCollectionBySlug(slug);
    const id = existing?.id ?? (await createCollection(name, { slug, description, icon: iconFor(name) }));
    if (existing && description && !existing.description) {
      await run("UPDATE collections SET description = $1 WHERE id = $2", [description, id]);
    }
    await run("UPDATE collections SET position = $1 WHERE id = $2", [position, id]);
    sectionIds.set(name, id);
  }

  // Decide every article's new address first, so links between articles can point at it. The
  // address comes from the title, which is what most help centers' own addresses are made from too.
  const targets = new Map<string, string>();
  const used = new Set<string>();
  for (const e of entries) {
    const legacy = lastPart(e.url);
    let slug = slugify(e.title);
    const taken = await getArticleBySlug(slug);
    if (used.has(slug) || (taken && !(await untouchedImport(taken.id)) && taken.title !== e.title)) slug = legacy;
    used.add(slug);
    targets.set(legacy, slug);
  }
  const byTitle = new Map(entries.map((e) => [e.title.toLowerCase(), targets.get(lastPart(e.url))!]));
  const host = new URL(origin).host.replace(/\./g, "\\.");
  const images = new Map<string, Promise<string | null>>();

  const rehost = (url: string): Promise<string | null> => {
    if (!images.has(url)) {
      images.set(
        url,
        (async () => {
          try {
            const res = await fetchOk(url);
            const buf = Buffer.from(await res.arrayBuffer());
            const ext = sniffImage(buf);
            if (!ext || buf.length > MAX_IMAGE_BYTES) return null;
            status.images++;
            return await putFile(newKey("imported", ext), buf);
          } catch (err) {
            status.errors.push(`Image ${url}: ${err instanceof Error ? err.message : err}`);
            return null;
          }
        })(),
      );
    }
    return images.get(url)!;
  };

  const convert = async (raw: string): Promise<string> => {
    let md = raw.replace(/\r\n/g, "\n").replace(/^\s*\[[^\]\n]*\]\s*\n/, "").replace(/^[ \t]+/, "").trim();
    // Images: copy each one here so the docs never depend on the old host.
    for (const m of [...md.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)]) {
      const local = await rehost(m[2]);
      if (local) md = md.replace(m[0], `![${m[1]}](${local})`);
    }
    // Links to other articles and sections on the old site.
    md = md.replace(new RegExp(`\\]\\(https?://${host}/([a-z0-9-]+)(?:\\.md)?/?(#[^)]*)?\\)`, "g"), (whole, part: string, hash = "") => {
      const slug = targets.get(part);
      if (slug) return `](/help/${slug}${hash})`;
      const section = sections.find((s) => sameAddress(part, slugify(s)));
      return section ? `](/help/c/${slugify(section)})` : whole;
    });
    // Internal links to articles the old help center never published: link by title, or keep the words.
    md = md.replace(/\[([^\]]+)\]\(internal:\/\/[^)]+\)/g, (_m, text: string) => {
      const slug = byTitle.get(text.toLowerCase());
      return slug ? `[${text}](/help/${slug})` : text;
    });
    // "Related:" lines that list titles as plain text get links where the article exists.
    md = md.replace(/^(\*\*Related(?: articles)?:\*\*\s*)(.+)$/gm, (_m, label: string, rest: string) => {
      const parts = rest.split(/\s+·\s+/).map((p) => {
        if (p.includes("](")) return p;
        const slug = byTitle.get(p.trim().toLowerCase());
        return slug ? `[${p.trim()}](/help/${slug})` : p;
      });
      return `${label}${parts.join(" · ")}`;
    });
    return md;
  };

  const positions = new Map<string, number>();
  await pool(entries, 4, async (e) => {
    const legacy = lastPart(e.url);
    const slug = targets.get(legacy)!;
    const position = positions.get(e.section) ?? 0;
    positions.set(e.section, position + 1);
    try {
      const body = await convert(await fetchText(e.url));
      if (body.length < 20) {
        status.skipped++;
        return;
      }
      const input = { title: e.title, summary: summarize(body), body, collectionId: sectionIds.get(e.section) ?? null, slug, position };
      const existing = await getArticleBySlug(slug);
      if (existing) {
        if (await untouchedImport(existing.id)) {
          await updateArticle(existing.id, input, "import", `Re-imported from ${e.url.replace(/\.md$/, "")}`);
          await run("UPDATE articles SET position = $1 WHERE id = $2", [position, existing.id]);
          status.updated++;
        } else {
          status.skipped++;
        }
      } else {
        await createArticle(input, publish ? "published" : "draft", "import", `Imported from ${e.url.replace(/\.md$/, "")}`);
        status.imported++;
      }
      await addRedirect(`/${legacy}`, `/help/${slug}`);
      await addRedirect(`/help/${legacy}`, `/help/${slug}`);
    } catch (err) {
      status.errors.push(`${e.title}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if ((status.imported + status.updated + status.skipped) % 5 === 0) await save(status);
  });
}

/* Sitemap import, for help centers without Markdown copies */

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "nav", "header", "footer", "aside", "form", "button", "noscript"]);

/** Picks the main content of a help page: <article>, then <main>, then <body>. */
function extract(html: string): { title: string; summary: string; bodyHtml: string } {
  const pick = (tag: string) => html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1];
  const content = pick("article") ?? pick("main") ?? pick("body") ?? html;
  const h1 = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = decode((h1 ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "Untitled").replace(/<[^>]+>/g, ""));
  const summary = decode(html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? "");
  return { title: title.replace(/\s+[|·–-]\s+.*$/, ""), summary, bodyHtml: content.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "") };
}

async function importSitemap(start: URL, publish: boolean, status: ImportStatus) {
  const sitemapUrl = start.pathname.endsWith(".xml") ? start.href : `${start.origin}/sitemap.xml`;
  const locs = [...(await fetchText(sitemapUrl)).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => decode(m[1]))
    .filter((u) => new URL(u).origin === start.origin && (start.pathname.endsWith(".xml") || u.startsWith(start.href.replace(/\/$/, ""))))
    .slice(0, 400);
  status.total = locs.length;
  await save(status);

  for (const loc of locs) {
    const parts = new URL(loc).pathname.split("/").filter(Boolean);
    const slug = slugify(parts.at(-1) ?? "");
    if (!slug || parts.length === 0 || (await getArticleBySlug(slug))) {
      status.skipped++;
      continue;
    }
    try {
      const { title, summary, bodyHtml } = extract(await fetchText(loc));
      const body = turndown.turndown(bodyHtml).replace(/\n{3,}/g, "\n\n").trim();
      if (body.length < 40) {
        status.skipped++;
        continue;
      }
      const sectionSlug = parts.length > 1 ? slugify(parts.at(-2)!) : "imported";
      const sectionName = sectionSlug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      const collectionId =
        (await getCollectionBySlug(sectionSlug))?.id ??
        (await createCollection(sectionName === "Articles" ? "Imported" : sectionName, { icon: iconFor(sectionName) }));
      await createArticle({ title, summary: summary || summarize(body), body, collectionId, slug }, publish ? "published" : "draft", "import", `Imported from ${loc}`);
      status.imported++;
    } catch (err) {
      status.errors.push(err instanceof Error ? err.message : String(err));
    }
    if ((status.imported + status.skipped) % 5 === 0) await save(status);
  }
}

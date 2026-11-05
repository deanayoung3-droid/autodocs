import "server-only";
import { generateJSON } from "./ai";
import { getArticle } from "./articles";
import { all, get, run } from "./db";
import { getSettings } from "./settings";

export const LANGUAGES: Record<string, string> = {
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  ar: "العربية",
  hi: "हिन्दी",
};

export type Translation = { article_id: number; lang: string; title: string; summary: string; body: string; source_hash: string };

// The hash of an article's current text, computed in SQL so freshness checks need no round trips.
const SOURCE_HASH = "md5(a.title || chr(10) || a.summary || chr(10) || a.body)";

export async function getTranslation(articleId: number, lang: string): Promise<Translation | undefined> {
  return get<Translation>(
    "SELECT article_id, lang, title, summary, body, source_hash FROM translations WHERE article_id = $1 AND lang = $2",
    [articleId, lang],
  );
}

/** Published articles whose translation is missing or older than the current text. */
export async function staleTranslations(limit = 5): Promise<{ articleId: number; lang: string }[]> {
  const langs = (await getSettings()).languages;
  if (!langs.length) return [];
  return all<{ articleId: number; lang: string }>(
    `SELECT a.id AS "articleId", l.lang
     FROM articles a CROSS JOIN unnest($1::text[]) AS l(lang)
     LEFT JOIN translations t ON t.article_id = a.id AND t.lang = l.lang
     WHERE a.status = 'published' AND a.deleted_at IS NULL
       AND (t.source_hash IS NULL OR t.source_hash <> ${SOURCE_HASH})
     ORDER BY a.views DESC, a.id
     LIMIT $2`,
    [langs, limit],
  );
}

export async function translationProgress(): Promise<{ lang: string; done: number; total: number }[]> {
  const langs = (await getSettings()).languages;
  if (!langs.length) return [];
  const rows = await all<{ lang: string; done: number; total: number }>(
    `SELECT l.lang, count(*) AS total,
            count(*) FILTER (WHERE t.source_hash = ${SOURCE_HASH}) AS done
     FROM articles a CROSS JOIN unnest($1::text[]) AS l(lang)
     LEFT JOIN translations t ON t.article_id = a.id AND t.lang = l.lang
     WHERE a.status = 'published' AND a.deleted_at IS NULL
     GROUP BY l.lang`,
    [langs],
  );
  return langs.map((lang) => rows.find((r) => r.lang === lang) ?? { lang, done: 0, total: 0 });
}

/** Translates one article. Keeps Markdown, links, code, and product names intact. */
export async function translateArticle(articleId: number, lang: string): Promise<void> {
  const a = await getArticle(articleId);
  if (!a || !LANGUAGES[lang]) return;
  const { brandName } = await getSettings();
  const out = await generateJSON<{ title: string; summary: string; body_markdown: string }>({
    purpose: "translate",
    system: `Translate help center articles for ${brandName} into ${LANGUAGES[lang]} (${lang}). Keep Markdown structure, links, images, callouts ("> [!INFO]" and the like), code, UI labels in bold as they appear in the product unless the product itself is localized, and the brand name unchanged. Write naturally for a native reader.`,
    prompt: `<title>${a.title}</title>\n<summary>${a.summary}</summary>\n<body>\n${a.body}\n</body>`,
    schema: {
      type: "object",
      properties: { title: { type: "string" }, summary: { type: "string" }, body_markdown: { type: "string" } },
      required: ["title", "summary", "body_markdown"],
      additionalProperties: false,
    },
    effort: "low",
  });
  // Record the hash of the text that was translated, read in the same statement.
  await run(
    `INSERT INTO translations (article_id, lang, title, summary, body, source_hash, updated_at)
     SELECT a.id, $2, $3, $4, $5, md5($6 || chr(10) || $7 || chr(10) || $8), now() FROM articles a WHERE a.id = $1
     ON CONFLICT (article_id, lang) DO UPDATE SET title = excluded.title, summary = excluded.summary,
       body = excluded.body, source_hash = excluded.source_hash, updated_at = excluded.updated_at`,
    [articleId, lang, out.title, out.summary, out.body_markdown, a.title, a.summary, a.body],
  );
}

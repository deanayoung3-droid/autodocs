import "server-only";
import crypto from "node:crypto";
import { DEFAULT_MODELS, aiConfigured, embed } from "./ai";
import { getArticle, restrictedCollectionIds, searchArticles, toTsQuery, type ArticleStatus, type SearchHit } from "./articles";
import { all, get, run, tx } from "./db";
import { EMBEDDING_DIMENSIONS } from "./schema";

// Search that understands meaning as well as words. Each article is split into its "##"
// sections; each section is embedded. Queries combine keyword and semantic rankings with
// reciprocal rank fusion, so exact UI labels and paraphrased questions both find the right place.

const MAX_SECTION = 1600; // characters per searchable section

export type Section = { heading: string; content: string };

/** Splits an article body at its "##" headings, breaking long sections at paragraph boundaries. */
export function splitSections(body: string): Section[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  let fence = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence ? line.match(/^##\s+(.+?)\s*#*\s*$/) : null;
    if (h) sections.push({ heading: h[1], lines: [] });
    else sections.at(-1)!.lines.push(line);
  }
  const out: Section[] = [];
  for (const s of sections) {
    const text = s.lines.join("\n").trim();
    if (!text) {
      if (s.heading) out.push({ heading: s.heading, content: "" });
      continue;
    }
    let current = "";
    for (const para of text.split(/\n{2,}/)) {
      if (current && current.length + para.length > MAX_SECTION) {
        out.push({ heading: s.heading, content: current });
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    out.push({ heading: s.heading, content: current });
  }
  return out;
}

/** Plain words for embedding and quoting: images become their alt text, links their label. */
function plain(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[Screenshot: $1]")
    .replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, "$1")
    .replace(/<\/?(details|summary)>/g, "\n")
    .replace(/^>\s*\[!([A-Z]+)\]\s*$/gm, (_m, kind: string) => `${kind[0]}${kind.slice(1).toLowerCase()}:`)
    .trim();
}

const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const toVector = (v: number[]) => `[${v.join(",")}]`;

/** Rebuilds an article's sections, embedding only the ones whose text changed. */
export async function embedArticle(articleId: number): Promise<void> {
  const a = await getArticle(articleId);
  if (!a || a.deleted_at) {
    await run("DELETE FROM article_chunks WHERE article_id = $1", [articleId]);
    return;
  }
  const model = DEFAULT_MODELS.embedding;
  const sections = splitSections(a.body).map((s, i) => {
    const content = plain(s.content);
    // The text that gets embedded carries the article's title, so a section reads on its own.
    const text = `${a.title}${s.heading ? ` — ${s.heading}` : ""}\n${i === 0 && a.summary ? `${a.summary}\n` : ""}${content}`;
    return { heading: s.heading, content, text, hash: sha1(text) };
  });
  const existing = new Map(
    (
      await all<{ position: number; content_hash: string; model: string | null; embedded: boolean }>(
        "SELECT position, content_hash, model, embedding IS NOT NULL AS embedded FROM article_chunks WHERE article_id = $1",
        [articleId],
      )
    ).map((r) => [r.position, r]),
  );
  const stale = sections
    .map((s, i) => ({ ...s, i }))
    .filter(({ hash, i }) => {
      const e = existing.get(i);
      return !(e && e.content_hash === hash && e.embedded && e.model === model);
    });
  const vectors = stale.length && aiConfigured() ? await embed(stale.map((s) => s.text), EMBEDDING_DIMENSIONS) : [];
  const fresh = new Map(stale.map((s, k) => [s.i, vectors[k]]));

  await tx(async () => {
    await run("DELETE FROM article_chunks WHERE article_id = $1 AND position >= $2", [articleId, sections.length]);
    for (const [i, s] of sections.entries()) {
      const v = fresh.get(i);
      await run(
        `INSERT INTO article_chunks (article_id, position, heading, content, content_hash, embedding, model)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
         ON CONFLICT (article_id, position) DO UPDATE SET
           heading = excluded.heading, content = excluded.content, content_hash = excluded.content_hash,
           embedding = CASE WHEN excluded.embedding IS NOT NULL THEN excluded.embedding
                            WHEN article_chunks.content_hash = excluded.content_hash THEN article_chunks.embedding END,
           model = CASE WHEN excluded.embedding IS NOT NULL THEN excluded.model
                        WHEN article_chunks.content_hash = excluded.content_hash THEN article_chunks.model END`,
        [articleId, i, s.heading, s.content, s.hash, v ? toVector(v) : null, v ? model : null],
      );
    }
  });
}

/* Query embeddings, cached so repeated searches don't call the API again. */

const queryCache = new Map<string, number[]>();

async function queryVector(text: string): Promise<number[] | null> {
  const key = text.trim().toLowerCase().slice(0, 500);
  const hit = queryCache.get(key);
  if (hit) return hit;
  try {
    const [v] = await embed([key], EMBEDDING_DIMENSIONS);
    queryCache.set(key, v);
    if (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
    return v;
  } catch (err) {
    // Search keeps working on keywords alone if embeddings are unavailable.
    console.error("[search] query embedding failed", err instanceof Error ? err.message : err);
    return null;
  }
}

async function semanticReady(): Promise<boolean> {
  return aiConfigured() && Boolean(await get("SELECT 1 FROM article_chunks WHERE embedding IS NOT NULL LIMIT 1"));
}

type ChunkHit = {
  id: number;
  article_id: number;
  position: number;
  heading: string;
  content: string;
  slug: string;
  title: string;
  summary: string;
  status: ArticleStatus;
  restricted: number;
  collection_id: number | null;
};

const CHUNK_FIELDS = `c.id, c.article_id, c.position, c.heading, c.content, a.slug, a.title, a.summary, a.status, a.restricted, a.collection_id`;

async function semanticChunks(text: string, k: number, publishedOnly: boolean): Promise<ChunkHit[]> {
  if (!(await semanticReady())) return [];
  const v = await queryVector(text);
  if (!v) return [];
  return all<ChunkHit>(
    `SELECT ${CHUNK_FIELDS} FROM (
       SELECT id, article_id, position, heading, content, embedding <=> $1::vector AS distance
       FROM article_chunks WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2
     ) c JOIN articles a ON a.id = c.article_id
     WHERE a.deleted_at IS NULL ${publishedOnly ? "AND a.status = 'published'" : ""}
       AND c.distance < 0.75
     ORDER BY c.distance`,
    [toVector(v), k],
  );
}

async function keywordChunks(text: string, k: number, publishedOnly: boolean): Promise<ChunkHit[]> {
  const q = toTsQuery(text);
  if (!q) return [];
  return all<ChunkHit>(
    `SELECT ${CHUNK_FIELDS}
     FROM article_chunks c JOIN articles a ON a.id = c.article_id, to_tsquery('english', $1) q
     WHERE to_tsvector('english', c.heading || ' ' || c.content) @@ q
       AND a.deleted_at IS NULL ${publishedOnly ? "AND a.status = 'published'" : ""}
     ORDER BY ts_rank_cd(to_tsvector('english', c.heading || ' ' || c.content), q, 32) DESC
     LIMIT $2`,
    [q, k],
  );
}

/** Reciprocal rank fusion: items ranked well in any list rise; items in several lists rise most. */
function fuse<T>(lists: T[][], key: (t: T) => number): { item: T; score: number }[] {
  const scores = new Map<number, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const k = key(item);
      const entry = scores.get(k) ?? { item, score: 0 };
      entry.score += 1 / (60 + rank);
      scores.set(k, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

async function visibleFilter(includeRestricted: boolean) {
  if (includeRestricted) return () => true;
  const hidden = await restrictedCollectionIds();
  return (h: { restricted: number; collection_id: number | null }) => !h.restricted && !(h.collection_id && hidden.has(h.collection_id));
}

const excerpt = (s: string) => (s.length > 220 ? `${s.slice(0, 220).replace(/\s+\S*$/, "")}…` : s).replace(/\s+/g, " ");

/** Article search by keywords and meaning. Use for result pages; keyword search is faster as-you-type. */
export async function hybridSearch(
  text: string,
  opts: { publishedOnly?: boolean; limit?: number; includeRestricted?: boolean } = {},
): Promise<SearchHit[]> {
  const publishedOnly = opts.publishedOnly !== false;
  const limit = opts.limit ?? 10;
  const [keyword, semantic] = await Promise.all([
    searchArticles(text, { publishedOnly, limit: 20, includeRestricted: true }),
    semanticChunks(text, 40, publishedOnly),
  ]);
  // One entry per article from the semantic side: its best-matching section.
  const seen = new Set<number>();
  const bySection: SearchHit[] = semantic
    .filter((c) => !seen.has(c.article_id) && seen.add(c.article_id))
    .map((c) => ({ id: c.article_id, slug: c.slug, title: c.title, summary: c.summary, status: c.status, snippet: excerpt(c.content) }));
  let hits = fuse<SearchHit>([keyword, bySection], (h) => h.id).map(({ item }) => item);
  // Public callers must not see restricted content unless the reader is signed in.
  if (publishedOnly && !opts.includeRestricted) {
    const hidden = await restrictionsFor(hits.map((h) => h.id));
    hits = hits.filter((h) => !hidden.has(h.id));
  }
  return hits.slice(0, limit);
}

async function restrictionsFor(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const hidden = await restrictedCollectionIds();
  const rows = await all<{ id: number; restricted: number; collection_id: number | null }>(
    "SELECT id, restricted, collection_id FROM articles WHERE id = ANY($1)",
    [ids],
  );
  return new Set(rows.filter((r) => r.restricted || (r.collection_id && hidden.has(r.collection_id))).map((r) => r.id));
}

export type Passage = { chunkId: number; articleId: number; slug: string; title: string; heading: string; content: string };

/**
 * The sections most likely to answer a question, for AI answers. Combines meaning, keywords in
 * the section, and keywords in the whole article (so a strong title match brings its opening in).
 */
export async function retrievePassages(question: string, opts: { limit?: number; includeRestricted?: boolean } = {}): Promise<Passage[]> {
  const limit = opts.limit ?? 6;
  const [semantic, keyword, articles, visible] = await Promise.all([
    semanticChunks(question, 30, true),
    keywordChunks(question, 20, true),
    searchArticles(question, { limit: 5, includeRestricted: true }),
    visibleFilter(Boolean(opts.includeRestricted)),
  ]);
  const openings = articles.length
    ? await all<ChunkHit>(
        `SELECT ${CHUNK_FIELDS} FROM article_chunks c JOIN articles a ON a.id = c.article_id
         WHERE c.article_id = ANY($1) AND c.position = 0`,
        [articles.map((a) => a.id)],
      )
    : [];
  const openingsRanked = articles.map((a) => openings.find((o) => o.article_id === a.id)).filter((o): o is ChunkHit => Boolean(o));
  let ranked = fuse<ChunkHit>([semantic, keyword, openingsRanked], (c) => c.id)
    .map(({ item }) => item)
    .filter(visible);

  // Before sections exist (say, right after an import), fall back to whole articles.
  if (!ranked.length && articles.length) {
    const fallback = (await Promise.all(articles.map((a) => getArticle(a.id)))).filter((a) => a && a.status === "published");
    const hidden = opts.includeRestricted ? null : await restrictionsFor(fallback.map((a) => a!.id));
    return fallback
      .filter((a) => !hidden?.has(a!.id))
      .slice(0, 3)
      .map((a) => ({ chunkId: -a!.id, articleId: a!.id, slug: a!.slug, title: a!.title, heading: "", content: plain(a!.body) }));
  }
  // At most three sections from any one article, so several sources can contribute.
  const perArticle = new Map<number, number>();
  ranked = ranked.filter((c) => {
    const n = perArticle.get(c.article_id) ?? 0;
    perArticle.set(c.article_id, n + 1);
    return n < 3;
  });
  return ranked.slice(0, limit).map((c) => ({
    chunkId: c.id,
    articleId: c.article_id,
    slug: c.slug,
    title: c.title,
    heading: c.heading,
    content: c.content,
  }));
}

/** How much of the help center is ready for semantic search. */
export async function indexStatus(): Promise<{ articles: number; indexed: number; sections: number }> {
  return (await get<{ articles: number; indexed: number; sections: number }>(
    `SELECT (SELECT count(*) FROM articles WHERE deleted_at IS NULL) AS articles,
            (SELECT count(DISTINCT article_id) FROM article_chunks WHERE embedding IS NOT NULL) AS indexed,
            (SELECT count(*) FROM article_chunks WHERE embedding IS NOT NULL) AS sections`,
  ))!;
}

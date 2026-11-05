import "server-only";
import { all, get, insert, run, tx } from "./db";
import { HIT_END, HIT_START, slugify } from "./format";
import { enqueue } from "./jobs";

export type ArticleStatus = "draft" | "published";

export type Article = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  body: string;
  collection_id: number | null;
  status: ArticleStatus;
  restricted: number;
  position: number;
  views: number;
  helpful_yes: number;
  helpful_no: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ArticleRow = Omit<Article, "body"> & { collection_name: string | null; collection_slug: string | null };

export type Collection = {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  parent_id: number | null;
  position: number;
  restricted: number;
};

export type SearchHit = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  snippet: string;
  status: ArticleStatus;
};

// Never SELECT * from articles: the table also holds its search vector.
const ARTICLE_COLUMNS = `id, slug, title, summary, body, collection_id, status, restricted, position, views,
  helpful_yes, helpful_no, created_at, updated_at, deleted_at`;

const ROW_COLUMNS = `a.id, a.slug, a.title, a.summary, a.collection_id, a.status, a.restricted, a.position, a.views,
  a.helpful_yes, a.helpful_no, a.created_at, a.updated_at, a.deleted_at,
  c.name AS collection_name, c.slug AS collection_slug`;

const COLLECTION_COLUMNS = "id, slug, name, description, icon, parent_id, position, restricted";

/** Articles, newest change first, or in their section's reading order with `order: "position"`. */
export async function listArticles(
  filter: { status?: ArticleStatus; collectionId?: number; order?: "recent" | "position" } = {},
): Promise<ArticleRow[]> {
  const where = ["a.deleted_at IS NULL"];
  const args: (string | number)[] = [];
  if (filter.status) {
    args.push(filter.status);
    where.push(`a.status = $${args.length}`);
  }
  if (filter.collectionId) {
    args.push(filter.collectionId);
    where.push(`a.collection_id = $${args.length}`);
  }
  return all<ArticleRow>(
    `SELECT ${ROW_COLUMNS} FROM articles a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${filter.order === "position" ? "a.position, a.title" : "a.updated_at DESC, a.id DESC"}`,
    args,
  );
}

export async function listDeletedArticles(): Promise<ArticleRow[]> {
  return all<ArticleRow>(
    `SELECT ${ROW_COLUMNS} FROM articles a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`,
  );
}

export async function getArticle(id: number): Promise<Article | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<Article>(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = $1`, [id]);
}

export async function getArticleBySlug(slug: string): Promise<Article | undefined> {
  return get<Article>(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
}

/* Collections (sections). Nested through parent_id. */

export async function listCollections(): Promise<(Collection & { published: number; total: number })[]> {
  return all<Collection & { published: number; total: number }>(
    `SELECT c.id, c.slug, c.name, c.description, c.icon, c.parent_id, c.position, c.restricted,
       (SELECT count(*) FROM articles a WHERE a.collection_id = c.id AND a.status = 'published' AND a.deleted_at IS NULL) AS published,
       (SELECT count(*) FROM articles a WHERE a.collection_id = c.id AND a.deleted_at IS NULL) AS total
     FROM collections c WHERE c.deleted_at IS NULL ORDER BY c.position, c.name`,
  );
}

export type CollectionNode = Collection & { published: number; total: number; depth: number; children: CollectionNode[] };

/** Collections as a tree, children ordered by position. */
export async function collectionTree(): Promise<CollectionNode[]> {
  const nodes = (await listCollections()).map((c) => ({ ...c, depth: 0, children: [] as CollectionNode[] }));
  const byId = new Map(nodes.map((c) => [c.id, c]));
  const roots: CollectionNode[] = [];
  for (const c of nodes) {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    (parent ? parent.children : roots).push(c);
  }
  const setDepth = (list: CollectionNode[], d: number) =>
    list.forEach((n) => {
      n.depth = d;
      setDepth(n.children, d + 1);
    });
  setDepth(roots, 0);
  return roots;
}

/** Depth-first flat list, for selects and indented lists. */
export function flattenTree(nodes: CollectionNode[]): CollectionNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** A collection plus its ancestors, root first. */
export async function collectionPath(id: number | null): Promise<Collection[]> {
  if (!id) return [];
  return all<Collection>(
    `WITH RECURSIVE up AS (
       SELECT ${COLLECTION_COLUMNS}, 0 AS depth FROM collections WHERE id = $1 AND deleted_at IS NULL
       UNION ALL
       SELECT c.id, c.slug, c.name, c.description, c.icon, c.parent_id, c.position, c.restricted, up.depth + 1
       FROM collections c JOIN up ON c.id = up.parent_id WHERE c.deleted_at IS NULL AND up.depth < 10
     )
     SELECT ${COLLECTION_COLUMNS} FROM up ORDER BY depth DESC`,
    [id],
  );
}

/** Ids of every section readers must sign in to see: restricted ones and everything under them. */
export async function restrictedCollectionIds(): Promise<Set<number>> {
  const rows = await all<{ id: number }>(
    `WITH RECURSIVE r AS (
       SELECT id FROM collections WHERE restricted = 1 AND deleted_at IS NULL
       UNION
       SELECT c.id FROM collections c JOIN r ON c.parent_id = r.id WHERE c.deleted_at IS NULL
     )
     SELECT id FROM r`,
  );
  return new Set(rows.map((r) => r.id));
}

/** True if the collection or any ancestor is restricted to signed-in readers. */
export async function collectionRestricted(id: number | null): Promise<boolean> {
  return (await collectionPath(id)).some((c) => c.restricted);
}

export async function getCollection(id: number): Promise<Collection | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<Collection>(`SELECT ${COLLECTION_COLUMNS} FROM collections WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

export async function getCollectionBySlug(slug: string): Promise<Collection | undefined> {
  return get<Collection>(`SELECT ${COLLECTION_COLUMNS} FROM collections WHERE slug = $1 AND deleted_at IS NULL`, [slug]);
}

export async function createCollection(
  name: string,
  opts: { description?: string; icon?: string; parentId?: number | null; slug?: string } = {},
): Promise<number> {
  return tx(async () => {
    const slug = await uniqueSlug("collections", slugify(opts.slug || name));
    return insert(
      `INSERT INTO collections (slug, name, description, icon, parent_id, position)
       VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position), -1) + 1 FROM collections))
       RETURNING id`,
      [slug, name, opts.description ?? "", opts.icon ?? "", opts.parentId ?? null],
    );
  });
}

export async function updateCollection(
  id: number,
  c: { name: string; description: string; icon: string; parentId: number | null; restricted: boolean },
) {
  // A collection can't become its own ancestor.
  const parentId = c.parentId && !(await collectionPath(c.parentId)).some((p) => p.id === id) ? c.parentId : null;
  await run("UPDATE collections SET name = $1, description = $2, icon = $3, parent_id = $4, restricted = $5 WHERE id = $6", [
    c.name,
    c.description,
    c.icon,
    parentId,
    c.restricted ? 1 : 0,
    id,
  ]);
}

/** Moves a collection one step up or down among its siblings. */
export async function moveCollection(id: number, direction: -1 | 1) {
  await tx(async () => {
    const c = await getCollection(id);
    if (!c) return;
    const siblings = (await listCollections()).filter((s) => s.parent_id === c.parent_id);
    const i = siblings.findIndex((s) => s.id === id);
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    for (const [k, s] of siblings.entries()) await run("UPDATE collections SET position = $1 WHERE id = $2", [k, s.id]);
  });
}

/** Deletes a collection; its articles and sub-sections move up to its parent. */
export async function deleteCollection(id: number) {
  await tx(async () => {
    const c = await getCollection(id);
    if (!c) return;
    await run("UPDATE articles SET collection_id = $1 WHERE collection_id = $2", [c.parent_id, id]);
    await run("UPDATE collections SET parent_id = $1 WHERE parent_id = $2", [c.parent_id, id]);
    await run("DELETE FROM collections WHERE id = $1", [id]);
  });
}

async function uniqueSlug(table: "articles" | "collections", base: string, exceptId?: number): Promise<string> {
  let slug = base;
  for (let i = 2; await get(`SELECT 1 FROM ${table} WHERE slug = $1 AND id IS DISTINCT FROM $2`, [slug, exceptId ?? null]); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

export type ArticleInput = {
  title: string;
  summary: string;
  body: string;
  collectionId: number | null;
  slug?: string;
  restricted?: boolean;
  position?: number;
};

export async function createArticle(input: ArticleInput, status: ArticleStatus, source: string, note?: string): Promise<number> {
  const id = await tx(async () => {
    const slug = await uniqueSlug("articles", slugify(input.slug || input.title));
    const id = await insert(
      `INSERT INTO articles (slug, title, summary, body, collection_id, status, restricted, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [slug, input.title, input.summary, input.body, input.collectionId, status, input.restricted ? 1 : 0, input.position ?? 0],
    );
    await addRevision(id, input.title, input.body, source, note);
    return id;
  });
  await reindex(id);
  return id;
}

export async function updateArticle(id: number, input: ArticleInput, source: string, note?: string): Promise<void> {
  await tx(async () => {
    const current = await getArticle(id);
    if (!current) throw new Error(`Article ${id} not found`);
    const slug = input.slug ? await uniqueSlug("articles", slugify(input.slug), id) : current.slug;
    const restricted = input.restricted === undefined ? current.restricted : input.restricted ? 1 : 0;
    await run(
      `UPDATE articles SET slug = $1, title = $2, summary = $3, body = $4, collection_id = $5, restricted = $6,
       updated_at = now() WHERE id = $7`,
      [slug, input.title, input.summary, input.body, input.collectionId, restricted, id],
    );
    if (current.title !== input.title || current.body !== input.body) {
      await addRevision(id, input.title, input.body, source, note);
    }
  });
  await reindex(id);
}

export async function setArticleStatus(id: number, status: ArticleStatus): Promise<void> {
  await run("UPDATE articles SET status = $1, updated_at = now() WHERE id = $2", [status, id]);
}

/** Moves an article to Recently deleted. It can be restored for 30 days. */
export async function deleteArticle(id: number): Promise<void> {
  await run("UPDATE articles SET deleted_at = now() WHERE id = $1", [id]);
}

export async function restoreArticle(id: number): Promise<void> {
  await run("UPDATE articles SET deleted_at = NULL, updated_at = now() WHERE id = $1", [id]);
  await reindex(id);
}

export async function purgeArticle(id: number): Promise<void> {
  await run("DELETE FROM articles WHERE id = $1 AND deleted_at IS NOT NULL", [id]);
}

/** Permanently removes articles deleted more than 30 days ago. */
export async function purgeExpiredArticles(): Promise<void> {
  await run("DELETE FROM articles WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'");
}

/** Queues the article's sections for (re)embedding, so semantic search and AI answers see the change. */
async function reindex(articleId: number) {
  await enqueue("embed", { articleId }, { dedupeKey: `embed:${articleId}` });
}

async function addRevision(articleId: number, title: string, body: string, source: string, note?: string) {
  await run("INSERT INTO revisions (article_id, title, body, source, note) VALUES ($1, $2, $3, $4, $5)", [
    articleId,
    title,
    body,
    source,
    note ?? null,
  ]);
}

export type Revision = { id: number; title: string; source: string; note: string | null; created_at: string };

export async function listRevisions(articleId: number): Promise<Revision[]> {
  return all<Revision>(
    "SELECT id, title, source, note, created_at FROM revisions WHERE article_id = $1 ORDER BY id DESC LIMIT 20",
    [articleId],
  );
}

export async function getRevision(id: number): Promise<(Revision & { body: string; article_id: number }) | undefined> {
  if (!Number.isInteger(id)) return undefined;
  return get<Revision & { body: string; article_id: number }>(
    "SELECT id, article_id, title, body, source, note, created_at FROM revisions WHERE id = $1",
    [id],
  );
}

const STOPWORDS = new Set(
  "a an and are as at be by can could do does for from get got have how i if in into is it its me my of on or so that the this to was we what when where which who why will with you your".split(
    " ",
  ),
);

/** The meaningful words of a query, lowercased and de-duplicated. */
export function queryTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .slice(0, 16);
}

/** Turns free text into a safe tsquery: stemmed prefix terms joined with OR. */
export function toTsQuery(text: string): string | null {
  const terms = queryTerms(text);
  return terms.length ? terms.map((t) => `${t}:*`).join(" | ") : null;
}

// ts_headline marks hits with these; they're mapped to HIT_START/HIT_END for rendering.
const MARK_OPEN = "⟦";
const MARK_CLOSE = "⟧";

/** Markdown syntax out of a search snippet, keeping the words and the hit marks. */
function cleanSnippet(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?(details|summary)>/g, " ")
    .replace(/^\s*>\s*\[![A-Z]+\]/gm, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll(MARK_OPEN, HIT_START)
    .replaceAll(MARK_CLOSE, HIT_END);
}

/** Keyword search, ranked by where the words appear (title first). */
export async function searchArticles(
  text: string,
  opts: { publishedOnly?: boolean; limit?: number; includeRestricted?: boolean } = {},
): Promise<SearchHit[]> {
  const query = toTsQuery(text);
  if (!query) return [];
  const publishedOnly = opts.publishedOnly !== false;
  const limit = opts.limit ?? 10;
  const hits = await all<SearchHit & { restricted: number; collection_id: number | null }>(
    `SELECT a.id, a.slug, a.title, a.summary, a.status, a.restricted, a.collection_id,
            ts_headline('english', a.body, q,
              'StartSel=${MARK_OPEN}, StopSel=${MARK_CLOSE}, MaxWords=24, MinWords=10, MaxFragments=1, FragmentDelimiter=" … "') AS snippet
     FROM articles a, to_tsquery('english', $1) q
     WHERE a.search @@ q AND a.deleted_at IS NULL ${publishedOnly ? "AND a.status = 'published'" : ""}
     ORDER BY ts_rank_cd(a.search, q, 32) DESC, a.views DESC
     LIMIT $2`,
    [query, limit * 2],
  );
  // Public callers must not see restricted content unless the reader is signed in.
  const hidden = publishedOnly && !opts.includeRestricted ? await restrictedCollectionIds() : null;
  return hits
    .filter((h) => !hidden || (!h.restricted && !(h.collection_id && hidden.has(h.collection_id))))
    .slice(0, limit)
    .map((h) => ({ id: h.id, slug: h.slug, title: h.title, summary: h.summary, status: h.status, snippet: cleanSnippet(h.snippet) }));
}

export async function popularArticles(limit = 6, includeRestricted = false): Promise<ArticleRow[]> {
  const hidden = includeRestricted ? null : await restrictedCollectionIds();
  const rows = await all<ArticleRow>(
    `SELECT ${ROW_COLUMNS} FROM articles a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.deleted_at IS NULL AND a.status = 'published' ${includeRestricted ? "" : "AND a.restricted = 0"}
     ORDER BY a.views DESC, a.updated_at DESC LIMIT $1`,
    [limit * 3],
  );
  return rows.filter((a) => !hidden || !(a.collection_id && hidden.has(a.collection_id))).slice(0, limit);
}

export async function recordView(id: number): Promise<void> {
  await run("UPDATE articles SET views = views + 1 WHERE id = $1", [id]);
}

export async function recordFeedback(id: number, helpful: boolean): Promise<void> {
  await run(
    `UPDATE articles SET ${helpful ? "helpful_yes = helpful_yes + 1" : "helpful_no = helpful_no + 1"} WHERE id = $1`,
    [id],
  );
}

/* Redirects: old addresses (renamed articles, the previous help center) to current ones */

export async function redirectFor(path: string): Promise<string | undefined> {
  return (await get<{ to_path: string }>("SELECT to_path FROM redirects WHERE from_path = $1", [path]))?.to_path;
}

export async function listRedirects(): Promise<{ id: number; from_path: string; to_path: string }[]> {
  return all("SELECT id, from_path, to_path FROM redirects ORDER BY id DESC");
}

/** Compact catalog of every live article, for the agent's prompt. */
export async function articleIndex(): Promise<{ id: number; title: string; summary: string; status: string; collection: string }[]> {
  return all(
    `SELECT a.id, a.title, a.summary, a.status, coalesce(c.slug, '') AS collection
     FROM articles a LEFT JOIN collections c ON c.id = a.collection_id
     WHERE a.deleted_at IS NULL ORDER BY a.id LIMIT 500`,
  );
}

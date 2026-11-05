import "server-only";
import { getArticle, listArticles } from "./articles";
import { tx } from "./db";
import { addProposal, createThread, finishThread } from "./proposals";

export type ReplaceOptions = { matchCase: boolean; wholeWord: boolean; collectionId: number | null };

export type Match = { id: number; title: string; status: string; count: number; snippets: string[] };

function pattern(find: string, opts: ReplaceOptions): RegExp {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(opts.wholeWord ? `\\b${escaped}\\b` : escaped, opts.matchCase ? "g" : "gi");
}

/** Every article containing the text, with a few lines of context around each hit. */
export async function findMatches(find: string, opts: ReplaceOptions): Promise<Match[]> {
  if (!find) return [];
  const re = pattern(find, opts);
  const out: Match[] = [];
  for (const row of await listArticles(opts.collectionId ? { collectionId: opts.collectionId } : {})) {
    const a = (await getArticle(row.id))!;
    const text = `${a.title}\n${a.summary}\n${a.body}`;
    const hits = [...text.matchAll(re)];
    if (!hits.length) continue;
    out.push({
      id: a.id,
      title: a.title,
      status: a.status,
      count: hits.length,
      snippets: hits.slice(0, 3).map((h) => {
        const start = Math.max(0, h.index! - 50);
        return `${start > 0 ? "…" : ""}${text.slice(start, h.index! + h[0].length + 50).replace(/\s+/g, " ")}…`;
      }),
    });
  }
  return out;
}

/** Creates a thread whose proposals replace the text everywhere it appears. Nothing changes until approved. */
export async function createReplaceThread(find: string, replace: string, opts: ReplaceOptions): Promise<{ runId: number; count: number }> {
  const matches = await findMatches(find, opts);
  const re = pattern(find, opts);
  const runId = await tx(async () => {
    const runId = await createThread({
      kind: "bulk",
      title: `Replace “${find}” with “${replace}”`,
      prompt: `Replace "${find}" with "${replace}"${opts.matchCase ? " (match case)" : ""}${opts.wholeWord ? " (whole words)" : ""}.`,
      status: "done",
    });
    for (const m of matches) {
      const a = (await getArticle(m.id))!;
      await addProposal({
        runId,
        action: "update",
        articleId: a.id,
        collectionId: a.collection_id,
        title: a.title.replace(re, replace),
        summary: a.summary.replace(re, replace),
        body: a.body.replace(re, replace),
        baseBody: a.body,
        reason: `${m.count} ${m.count === 1 ? "occurrence" : "occurrences"} of “${find}”.`,
      });
    }
    await finishThread(runId, {
      summary: `Replaces “${find}” with “${replace}” in ${matches.length} ${matches.length === 1 ? "article" : "articles"}.`,
      confidence: "high",
      changes: [{ type: "changed", text: `“${find}” → “${replace}”` }],
    });
    return runId;
  });
  return { runId, count: matches.length };
}

import { logQuery } from "@/lib/analytics";
import { searchArticles } from "@/lib/articles";
import { hybridSearch } from "@/lib/search";

// Live search for the widget and ⌘K. Keystrokes use fast keyword search; a submitted search
// (final=1) also searches by meaning, and is the only kind logged, so Insights isn't flooded.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 300);
  if (q.length < 2) return Response.json({ results: [] });
  const final = url.searchParams.get("final") === "1";
  const hits = final ? await hybridSearch(q, { limit: 8 }) : await searchArticles(q, { limit: 8 });
  if (final) await logQuery("search", q, hits.length, hits.length > 0);
  return Response.json({
    results: hits.map((h) => ({ slug: h.slug, title: h.title, summary: h.summary })),
  });
}

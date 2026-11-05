import { extensionAuth, signedOut } from "@/lib/extension";
import { HIT_END, HIT_START } from "@/lib/format";
import { publicOrigin } from "@/lib/integrations";
import { hybridSearch } from "@/lib/search";

// GET /api/extension/search?q=…: published articles for the side panel and the !! popover.
export async function GET(req: Request) {
  if (!(await extensionAuth(req))) return signedOut();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return Response.json({ data: [] });
  const origin = publicOrigin(url.origin);
  const hits = await hybridSearch(q, { publishedOnly: true, includeRestricted: true, limit: 8 });
  return Response.json({
    data: hits.map((h) => ({
      id: h.id,
      title: h.title,
      summary: h.summary,
      snippet: h.snippet.replaceAll(HIT_START, "").replaceAll(HIT_END, ""),
      url: `${origin}/help/${h.slug}`,
    })),
  });
}

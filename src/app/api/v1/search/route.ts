import { authenticateRequest, unauthorized } from "@/lib/apikeys";
import { hybridSearch } from "@/lib/search";
import { HIT_END, HIT_START } from "@/lib/format";

// GET /api/v1/search?q=…&drafts=1
export async function GET(req: Request) {
  if (!await authenticateRequest(req)) return unauthorized();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const hits = await hybridSearch(q, { publishedOnly: url.searchParams.get("drafts") !== "1", includeRestricted: true, limit: 20 });
  return Response.json({
    data: hits.map((h) => ({ ...h, snippet: h.snippet.replaceAll(HIT_START, "").replaceAll(HIT_END, "") })),
  });
}

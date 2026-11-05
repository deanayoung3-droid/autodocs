import { getArticleBySlug, recordFeedback } from "@/lib/articles";

export async function POST(req: Request) {
  let body: { slug?: unknown; helpful?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const article = typeof body.slug === "string" ? await getArticleBySlug(body.slug) : undefined;
  if (!article || article.status !== "published" || typeof body.helpful !== "boolean") {
    return Response.json({ error: "Unknown article." }, { status: 400 });
  }
  await recordFeedback(article.id, body.helpful);
  return Response.json({ ok: true });
}

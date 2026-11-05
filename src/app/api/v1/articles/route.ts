import { authenticateRequest, unauthorized } from "@/lib/apikeys";
import { createArticle, getArticle, getCollectionBySlug, listArticles } from "@/lib/articles";
import { emit } from "@/lib/events";

// GET /api/v1/articles?status=published  ·  POST /api/v1/articles {title, summary?, body, section?, publish?}
export async function GET(req: Request) {
  if (!await authenticateRequest(req)) return unauthorized();
  const status = new URL(req.url).searchParams.get("status");
  const rows = await listArticles(status === "published" || status === "draft" ? { status } : {});
  return Response.json({
    data: rows.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      status: a.status,
      section: a.collection_slug,
      updated_at: a.updated_at,
    })),
  });
}

export async function POST(req: Request) {
  if (!await authenticateRequest(req)) return unauthorized();
  let body: { title?: string; summary?: string; body?: string; section?: string; publish?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  if (!body.title?.trim() || typeof body.body !== "string") return Response.json({ error: "title and body are required." }, { status: 400 });
  const id = await createArticle(
    {
      title: body.title.trim().slice(0, 200),
      summary: (body.summary ?? "").slice(0, 300),
      body: body.body,
      collectionId: body.section ? ((await getCollectionBySlug(body.section))?.id ?? null) : null,
    },
    body.publish ? "published" : "draft",
    "api",
  );
  const a = (await getArticle(id))!;
  if (body.publish) emit("article.published", { id: a.id, slug: a.slug, title: a.title });
  return Response.json({ data: a }, { status: 201 });
}

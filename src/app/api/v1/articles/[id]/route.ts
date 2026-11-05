import { authenticateRequest, unauthorized } from "@/lib/apikeys";
import { deleteArticle, getArticle, setArticleStatus, updateArticle } from "@/lib/articles";
import { emit } from "@/lib/events";

type Ctx = RouteContext<"/api/v1/articles/[id]">;

async function find(ctx: Ctx) {
  const a = await getArticle(Number((await ctx.params).id));
  return a && !a.deleted_at ? a : undefined;
}

export async function GET(req: Request, ctx: Ctx) {
  if (!await authenticateRequest(req)) return unauthorized();
  const a = await find(ctx);
  return a ? Response.json({ data: a }) : Response.json({ error: "Not found." }, { status: 404 });
}

// PATCH {title?, summary?, body?, status?: "draft" | "published"}
export async function PATCH(req: Request, ctx: Ctx) {
  if (!await authenticateRequest(req)) return unauthorized();
  const a = await find(ctx);
  if (!a) return Response.json({ error: "Not found." }, { status: 404 });
  let b: { title?: string; summary?: string; body?: string; status?: string };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  await updateArticle(
    a.id,
    { title: b.title ?? a.title, summary: b.summary ?? a.summary, body: b.body ?? a.body, collectionId: a.collection_id },
    "api",
  );
  if (b.status === "published" || b.status === "draft") await setArticleStatus(a.id, b.status);
  const next = (await getArticle(a.id))!;
  if (next.status === "published") emit(a.status === "published" ? "article.updated" : "article.published", { id: next.id, slug: next.slug, title: next.title });
  return Response.json({ data: next });
}

export async function DELETE(req: Request, ctx: Ctx) {
  if (!await authenticateRequest(req)) return unauthorized();
  const a = await find(ctx);
  if (!a) return Response.json({ error: "Not found." }, { status: 404 });
  await deleteArticle(a.id);
  emit("article.deleted", { id: a.id, slug: a.slug, title: a.title });
  return new Response(null, { status: 204 });
}

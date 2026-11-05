import { collectionRestricted, getArticleBySlug } from "@/lib/articles";
import { currentReader } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

// The article as plain Markdown, for AI tools and "Copy as Markdown".
export async function GET(_req: Request, { params }: RouteContext<"/help/md/[slug]">) {
  const a = await getArticleBySlug((await params).slug);
  const s = await getSettings();
  if (!a || a.status !== "published") return new Response("Not found", { status: 404 });
  const hidden = s.siteVisibility === "private" || a.restricted || await collectionRestricted(a.collection_id);
  if (hidden && !(await currentReader())) return new Response("Sign in to read this article.", { status: 401 });
  return new Response(`# ${a.title}\n\n${a.summary ? `${a.summary}\n\n` : ""}${a.body}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

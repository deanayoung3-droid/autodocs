import { connection } from "next/server";
import { collectionTree, flattenTree, listArticles, restrictedCollectionIds } from "@/lib/articles";
import { getSettings } from "@/lib/settings";

// llms.txt: an index of public articles that AI assistants can read, each linking to raw Markdown.
export async function GET(req: Request) {
  await connection();
  const s = await getSettings();
  if (s.siteVisibility === "private") return new Response("Not found", { status: 404 });
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const hidden = await restrictedCollectionIds();
  const articles = (await listArticles({ status: "published" }))
    .filter((a) => !a.restricted && !(a.collection_id && hidden.has(a.collection_id)))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const lines = [`# ${s.brandName} Help Center`, "", `> ${s.seoDescription || `Guides and answers for ${s.brandName}.`}`, ""];
  for (const section of [...flattenTree(await collectionTree()), { id: null as number | null, name: "Other" }]) {
    const items = articles.filter((a) => a.collection_id === section.id);
    if (!items.length) continue;
    lines.push(`## ${section.name}`, "");
    for (const a of items) lines.push(`- [${a.title}](${origin}/help/md/${a.slug})${a.summary ? `: ${a.summary}` : ""}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

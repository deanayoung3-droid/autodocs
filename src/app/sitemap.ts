import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { collectionTree, flattenTree, listArticles, restrictedCollectionIds } from "@/lib/articles";
import { parseSqlDate } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  if ((await getSettings()).siteVisibility === "private") return [];
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || "http://localhost:3000";
  const hidden = await restrictedCollectionIds();
  const articles = (await listArticles({ status: "published" }))
    .filter((a) => !a.restricted && !(a.collection_id && hidden.has(a.collection_id)))
    .map((a) => ({ url: `${origin}/help/${a.slug}`, lastModified: parseSqlDate(a.updated_at) }));
  const sections = flattenTree(await collectionTree())
    .filter((c) => !hidden.has(c.id))
    .map((c) => ({ url: `${origin}/help/c/${c.slug}` }));
  return [{ url: `${origin}/help` }, ...sections, ...articles];
}

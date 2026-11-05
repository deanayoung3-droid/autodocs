import { strToU8, zipSync } from "fflate";
import { cookies } from "next/headers";
import { collectionPath, collectionTree, flattenTree, getArticle, listArticles } from "@/lib/articles";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getScreenshot } from "@/lib/capture";
import { getFile, validKey } from "@/lib/storage";

// Everything as Markdown files (one folder per section) plus index.json, with the images the
// articles use: uploads under files/ and screenshots under screenshots/, at the paths the Markdown links to.
export async function GET() {
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) {
    return new Response("Sign in first.", { status: 401 });
  }
  const files: Record<string, Uint8Array> = {};
  const uploads = new Set<string>();
  const shots = new Set<number>();
  const index: { id: number; slug: string; title: string; status: string; path: string }[] = [];
  for (const row of await listArticles()) {
    const a = (await getArticle(row.id))!;
    const folder = (await collectionPath(a.collection_id)).map((c) => c.slug).join("/") || "unsorted";
    const path = `${folder}/${a.slug}.md`;
    const front = `---\ntitle: ${JSON.stringify(a.title)}\nsummary: ${JSON.stringify(a.summary)}\nstatus: ${a.status}\nupdated: ${a.updated_at}\n---\n\n`;
    files[path] = strToU8(front + a.body + "\n");
    for (const m of a.body.matchAll(/\/files\/([\w./-]+)/g)) if (validKey(m[1])) uploads.add(m[1]);
    for (const m of a.body.matchAll(/\/screenshots\/(\d+)/g)) shots.add(Number(m[1]));
    index.push({ id: a.id, slug: a.slug, title: a.title, status: a.status, path });
  }
  for (const key of uploads) {
    const f = await getFile(key);
    if (f) files[`files/${key}`] = new Uint8Array(f.body);
  }
  for (const id of shots) {
    const shot = await getScreenshot(id);
    const f = shot ? await getFile(shot.image_key) : null;
    if (f) files[`screenshots/${id}.webp`] = new Uint8Array(f.body);
  }
  const sections = flattenTree(await collectionTree()).map((c) => ({ id: c.id, slug: c.slug, name: c.name, parent_id: c.parent_id, icon: c.icon }));
  files["index.json"] = strToU8(JSON.stringify({ exported_at: new Date().toISOString(), sections, articles: index }, null, 2));
  const zip = zipSync(files);
  return new Response(zip.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="autodocs-${new Date().toISOString().slice(0, 10)}.zip"`,
    },
  });
}

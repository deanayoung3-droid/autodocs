import { getScreenshot } from "@/lib/capture";
import { getFile } from "@/lib/storage";

// A screenshot's current image. Articles link here, so retakes and box edits show up without
// editing the article; the ETag lets browsers and CDNs revalidate cheaply.
export async function GET(req: Request, { params }: RouteContext<"/screenshots/[id]">) {
  const shot = await getScreenshot(Number((await params).id));
  if (!shot) return new Response("Not found", { status: 404 });
  const etag = `"${shot.image_key.replace(/[^a-z0-9]/g, "")}"`;
  const headers = { ETag: etag, "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const file = await getFile(shot.image_key);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), { headers: { ...headers, "Content-Type": file.contentType } });
}

import { getFile } from "@/lib/storage";

// Stored files (imported and uploaded images, raw captures). Keys are random and never reused,
// so responses can be cached forever.
export async function GET(_req: Request, { params }: RouteContext<"/files/[...key]">) {
  const file = await getFile((await params).key.join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

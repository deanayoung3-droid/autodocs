import { recordWidgetEvent } from "@/lib/widgets";

// Widget telemetry: impressions, searches, and article opens, for per-widget stats.
export async function POST(req: Request) {
  let body: { widget?: unknown; kind?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const id = Number(body.widget);
  const kind = body.kind;
  if (!id || (kind !== "impression" && kind !== "search" && kind !== "view")) return new Response(null, { status: 400 });
  await recordWidgetEvent(id, kind);
  return new Response(null, { status: 204 });
}

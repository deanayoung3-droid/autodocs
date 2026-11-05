import { requireAdmin } from "@/lib/auth";
import { finishedSince } from "@/lib/notify";

// GET /api/admin/finished?since=ISO: threads you started that finished since then, for browser notifications.
export async function GET(req: Request) {
  const user = await requireAdmin();
  const since = new Date(new URL(req.url).searchParams.get("since") ?? "");
  if (Number.isNaN(since.getTime())) return Response.json({ error: "Pass since as an ISO date." }, { status: 400 });
  return Response.json({ threads: await finishedSince(user.id, since), now: new Date().toISOString() });
}

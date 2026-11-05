import { AI_SETUP_HINT, aiConfigured } from "@/lib/ai";
import { extensionAuth, readPage, recentTasks, signedOut, startExtensionTask } from "@/lib/extension";
import { adminOrigin } from "@/lib/integrations";

// GET: the docs tasks this person started. POST { prompt, page? }: starts one, like the composer in the app.
export async function GET(req: Request) {
  const auth = await extensionAuth(req);
  if (!auth) return signedOut();
  const origin = adminOrigin(new URL(req.url).origin);
  return Response.json({ data: (await recentTasks(auth.user.id)).map((t) => ({ ...t, url: `${origin}/admin/agent/${t.id}` })) });
}

export async function POST(req: Request) {
  const auth = await extensionAuth(req);
  if (!auth) return signedOut();
  if (!aiConfigured()) return Response.json({ error: AI_SETUP_HINT }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; page?: unknown };
  const prompt = String(body.prompt ?? "").trim();
  if (prompt.length < 5 || prompt.length > 4000) return Response.json({ error: "Describe the docs change in 5 to 4,000 characters." }, { status: 400 });
  const id = await startExtensionTask(auth.user, prompt, readPage(body.page));
  return Response.json({ id, url: `${adminOrigin(new URL(req.url).origin)}/admin/agent/${id}` }, { status: 201 });
}

import { AI_SETUP_HINT, AIError, aiConfigured } from "@/lib/ai";
import { draftReply, extensionAuth, signedOut } from "@/lib/extension";
import { publicOrigin } from "@/lib/integrations";

// POST /api/extension/draft { conversation, instructions? }: a reply to paste into the helpdesk.
export async function POST(req: Request) {
  if (!(await extensionAuth(req))) return signedOut();
  if (!aiConfigured()) return Response.json({ error: AI_SETUP_HINT }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { conversation?: unknown; instructions?: unknown };
  const conversation = String(body.conversation ?? "").trim();
  if (conversation.length < 10) return Response.json({ error: "There's no conversation on this page to reply to. Select the customer's message and try again." }, { status: 400 });
  try {
    return Response.json(await draftReply(conversation.slice(-12_000), publicOrigin(new URL(req.url).origin), String(body.instructions ?? "")));
  } catch (err) {
    if (err instanceof AIError) return Response.json({ error: err.message }, { status: 502 });
    throw err;
  }
}

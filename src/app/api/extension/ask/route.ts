import { AI_SETUP_HINT, AIError, aiConfigured } from "@/lib/ai";
import { answerForTeammate, extensionAuth, readPage, signedOut } from "@/lib/extension";
import { publicOrigin } from "@/lib/integrations";

// POST /api/extension/ask { question, page? }: an answer from the help center, with citations.
export async function POST(req: Request) {
  if (!(await extensionAuth(req))) return signedOut();
  if (!aiConfigured()) return Response.json({ error: AI_SETUP_HINT }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; page?: unknown };
  const question = String(body.question ?? "").trim();
  if (question.length < 3 || question.length > 2000) return Response.json({ error: "Ask a question between 3 and 2,000 characters long." }, { status: 400 });
  try {
    return Response.json(await answerForTeammate(question, publicOrigin(new URL(req.url).origin), readPage(body.page)));
  } catch (err) {
    if (err instanceof AIError) return Response.json({ error: err.message }, { status: 502 });
    throw err;
  }
}

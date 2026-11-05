import { markHandoff, rateAnswer, visitorId } from "@/lib/analytics";

// A reader's reaction to an AI answer: thumbs up or down, or going on to contact support.
// Only the visitor who asked can rate their own answer.
export async function POST(req: Request) {
  let body: { conversation?: unknown; helpful?: unknown; handoff?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const id = Number(body.conversation);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Missing conversation." }, { status: 400 });
  if (body.handoff === true) await markHandoff(id);
  if (typeof body.helpful === "boolean") await rateAnswer(id, visitorId(req.headers), body.helpful);
  return new Response(null, { status: 204 });
}

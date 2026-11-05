import { authenticateRequest, unauthorized } from "@/lib/apikeys";
import { ingestConversation, transcriptOf } from "@/lib/support";

// POST /api/v1/support/conversations: the Support Endpoint. Send each conversation when it's
// resolved: {id, subject?, customer?, source?, resolved_at?, messages: [{from: "customer"|"agent", text}]}
// or {id, transcript}. Sending the same id again replaces it.
export async function POST(req: Request) {
  if (!(await authenticateRequest(req))) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  const id = body.id ?? body.external_id;
  if ((typeof id !== "string" && typeof id !== "number") || !String(id).trim()) {
    return Response.json({ error: "Include the conversation's id from your helpdesk." }, { status: 400 });
  }
  const transcript = transcriptOf(body);
  if (transcript.length < 20) return Response.json({ error: "Include messages: [{from, text}] or a transcript." }, { status: 400 });
  const resolved = typeof body.resolved_at === "string" && !Number.isNaN(Date.parse(body.resolved_at)) ? body.resolved_at : undefined;
  await ingestConversation({
    externalId: String(id),
    source: typeof body.source === "string" ? body.source : "",
    subject: typeof body.subject === "string" ? body.subject : "",
    customer: typeof body.customer === "string" ? body.customer : "",
    transcript,
    resolvedAt: resolved,
  });
  return Response.json({ received: String(id) }, { status: 202 });
}

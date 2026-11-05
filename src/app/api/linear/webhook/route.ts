import { after } from "next/server";
import { prepareRerun, queueThread, startThread } from "@/lib/agent";
import { aiConfigured } from "@/lib/ai";
import { hmacMatches } from "@/lib/crypto";
import { tx } from "@/lib/db";
import { linearConfig, linearRevoked, linearWebhookSecret, linkSession, postActivity, recordSession, sessionById, threadUrl } from "@/lib/linear";
import { dismissThread } from "@/lib/proposals";

type Issue = { identifier?: string; title?: string; url?: string; description?: string };
type SessionEvent = {
  type: "AgentSessionEvent";
  action: "created" | "prompted";
  organizationId?: string;
  promptContext?: string;
  agentSession: { id: string; issue?: Issue; comment?: { body?: string }; creator?: { name?: string } };
  agentActivity?: { content?: { body?: string }; body?: string; signal?: string };
};

class AlreadyStarted extends Error {}

const ok = (body: Record<string, unknown>, status = 200) => Response.json(body, { status });

/** Posts to the issue after the reply is sent; Linear wants the webhook answered within seconds. */
function later(sessionId: string, work: () => Promise<unknown>) {
  after(() => work().catch((err) => console.warn(`[linear] session ${sessionId}: ${err instanceof Error ? err.message : err}`)));
}

// Webhooks from the Linear app. Someone mentioning or assigning Docs Agent on an issue opens an agent
// session ("created"); replying to Docs Agent in that session sends "prompted".
export async function POST(req: Request) {
  const secret = await linearWebhookSecret();
  if (!secret) return ok({ error: "Connect Linear in Integrations first." }, 503);
  const raw = await req.text();
  if (!hmacMatches(secret, raw, req.headers.get("linear-signature") ?? "")) return ok({ error: "Signature doesn't match." }, 401);
  const payload = JSON.parse(raw);
  // Linear signs the delivery time too; refuse replays of old deliveries.
  if (typeof payload.webhookTimestamp === "number" && Math.abs(Date.now() - payload.webhookTimestamp) > 60_000) {
    return ok({ error: "Delivery is too old." }, 401);
  }

  if (payload.type === "OAuthApp" && payload.action === "revoked") {
    await linearRevoked();
    return ok({ disconnected: true });
  }
  if (payload.type !== "AgentSessionEvent") return ok({ ignored: `event ${payload.type}` });

  const event = payload as SessionEvent;
  const config = await linearConfig();
  if (!config.organizationId) return ok({ ignored: "Linear isn't connected" });
  if (event.organizationId && event.organizationId !== config.organizationId) return ok({ ignored: "another Linear workspace" });
  if (!event.agentSession?.id) return ok({ error: "No agent session." }, 400);

  const existing = await sessionById(event.agentSession.id);
  if (event.action === "prompted" && existing) return prompted(event, existing.run_id, config.origin);
  if (event.action === "created" || event.action === "prompted") {
    if (existing) return ok({ duplicate: existing.run_id });
    return created(event, config.origin);
  }
  return ok({ ignored: `action ${event.action}` });
}

async function created(event: SessionEvent, origin: string | undefined) {
  const session = event.agentSession;
  if (!aiConfigured()) {
    later(session.id, () => postActivity(session.id, { type: "error", body: "Docs Agent isn't set up yet: add an OpenAI API key in Settings → AI." }));
    return ok({ ignored: "no OpenAI API key" });
  }
  const issue = session.issue ?? {};
  const identifier = issue.identifier ?? "the issue";
  const who = session.creator?.name || "A teammate";
  const context =
    event.promptContext?.trim() ||
    [issue.title, issue.description, session.comment?.body, event.agentActivity?.content?.body].filter(Boolean).join("\n\n");
  const prompt = `${who} asked you about Linear issue ${identifier}${issue.title ? ` ("${issue.title}")` : ""}.

<linear_context>
${context}
</linear_context>

Work out what the help center needs because of this issue: new articles, or updates to existing ones. Propose them. If the issue doesn't call for documentation changes, say so in your summary and propose nothing.`;

  let runId: number;
  try {
    runId = await tx(async () => {
      const id = await startThread({
        kind: "task",
        title: `${issue.identifier ? `${issue.identifier}: ` : ""}${issue.title ?? "Linear request"}`.slice(0, 120),
        prompt,
        ref: issue.identifier ?? null,
        url: issue.url ?? null,
        author: session.creator?.name ?? null,
      });
      const fresh = await recordSession({
        sessionId: session.id,
        runId: id,
        identifier: issue.identifier ?? "",
        title: issue.title ?? "",
        url: issue.url ?? "",
        requestedBy: session.creator?.name ?? "",
      });
      // Linear redelivered a session another request already started; keep only one thread.
      if (!fresh) throw new AlreadyStarted();
      return id;
    });
  } catch (err) {
    if (err instanceof AlreadyStarted) return ok({ duplicate: true });
    throw err;
  }
  await queueThread(runId);
  later(session.id, async () => {
    await postActivity(session.id, { type: "thought", body: `On it. Reading ${identifier} and the help center.` });
    await linkSession(session.id, threadUrl(origin, runId));
  });
  return ok({ queued: runId });
}

async function prompted(event: SessionEvent, runId: number, origin: string | undefined) {
  const session = event.agentSession;
  if (event.agentActivity?.signal === "stop") {
    await dismissThread(runId);
    later(session.id, () => postActivity(session.id, { type: "response", body: `Stopped. Nothing was published. [Open the thread](${threadUrl(origin, runId)})` }));
    return ok({ stopped: runId });
  }
  const text = (event.agentActivity?.content?.body ?? event.agentActivity?.body ?? "").trim();
  if (!text) return ok({ ignored: "empty reply" });
  await prepareRerun(runId, text);
  await queueThread(runId);
  later(session.id, () => postActivity(session.id, { type: "thought", body: "Got it. Revising the drafts." }));
  return ok({ requeued: runId });
}

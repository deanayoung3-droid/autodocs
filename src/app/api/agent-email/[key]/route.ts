import crypto from "node:crypto";
import { queueThread, startThread } from "@/lib/agent";
import { aiConfigured } from "@/lib/ai";
import { get, run } from "@/lib/db";
import { emailAddress, newPartOfEmail, readInbound } from "@/lib/inbox";
import { emailAgentKey } from "@/lib/mailer";
import { getSettings } from "@/lib/settings";

const MAX_BYTES = 10 * 1024 * 1024;

// Email Docs Agent: an email to Docs Agent's address becomes a task. Your email service forwards it here.
export async function POST(req: Request, ctx: RouteContext<"/api/agent-email/[key]">) {
  const { key } = await ctx.params;
  const expected = await emailAgentKey();
  if (!expected || expected.length !== key.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(key))) {
    return Response.json({ error: "Unknown address." }, { status: 404 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Too large." }, { status: 413 });
  const email = await readInbound(req);
  if (!email) return Response.json({ error: "Empty message." }, { status: 400 });

  const sender = emailAddress(email.from);
  const settings = await getSettings();
  const teammate = await get<{ id: number; name: string }>("SELECT id, name FROM users WHERE email = $1", [sender]);
  // Only teammates can hand Docs Agent work, unless the workspace lets anyone.
  if (!teammate && !settings.emailAgentExternal) return Response.json({ ignored: "sender isn't on the team" }, { status: 202 });
  if (!aiConfigured()) return Response.json({ ignored: "no OpenAI API key" }, { status: 202 });
  const body = newPartOfEmail(email.text || email.html.replace(/<[^>]+>/g, " "));
  if (body.length < 8 && email.subject.trim().length < 8) return Response.json({ ignored: "empty request" }, { status: 202 });

  const id = await startThread({
    kind: "task",
    title: email.subject.trim() || body.split("\n")[0].slice(0, 120),
    prompt: `${email.subject.trim() ? `${email.subject.trim()}\n\n` : ""}${body}\n\n(Emailed to Docs Agent by ${teammate?.name ?? sender}.)`,
    ref: "Email",
    author: teammate?.name ?? sender,
    startedBy: teammate?.id ?? null,
  });
  await run("UPDATE agent_runs SET reply_to = coalesce(reply_to, '{}'::jsonb) || $1::jsonb WHERE id = $2", [
    JSON.stringify({ email: sender, subject: email.subject, messageId: email.messageId }),
    id,
  ]);
  await queueThread(id);
  return Response.json({ queued: id }, { status: 202 });
}

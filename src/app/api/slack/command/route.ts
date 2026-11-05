import crypto from "node:crypto";
import { queueThread, startThread } from "@/lib/agent";
import { aiConfigured } from "@/lib/ai";
import { adminOrigin } from "@/lib/integrations";
import { replyInSlack, slackSigningSecret } from "@/lib/slack";

// Slack slash command, e.g. `/docs document how CSV export works`. Starts an agent task.
export async function POST(req: Request) {
  const secret = await slackSigningSecret();
  if (!secret) return new Response("Slack isn't set up: add the app's signing secret on the Slack integration page.", { status: 503 });
  const raw = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return new Response("Stale request.", { status: 401 });
  const expected = `v0=${crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`;
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return new Response("Bad signature.", { status: 401 });
  }
  const form = new URLSearchParams(raw);
  const prompt = (form.get("text") ?? "").trim();
  const who = form.get("user_name") ?? "someone";
  if (prompt.length < 8) {
    return Response.json({ response_type: "ephemeral", text: "Tell me what to document, e.g. `/docs document how CSV export works`." });
  }
  if (!aiConfigured()) return Response.json({ response_type: "ephemeral", text: "Docs Agent isn't set up yet: add an OpenAI API key in Settings → AI." });
  const id = await startThread({ kind: "task", prompt: `${prompt}\n\n(Requested in Slack by ${who}.)`, ref: "Slack", author: who });
  const responseUrl = form.get("response_url");
  if (responseUrl) await replyInSlack(id, responseUrl);
  await queueThread(id);
  const origin = adminOrigin(new URL(req.url).origin);
  return Response.json({ response_type: "ephemeral", text: `On it. I'll post here when the drafts are ready. Follow along: ${origin}/admin/agent/${id}` });
}
